import net, { type Socket } from "node:net"
import {
  decodeConnectToPeer,
  decodeFileSearchResponse,
  decodeLogin,
  decodePeerInit,
  encodeFileSearch,
  encodeLogin,
  encodeSetWaitPort,
  PEER_CODES,
  PEER_INIT_CODES,
  type ConnectToPeerMessage,
  type LoginResponse,
  type PeerInitMessage,
  type SlskSearchResponse,
} from "./messages"

const DEFAULT_HOST = "server.slsknet.org"
const DEFAULT_PORT = 2242
const DEFAULT_LISTEN_PORT = 2234
const CONNECT_TIMEOUT_MS = 10_000
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024

export interface SoulseekOptions {
  readonly username: string
  readonly password: string
  readonly host?: string
  readonly port?: number
  readonly listenPort?: number
}

export type ConnectionState = "disconnected" | "connecting" | "logged-in"

interface PendingSearch {
  readonly token: number
  readonly responses: SlskSearchResponse[]
}

/**
 * Minimal Soulseek network client: server login plus distributed file search.
 * Search results arrive on peer connections the responding peers open toward
 * our listening port, so an unreachable listener means no results (forward the
 * port or expect empty searches behind strict NAT).
 */
export class SoulseekClient {
  private serverSocket: Socket | undefined
  private listener: net.Server | undefined
  private state: ConnectionState = "disconnected"
  private inBuffer: Buffer = Buffer.alloc(0)
  private loginWaiter: ((response: LoginResponse) => void) | undefined
  private connectToPeerWaiters = new Set<(message: ConnectToPeerMessage) => void>()
  private activeSearches = new Map<number, PendingSearch>()
  private options: SoulseekOptions | undefined

  get connectionState(): ConnectionState {
    return this.state
  }

  async connect(options: SoulseekOptions): Promise<LoginResponse> {
    if (this.state === "logged-in") return { success: true }
    this.options = options
    this.state = "connecting"
    try {
      const response = await this.login(options)
      if (!response.success) {
        this.state = "disconnected"
        return response
      }
      await this.startListener(options.listenPort ?? DEFAULT_LISTEN_PORT)
      this.write(encodeSetWaitPort(options.listenPort ?? DEFAULT_LISTEN_PORT))
      this.state = "logged-in"
      return response
    } catch (error) {
      this.state = "disconnected"
      throw error
    }
  }

  async disconnect(): Promise<void> {
    const listener = this.listener
    const socket = this.serverSocket
    this.listener = undefined
    this.serverSocket = undefined
    this.state = "disconnected"
    this.inBuffer = Buffer.alloc(0)
    await new Promise<void>((resolve) => {
      let remaining = 0
      const done = (): void => {
        remaining -= 1
        if (remaining === 0) resolve()
      }
      if (socket !== undefined) {
        remaining += 1
        socket.once("close", done)
        socket.destroy()
      }
      if (listener !== undefined) {
        remaining += 1
        listener.close(() => done())
      }
      if (remaining === 0) resolve()
    })
  }

  /**
   * Runs a distributed file search and collects peer responses until the
   * timeout elapses. Safe to run concurrently; tokens disambiguate results.
   */
  async search(query: string, timeoutMs = 8_000): Promise<readonly SlskSearchResponse[]> {
    if (this.state !== "logged-in") {
      throw new Error("soulseek: not connected")
    }
    const token = randomToken()
    const pending: PendingSearch = { token, responses: [] }
    this.activeSearches.set(token, pending)
    this.write(encodeFileSearch(token, query))
    await Bun.sleep(timeoutMs)
    this.activeSearches.delete(token)
    return pending.responses
  }

  onConnectToPeer(handler: (message: ConnectToPeerMessage) => void): () => void {
    this.connectToPeerWaiters.add(handler)
    return () => this.connectToPeerWaiters.delete(handler)
  }

