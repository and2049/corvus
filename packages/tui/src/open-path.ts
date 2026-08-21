import path from "node:path"

export interface RevealDeps {
  readonly platform?: NodeJS.Platform
  readonly spawn?: (command: readonly string[]) => Promise<void>
}

/**
 * Opens the platform file manager with the given path highlighted (or its
 * containing directory where highlighting is not supported). Fire-and-forget:
 * explorer.exe routinely exits non-zero even on success, so no result to gate on.
 */
export async function revealPath(target: string, deps?: RevealDeps): Promise<boolean> {
  if (target === "") return false
  const platform = deps?.platform ?? process.platform
  const spawn = deps?.spawn ?? defaultSpawn
  try {
    if (platform === "win32") {
      await spawn(["explorer", `/select,${path.win32.normalize(target)}`])
    } else if (platform === "darwin") {
      await spawn(["open", "-R", target])
    } else {
      await spawn(["xdg-open", path.dirname(target)])
    }
    return true
  } catch {
    return false
  }
}

async function defaultSpawn(command: readonly string[]): Promise<void> {
  Bun.spawn([...command], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
}
