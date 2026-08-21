import { describe, expect, test } from "bun:test"
import { deflateSync } from "node:zlib"
import { Reader, Writer, codeBody, frame } from "../sources/soulseek/protocol"
import {
  decodeConnectToPeer,
  decodeFileSearchResponse,
  decodeLogin,
  decodePeerInit,
  encodeFileSearch,
  encodeLogin,
  encodePeerInit,
  encodeSetWaitPort,
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
