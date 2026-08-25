import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CORVUS_VERSION } from "./version"

export const REPOSITORY = "and2049/corvus"
export const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
export const INSTALLER = `https://github.com/${REPOSITORY}/releases/latest/download/install`
export const INSTALLER_WINDOWS = `https://github.com/${REPOSITORY}/releases/latest/download/install.ps1`

type Method = "curl" | "powershell"

function versionFromRelease(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("tag_name" in data)) return undefined
  const tag = (data as { tag_name: unknown }).tag_name
  if (typeof tag !== "string" || !tag) return undefined
  return tag.replace(/^v/, "")
}

async function latest(): Promise<string> {
  const response = await fetch(RELEASE_API, {
    headers: { "User-Agent": `corvus/${CORVUS_VERSION}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Update check failed with status ${response.status}`)
  const version = versionFromRelease(await response.json())
  if (!version) throw new Error("Update information did not include a version")
  return version
}

// Re-invoke the published, version-pinned installer rather than replacing the
// binary directly — the installer owns download/extract/replace, including the
// Windows running-exe lock handling.
async function runInstaller(method: Method, version: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "corvus-upgrade-"))
  try {
    if (method === "powershell") {
      const installer = join(dir, "install.ps1")
      await download(INSTALLER_WINDOWS, installer)
      run("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        installer,
        "-Version",
        version,
        "-NoModifyPath",
      ])
    } else {
      const installer = join(dir, "install")
      await download(INSTALLER, installer)
      run("bash", [installer, "--version", version, "--no-modify-path"])
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function download(url: string, dest: string): Promise<void> {
  const response = await fetch(url, {
    headers: { "User-Agent": `corvus/${CORVUS_VERSION}` },
    signal: AbortSignal.timeout(5 * 60_000),
  })
  if (!response.ok) throw new Error(`Failed to download installer (${response.status})`)
  await Bun.write(dest, response)
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status ?? "unknown"}`)
}

export async function runUpgrade(args: string[]): Promise<void> {
  const versionIndex = args.findIndex((arg) => arg === "--version" || arg === "-v")
  const requested = versionIndex >= 0 ? args[versionIndex + 1] : undefined
  const to = requested ? requested.replace(/^v/, "") : await latest()
  if (to === CORVUS_VERSION) {
    process.stdout.write(`corvus ${to} is already installed\n`)
    return
  }
  const method: Method = process.platform === "win32" ? "powershell" : "curl"
  process.stdout.write(`upgrading corvus ${CORVUS_VERSION} -> ${to} using ${method}\n`)
  await runInstaller(method, to)
  process.stdout.write(`upgraded corvus to ${to}\n`)
}

export function printHelp(): void {
  process.stdout.write(`corvus v${CORVUS_VERSION}

Usage:
  corvus                     Launch the TUI
  corvus upgrade             Upgrade to the latest release
  corvus upgrade -v <ver>    Upgrade to a specific version
  corvus --version           Print the version
  corvus --help              Show this help

Install:
  curl -fsSL https://github.com/${REPOSITORY}/releases/latest/download/install | bash
  irm https://github.com/${REPOSITORY}/releases/latest/download/install.ps1 | iex
`)
}
