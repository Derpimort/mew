/* Renders MEW's constrained markdown subset (see markdown.ts) as React
   elements — text content is escaped by React, links are pre-vetted by
   `safeHref`, and there is no dangerouslySetInnerHTML, so a reply can't smuggle
   markup. Styling is the terminal log's own type scale (`.md` in
   primitives.css): tight spacing, mono code, list indents on the `mew ❯`
   gutter. Parsing is memoized per-body so streaming re-renders stay cheap. */

import { useMemo } from 'react'
import { parseMarkdown, type MdBlock, type MdInline } from './markdown'

export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return (
    <div className="md">
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  )
}

function Block({ block }: { block: MdBlock }) {
  switch (block.kind) {
    case 'para':
      return (
        <p className="md-p">
          <Inlines spans={block.spans} />
        </p>
      )
    case 'code':
      return (
        <pre className="md-pre">
          <code>{block.text}</code>
        </pre>
      )
    case 'list':
      return block.ordered ? (
        <ol className="md-ol">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inlines spans={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="md-ul">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inlines spans={item} />
            </li>
          ))}
        </ul>
      )
    case 'quote':
      return (
        <blockquote className="md-quote">
          <Inlines spans={block.spans} />
        </blockquote>
      )
  }
}

function Inlines({ spans }: { spans: MdInline[] }) {
  return (
    <>
      {spans.map((s, i) => (
        <Inline key={i} span={s} />
      ))}
    </>
  )
}

function Inline({ span }: { span: MdInline }) {
  switch (span.kind) {
    case 'text':
      // hard breaks are carried as '\n'; pre-wrap on the paragraph keeps them
      return <>{span.text}</>
    case 'strong':
      return (
        <strong>
          <Inlines spans={span.children} />
        </strong>
      )
    case 'em':
      return (
        <em>
          <Inlines spans={span.children} />
        </em>
      )
    case 'code':
      return <code className="md-code">{span.text}</code>
    case 'link':
      return (
        <a className="md-link" href={span.href} target="_blank" rel="noopener noreferrer">
          <Inlines spans={span.children} />
        </a>
      )
  }
}
