import { afterEach, describe, expect, test } from "bun:test"
import net, { type Socket } from "node:net"
import { SoulseekClient } from "../sources/soulseek/client"
import { Writer, codeBody, frame } from "../sources/soulseek/protocol"
import {
  decodePeerInit,
  decodePierceFirewall,
  encodePeerInit,
  encodePierceFirewall,
  PEER_CODES,
  PEER_INIT_CODES,
  SERVER_CODES,
} from "../sources/soulseek/messages"
import { Reader } from "../sources/soulseek/protocol"

const LOOPBACK = 16777343 // 127.0.0.1 in the protocol's little-endian byte order

interface FakeServer {
  readonly port: number
  readonly received: Buffer[]
  socket: Socket | undefined
  close(): Promise<void>
  send(data: Buffer): void
  onMessage(handler: (code: number, reader: Reader) => void): void
}

function startFakeServer(peerPort: () => number): Promise<FakeServer> {
  return new Promise((resolve) => {
    const received: Buffer[] = []
    const handlers: ((code: number, reader: Reader) => void)[] = []
    const state: { socket: Socket | undefined } = { socket: undefined }
    const server = net.createServer((socket) => {
      state.socket = socket
      let buffer: Buffer = Buffer.alloc(0)
      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])
        for (;;) {
          if (buffer.length < 8) return
          const size = buffer.readUInt32LE(0)
          if (buffer.length < size + 4) return
          const payload = buffer.subarray(4, size + 4)
          buffer = buffer.subarray(size + 4)
          received.push(payload)
          const code = payload.readUInt32LE(0)
          if (code === SERVER_CODES.LOGIN) {
            socket.write(frame(codeBody(1, new Writer().bool(true).string("ok").u32(LOOPBACK).build())))
            continue
          }
          if (code === SERVER_CODES.GET_PEER_ADDRESS) {
            const reader = new Reader(payload.subarray(4))
            const user = reader.string()
            socket.write(
              frame(codeBody(3, new Writer().string(user).u32(LOOPBACK).u32(peerPort()).u32(0).build())),
            )
            continue
          }
          for (const handler of handlers) handler(code, new Reader(payload.subarray(4)))
        }
      })
    })
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      resolve({
        port,
        received,
        get socket() {
          return state.socket
        },
        set socket(_value) {},
        close: () =>
          new Promise<void>((done) => {
            state.socket?.destroy()
            server.close(() => done())
          }),
        send: (data) => state.socket?.write(data),
        onMessage: (handler) => handlers.push(handler),
      })
    })
  })
}

interface FakePeer {
  readonly port: number
  socket: Socket | undefined
  waitForConnection(): Promise<Socket>
  close(): Promise<void>
}

function startFakePeer(): Promise<FakePeer> {
  return new Promise((resolve) => {
    const state: { socket: Socket | undefined; waiters: ((s: Socket) => void)[] } = { socket: undefined, waiters: [] }
    const server = net.createServer((socket) => {
      state.socket = socket
      for (const waiter of state.waiters.splice(0)) waiter(socket)
    })
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      resolve({
        port,
        get socket() {
          return state.socket
        },
        set socket(_value) {},
        waitForConnection: () =>
          state.socket !== undefined
            ? Promise.resolve(state.socket)
            : new Promise((done) => state.waiters.push(done)),
        close: () =>
          new Promise<void>((done) => {
            state.socket?.destroy()
            server.close(() => done())
          }),
      })
    })
  })
}

function readBytes(socket: Socket, count: number): Promise<Buffer> {
  return new Promise((resolve) => {
    let buffer: Buffer = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length >= count) {
        socket.removeListener("data", onData)
        resolve(buffer)
      }
    }
    socket.on("data", onData)
  })
}

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function connectedClient(peerPort: () => number = () => 0): Promise<{ client: SoulseekClient; server: FakeServer }> {
  const server = await startFakeServer(peerPort)
  const client = new SoulseekClient()
  cleanups.push(() => client.disconnect())
  cleanups.push(() => server.close())
  const response = await client.connect({
    username: "me",
    password: "pw",
    host: "127.0.0.1",
    port: server.port,
    listenPort: 0,
  })
  expect(response.success).toBe(true)
  return { client, server }
}

