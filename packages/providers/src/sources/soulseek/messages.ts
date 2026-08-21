import { createHash } from "node:crypto"
import { inflateSync } from "node:zlib"
import { Reader, Writer, codeBody, frame } from "./protocol"

export const SERVER_CODES = {
  LOGIN: 1,
  SET_WAIT_PORT: 2,
  GET_PEER_ADDRESS: 3,
  CONNECT_TO_PEER: 18,
  FILE_SEARCH: 26,
  CANT_CONNECT_TO_PEER: 1001,
} as const

export const PEER_INIT_CODES = {
  PIERCE_FIREWALL: 0,
  PEER_INIT: 1,
} as const

export const PEER_CODES = {
  FILE_SEARCH_RESPONSE: 9,
  TRANSFER_REQUEST: 40,
  TRANSFER_RESPONSE: 41,
  QUEUE_UPLOAD: 43,
  PLACE_IN_QUEUE_RESPONSE: 44,
  UPLOAD_FAILED: 46,
  UPLOAD_DENIED: 50,
  PLACE_IN_QUEUE_REQUEST: 51,
} as const

export const TRANSFER_DIRECTION_UPLOAD = 1

export interface LoginResponse {
  readonly success: boolean
  readonly rejectionReason?: string
  readonly banner?: string
  readonly ipAddress?: string
}

export interface SlskFile {
  readonly path: string
  readonly size: number
  readonly ext?: string
  readonly bitrate?: number
  readonly vbr?: boolean
  readonly duration?: number
  readonly sampleRate?: number
  readonly bitDepth?: number
}

export interface SlskSearchResponse {
  readonly username: string
  readonly token: number
  readonly files: readonly SlskFile[]
  readonly freeUploadSlots: boolean
  readonly uploadSpeed: number
  readonly queueLength: number
}

export interface ConnectToPeerMessage {
  readonly user: string
  readonly connType: string
  readonly ipAddress: string
  readonly port: number
  readonly token: number
}

export interface PeerAddressResponse {
  readonly user: string
  readonly ipAddress: string
  readonly port: number
}

export interface TransferRequestMessage {
  readonly direction: number
  readonly token: number
  readonly file: string
  readonly filesize?: number
}

export interface PlaceInQueueMessage {
  readonly file: string
  readonly place: number
}

export interface UploadDeniedMessage {
  readonly file: string
  readonly reason: string
}

export interface PeerInitMessage {
  readonly username: string
  readonly connType: string
  readonly token: number
}

export function encodeLogin(username: string, password: string): Buffer {
  const md5 = createHash("md5").update(username + password).digest("hex")
  const body = new Writer()
    .string(username)
    .string(password)
    .u32(177) // major version reserved for experimental clients
    .string(md5)
    .u32(1) // minor version
    .build()
  return frame(codeBody(SERVER_CODES.LOGIN, body))
}

export function decodeLogin(payload: Buffer): LoginResponse {
  const reader = new Reader(payload)
  reader.u32() // code
  if (!reader.bool()) {
    return { success: false, rejectionReason: reader.string() }
  }
  const banner = reader.string()
  const ipAddress = reader.ip()
  return { success: true, banner, ipAddress }
}

export function encodeSetWaitPort(port: number): Buffer {
  return frame(codeBody(SERVER_CODES.SET_WAIT_PORT, new Writer().u32(port).build()))
}

export function encodeFileSearch(token: number, query: string): Buffer {
  const normalized = query.split(/\s+/).filter((part) => part !== "-").join(" ")
  return frame(codeBody(SERVER_CODES.FILE_SEARCH, new Writer().u32(token).string(normalized).build()))
}

export function decodeConnectToPeer(payload: Buffer): ConnectToPeerMessage {
  const reader = new Reader(payload)
  reader.u32() // code
  const user = reader.string()
  const connType = reader.string()
  const ipAddress = reader.ip()
  const port = reader.u32()
  const token = reader.u32()
  return { user, connType, ipAddress, port, token }
}

export function encodePeerInit(username: string, connType: string): Buffer {
  const body = new Writer().string(username).string(connType).u32(0).build()
  // Init messages frame a single code byte instead of a uint32 code
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length + 1, 0)
  return Buffer.concat([head, Buffer.from([PEER_INIT_CODES.PEER_INIT]), body])
}

export function decodePeerInit(payload: Buffer): PeerInitMessage {
  const reader = new Reader(payload.subarray(1)) // skip code byte
  const username = reader.string()
  const connType = reader.string()
  const token = reader.hasRemaining() ? reader.u32() : 0
  return { username, connType, token }
}

export function encodePierceFirewall(token: number): Buffer {
  const body = new Writer().u32(token).build()
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length + 1, 0)
  return Buffer.concat([head, Buffer.from([PEER_INIT_CODES.PIERCE_FIREWALL]), body])
}

