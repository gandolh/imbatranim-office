/**
 * Draws a slide from its render model: the one renderer the stage, the
 * thumbnail rail, the presenter and the PNG export all use, so a thumbnail
 * cannot disagree with the slide it stands for.
 *
 * A slide is drawn at a logical width (BASE_WIDTH by default) and scaled with
 * a CSS transform by whoever shows it, so text wraps the same way at every
 * zoom. Shapes are absolutely positioned boxes: SVG for geometry, HTML for
 * text and pictures. Colours here are the deck's own (user content), never
 * the desktop's tokens.
 */
import { memo, useId, type CSSProperties, type ReactNode } from 'react'
import { css } from '../engine/color'
import { customPaths, presetPath, type ShapePath } from '../engine/geometry'
import type { Fill, Line, ShapeModel, SlideModel, TableModel, TextBody } from '../engine/model'
import type { Xfrm } from '../engine/shapes'
import { backgroundCss, BASE_WIDTH, mix, slideHeight } from './slideMetrics'
import { bodyCss, bulletCss, bulletText, paragraphCss, runCss } from './textStyle'

export type SlideViewProps = {
  model: SlideModel
  /** Logical width in CSS pixels. */
  width?: number
  /** Draw empty placeholders with their prompt (the editing stage only). */
  showPrompts?: boolean
  /** Preview frames while a drag is in progress, by shape key. */
  overrides?: ReadonlyMap<string, Xfrm>
  /** The shape whose text is being edited: its text comes from `renderEditor`. */
  editingKey?: string | null
  renderEditor?: (shape: ShapeModel, scale: number) => ReactNode
  /** Mark the slide's own shapes for hit-testing (the editing stage only). */
  interactive?: boolean
  className?: string
  style?: CSSProperties
}

export const SlideView = memo(function SlideView({
  model,
  width = BASE_WIDTH,
  showPrompts = false,
  overrides,
  editingKey = null,
  renderEditor,
  interactive = false,
  className,
  style,
}: SlideViewProps) {
  const scale = width / model.size.cx
  const height = slideHeight(model, width)
  return (
    <div
      className={className}
      data-slide-view=""
      style={{
        position: 'relative',
        width,
        height,
        overflow: 'hidden',
        backgroundColor: '#ffffff',
        ...backgroundCss(model.background),
        ...style,
      }}
    >
      {model.shapes.map((shape) => (
        <ShapeView
          key={shape.key}
          shape={shape}
          scale={scale}
          frame={frameOf(overrides?.get(shape.key) ?? shape.box, scale)}
          showPrompts={showPrompts}
          editingKey={editingKey}
          renderEditor={renderEditor}
          interactive={interactive}
        />
      ))}
    </div>
  )
})

type Frame = {
  left: number
  top: number
  width: number
  height: number
  rot: number
  flipH: boolean
  flipV: boolean
}

function frameOf(box: Xfrm, scale: number): Frame {
  return {
    left: box.x * scale,
    top: box.y * scale,
    width: box.cx * scale,
    height: box.cy * scale,
    rot: box.rot,
    flipH: box.flipH,
    flipV: box.flipV,
  }
}

function transformOf(f: Frame): string | undefined {
  const parts: string[] = []
  if (f.rot) parts.push(`rotate(${f.rot}deg)`)
  if (f.flipH || f.flipV) parts.push(`scale(${f.flipH ? -1 : 1}, ${f.flipV ? -1 : 1})`)
  return parts.length ? parts.join(' ') : undefined
}

type ShapeViewProps = {
  shape: ShapeModel
  scale: number
  frame: Frame
  showPrompts: boolean
  editingKey: string | null
  renderEditor?: (shape: ShapeModel, scale: number) => ReactNode
  /** Top-level slide shapes carry the attribute the stage hit-tests on. */
  interactive: boolean
}

