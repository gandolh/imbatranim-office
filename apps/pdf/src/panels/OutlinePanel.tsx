/**
 * Outline panel — the document's bookmark tree (Outline.tree). Click a node to
 * navigate to its resolved page; nodes with children collapse/expand.
 */
import { useState } from 'react'
import type { JSX } from 'react'
import { ChevronRight } from 'lucide-react'
import type { OutlineNode } from '@pdfcore/engine'
import { useReader } from '../app/context'

interface NodeProps {
  node: OutlineNode
  depth: number
  currentPage: number
  onGo: (page1: number) => void
}

function OutlineItem({ node, depth, currentPage, onGo }: NodeProps) {
  const [open, setOpen] = useState(depth < 1)
  const hasChildren = node.children.length > 0
  // pageIndex is 0-based; a bookmark without a resolved dest is non-navigable.
  const page1 = node.pageIndex != null ? node.pageIndex + 1 : null
  const active = page1 != null && page1 === currentPage

  return (
    <li>
      <div
        className={
          'flex items-center gap-0.5 ' +
          (active ? 'bg-primary-container' : 'hover:bg-surface-container-high')
        }
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="text-on-surface-variant flex h-5 w-5 shrink-0 items-center justify-center"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              size={12}
              className={'transition-transform ' + (open ? 'rotate-90' : '')}
            />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}
        <button
          type="button"
          className={
            'flex min-w-0 flex-1 items-center justify-between gap-2 py-1 pr-2 text-left text-[12px] ' +
            (page1 == null ? 'cursor-default' : 'cursor-pointer') +
            (active ? ' text-on-primary-container' : ' text-on-surface')
          }
          disabled={page1 == null}
          onClick={() => page1 != null && onGo(page1)}
          title={node.title}
        >
          <span className="truncate">{node.title || 'Untitled'}</span>
          {page1 != null && (
            <span className="text-on-surface-variant shrink-0 text-[10px] tabular-nums">
              {page1}
            </span>
          )}
        </button>
      </div>
      {hasChildren && open && (
        <ul>
          {node.children.map((child, i) => (
            <OutlineItem
              key={i}
              node={child}
              depth={depth + 1}
              currentPage={currentPage}
              onGo={onGo}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function OutlinePanel(): JSX.Element {
  const { doc, outline, currentPage, goToPage } = useReader()

  if (!doc)
    return <div className="text-on-surface-variant p-3 text-center text-[11px]">Loading…</div>
  if (!outline.length) {
    return (
      <div className="text-on-surface-variant p-3 text-center text-[11px]">
        This document has no outline (bookmarks).
      </div>
    )
  }

  return (
    <ul className="py-1">
      {outline.map((node, i) => (
        <OutlineItem key={i} node={node} depth={0} currentPage={currentPage} onGo={goToPage} />
      ))}
    </ul>
  )
}
