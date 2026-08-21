import { theme } from "../theme"

export function HRule() {
  return <box width="100%" height={1} flexShrink={0} border={["top"]} borderColor={theme.borderMuted} />
}