function ShapeView({
  shape,
  scale,
  frame,
  showPrompts,
  editingKey,
  renderEditor,
  interactive,
}: ShapeViewProps) {
  const style: CSSProperties = {
    position: 'absolute',
    left: frame.left,
    top: frame.top,
    width: Math.max(frame.width, 0),
    height: Math.max(frame.height, 0),
    transform: transformOf(frame),
    transformOrigin: 'center center',
  }
  const hit = interactive && shape.origin === 'slide' ? { 'data-shape-key': shape.key } : {}
  // Text is not mirrored with its shape: a horizontal flip leaves it readable,
  // a vertical one turns it upside down (PowerPoint's rule).
  const textFlip = frame.flipH !== frame.flipV ? 'scaleX(-1)' : undefined

  if (shape.kind === 'group') {
    const cs = shape.childSpace ?? {
      x: shape.box.x,
      y: shape.box.y,
      cx: shape.box.cx,
      cy: shape.box.cy,
    }
    const sx = cs.cx ? frame.width / cs.cx : scale
    const sy = cs.cy ? frame.height / cs.cy : scale
    return (
      <div style={style} {...hit} data-shape-kind="group">
        {shape.children.map((child) => (
          <ShapeView
            key={child.key + child.id}
            shape={child}
            scale={scale}
            frame={{
              left: (child.box.x - cs.x) * sx,
              top: (child.box.y - cs.y) * sy,
              width: child.box.cx * sx,
              height: child.box.cy * sy,
              rot: child.box.rot,
              flipH: child.box.flipH,
              flipV: child.box.flipV,
            }}
            showPrompts={false}
            editingKey={null}
            interactive={false}
          />
        ))}
      </div>
    )
  }

  const editing = editingKey === shape.key && renderEditor
  return (
    <div style={style} {...hit}>
      {shape.kind === 'shape' && (
        <Geometry shape={shape} width={frame.width} height={frame.height} scale={scale} />
      )}
      {shape.kind === 'picture' && (
        <Picture shape={shape} width={frame.width} height={frame.height} scale={scale} />
      )}
      {(shape.kind === 'chart' || shape.kind === 'object' || shape.kind === 'unknown') && (
        <Picture shape={shape} width={frame.width} height={frame.height} scale={scale} />
      )}
      {shape.kind === 'table' && shape.table && <Table table={shape.table} scale={scale} />}
      {editing ? (
        <div style={{ position: 'absolute', inset: 0, transform: textFlip }}>
          {renderEditor(shape, scale)}
        </div>
      ) : shape.text && hasText(shape.text) ? (
        <div style={{ position: 'absolute', inset: 0, transform: textFlip }}>
          <Text body={shape.text} scale={scale} />
        </div>
      ) : showPrompts && shape.prompt !== null ? (
        <Prompt shape={shape} scale={scale} />
      ) : null}
    </div>
  )
}

function hasText(body: TextBody): boolean {
  return body.paragraphs.some((p) => p.runs.length > 0)
}

// ── Geometry ─────────────────────────────────────────────────────────────────