describe("SoulseekClient peer connections", () => {
  test("direct peer session: dials the address from the server and sends PeerInit", async () => {
    const peer = await startFakePeer()
    cleanups.push(() => peer.close())
    const { client } = await connectedClient(() => peer.port)

    const messages: { username: string; code: number }[] = []
    client.onPeerMessage((username, code) => messages.push({ username, code }))

    const sessionPromise = client.peerSession("uploader")
    const socket = await peer.waitForConnection()
    const initBytes = await readBytes(socket, 5)
    expect(initBytes.readUInt8(4)).toBe(PEER_INIT_CODES.PEER_INIT)
    const init = decodePeerInit(initBytes.subarray(4))
    expect(init.username).toBe("me")
    expect(init.connType).toBe("P")

    const session = await sessionPromise
    expect(session.username).toBe("uploader")
    expect(session.open).toBe(true)

    socket.write(frame(codeBody(PEER_CODES.UPLOAD_FAILED, new Writer().string("f").build())))
    await Bun.sleep(50)
    expect(messages).toEqual([{ username: "uploader", code: PEER_CODES.UPLOAD_FAILED }])
  })

  test("indirect fallback: unreachable peer connects inbound with PierceFireWall", async () => {
    const { client, server } = await connectedClient(() => 0)

    let pierceToken: number | undefined
    server.onMessage((code, reader) => {
      if (code !== SERVER_CODES.CONNECT_TO_PEER) return
      pierceToken = reader.u32()
      expect(reader.string()).toBe("shy-peer")
      expect(reader.string()).toBe("P")
      const socket = net.connect({ host: "127.0.0.1", port: client.listeningPort! })
      socket.once("connect", () => socket.write(encodePierceFirewall(pierceToken!)))
    })

    const session = await client.peerSession("shy-peer")
    expect(session.username).toBe("shy-peer")
    expect(session.open).toBe(true)
    expect(pierceToken).toBeDefined()
  })

  test("inbound F connection routes by transfer token with buffered payload", async () => {
    const { client } = await connectedClient()

    const waiter = client.expectFileConnection(555, 5_000)
    const socket = net.connect({ host: "127.0.0.1", port: client.listeningPort! })
    socket.once("connect", () => {
      socket.write(
        Buffer.concat([encodePeerInit("uploader", "F"), new Writer().u32(555).build(), Buffer.from("abc")]),
      )
    })
    cleanups.push(() => {
      socket.destroy()
    })

    const conn = await waiter
    expect(conn.initial.toString()).toBe("abc")
  })

  test("server-relayed F ConnectToPeer: client dials out, pierces, then routes the token", async () => {
    const peer = await startFakePeer()
    cleanups.push(() => peer.close())
    const { client, server } = await connectedClient(() => peer.port)

    const waiter = client.expectFileConnection(777, 5_000)
    server.send(
      frame(
        codeBody(
          SERVER_CODES.CONNECT_TO_PEER,
          new Writer().string("uploader").string("F").u32(LOOPBACK).u32(peer.port).u32(42).build(),
        ),
      ),
    )

    const socket = await peer.waitForConnection()
    const pierce = await readBytes(socket, 9)
    expect(pierce.readUInt8(4)).toBe(PEER_INIT_CODES.PIERCE_FIREWALL)
    expect(decodePierceFirewall(pierce.subarray(4))).toBe(42)

    socket.write(Buffer.concat([new Writer().u32(777).build(), Buffer.from("xyz")]))
    const conn = await waiter
    expect(conn.initial.toString()).toBe("xyz")
  })

  test("expectFileConnection times out and cleans up its waiter", async () => {
    const { client } = await connectedClient()
    const started = Date.now()
    await expect(client.expectFileConnection(999, 100)).rejects.toThrow("transfer connection timed out")
    expect(Date.now() - started).toBeGreaterThanOrEqual(90)
  })
})

describe("SoulseekClient login handling", () => {
  test("a rejected login is cached until the credentials change", async () => {
    let logins = 0
    const server = net.createServer((socket) => {
      socket.on("data", () => {
        logins += 1
        socket.write(frame(codeBody(1, new Writer().bool(false).string("INVALIDPASS").build())))
      })
    })
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()))
    cleanups.push(() => new Promise<void>((done) => server.close(() => done())))
    const address = server.address()
    const port = typeof address === "object" && address !== null ? address.port : 0
    const client = new SoulseekClient()
    cleanups.push(() => client.disconnect())
    const creds = { username: "me", password: "wrong", host: "127.0.0.1", port, listenPort: 0 }

    const first = await client.connect(creds)
    expect(first.success).toBe(false)
    expect(first.rejectionReason).toBe("INVALIDPASS")
    const second = await client.connect(creds)
    expect(second).toEqual(first)
    expect(logins).toBe(1)

    const third = await client.connect({ ...creds, password: "other" })
    expect(third.success).toBe(false)
    expect(logins).toBe(2)
  })

  test("connecting with different credentials while logged in re-logs in", async () => {
    const { client, server } = await connectedClient()
    const loginCount = () => server.received.filter((payload) => payload.readUInt32LE(0) === SERVER_CODES.LOGIN).length
    expect(loginCount()).toBe(1)

    const same = await client.connect({ username: "me", password: "pw", host: "127.0.0.1", port: server.port, listenPort: 0 })
    expect(same.success).toBe(true)
    expect(loginCount()).toBe(1)

    const changed = await client.connect({ username: "other", password: "pw2", host: "127.0.0.1", port: server.port, listenPort: 0 })
    expect(changed.success).toBe(true)
    expect(client.username).toBe("other")
    expect(loginCount()).toBe(2)
  })
})
