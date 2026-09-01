/**
 * Local credential checks mirroring the Soulseek server's own rules (as
 * documented by nicotine-plus), so a doomed login is never sent, plus the
 * human wording for each rejection reason the server can return.
 */

const MAX_USERNAME = 30

export const NOT_CONFIGURED = "not configured (ctrl+g settings)"

export function validateCredentials(username: string, password: string): string | undefined {
  if (username === "" || password === "") return NOT_CONFIGURED
  if (username.length > MAX_USERNAME) return `username is too long (max ${MAX_USERNAME})`
  if (!/^[\x20-\x7e]+$/.test(username)) return "username has invalid characters (printable ascii only)"
  if (username !== username.trim()) return "username has leading or trailing spaces"
  return undefined
}

const REJECTIONS: Readonly<Record<string, string>> = {
  INVALIDUSERNAME: "invalid username",
  EMPTYPASSWORD: "password is empty",
  INVALIDPASS: "wrong password or username taken",
  INVALIDVERSION: "client version rejected by the server",
  SVRFULL: "server is full, try again later",
  SVRPRIVATE: "server is not accepting new accounts",
}

export function describeLoginRejection(reason: string | undefined, detail?: string): string {
  if (reason === undefined) return "login rejected"
  const text = detail !== undefined && detail !== "" ? detail : (REJECTIONS[reason] ?? reason)
  return `login rejected: ${text}`
}
