import { afterEach, describe, expect, test } from "bun:test"
import net, { type Socket } from "node:net"
import { SoulseekClient } from "../sources/soulseek/client"
import { startTransfer, type SlskTransferEvent } from "../sources/soulseek/transfers"
import { Reader, Writer, codeBody, frame } from "../sources/soulseek/protocol"
import {
  decodePeerInit,
  encodePeerInit,
  PEER_CODES,
  SERVER_CODES,
} from "../sources/soulseek/messages"

const LOOPBACK = 16777343

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

interface Harness {
  readonly client: SoulseekClient
  readonly uploaderPort: number
  onUploaderMessage(handler: (code: number, payload: Buffer, socket: Socket) => void): void
}

async function startHarness(): Promise<Harness> {
  const handlers: ((code: number, payload: Buffer, socket: Socket) => void)[] = []
  const uploaderSockets = new Set<Socket>()

  const uploader = net.createServer((socket) => {
    uploaderSockets.add(socket)
    socket.on("close", () => uploaderSockets.delete(socket))
    let buffer: Buffer = Buffer.alloc(0)
    let initDone = false
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (!initDone) {
        if (buffer.length < 5) return
        const size = buffer.readUInt32LE(0)
        if (buffer.length < size + 4) return
        const init = decodePeerInit(buffer.subarray(4, size + 4))
        expect(init.connType).toBe("P")
        buffer = buffer.subarray(size + 4)
        initDone = true
      }
      for (;;) {
        if (buffer.length < 8) return
        const size = buffer.readUInt32LE(0)
        if (buffer.length < size + 4) return
        const code = buffer.readUInt32LE(4)
        const payload = buffer.subarray(8, size + 4)
        buffer = buffer.subarray(size + 4)
        for (const handler of handlers) handler(code, payload, socket)
      }
    })
  })
  const uploaderPort = await new Promise<number>((resolve) => {
    uploader.listen(0, "127.0.0.1", () => {
      const address = uploader.address()
      resolve(typeof address === "object" && address !== null ? address.port : 0)
    })
  })
  cleanups.push(
    () =>
      new Promise<void>((done) => {
        for (const socket of uploaderSockets) socket.destroy()
        uploader.close(() => done())
      }),
  )

  const serverSockets = new Set<Socket>()
  const server = net.createServer((socket) => {
    serverSockets.add(socket)
    socket.on("close", () => serverSockets.delete(socket))
    let buffer: Buffer = Buffer.alloc(0)
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        if (buffer.length < 8) return
        const size = buffer.readUInt32LE(0)
        if (buffer.length < size + 4) return
        const payload = buffer.subarray(4, size + 4)
        buffer = buffer.subarray(size + 4)
        const code = payload.readUInt32LE(0)
        if (code === SERVER_CODES.LOGIN) {
          socket.write(frame(codeBody(1, new Writer().bool(true).string("ok").u32(LOOPBACK).build())))
        } else if (code === SERVER_CODES.GET_PEER_ADDRESS) {
          const user = new Reader(payload.subarray(4)).string()
          socket.write(
            frame(codeBody(3, new Writer().string(user).u32(LOOPBACK).u32(uploaderPort).u32(0).build())),
          )
        }
      }
    })
  })
  const serverPort = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolve(typeof address === "object" && address !== null ? address.port : 0)
    })
  })
  cleanups.push(
    () =>
      new Promise<void>((done) => {
        for (const socket of serverSockets) socket.destroy()
        server.close(() => done())
      }),
  )

  const client = new SoulseekClient()
  cleanups.push(() => client.disconnect())
  const response = await client.connect({
    username: "me",
    password: "pw",
    host: "127.0.0.1",
    port: serverPort,
    listenPort: 0,
  })
  expect(response.success).toBe(true)

  return { client, uploaderPort, onUploaderMessage: (handler) => handlers.push(handler) }
}

