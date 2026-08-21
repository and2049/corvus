import type { Socket } from "node:net"

const MAX_MESSAGE_BYTES = 16 * 1024 * 1024
const IDLE_TIMEOUT_MS = 60_000

export interface PeerSessionOptions {
  readonly initial?: Buffer
  readonly onMessage: (code: number, payload: Buffer) => void
  readonly onClose?: () => void
}

// One established 'P' peer connection: framed [u32 size][u32 code][payload]
// message stream in both directions. Sessions are ephemeral - queue state must
// never live on the socket; an idle drop is normal and reconnection is cheap.
export class PeerSession {
  private buffer: Buffer
  private destroyed = false

  constructor(
    readonly username: string,
    private readonly socket: Socket,
    private readonly options: PeerSessionOptions,
  ) {
    this.buffer = options.initial ?? Buffer.alloc(0)
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy())
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.drain()
    })
    socket.on("error", () => socket.destroy())
    socket.on("close", () => {
      if (this.destroyed) return
      this.destroyed = true
      this.options.onClose?.()
    })
    this.drain()
  }

  get open(): boolean {
    return !this.destroyed && !this.socket.destroyed
  }

  send(data: Buffer): void {
    if (this.open) this.socket.write(data)
  }

  close(): void {
    this.socket.destroy()
  }

  private drain(): void {
    for (;;) {
      if (this.buffer.length < 8) return
      const size = this.buffer.readUInt32LE(0)
      if (size > MAX_MESSAGE_BYTES) {
        this.socket.destroy()
        return
      }
      if (this.buffer.length < size + 4) return
      const code = this.buffer.readUInt32LE(4)
      const payload = this.buffer.subarray(8, size + 4)
      this.buffer = this.buffer.subarray(size + 4)
      this.options.onMessage(code, payload)
    }
  }
}