const DASHES: Record<string, number[]> = {
  dash: [4, 3],
  dashDot: [4, 3, 1, 3],
  dot: [1, 3],
  lgDash: [8, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
}

function paint(fill: Fill, id: string): { value: string; defs: ReactNode } {
  switch (fill.kind) {
    case 'solid':
      return { value: css(fill.color), defs: null }
    case 'gradient': {
      const stops = fill.stops.map((s, i) => (
        <stop
          key={i}
          offset={s.pos}
          stopColor={css({ ...s.color, a: 1 })}
          stopOpacity={s.color.a}
        />
      ))
      if (fill.radial) {
        return { value: `url(#${id})`, defs: <radialGradient id={id}>{stops}</radialGradient> }
      }
      const a = (fill.angle * Math.PI) / 180
      const dx = Math.cos(a) / 2
      const dy = Math.sin(a) / 2
      return {
        value: `url(#${id})`,
        defs: (
          <linearGradient id={id} x1={0.5 - dx} y1={0.5 - dy} x2={0.5 + dx} y2={0.5 + dy}>
            {stops}
          </linearGradient>
        ),
      }
    }
    case 'image':
      if (!fill.src) return { value: 'none', defs: null }
      return {
        value: `url(#${id})`,
        defs: (
          <pattern id={id} patternContentUnits="objectBoundingBox" width="1" height="1">
            <image href={fill.src} width="1" height="1" preserveAspectRatio="none" />
          </pattern>
        ),
      }
    case 'pattern':
      return { value: css(mix(fill.fg, fill.bg)), defs: null }
    default:
      return { value: 'none', defs: null }
  }
}

function strokeProps(line: Line | null, scale: number) {
  if (!line || line.fill.kind === 'none') return { stroke: 'none' as const, width: 0 }
  const width = Math.max(0.5, line.width * scale)
  const color =
    line.fill.kind === 'solid'
      ? css(line.fill.color)
      : line.fill.kind === 'gradient'
        ? css(line.fill.stops[0].color)
        : '#000000'
  const dash = DASHES[line.dash]
  return { stroke: color, width, dash: dash ? dash.map((d) => d * width).join(' ') : undefined }
}

function Geometry({
  shape,
  width,
  height,
  scale,
}: {
  shape: ShapeModel
  width: number
  height: number
  scale: number
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const w = Math.max(width, 0)
  const h = Math.max(height, 0)
  const paths: ShapePath[] =
    shape.geometry.kind === 'custom'
      ? customPaths(shape.geometry.el, w, h)
      : presetPath(shape.geometry.name, w, h, shape.geometry.adjust)
  const fill = shape.isLine ? { value: 'none', defs: null } : paint(shape.fill, `f${id}`)
  const stroke = strokeProps(shape.line, scale)
  if (fill.value === 'none' && stroke.stroke === 'none') return null
  const markerSize = Math.max(3, stroke.width * 3)
  const marker = (end: 'head' | 'tail', type: string | null) => {
    if (!type || stroke.stroke === 'none') return null
    const mid = `m${end}${id}`
    const shapeEl =
      type === 'oval' ? (
        <circle cx="5" cy="5" r="4" fill={stroke.stroke} />
      ) : type === 'diamond' ? (
        <path d="M5,0 L10,5 L5,10 L0,5 Z" fill={stroke.stroke} />
      ) : type === 'arrow' ? (
        <path d="M0,0 L10,5 L0,10" fill="none" stroke={stroke.stroke} strokeWidth="1.5" />
      ) : (
        <path d="M0,0 L10,5 L0,10 Z" fill={stroke.stroke} />
      )
    return (
      <marker
        key={mid}
        id={mid}
        viewBox="0 0 10 10"
        refX="5"
        refY="5"
        markerWidth={markerSize}
        markerHeight={markerSize}
        markerUnits="userSpaceOnUse"
        orient="auto-start-reverse"
      >
        {shapeEl}
      </marker>
    )
  }
  const head = marker('head', shape.line?.head ?? null)
  const tail = marker('tail', shape.line?.tail ?? null)
  return (
    <svg
      width={w}
      height={h}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
      aria-hidden="true"
    >
      {(fill.defs || head || tail) && (
        <defs>
          {fill.defs}
          {head}
          {tail}
        </defs>
      )}
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.filled ? fill.value : 'none'}
          stroke={p.stroked ? stroke.stroke : 'none'}
          strokeWidth={stroke.width || undefined}
          strokeDasharray={stroke.dash}
          strokeLinejoin="round"
          markerStart={head && i === 0 ? `url(#mhead${id})` : undefined}
          markerEnd={tail && i === paths.length - 1 ? `url(#mtail${id})` : undefined}
        />
      ))}
    </svg>
  )
}

// ── Pictures and objects ─────────────────────────────────────────────────────

function Picture({
  shape,
  width,
  height,
  scale,
}: {
  shape: ShapeModel
  width: number
  height: number
  scale: number
}) {
  const img = shape.image
  const stroke = strokeProps(shape.line, scale)
  if (!img || !img.src) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(128, 128, 128, 0.12)',
          border: '1px dashed rgba(128, 128, 128, 0.7)',
          color: 'rgba(90, 90, 90, 0.9)',
          fontFamily: 'sans-serif',
          fontSize: Math.max(8, Math.min(14, height / 6)),
          overflow: 'hidden',
          textAlign: 'center',
        }}
      >
        {img?.label ?? 'Object'}
      </div>
    )
  }
  const { l, t, r, b } = img.crop
  const cw = Math.max(0.01, 1 - l - r)
  const ch = Math.max(0.01, 1 - t - b)
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        boxShadow:
          stroke.stroke !== 'none' ? `inset 0 0 0 ${stroke.width}px ${stroke.stroke}` : undefined,
      }}
    >
      <img
        src={img.src}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          left: `${(-l / cw) * 100}%`,
          top: `${(-t / ch) * 100}%`,
          width: `${(1 / cw) * 100}%`,
          height: `${(1 / ch) * 100}%`,
          maxWidth: 'none',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />
      {void width}
    </div>
  )
}

// ── Text ─────────────────────────────────────────────────────────────────────

