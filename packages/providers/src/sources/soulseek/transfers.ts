import { SoulseekClient } from "./client"
import {
  decodePlaceInQueueResponse,
  decodeTransferRequest,
  decodeUploadDenied,
  decodeUploadFailed,
  encodeFileOffset,
  encodePlaceInQueueRequest,
  encodeQueueUpload,
  encodeTransferResponse,
  PEER_CODES,
  TRANSFER_DIRECTION_UPLOAD,
} from "./messages"

const FILE_CONN_TIMEOUT_MS = 60_000
const INACTIVITY_TIMEOUT_MS = 45_000
const PLACE_POLL_MS = 60_000

// UploadDenied reasons that mean "still queued, wait" rather than a failure.
const SOFT_DENIALS = ["queued", "too many files", "too many megabytes"]

export interface SlskDownloadRequest {
  readonly username: string
  readonly path: string
  readonly size: number
  readonly offset: number
}

export type SlskTransferEvent =
  | { readonly kind: "queued"; readonly place?: number }
  | { readonly kind: "started"; readonly size: number; readonly offset: number }
  | { readonly kind: "data"; readonly chunk: Buffer }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly reason: string; readonly requeueable: boolean }

export interface SlskTransferHandle {
  readonly abort: () => void
}

/**
 * Drives one download: queue with the uploader, accept their TransferRequest,
 * receive the file over the 'F' connection. Emits events only; never touches
 * disk. Peer sessions are ephemeral - the queue position survives session
 * drops because the uploader reconnects to send TransferRequest when ready.
 */
export function startTransfer(
  client: SoulseekClient,
  request: SlskDownloadRequest,
  onEvent: (event: SlskTransferEvent) => void,
): SlskTransferHandle {
  let finished = false
  let fileToken: number | undefined
  let fileSocket: { destroy: () => void } | undefined
  let placeTimer: ReturnType<typeof setInterval> | undefined
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined

  const emit = (event: SlskTransferEvent): void => {
    if (finished) return
    if (event.kind === "done" || event.kind === "failed") {
      finished = true
      cleanup()
    }
    onEvent(event)
  }

  const cleanup = (): void => {
    unsubscribeMessages()
    unsubscribeDisconnect()
    if (placeTimer !== undefined) clearInterval(placeTimer)
    if (inactivityTimer !== undefined) clearTimeout(inactivityTimer)
    if (fileToken !== undefined) client.cancelFileConnection(fileToken)
    fileSocket?.destroy()
  }

  const sendToPeer = async (data: Buffer): Promise<void> => {
    const session = await client.peerSession(request.username)
    session.send(data)
  }

  const unsubscribeMessages = client.onPeerMessage((username, code, payload) => {
    if (username !== request.username) return
    if (code === PEER_CODES.TRANSFER_REQUEST) {
      const message = decodeTransferRequest(payload)
      if (message.direction !== TRANSFER_DIRECTION_UPLOAD || message.file !== request.path) return
      void accept(message.token, message.filesize)
      return
    }
    if (code === PEER_CODES.UPLOAD_DENIED) {
      const message = decodeUploadDenied(payload)
      if (message.file !== request.path) return
      if (SOFT_DENIALS.includes(message.reason.toLowerCase().replace(/\.$/, ""))) {
        emit({ kind: "queued" })
      } else {
        emit({ kind: "failed", reason: message.reason, requeueable: false })
      }
      return
    }
    if (code === PEER_CODES.UPLOAD_FAILED) {
      if (decodeUploadFailed(payload) !== request.path) return
      emit({ kind: "failed", reason: "upload failed on the peer's side", requeueable: true })
      return
    }
    if (code === PEER_CODES.PLACE_IN_QUEUE_RESPONSE) {
      const message = decodePlaceInQueueResponse(payload)
      if (message.file !== request.path) return
      emit({ kind: "queued", place: message.place })
    }
  })

  const unsubscribeDisconnect = client.onDisconnect(() => {
    emit({ kind: "failed", reason: "disconnected from soulseek server", requeueable: true })
  })

  const accept = async (token: number, filesize: number | undefined): Promise<void> => {
    if (finished || fileToken !== undefined) return
    fileToken = token
    // SoulseekQt sends filesize 0 for >2GiB files; keep the search-time size then.
    const size = filesize !== undefined && filesize > 0 ? filesize : request.size
    const waiter = client.expectFileConnection(token, FILE_CONN_TIMEOUT_MS)
    try {
      await sendToPeer(encodeTransferResponse(token, true))
      const conn = await waiter
      if (finished) {
        conn.socket.destroy()
        return
      }
      fileSocket = conn.socket
      conn.socket.write(encodeFileOffset(request.offset))
      emit({ kind: "started", size, offset: request.offset })
      let received = request.offset
      const bumpInactivity = (): void => {
        if (inactivityTimer !== undefined) clearTimeout(inactivityTimer)
        inactivityTimer = setTimeout(() => {
          emit({ kind: "failed", reason: "transfer stalled", requeueable: true })
        }, INACTIVITY_TIMEOUT_MS)
      }
      const onChunk = (chunk: Buffer): void => {
        if (finished) return
        received += chunk.length
        bumpInactivity()
        emit({ kind: "data", chunk })
        if (received >= size) emit({ kind: "done" })
      }
      bumpInactivity()
      if (conn.initial.length > 0) onChunk(conn.initial)
      conn.socket.on("data", onChunk)
      conn.socket.on("error", () => conn.socket.destroy())
      conn.socket.on("close", () => {
        if (received >= size) emit({ kind: "done" })
        else emit({ kind: "failed", reason: "transfer connection closed", requeueable: true })
      })
    } catch (error) {
      fileToken = undefined
      client.cancelFileConnection(token)
      emit({ kind: "failed", reason: String(error), requeueable: true })
    }
  }

  const begin = async (): Promise<void> => {
    try {
      await sendToPeer(encodeQueueUpload(request.path))
      emit({ kind: "queued" })
      placeTimer = setInterval(() => {
        void sendToPeer(encodePlaceInQueueRequest(request.path)).catch(() => {})
      }, PLACE_POLL_MS)
    } catch (error) {
      emit({ kind: "failed", reason: String(error), requeueable: false })
    }
  }
  void begin()

  return {
    abort: () => {
      if (finished) return
      finished = true
      cleanup()
    },
  }
}

/**
 * Standing responder for TransferRequests that arrive while no transfer is
 * active for the file (e.g. the download is paused): denies them so the
 * uploader's slot frees up instead of timing out.
 */
export function registerTransferDenier(
  client: SoulseekClient,
  shouldDeny: (username: string, path: string) => boolean,
): () => void {
  return client.onPeerMessage((username, code, payload) => {
    if (code !== PEER_CODES.TRANSFER_REQUEST) return
    const message = decodeTransferRequest(payload)
    if (message.direction !== TRANSFER_DIRECTION_UPLOAD) return
    if (!shouldDeny(username, message.file)) return
    void client
      .peerSession(username)
      .then((session) => session.send(encodeTransferResponse(message.token, false, "Paused")))
      .catch(() => {})
  })
}

let shared: SoulseekClient | undefined

/**
 * The one client both the search provider and the downloads manager use: a
 * single server login and listener socket, surviving provider re-creation on
 * config changes (a fresh client per provider instance would leave the old
 * listener bound and EADDRINUSE the next search).
 */
export function sharedSoulseekClient(): SoulseekClient {
  shared ??= new SoulseekClient()
  return shared
}
