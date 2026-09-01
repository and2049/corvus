import net, { type Socket } from "node:net"
import {
  decodeConnectToPeer,
  decodeFileSearchResponse,
  decodeGetPeerAddressResponse,
  decodeLogin,
  decodePeerInit,
  decodePierceFirewall,
  encodeCantConnectToPeer,
  encodeConnectToPeerRequest,
  encodeFileSearch,
  encodeGetPeerAddress,
  encodeLogin,
  encodePeerInit,
  encodePierceFirewall,
  encodeSetWaitPort,
  PEER_CODES,
  PEER_INIT_CODES,
  type ConnectToPeerMessage,
  type LoginResponse,
  type PeerAddressResponse,
  type PeerInitMessage,
  type SlskSearchResponse,
} from "./messages"
import { PeerSession } from "./peer"

const DEFAULT_HOST = "server.slsknet.org"
const DEFAULT_PORT = 2242
const DEFAULT_LISTEN_PORT = 2234
const CONNECT_TIMEOUT_MS = 10_000
const INDIRECT_TIMEOUT_MS = 20_000
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024

export interface SoulseekOptions {
  readonly username: string
  readonly password: string
  readonly host?: string
  readonly port?: number
  readonly listenPort?: number
}

export type ConnectionState = "disconnected" | "connecting" | "logged-in"

export interface FileConnection {
  readonly socket: Socket
  readonly initial: Buffer
}

export type PeerMessageHandler = (username: string, code: number, payload: Buffer) => void

interface PendingSearch {
  readonly token: number
  readonly responses: SlskSearchResponse[]
}

