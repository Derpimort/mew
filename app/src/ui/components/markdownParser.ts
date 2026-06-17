/* A constrained markdown subset for MEW's chat replies — parsed to a typed AST,
   never to HTML. The renderer (Markdown.tsx) maps these nodes to React elements,
   so escaping is React's job and there is no dangerouslySetInnerHTML anywhere:
   an attacker-authored reply can carry no markup it didn't get to spell out as
   plain text. Supported: paragraphs, hard breaks, bold/italic, inline + fenced
   code, bullet/ordered lists, blockquotes, and links — links only behind a
   protocol allow-list (http/https/mailto), so `javascript:`/`data:` never land
   on an href. Anything outside the subset (images, tables, raw HTML) degrades
   to its literal text. Streaming-safe by construction: an unterminated fence or
   a dangling `**` mid-stream parses as text, never throws. All pure — tested
   like the week model is. */

/* ---- inline AST: the spans inside a line ---- */
export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: MdInline[] }
  | { kind: 'em'; children: MdInline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: MdInline[] }

/* ---- block AST: the stacked structure of a message ---- */
export type MdBlock =
  | { kind: 'para'; spans: MdInline[] }
  | { kind: 'code'; text: string; lang?: string }
  | { kind: 'list'; ordered: boolean; items: MdInline[][] }
  | { kind: 'quote'; spans: MdInline[] }

/* Protocols a link may carry. Everything else (javascript:, data:, vbscript:,
   file:, relative paths we can't vouch for) is dropped to plain text. */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/* A bare-looking link with no scheme is treated as https — but it must still
   parse to a safe absolute URL, or it falls through to text. */
export function safeHref(raw: string): string | null {
  const url = raw.trim()
  if (!url) return null
  try {
    // protocol-relative and scheme-less hosts → https; otherwise honor the scheme
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(url)
      ? url
      : url.startsWith('//')
        ? `https:${url}`
        : `https://${url}`
    const parsed = new URL(candidate)
    return SAFE_PROTOCOLS.has(parsed.protocol.toLowerCase()) ? parsed.href : null
  } catch {
    return null
  }
}

/* ── inline pass ────────────────────────────────────────────────────────────
   A single left-to-right scan. Each marker only "opens" if it can find its
   close on the same line; otherwise the marker char is emitted literally, so a
   half-typed `**bold` mid-stream reads as the four characters it is. */
export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ kind: 'text', text })
    text = ''
  }

  let i = 0
  while (i < src.length) {
    const c = src[i]

    // inline code: `…` — highest precedence, no markup parsed inside
    if (c === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i) {
        flush()
        out.push({ kind: 'code', text: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    // [label](url) link
    if (c === '[') {
      const link = matchLink(src, i)
      if (link) {
        const href = safeHref(link.href)
        flush()
        if (href) out.push({ kind: 'link', href, children: parseInline(link.label) })
        // an unsafe url keeps the human-readable label, drops the trap
        else out.push(...parseInline(link.label))
        i = link.next
        continue
      }
    }

    // **strong** / __strong__
    if ((c === '*' || c === '_') && src[i + 1] === c) {
      const close = findClose(src, i + 2, c + c)
      if (close > i) {
        flush()
        out.push({ kind: 'strong', children: parseInline(src.slice(i + 2, close)) })
        i = close + 2
        continue
      }
    }

    // *em* / _em_  (single marker; require non-space just inside so `a * b` is literal)
    if ((c === '*' || c === '_') && src[i + 1] !== c && !isSpace(src[i + 1])) {
      const close = findClose(src, i + 1, c)
      if (close > i) {
        flush()
        out.push({ kind: 'em', children: parseInline(src.slice(i + 1, close)) })
        i = close + 1
        continue
      }
    }

    text += c
    i++
  }
  flush()
  return out
}

function isSpace(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === undefined
}

/* Find the next unescaped occurrence of `marker` at/after `from`, refusing a
   match that sits immediately after whitespace (so ` **` won't close an em). */
function findClose(src: string, from: number, marker: string): number {
  let i = from
  while (i <= src.length - marker.length) {
    if (src.startsWith(marker, i) && !isSpace(src[i - 1])) return i
    i++
  }
  return -1
}

/* [label](href) — returns the slice bounds, or null if it isn't a complete,
   well-formed link (e.g. mid-stream before the `)` arrives). */
function matchLink(src: string, at: number): { label: string; href: string; next: number } | null {
  const close = src.indexOf(']', at + 1)
  if (close < 0 || src[close + 1] !== '(') return null
  const end = src.indexOf(')', close + 2)
  if (end < 0) return null
  return { label: src.slice(at + 1, close), href: src.slice(close + 2, end), next: end + 1 }
}

/* ── block pass ─────────────────────────────────────────────────────────────
   Line-oriented: fences capture until they close (or until EOF, so a streaming
   half-fence still renders as a code block), list runs group consecutive
   markers, blank lines split paragraphs. */
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/
const ORDERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const FENCE = /^\s{0,3}(?:```|~~~)\s*([\w+-]*)\s*$/

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let i = 0

  const pushPara = (buf: string[]) => {
    const joined = buf.join('\n').trim()
    if (joined) blocks.push({ kind: 'para', spans: parseInlineMultiline(joined) })
  }

  let para: string[] = []
  while (i < lines.length) {
    const line = lines[i]

    // fenced code — verbatim until the closing fence or EOF
    const fence = line.match(FENCE)
    if (fence) {
      pushPara(para)
      para = []
      const lang = fence[1] || undefined
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      i++ // consume the closing fence if present; harmless past EOF
      blocks.push({ kind: 'code', text: body.join('\n'), lang })
      continue
    }

    // a run of list items (all bullets, or all ordered)
    if (BULLET.test(line) || ORDERED.test(line)) {
      pushPara(para)
      para = []
      const ordered = !BULLET.test(line)
      const re = ordered ? ORDERED : BULLET
      const items: MdInline[][] = []
      while (i < lines.length) {
        const m = lines[i].match(re)
        if (!m) break
        items.push(parseInline(m[1]))
        i++
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // blockquote run — joined into one quote block
    if (QUOTE.test(line)) {
      pushPara(para)
      para = []
      const quoted: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(QUOTE)
        if (!m) break
        quoted.push(m[1])
        i++
      }
      blocks.push({ kind: 'quote', spans: parseInlineMultiline(quoted.join('\n').trim()) })
      continue
    }

    // blank line ends a paragraph
    if (line.trim() === '') {
      pushPara(para)
      para = []
      i++
      continue
    }

    para.push(line)
    i++
  }
  pushPara(para)
  return blocks
}

/* Parse a multi-line paragraph, inserting a hard break between source lines so
   the terminal log keeps the author's line shape. */
function parseInlineMultiline(text: string): MdInline[] {
  const parts = text.split('\n')
  const spans: MdInline[] = []
  parts.forEach((part, idx) => {
    if (idx > 0) spans.push({ kind: 'text', text: '\n' })
    spans.push(...parseInline(part))
  })
  return spans
}