export function decodePierceFirewall(payload: Buffer): number {
  return new Reader(payload.subarray(1)).u32() // skip code byte
}

export function encodeGetPeerAddress(username: string): Buffer {
  return frame(codeBody(SERVER_CODES.GET_PEER_ADDRESS, new Writer().string(username).build()))
}

export function decodeGetPeerAddressResponse(payload: Buffer): PeerAddressResponse {
  const reader = new Reader(payload)
  reader.u32() // code
  const user = reader.string()
  const ipAddress = reader.ip()
  const port = reader.u32()
  return { user, ipAddress, port }
}

export function encodeConnectToPeerRequest(token: number, username: string, connType: string): Buffer {
  const body = new Writer().u32(token).string(username).string(connType).build()
  return frame(codeBody(SERVER_CODES.CONNECT_TO_PEER, body))
}

export function encodeCantConnectToPeer(token: number, username: string): Buffer {
  const body = new Writer().u32(token).string(username).build()
  return frame(codeBody(SERVER_CODES.CANT_CONNECT_TO_PEER, body))
}

// Peer-message decoders receive the payload AFTER the u32 code (the peer read
// loop strips it), unlike server decoders which consume the code themselves.

export function encodeQueueUpload(file: string): Buffer {
  return frame(codeBody(PEER_CODES.QUEUE_UPLOAD, new Writer().string(file).build()))
}

export function decodeTransferRequest(payload: Buffer): TransferRequestMessage {
  const reader = new Reader(payload)
  const direction = reader.u32()
  const token = reader.u32()
  const file = reader.string()
  if (direction === TRANSFER_DIRECTION_UPLOAD && reader.remaining() >= 8) {
    return { direction, token, file, filesize: Number(reader.u64()) }
  }
  return { direction, token, file }
}

export function encodeTransferResponse(token: number, allowed: boolean, reason?: string): Buffer {
  const writer = new Writer().u32(token).bool(allowed)
  if (!allowed && reason !== undefined) writer.string(reason)
  return frame(codeBody(PEER_CODES.TRANSFER_RESPONSE, writer.build()))
}

export function encodePlaceInQueueRequest(file: string): Buffer {
  return frame(codeBody(PEER_CODES.PLACE_IN_QUEUE_REQUEST, new Writer().string(file).build()))
}

export function decodePlaceInQueueResponse(payload: Buffer): PlaceInQueueMessage {
  const reader = new Reader(payload)
  const file = reader.string()
  const place = reader.u32()
  return { file, place }
}

export function decodeUploadFailed(payload: Buffer): string {
  return new Reader(payload).string()
}

export function decodeUploadDenied(payload: Buffer): UploadDeniedMessage {
  const reader = new Reader(payload)
  const file = reader.string()
  const reason = reader.string()
  return { file, reason }
}

// 'F' connection handshake messages are raw and unframed: the uploader sends a
// bare u32 transfer token, the downloader replies with a bare u64 resume offset.

export function encodeFileOffset(offset: number): Buffer {
  return new Writer().u64(offset).build()
}

export function decodeFileTransferInit(buffer: Buffer): number | undefined {
  if (buffer.length < 4) return undefined
  return buffer.readUInt32LE(0)
}

interface Attrs {
  bitrate?: number
  vbr?: boolean
  duration?: number
  sampleRate?: number
  bitDepth?: number
}

function parseAttrs(reader: Reader): Attrs {
  const attrs: Attrs = {}
  const count = reader.u32()
  for (let i = 0; i < count; i++) {
    const key = reader.u32()
    const value = reader.u32()
    switch (key) {
      case 0:
        attrs.bitrate = value
        break
      case 1:
        attrs.duration = value
        break
      case 2:
        attrs.vbr = value === 1
        break
      case 4:
        attrs.sampleRate = value
        break
      case 5:
        attrs.bitDepth = value
        break
    }
  }
  return attrs
}

export function decodeFileSearchResponse(compressed: Buffer): SlskSearchResponse {
  const body = inflateSync(compressed)
  const reader = new Reader(body)
  const username = reader.string()
  const token = reader.u32()

  const fileCount = reader.u32()
  const files: SlskFile[] = []
  for (let i = 0; i < fileCount && reader.hasRemaining(); i++) {
    reader.u8() // code, always 1
    const path = reader.string().replaceAll("/", "\\")
    const size = reader.fileSize()
    const extLength = reader.u32()
    reader.raw(extLength) // obsolete extension field
    const attrs = parseAttrs(reader)
    files.push({ path, size, ...attrs })
  }

  const freeUploadSlots = reader.bool()
  const uploadSpeed = reader.u32()
  const queueLength = reader.u32()
  return { username, token, files, freeUploadSlots, uploadSpeed, queueLength }
}
