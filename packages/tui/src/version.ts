// CORVUS_VERSION / CORVUS_CHANNEL are build-time globals injected by
// Bun.build({ define: {...} }) in script/build.ts. Running from source (bun dev,
// bun test) leaves them undefined, so both fall back to "local".
declare const CORVUS_VERSION: string
declare const CORVUS_CHANNEL: string

const version = typeof CORVUS_VERSION === "string" ? CORVUS_VERSION : "local"
const channel = typeof CORVUS_CHANNEL === "string" ? CORVUS_CHANNEL : "local"

export { version as CORVUS_VERSION, channel as CORVUS_CHANNEL }
export const CORVUS_LOCAL = channel === "local"
