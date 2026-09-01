import { describe, expect, test } from "bun:test"
import { NOT_CONFIGURED, describeLoginRejection, validateCredentials } from "../sources/soulseek/credentials"
import { decodeLogin } from "../sources/soulseek/messages"
import { Writer, codeBody, frame } from "../sources/soulseek/protocol"

describe("validateCredentials", () => {
  test("empty username or password is not configured", () => {
    expect(validateCredentials("", "")).toBe(NOT_CONFIGURED)
    expect(validateCredentials("me", "")).toBe(NOT_CONFIGURED)
    expect(validateCredentials("", "pw")).toBe(NOT_CONFIGURED)
  })

  test("applies the server's username rules locally", () => {
    expect(validateCredentials("a".repeat(31), "pw")).toContain("too long")
    expect(validateCredentials("héllo", "pw")).toContain("invalid characters")
    expect(validateCredentials(" me", "pw")).toContain("spaces")
    expect(validateCredentials("me ", "pw")).toContain("spaces")
    expect(validateCredentials("me 2", "pw")).toBeUndefined()
  })
})

describe("describeLoginRejection", () => {
  test("maps known reasons to readable text and prefers the server detail", () => {
    expect(describeLoginRejection("INVALIDPASS")).toBe("login rejected: wrong password or username taken")
    expect(describeLoginRejection("SVRFULL")).toContain("full")
    expect(describeLoginRejection("INVALIDUSERNAME", "Nick empty.")).toBe("login rejected: Nick empty.")
    expect(describeLoginRejection("SOMETHINGNEW")).toBe("login rejected: SOMETHINGNEW")
    expect(describeLoginRejection(undefined)).toBe("login rejected")
  })

  test("decodeLogin reads the optional detail string after the reason", () => {
    const payload = frame(codeBody(1, new Writer().bool(false).string("INVALIDUSERNAME").string("Nick too long.").build()))
    const decoded = decodeLogin(payload.subarray(4))
    expect(decoded.rejectionReason).toBe("INVALIDUSERNAME")
    expect(decoded.rejectionDetail).toBe("Nick too long.")
  })
})