interface PendingPierce {
  readonly username: string
  readonly resolve: (session: PeerSession) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface FileConnWaiter {
  readonly resolve: (conn: FileConnection) => void
  readonly timer: ReturnType<typeof setTimeout>
}

/**
 * Soulseek network client: server login, distributed file search, and peer
 * connection management for transfers. Peer sessions ('P') carry framed
 * messages; file connections ('F') carry a raw token handshake then file
 * bytes. Search results and transfer offers both REQUIRE reachability: either
 * our listener accepts inbound peers, or peers relay ConnectToPeer through the
 * server and we dial out.
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
  private connecting: Promise<LoginResponse> | undefined
  // The last credentials the server rejected: identical retries are answered
  // locally so a misconfigured account never hammers the server on every search.
  private rejected: { readonly username: string; readonly password: string; readonly response: LoginResponse } | undefined
  private peerSessions = new Map<string, PeerSession>()
  private pendingPierce = new Map<number, PendingPierce>()
  private fileConnWaiters = new Map<number, FileConnWaiter>()
  private peerAddressWaiters = new Map<string, ((address: PeerAddressResponse) => void)[]>()
  private peerMessageHandlers = new Set<PeerMessageHandler>()
  private disconnectHandlers = new Set<() => void>()
  // Every peer socket (inbound or dialed) so disconnect() can force-close them;
  // net.Server.close() alone waits forever for live connections.
  private trackedSockets = new Set<Socket>()

  get connectionState(): ConnectionState {
    return this.state
  }

  get username(): string {
    return this.options?.username ?? ""
  }

  private sameCredentials(
    a: { readonly username: string; readonly password: string },
    b: { readonly username: string; readonly password: string } | undefined,
  ): boolean {
    return b !== undefined && a.username === b.username && a.password === b.password
  }

  get listeningPort(): number | undefined {
    const address = this.listener?.address()
    return typeof address === "object" && address !== null ? address.port : undefined
  }

  async connect(options: SoulseekOptions): Promise<LoginResponse> {
    if (this.state === "logged-in") {
      if (this.sameCredentials(options, this.options)) return { success: true }
      await this.disconnect()
    }
    if (this.rejected !== undefined && this.sameCredentials(options, this.rejected)) return this.rejected.response
    if (this.connecting !== undefined) return this.connecting
    this.connecting = this.doConnect(options)
    try {
      return await this.connecting
    } finally {
      this.connecting = undefined
    }
  }

  private async doConnect(options: SoulseekOptions): Promise<LoginResponse> {
    this.options = options
    this.state = "connecting"
    try {
      const response = await this.login(options)
      if (!response.success) {
        this.rejected = { username: options.username, password: options.password, response }
        this.state = "disconnected"
        this.serverSocket?.destroy()
        this.serverSocket = undefined
        return response
      }
      this.rejected = undefined
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
    this.dropPeerState()
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

  onPeerMessage(handler: PeerMessageHandler): () => void {
    this.peerMessageHandlers.add(handler)
    return () => this.peerMessageHandlers.delete(handler)
  }

  onDisconnect(handler: () => void): () => void {
    this.disconnectHandlers.add(handler)
    return () => this.disconnectHandlers.delete(handler)
  }

  /** Resolves the peer's address via the server (code 3). */
  getPeerAddress(username: string, timeoutMs = CONNECT_TIMEOUT_MS): Promise<PeerAddressResponse> {
    if (this.state !== "logged-in") return Promise.reject(new Error("soulseek: not connected"))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const list = this.peerAddressWaiters.get(username)?.filter((w) => w !== waiter)
        if (list === undefined || list.length === 0) this.peerAddressWaiters.delete(username)
        else this.peerAddressWaiters.set(username, list)
        reject(new Error(`soulseek: no address for ${username}`))
      }, timeoutMs)
      const waiter = (address: PeerAddressResponse): void => {
        clearTimeout(timer)
        resolve(address)
      }
      const list = this.peerAddressWaiters.get(username) ?? []
      list.push(waiter)
      this.peerAddressWaiters.set(username, list)
      this.write(encodeGetPeerAddress(username))
    })
  }

  /**
   * Returns an open 'P' session with the peer, reusing an existing one or
   * establishing a new connection: direct dial first, then the server-relayed
   * indirect route (peer dials our listener and pierces with our token).
   */
  async peerSession(username: string): Promise<PeerSession> {
    const existing = this.peerSessions.get(username)
    if (existing?.open === true) return existing
    const address = await this.getPeerAddress(username)
    if (address.port !== 0) {
      try {
        const socket = await dial(address.ipAddress, address.port, CONNECT_TIMEOUT_MS)
        this.track(socket)
        socket.write(encodePeerInit(this.username, "P"))
        return this.adoptSession(username, socket)
      } catch {
        // fall through to the indirect route
      }
    }
    return this.indirectPeerSession(username)
  }

  private indirectPeerSession(username: string): Promise<PeerSession> {
    return new Promise((resolve, reject) => {
      const token = randomToken()
      const timer = setTimeout(() => {
        this.pendingPierce.delete(token)
        reject(new Error(`soulseek: could not reach ${username}`))
      }, INDIRECT_TIMEOUT_MS)
      this.pendingPierce.set(token, {
        username,
        timer,
        resolve: (session) => {
          clearTimeout(timer)
          resolve(session)
        },
      })
      this.write(encodeConnectToPeerRequest(token, username, "P"))
    })
  }

  /**
   * Registers a waiter for an incoming 'F' connection whose raw handshake
   * token matches. Must be registered BEFORE accepting the TransferRequest so
   * the uploader's connection always finds its waiter.
   */
  expectFileConnection(token: number, timeoutMs: number): Promise<FileConnection> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fileConnWaiters.delete(token)
        reject(new Error("soulseek: transfer connection timed out"))
      }, timeoutMs)
      this.fileConnWaiters.set(token, {
        timer,
        resolve: (conn) => {
          clearTimeout(timer)
          resolve(conn)
        },
      })
    })
  }

  cancelFileConnection(token: number): void {
    const waiter = this.fileConnWaiters.get(token)
    if (waiter === undefined) return
    clearTimeout(waiter.timer)
    this.fileConnWaiters.delete(token)
  }

  private async login(options: SoulseekOptions): Promise<LoginResponse> {
    const socket = await dial(options.host ?? DEFAULT_HOST, options.port ?? DEFAULT_PORT, CONNECT_TIMEOUT_MS)
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

  private startListener(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const listener = net.createServer((socket) => this.onInboundConnection(socket))
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
    this.dropPeerState()
    for (const handler of this.disconnectHandlers) handler()
  }

  private dropPeerState(): void {
    for (const session of this.peerSessions.values()) session.close()
    this.peerSessions.clear()
    for (const socket of this.trackedSockets) socket.destroy()
    this.trackedSockets.clear()
    for (const pending of this.pendingPierce.values()) clearTimeout(pending.timer)
    this.pendingPierce.clear()
    for (const waiter of this.fileConnWaiters.values()) clearTimeout(waiter.timer)
    this.fileConnWaiters.clear()
    this.peerAddressWaiters.clear()
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
    if (code === 3) {
      const address = decodeGetPeerAddressResponse(payload)
      const waiters = this.peerAddressWaiters.get(address.user)
      if (waiters !== undefined) {
        this.peerAddressWaiters.delete(address.user)
        for (const waiter of waiters) waiter(address)
      }
      return
    }
    if (code === 18) {
      const message = decodeConnectToPeer(payload)
      for (const handler of this.connectToPeerWaiters) handler(message)
      void this.handleServerConnectToPeer(message)
    }
  }

  /**
   * A peer that cannot reach our listener asked the server to have us dial
   * them. Dial, pierce with their token, then treat the socket per its type:
   * 'P' becomes a session (this also recovers search responses from
   * unreachable peers), 'F' expects the raw transfer-token handshake next.
   */
  private async handleServerConnectToPeer(message: ConnectToPeerMessage): Promise<void> {
    if (message.connType !== "P" && message.connType !== "F") return
    let socket: Socket
    try {
      socket = await dial(message.ipAddress, message.port, CONNECT_TIMEOUT_MS)
    } catch {
      this.write(encodeCantConnectToPeer(message.token, message.user))
      return
    }
    this.track(socket)
    socket.write(encodePierceFirewall(message.token))
    if (message.connType === "P") {
      this.adoptSession(message.user, socket)
    } else {
      this.awaitFileToken(socket, Buffer.alloc(0))
    }
  }

  private adoptSession(username: string, socket: Socket, initial: Buffer = Buffer.alloc(0)): PeerSession {
    this.peerSessions.get(username)?.close()
    const session = new PeerSession(username, socket, {
      initial,
      onMessage: (code, payload) => this.dispatchPeerMessage(username, code, payload),
      onClose: () => {
        if (this.peerSessions.get(username) === session) this.peerSessions.delete(username)
      },
    })
    this.peerSessions.set(username, session)
    return session
  }

  private dispatchPeerMessage(username: string, code: number, payload: Buffer): void {
    if (code === PEER_CODES.FILE_SEARCH_RESPONSE) {
      this.handleSearchResponse(payload)
      return
    }
    for (const handler of this.peerMessageHandlers) handler(username, code, payload)
  }

  private track(socket: Socket): void {
    this.trackedSockets.add(socket)
    socket.on("close", () => this.trackedSockets.delete(socket))
  }

  private onInboundConnection(socket: Socket): void {
    this.track(socket)
    socket.setTimeout(30_000, () => socket.destroy())
    let buffer: Buffer = Buffer.alloc(0)

    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      const init = tryReadInit(buffer)
      if (init === undefined) return
      socket.removeListener("data", onData)
      if (init.kind === "peer-init") {
        this.handlePeerInit(socket, init.message, init.rest)
      } else {
        this.handlePierceFirewall(socket, init.token, init.rest)
      }
    }
    socket.on("data", onData)
    socket.on("error", () => socket.destroy())
  }

  private handlePeerInit(socket: Socket, message: PeerInitMessage, rest: Buffer): void {
    if (message.connType === "P") {
      this.adoptSession(message.username, socket, rest)
      return
    }
    if (message.connType === "F") {
      this.awaitFileToken(socket, rest)
      return
    }
    socket.destroy()
  }

  private handlePierceFirewall(socket: Socket, token: number, rest: Buffer): void {
    const pending = this.pendingPierce.get(token)
    if (pending === undefined) {
      socket.destroy()
      return
    }
    this.pendingPierce.delete(token)
    pending.resolve(this.adoptSession(pending.username, socket, rest))
  }

  /** Reads the raw u32 transfer token that opens every 'F' connection. */
  private awaitFileToken(socket: Socket, initial: Buffer): void {
    let buffer = initial
    const route = (): boolean => {
      if (buffer.length < 4) return false
      const token = buffer.readUInt32LE(0)
      const waiter = this.fileConnWaiters.get(token)
      if (waiter === undefined) {
        socket.destroy()
        return true
      }
      clearTimeout(waiter.timer)
      this.fileConnWaiters.delete(token)
      socket.removeListener("data", onData)
      socket.setTimeout(0)
      waiter.resolve({ socket, initial: buffer.subarray(4) })
      return true
    }
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      route()
    }
    if (route()) return
    socket.on("data", onData)
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

function dial(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`soulseek: connect to ${host}:${port} timed out`))
    }, timeoutMs)
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

type InitFrame =
  | { kind: "peer-init"; message: PeerInitMessage; rest: Buffer }
  | { kind: "pierce"; token: number; rest: Buffer }

function tryReadInit(buffer: Buffer): InitFrame | undefined {
  if (buffer.length < 5) return undefined
  const size = buffer.readUInt32LE(0)
  const code = buffer.readUInt8(4)
  if (buffer.length < size + 4) return undefined
  const payload = buffer.subarray(4, size + 4)
  const rest = buffer.subarray(size + 4)
  if (code === PEER_INIT_CODES.PEER_INIT) {
    return { kind: "peer-init", message: decodePeerInit(payload), rest }
  }
  if (code === PEER_INIT_CODES.PIERCE_FIREWALL) {
    return { kind: "pierce", token: decodePierceFirewall(payload), rest }
  }
  return { kind: "peer-init", message: { username: "", connType: "", token: 0 }, rest }
}
