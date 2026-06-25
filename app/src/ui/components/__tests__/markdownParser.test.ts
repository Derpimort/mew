import { describe, expect, it } from 'vitest'
import {
  parseInline,
  parseMarkdown,
  safeHref,
  type MdBlock,
  type MdInline,
} from '../markdownParser'

/* Walk the inline AST back to its text so a test can assert "what the reader
   sees" without caring how spans nest. */
function flatten(spans: MdInline[]): string {
  return spans
    .map((s) => {
      switch (s.kind) {
        case 'text':
          return s.text
        case 'code':
          return s.text
        case 'strong':
        case 'em':
        case 'link':
          return flatten(s.children)
      }
    })
    .join('')
}

describe('parseMarkdown — block structure', () => {
  it('splits paragraphs on blank lines', () => {
    const b = parseMarkdown('first para\n\nsecond para')
    expect(b.map((x) => x.kind)).toEqual(['para', 'para'])
    expect(flatten((b[0] as Extract<MdBlock, { kind: 'para' }>).spans)).toBe('first para')
    expect(flatten((b[1] as Extract<MdBlock, { kind: 'para' }>).spans)).toBe('second para')
  })

  it('keeps soft line breaks within a paragraph as hard breaks', () => {
    const b = parseMarkdown('line one\nline two')
    const para = b[0] as Extract<MdBlock, { kind: 'para' }>
    expect(para.kind).toBe('para')
    expect(flatten(para.spans)).toBe('line one\nline two')
  })

  it('groups consecutive bullets into one unordered list', () => {
    const b = parseMarkdown('- alpha\n- beta\n- gamma')
    const list = b[0] as Extract<MdBlock, { kind: 'list' }>
    expect(list.kind).toBe('list')
    expect(list.ordered).toBe(false)
    expect(list.items.map(flatten)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('groups numbered items into one ordered list', () => {
    const b = parseMarkdown('1. one\n2. two')
    const list = b[0] as Extract<MdBlock, { kind: 'list' }>
    expect(list.kind).toBe('list')
    expect(list.ordered).toBe(true)
    expect(list.items.map(flatten)).toEqual(['one', 'two'])
  })

  it('captures a fenced code block verbatim, with its language', () => {
    const b = parseMarkdown('```ts\nconst x = 1\nconst y = 2\n```')
    const code = b[0] as Extract<MdBlock, { kind: 'code' }>
    expect(code.kind).toBe('code')
    expect(code.lang).toBe('ts')
    expect(code.text).toBe('const x = 1\nconst y = 2')
  })

  it('does not parse markup inside a fenced block', () => {
    const b = parseMarkdown('```\n**not bold** and [not](a-link)\n```')
    const code = b[0] as Extract<MdBlock, { kind: 'code' }>
    expect(code.text).toBe('**not bold** and [not](a-link)')
  })

  it('reads a blockquote run', () => {
    const b = parseMarkdown('> a quoted thought\n> still quoted')
    const q = b[0] as Extract<MdBlock, { kind: 'quote' }>
    expect(q.kind).toBe('quote')
    expect(flatten(q.spans)).toBe('a quoted thought\nstill quoted')
  })
})

describe('parseInline — emphasis & code', () => {
  it('parses **bold** and *italic*', () => {
    const spans = parseInline('a **bold** and *italic* word')
    expect(spans.map((s) => s.kind)).toContain('strong')
    expect(spans.map((s) => s.kind)).toContain('em')
    expect(flatten(spans)).toBe('a bold and italic word')
  })

  it('parses inline `code` and never reads markup inside it', () => {
    const spans = parseInline('run `npm **install**` now')
    const code = spans.find((s) => s.kind === 'code')
    expect(code).toBeDefined()
    expect(code && code.kind === 'code' && code.text).toBe('npm **install**')
  })

  it('parses a [label](url) link with the label preserved', () => {
    const spans = parseInline('see [the docs](https://example.com/x)')
    const link = spans.find((s) => s.kind === 'link')
    expect(link && link.kind === 'link' && link.href).toBe('https://example.com/x')
    expect(link && link.kind === 'link' && flatten(link.children)).toBe('the docs')
  })
})

describe('streaming-safe — partial markdown degrades to text, never throws', () => {
  it('a dangling **bold opener renders as literal text', () => {
    const spans = parseInline('half a **bold thought')
    expect(() => flatten(spans)).not.toThrow()
    expect(flatten(spans)).toBe('half a **bold thought')
    expect(spans.some((s) => s.kind === 'strong')).toBe(false)
  })

  it('an unterminated link is literal until its `)` arrives', () => {
    const spans = parseInline('see [the docs](https://exa')
    expect(flatten(spans)).toBe('see [the docs](https://exa')
    expect(spans.some((s) => s.kind === 'link')).toBe(false)
  })

  it('an unclosed fence still renders as a code block (no throw)', () => {
    expect(() => parseMarkdown('```ts\nconst x = 1')).not.toThrow()
    const b = parseMarkdown('```ts\nconst x = 1')
    const code = b[0] as Extract<MdBlock, { kind: 'code' }>
    expect(code.kind).toBe('code')
    expect(code.text).toBe('const x = 1')
  })

  it('an empty string yields no blocks', () => {
    expect(parseMarkdown('')).toEqual([])
  })
})

describe('sanitization — links are protocol-gated, no XSS reaches an href', () => {
  it('accepts http/https/mailto', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com/')
    expect(safeHref('http://example.com/a')).toBe('http://example.com/a')
    expect(safeHref('mailto:hi@example.com')).toBe('mailto:hi@example.com')
  })

  it('rejects javascript:, data:, vbscript:, and file:', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('JavaScript:alert(1)')).toBeNull() // case-folding can't smuggle it
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safeHref('vbscript:msgbox(1)')).toBeNull()
    expect(safeHref('file:///etc/passwd')).toBeNull()
  })

  it('a [label](javascript:…) link keeps the readable label but drops the trap', () => {
    const spans = parseInline('click [me](javascript:alert(document.cookie))')
    expect(spans.some((s) => s.kind === 'link')).toBe(false)
    // the human-readable text survives so the message still reads sensibly
    expect(flatten(spans)).toContain('me')
  })

  it('an http link is never silently rewritten to a script URL', () => {
    const spans = parseInline('[x](https://good.example/path)')
    const link = spans.find((s) => s.kind === 'link')
    expect(link && link.kind === 'link' && link.href.startsWith('https://')).toBe(true)
  })

  it('treats literal angle-bracket HTML as plain text (no raw HTML)', () => {
    // the renderer escapes text content; the parser must not promote tags to nodes
    const b = parseMarkdown('<img src=x onerror=alert(1)> and <script>alert(1)</script>')
    const para = b[0] as Extract<MdBlock, { kind: 'para' }>
    expect(para.kind).toBe('para')
    expect(flatten(para.spans)).toContain('<img src=x onerror=alert(1)>')
    expect(flatten(para.spans)).toContain('<script>')
  })
})