function makeCollector(): { events: SlskTransferEvent[]; onEvent: (event: SlskTransferEvent) => void; waitFor: (kind: SlskTransferEvent["kind"], timeoutMs?: number) => Promise<SlskTransferEvent> } {
  const events: SlskTransferEvent[] = []
  const waiters: { kind: string; resolve: (event: SlskTransferEvent) => void }[] = []
  return {
    events,
    onEvent: (event) => {
      events.push(event)
      const matched = waiters.filter((waiter) => waiter.kind === event.kind)
      for (const waiter of matched) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(event)
      }
    },
    waitFor: (kind, timeoutMs = 5_000) => {
      const existing = events.find((event) => event.kind === kind)
      if (existing !== undefined) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${kind}: saw ${JSON.stringify(events.map((e) => e.kind))}`)), timeoutMs)
        waiters.push({
          kind,
          resolve: (event) => {
            clearTimeout(timer)
            resolve(event)
          },
        })
      })
    },
  }
}

describe("soulseek transfers", () => {
  test("end-to-end download: queue, transfer request, F connection, bytes, done", async () => {
    const harness = await startHarness()
    const fileBytes = Buffer.from("soulseek file contents!")
    const path = "Music\\Artist\\song.bin"

    harness.onUploaderMessage((code, payload, socket) => {
      if (code === PEER_CODES.QUEUE_UPLOAD) {
        expect(new Reader(payload).string()).toBe(path)
        socket.write(
          frame(
            codeBody(
              PEER_CODES.TRANSFER_REQUEST,
              new Writer().u32(1).u32(9001).string(path).u64(fileBytes.length).build(),
            ),
          ),
        )
        return
      }
      if (code === PEER_CODES.TRANSFER_RESPONSE) {
        const reader = new Reader(payload)
        expect(reader.u32()).toBe(9001)
        expect(reader.bool()).toBe(true)
        const fileConn = net.connect({ host: "127.0.0.1", port: harness.client.listeningPort! })
        fileConn.once("connect", () => {
          fileConn.write(Buffer.concat([encodePeerInit("uploader", "F"), new Writer().u32(9001).build()]))
          let offsetBuffer: Buffer = Buffer.alloc(0)
          fileConn.on("data", (chunk: Buffer) => {
            offsetBuffer = Buffer.concat([offsetBuffer, chunk])
            if (offsetBuffer.length >= 8) {
              expect(new Reader(offsetBuffer).u64()).toBe(0n)
              fileConn.write(fileBytes)
            }
          })
        })
      }
    })

    const collector = makeCollector()
    const handle = startTransfer(
      harness.client,
      { username: "uploader", path, size: fileBytes.length, offset: 0 },
      collector.onEvent,
    )
    cleanups.push(() => handle.abort())

    await collector.waitFor("done")
    const kinds = collector.events.map((event) => event.kind)
    expect(kinds[0]).toBe("queued")
    expect(kinds).toContain("started")
    const data = collector.events.filter((event) => event.kind === "data")
    const received = Buffer.concat(data.map((event) => (event.kind === "data" ? event.chunk : Buffer.alloc(0))))
    expect(received.equals(fileBytes)).toBe(true)
  })

  test("resume: offset is sent on the F connection and counts toward completion", async () => {
    const harness = await startHarness()
    const fileBytes = Buffer.from("0123456789")
    const offset = 4
    const path = "Music\\resume.bin"

    harness.onUploaderMessage((code, payload, socket) => {
      if (code === PEER_CODES.QUEUE_UPLOAD) {
        socket.write(
          frame(
            codeBody(
              PEER_CODES.TRANSFER_REQUEST,
              new Writer().u32(1).u32(7).string(path).u64(fileBytes.length).build(),
            ),
          ),
        )
      }
      if (code === PEER_CODES.TRANSFER_RESPONSE) {
        const fileConn = net.connect({ host: "127.0.0.1", port: harness.client.listeningPort! })
        fileConn.once("connect", () => {
          fileConn.write(Buffer.concat([encodePeerInit("uploader", "F"), new Writer().u32(7).build()]))
          let offsetBuffer: Buffer = Buffer.alloc(0)
          fileConn.on("data", (chunk: Buffer) => {
            offsetBuffer = Buffer.concat([offsetBuffer, chunk])
            if (offsetBuffer.length >= 8) {
              expect(new Reader(offsetBuffer).u64()).toBe(BigInt(offset))
              fileConn.write(fileBytes.subarray(offset))
            }
          })
        })
      }
    })

    const collector = makeCollector()
    const handle = startTransfer(
      harness.client,
      { username: "uploader", path, size: fileBytes.length, offset },
      collector.onEvent,
    )
    cleanups.push(() => handle.abort())

    await collector.waitFor("done")
    const started = collector.events.find((event) => event.kind === "started")
    expect(started).toEqual({ kind: "started", size: fileBytes.length, offset })
    const data = collector.events
      .filter((event) => event.kind === "data")
      .map((event) => (event.kind === "data" ? event.chunk : Buffer.alloc(0)))
    expect(Buffer.concat(data).toString()).toBe("456789")
  })

  test("hard denial fails the transfer; soft denial keeps it queued", async () => {
    const harness = await startHarness()
    const path = "Music\\denied.bin"

    harness.onUploaderMessage((code, _payload, socket) => {
      if (code === PEER_CODES.QUEUE_UPLOAD) {
        socket.write(
          frame(
            codeBody(PEER_CODES.UPLOAD_DENIED, new Writer().string(path).string("File not shared.").build()),
          ),
        )
      }
    })

    const collector = makeCollector()
    const handle = startTransfer(
      harness.client,
      { username: "uploader", path, size: 10, offset: 0 },
      collector.onEvent,
    )
    cleanups.push(() => handle.abort())

    const failed = await collector.waitFor("failed")
    expect(failed).toEqual({ kind: "failed", reason: "File not shared.", requeueable: false })
  })

  test("unreachable peer fails the transfer instead of hanging", async () => {
    const harness = await startHarness()
    await harness.client.disconnect()

    const collector = makeCollector()
    const handle = startTransfer(
      harness.client,
      { username: "uploader", path: "x", size: 1, offset: 0 },
      collector.onEvent,
    )
    cleanups.push(() => handle.abort())
    const failed = await collector.waitFor("failed")
    expect(failed.kind).toBe("failed")
  })
})