  private async login(options: SoulseekOptions): Promise<LoginResponse> {
    const socket = await this.openServerSocket(options.host ?? DEFAULT_HOST, options.port ?? DEFAULT_PORT)
    this.serverSocket = socket
    this.inBuffer = Buffer.alloc(0)
    socket.setKeepAlive(true)
    socket.on("data", (chunk: Buffer) => this.onServerData(chunk))
    socket.on("error", () => this.handleDisconnect())
    socket.on("close", () => this.handleDisconnect())

    const response = await new Promise<LoginResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("soulseek: login timed out")), CONNECT_TIMEOUT_MS)
      this.loginWaiter = (response) => {
        clearTimeout(timer)
        resolve(response)
      }
      this.write(encodeLogin(options.username, options.password))
    })
    return response
  }

  private openServerSocket(host: string, port: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port })
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error(`soulseek: connect to ${host}:${port} timed out`))
      }, CONNECT_TIMEOUT_MS)
      socket.once("connect", () => {
        clearTimeout(timer)
        resolve(socket)
      })
      socket.once("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  private startListener(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const listener = net.createServer((socket) => this.onPeerConnection(socket))
      listener.on("error", reject)
      listener.listen(port, () => resolve())
      this.listener = listener
    })
  }

  private handleDisconnect(): void {
    if (this.state === "disconnected") return
    this.state = "disconnected"
    this.serverSocket = undefined
    this.inBuffer = Buffer.alloc(0)
    const listener = this.listener
    this.listener = undefined
    listener?.close()
  }

  private write(data: Buffer): void {
    this.serverSocket?.write(data)
  }

  private onServerData(chunk: Buffer): void {
    this.inBuffer = Buffer.concat([this.inBuffer, chunk])
    for (;;) {
      if (this.inBuffer.length < 8) return
      const size = this.inBuffer.readUInt32LE(0)
      if (size > MAX_MESSAGE_BYTES) {
        this.handleDisconnect()
        return
      }
      if (this.inBuffer.length < size + 4) return
      const payload = this.inBuffer.subarray(4, size + 4)
      this.inBuffer = this.inBuffer.subarray(size + 4)
      this.dispatchServerMessage(payload)
    }
  }

  private dispatchServerMessage(payload: Buffer): void {
    const code = payload.readUInt32LE(0)
    if (code === 1 && this.loginWaiter !== undefined) {
      const waiter = this.loginWaiter
      this.loginWaiter = undefined
      waiter(decodeLogin(payload))
      return
    }
    if (code === 18) {
      const message = decodeConnectToPeer(payload)
      for (const handler of this.connectToPeerWaiters) handler(message)
    }
  }

  private onPeerConnection(socket: Socket): void {
    socket.setTimeout(30_000, () => socket.destroy())
    let buffer: Buffer = Buffer.alloc(0)
    let initDone = false

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (!initDone) {
        const init = tryReadInit(buffer)
        if (init === undefined) return
        buffer = init.rest
        initDone = true
        if (!this.handlePeerInit(socket, init.message)) {
          socket.destroy()
          return
        }
      }
      for (;;) {
        if (buffer.length < 8) return
        const size = buffer.readUInt32LE(0)
        if (size > MAX_MESSAGE_BYTES) {
          socket.destroy()
          return
        }
        if (buffer.length < size + 4) return
        const code = buffer.readUInt32LE(4)
        const payload = buffer.subarray(8, size + 4)
        buffer = buffer.subarray(size + 4)
        if (code === PEER_CODES.FILE_SEARCH_RESPONSE) {
          this.handleSearchResponse(payload)
        }
      }
    })
    socket.on("error", () => socket.destroy())
  }

  private handlePeerInit(_socket: Socket, message: PeerInitMessage): boolean {
    // Only 'P' connections carry search responses in this client's scope;
    // 'F'/'D' transfers are handled by a future download pipeline.
    return message.connType === "P"
  }

  private handleSearchResponse(compressed: Buffer): void {
    let response: SlskSearchResponse
    try {
      response = decodeFileSearchResponse(compressed)
    } catch {
      return
    }
    const pending = this.activeSearches.get(response.token)
    if (pending === undefined || response.files.length === 0) return
    pending.responses.push(response)
  }
}

function randomToken(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}

function tryReadInit(buffer: Buffer): { message: PeerInitMessage; rest: Buffer } | undefined {
  if (buffer.length < 5) return undefined
  const size = buffer.readUInt32LE(0)
  const code = buffer.readUInt8(4)
  if (buffer.length < size + 4) return undefined
  const payload = buffer.subarray(4, size + 4)
  const rest = buffer.subarray(size + 4)
  if (code === PEER_INIT_CODES.PEER_INIT) {
    return { message: decodePeerInit(payload), rest }
  }
  // PierceFireWall and unknown inits are out of scope; report as unusable
  return { message: { username: "", connType: "", token: 0 }, rest }
}
