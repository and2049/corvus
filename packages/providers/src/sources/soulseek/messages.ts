import { createHash } from "node:crypto"
import { inflateSync } from "node:zlib"
import { Reader, Writer, codeBody, frame } from "./protocol"

export const SERVER_CODES = {
  LOGIN: 1,
  SET_WAIT_PORT: 2,
  CONNECT_TO_PEER: 18,
  FILE_SEARCH: 26,
} as const

export const PEER_INIT_CODES = {
  PIERCE_FIREWALL: 0,
  PEER_INIT: 1,
} as const

export const PEER_CODES = {
  FILE_SEARCH_RESPONSE: 9,
} as const

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
