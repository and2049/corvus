import * as cheerio from "cheerio"

interface XmlElement {
  readonly type: string
  readonly name?: string
  readonly attribs?: Record<string, string>
  readonly children?: readonly unknown[]
}

export interface RssItem {
  text(...names: readonly string[]): string
  all(...names: readonly string[]): readonly string[]
  attrs(localName: string): readonly Record<string, string>[]
}

function localName(name: string): string {
  const index = name.indexOf(":")
  return (index >= 0 ? name.slice(index + 1) : name).toLowerCase()
}

export function parseRssItems(xml: string): readonly RssItem[] {
  const $ = cheerio.load(xml, { xml: true })
  const items: RssItem[] = []
  $("item").each((_, node) => {
    const element = node as unknown as XmlElement
    const texts = new Map<string, string[]>()
    const elements = new Map<string, Record<string, string>[]>()
    for (const child of element.children ?? []) {
      if ((child as XmlElement).type !== "tag") continue
      const elem = child as unknown as XmlElement
      const local = localName(elem.name ?? "")
      if (local === "") continue
      const text = $(elem as never).text().trim()
      const textList = texts.get(local) ?? []
      textList.push(text)
      texts.set(local, textList)
      const elemList = elements.get(local) ?? []
      elemList.push(elem.attribs ?? {})
      elements.set(local, elemList)
    }
    items.push({
      text(...names: readonly string[]): string {
        for (const name of names) {
          const list = texts.get(name.toLowerCase())
          if (list !== undefined && list.length > 0) return list[0]!
        }
        return ""
      },
      all(...names: readonly string[]): readonly string[] {
        const out: string[] = []
        for (const name of names) {
          for (const value of texts.get(name.toLowerCase()) ?? []) {
            if (value !== "") out.push(value)
          }
        }
        return out
      },
      attrs(local: string): readonly Record<string, string>[] {
        return elements.get(local.toLowerCase()) ?? []
      },
    })
  })
  return items
}
