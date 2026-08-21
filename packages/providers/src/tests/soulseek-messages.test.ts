import { describe, expect, test } from "bun:test"
import { deflateSync } from "node:zlib"
import { Reader, Writer, codeBody, frame } from "../sources/soulseek/protocol"
import {
  decodeConnectToPeer,
  decodeFileSearchResponse,
  decodeFileTransferInit,
  decodeGetPeerAddressResponse,
  decodeLogin,
  decodePeerInit,
  decodePierceFirewall,
  decodePlaceInQueueResponse,
  decodeTransferRequest,
  decodeUploadDenied,
  decodeUploadFailed,
  encodeCantConnectToPeer,
  encodeConnectToPeerRequest,
  encodeFileOffset,
  encodeFileSearch,
  encodeGetPeerAddress,
  encodeLogin,
  encodePeerInit,
  encodePierceFirewall,
  encodePlaceInQueueRequest,
  encodeQueueUpload,
  encodeSetWaitPort,
  encodeTransferResponse,
  PEER_CODES,
  SERVER_CODES,
} from "../sources/soulseek/messages"

describe("protocol primitives", () => {
  test("writer/reader round-trip", () => {
    const buf = new Writer().u32(0xdeadbeef).u64(5_000_000_000).bool(true).string("hello").build()
    const reader = new Reader(buf)
    expect(reader.u32()).toBe(0xdeadbeef)
    expect(reader.u64()).toBe(5_000_000_000n)
    expect(reader.bool()).toBe(true)
    expect(reader.string()).toBe("hello")
    expect(reader.hasRemaining()).toBe(false)
  })

  test("framing: size field counts code + payload", () => {
    const framed = frame(codeBody(26, new Writer().u32(7).build()))
    expect(framed.readUInt32LE(0)).toBe(8)
    expect(framed.readUInt32LE(4)).toBe(26)
  })

  test("fileSize handles the Soulseek NS >2GiB bug", () => {
    const buggy = Buffer.alloc(8)
    buggy.writeUInt32LE(3_000_000_000, 0)
    buggy.writeUInt32LE(0xffffffff, 4)
    expect(new Reader(buggy).fileSize()).toBe(3_000_000_000)

    const normal = new Writer().u64(6_000_000_000).build()
    expect(new Reader(normal).fileSize()).toBe(6_000_000_000)
  })

  test("ip decoding", () => {
    const reader = new Reader(new Writer().u32((2 << 24) | (1 << 16) | (168 << 8) | 192).build())
    expect(reader.ip()).toBe("192.168.1.2")
  })
})