export function Text({ body, scale }: { body: TextBody; scale: number }) {
  return (
    <div style={bodyCss(body, scale) as CSSProperties}>
      {body.paragraphs.map((p, i) => (
        <div key={i} style={paragraphCss(p, body, scale, i === 0) as CSSProperties}>
          {p.bullet && (
            <span style={bulletCss(p.bullet, p, body, scale) as CSSProperties}>
              {bulletText(p.bullet)}
            </span>
          )}
          {p.runs.length === 0
            ? '\u200b'
            : p.runs.map((r, j) =>
                r.kind === 'br' ? (
                  <br key={j} />
                ) : (
                  <span key={j} style={runCss(r.style, scale, body.fontScale) as CSSProperties}>
                    {r.text}
                  </span>
                )
              )}
          {p.runs.length > 0 && p.runs[p.runs.length - 1].kind === 'br' && '\u200b'}
        </div>
      ))}
    </div>
  )
}

function Prompt({ shape, scale }: { shape: ShapeModel; scale: number }) {
  const body = shape.text
  const p = body?.paragraphs[0]
  const size = p ? p.endStyle.sizePt * (body?.fontScale ?? 1) * 12700 * scale : 14
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        border: '1px dashed rgba(128, 128, 128, 0.8)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent:
          body?.anchor === 'ctr' ? 'center' : body?.anchor === 'b' ? 'flex-end' : 'flex-start',
        textAlign: p?.align === 'ctr' ? 'center' : p?.align === 'r' ? 'right' : 'left',
        padding: body
          ? `${body.insets.t * scale}px ${body.insets.r * scale}px ${body.insets.b * scale}px ${body.insets.l * scale}px`
          : 4,
        color: 'rgba(110, 110, 110, 0.95)',
        fontFamily: p ? (runCss(p.endStyle, scale, 1).fontFamily as string) : 'sans-serif',
        fontSize: Math.max(6, size),
        lineHeight: 1.2,
        boxSizing: 'border-box',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {shape.prompt}
    </div>
  )
}

// ── Tables ───────────────────────────────────────────────────────────────────

function borderCss(line: Line | null, scale: number): string | undefined {
  if (!line) return undefined
  const s = strokeProps(line, scale)
  return s.stroke === 'none' ? undefined : `${Math.max(0.5, s.width)}px solid ${s.stroke}`
}

function Table({ table, scale }: { table: TableModel; scale: number }) {
  const width = table.cols.reduce((a, b) => a + b, 0) * scale
  return (
    <table
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
      }}
    >
      <colgroup>
        {table.cols.map((w, i) => (
          <col key={i} style={{ width: w * scale }} />
        ))}
      </colgroup>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r} style={{ height: row.height * scale }}>
            {row.cells.map((cell, c) =>
              cell.merged ? null : (
                <td
                  key={c}
                  colSpan={cell.gridSpan > 1 ? cell.gridSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                  style={{
                    position: 'relative',
                    padding: 0,
                    verticalAlign:
                      cell.text.anchor === 'ctr'
                        ? 'middle'
                        : cell.text.anchor === 'b'
                          ? 'bottom'
                          : 'top',
                    borderLeft: borderCss(cell.borders.l, scale),
                    borderRight: borderCss(cell.borders.r, scale),
                    borderTop: borderCss(cell.borders.t, scale),
                    borderBottom: borderCss(cell.borders.b, scale),
                    ...backgroundCss(cell.fill),
                  }}
                >
                  <div style={{ position: 'relative', minHeight: row.height * scale }}>
                    <CellText body={cell.text} scale={scale} />
                  </div>
                </td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Table cell text flows (it sizes the row) instead of filling an absolute box. */
function CellText({ body, scale }: { body: TextBody; scale: number }) {
  const outer = bodyCss(body, scale)
  delete outer.position
  delete outer.inset
  return (
    <div style={{ ...(outer as CSSProperties), minHeight: 'inherit' }}>
      {body.paragraphs.map((p, i) => (
        <div key={i} style={paragraphCss(p, body, scale, i === 0) as CSSProperties}>
          {p.runs.length === 0
            ? '\u200b'
            : p.runs.map((r, j) =>
                r.kind === 'br' ? (
                  <br key={j} />
                ) : (
                  <span key={j} style={runCss(r.style, scale, body.fontScale) as CSSProperties}>
                    {r.text}
                  </span>
                )
              )}
        </div>
      ))}
    </div>
  )
}
