export interface ClipboardRenderer {
  copyToClipboardOSC52(text: string): boolean
}

export interface ClipboardDeps {
  readonly renderer?: ClipboardRenderer
  readonly platform?: NodeJS.Platform
  readonly spawn?: (command: string, input: string) => Promise<boolean>
}

const NATIVE_COPY: Partial<Record<NodeJS.Platform, string>> = {
  win32: "clip",
  darwin: "pbcopy",
}

export async function writeToClipboard(
  text: string,
  deps?: ClipboardDeps,
): Promise<boolean> {
  if (text === "") return false
  const native = NATIVE_COPY[deps?.platform ?? process.platform]
  if (native !== undefined) {
    const spawn = deps?.spawn ?? defaultSpawn
    return spawn(native, text)
  }
  return deps?.renderer?.copyToClipboardOSC52(text) ?? false
}

async function defaultSpawn(command: string, input: string): Promise<boolean> {
  const child = Bun.spawn([command], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
  child.stdin.write(input)
  child.stdin.end()
  await child.exited
  return child.exitCode === 0
}