describe("messages", () => {
  test("login encode contains md5 of credentials", () => {
    const msg = encodeLogin("user", "pass")
    const text = msg.toString("latin1")
    expect(text).toContain("user")
    expect(text).toContain("pass")
    expect(text).toContain("63e780c3f321d131")
  })

  test("login response success and failure", () => {
    const ok = frame(codeBody(1, new Writer().bool(true).string("welcome").u32((2 << 24) | (1 << 16)).string("md5").bool(false).build()))
    const decoded = decodeLogin(ok.subarray(4))
    expect(decoded.success).toBe(true)
    expect(decoded.banner).toBe("welcome")
    expect(decoded.ipAddress).toBe("0.0.1.2")

    const rejected = frame(codeBody(1, new Writer().bool(false).string("INVALIDPASS").build()))
    const failed = decodeLogin(rejected.subarray(4))
    expect(failed.success).toBe(false)
    expect(failed.rejectionReason).toBe("INVALIDPASS")
  })

  test("setwaitport and filesearch framing", () => {
    expect(encodeSetWaitPort(2234).readUInt32LE(0)).toBe(8)
    const search = encodeFileSearch(12345, "pink - floyd")
    const reader = new Reader(search.subarray(8))
    expect(reader.u32()).toBe(12345)
    expect(reader.string()).toBe("pink floyd")
  })

  test("filesearch matches nicotine-plus reference fixture byte-for-byte", () => {
    // From nicotine-plus tests/unit/protocol/test_slskmessages.py FileSearchTest
    const expectedBody = Buffer.from([
      0xaa, 0x49, 0x46, 0x1f, 0x0c, 0, 0, 0, ...Buffer.from("70 gwen auto"),
    ])
    const actual = encodeFileSearch(524700074, "70 gwen auto")
    expect(actual.readUInt32LE(0)).toBe(24)
    expect(actual.readUInt32LE(4)).toBe(26)
    expect(actual.subarray(8).equals(expectedBody)).toBe(true)
  })

  test("peer init encode/decode", () => {
    const encoded = encodePeerInit("me", "P")
    const decoded = decodePeerInit(encoded.subarray(4))
    expect(decoded.username).toBe("me")
    expect(decoded.connType).toBe("P")
  })

  test("connect to peer decode", () => {
    const payload = codeBody(
      18,
      new Writer().string("peer1").string("F").u32((10 << 24) | (0 << 16) | (0 << 8) | 1).u32(4242).u32(99).build(),
    )
    const decoded = decodeConnectToPeer(payload)
    expect(decoded.user).toBe("peer1")
    expect(decoded.connType).toBe("F")
    expect(decoded.ipAddress).toBe("1.0.0.10")
    expect(decoded.port).toBe(4242)
    expect(decoded.token).toBe(99)
  })

  test("get peer address matches nicotine-plus reference fixture byte-for-byte", () => {
    // From nicotine-plus tests/unit/protocol/test_slskmessages.py GetPeerAddressMessageTest
    const encoded = encodeGetPeerAddress("user1")
    expect(encoded.readUInt32LE(4)).toBe(SERVER_CODES.GET_PEER_ADDRESS)
    expect(encoded.subarray(8).equals(Buffer.from("\x05\x00\x00\x00user1", "latin1"))).toBe(true)

    const reply = codeBody(
      3,
      new Writer().string("user1").u32((10 << 24) | 1).u32(2234).u32(0).build(),
    )
    const decoded = decodeGetPeerAddressResponse(reply)
    expect(decoded.user).toBe("user1")
    expect(decoded.ipAddress).toBe("1.0.0.10")
    expect(decoded.port).toBe(2234)
  })

  test("connect to peer request and cant connect encode", () => {
    const request = encodeConnectToPeerRequest(99, "peer1", "P")
    expect(request.readUInt32LE(4)).toBe(SERVER_CODES.CONNECT_TO_PEER)
    const reader = new Reader(request.subarray(8))
    expect(reader.u32()).toBe(99)
    expect(reader.string()).toBe("peer1")
    expect(reader.string()).toBe("P")

    const cant = encodeCantConnectToPeer(99, "peer1")
    expect(cant.readUInt32LE(4)).toBe(SERVER_CODES.CANT_CONNECT_TO_PEER)
  })

  test("pierce firewall round-trip uses the 1-byte init code", () => {
    const encoded = encodePierceFirewall(4242)
    expect(encoded.readUInt32LE(0)).toBe(5)
    expect(encoded.readUInt8(4)).toBe(0)
    expect(decodePierceFirewall(encoded.subarray(4))).toBe(4242)
  })

  test("queue upload and place in queue framing", () => {
    const queue = encodeQueueUpload("Music\\a.flac")
    expect(queue.readUInt32LE(4)).toBe(PEER_CODES.QUEUE_UPLOAD)
    expect(new Reader(queue.subarray(8)).string()).toBe("Music\\a.flac")

    const request = encodePlaceInQueueRequest("Music\\a.flac")
    expect(request.readUInt32LE(4)).toBe(PEER_CODES.PLACE_IN_QUEUE_REQUEST)

    const response = decodePlaceInQueueResponse(new Writer().string("Music\\a.flac").u32(7).build())
    expect(response.file).toBe("Music\\a.flac")
    expect(response.place).toBe(7)
  })

  test("transfer request decode: upload direction carries filesize, download does not", () => {
    const upload = decodeTransferRequest(
      new Writer().u32(1).u32(55).string("Music\\a.flac").u64(6_000_000_000).build(),
    )
    expect(upload.direction).toBe(1)
    expect(upload.token).toBe(55)
    expect(upload.file).toBe("Music\\a.flac")
    expect(upload.filesize).toBe(6_000_000_000)

    const download = decodeTransferRequest(new Writer().u32(0).u32(56).string("Music\\b.mp3").build())
    expect(download.filesize).toBeUndefined()
  })

  test("transfer response encode: allowed omits reason, denied includes it", () => {
    const allowed = encodeTransferResponse(55, true)
    const okReader = new Reader(allowed.subarray(8))
    expect(okReader.u32()).toBe(55)
    expect(okReader.bool()).toBe(true)
    expect(okReader.hasRemaining()).toBe(false)

    const denied = encodeTransferResponse(55, false, "Paused")
    const noReader = new Reader(denied.subarray(8))
    expect(noReader.u32()).toBe(55)
    expect(noReader.bool()).toBe(false)
    expect(noReader.string()).toBe("Paused")
  })

  test("upload denied and failed decode", () => {
    const denied = decodeUploadDenied(new Writer().string("Music\\a.flac").string("Queued").build())
    expect(denied.file).toBe("Music\\a.flac")
    expect(denied.reason).toBe("Queued")
    expect(decodeUploadFailed(new Writer().string("Music\\a.flac").build())).toBe("Music\\a.flac")
  })

  test("file connection handshake messages are raw and unframed", () => {
    const offset = encodeFileOffset(3_000_000_000)
    expect(offset.length).toBe(8)
    expect(new Reader(offset).u64()).toBe(3_000_000_000n)

    expect(decodeFileTransferInit(new Writer().u32(4242).build())).toBe(4242)
    expect(decodeFileTransferInit(Buffer.from([1, 2]))).toBeUndefined()
  })

  test("file search response decode", () => {
    const files = new Writer()
      .u32(2)
      .u8(1).string("Music\\Artist\\01 - Song.flac").u64(30_000_000).u32(0)
        .u32(3).u32(1).u32(180).u32(4).u32(44100).u32(5).u32(16)
      .u8(1).string("Music\\Artist\\02 - Song.mp3").u64(8_000_000).u32(0)
        .u32(1).u32(0).u32(320)
      .build()

    const inner = new Writer()
      .string("uploader")
      .u32(777)
      .bytes(files)
      .bool(true)
      .u32(1_000_000)
      .u32(2)
      .u32(0)
      .build()

    const compressed = deflateSync(inner)
    const message = Buffer.concat([Buffer.alloc(4), new Writer().u32(9).build(), compressed]).subarray(4)
    // peer framing: [size][code][payload]; decode takes the payload after the code
    const payload = message.subarray(4)

    const decoded = decodeFileSearchResponse(payload)
    expect(decoded.username).toBe("uploader")
    expect(decoded.token).toBe(777)
    expect(decoded.files.length).toBe(2)
    expect(decoded.files[0]!.path).toBe("Music\\Artist\\01 - Song.flac")
    expect(decoded.files[0]!.size).toBe(30_000_000)
    expect(decoded.files[0]!.duration).toBe(180)
    expect(decoded.files[0]!.sampleRate).toBe(44100)
    expect(decoded.files[0]!.bitDepth).toBe(16)
    expect(decoded.files[1]!.bitrate).toBe(320)
    expect(decoded.freeUploadSlots).toBe(true)
    expect(decoded.uploadSpeed).toBe(1_000_000)
    expect(decoded.queueLength).toBe(2)
  })
})
