/**
 * Shape outlines as SVG paths, in the shape's own pixel box (0,0)–(w,h).
 *
 * Preset geometry: the common presets drawn from their definitions in
 * ECMA-376 Part 1 §20.1.10.56 (`presetShapeDefinitions.xml`), simplified where
 * a preset's guides only refine a corner; anything not listed draws as its
 * bounding rectangle. Custom geometry (`a:custGeom`) is drawn exactly.
 */
import { NS } from './ns.ts'
import type { XmlElement } from './xml.ts'

export type ShapePath = {
  d: string
  /** False for open paths (lines, arcs) and paths marked `fill="none"`. */
  filled: boolean
  /** False for paths marked `stroke="0"`. */
  stroked: boolean
}

type Adj = Record<string, number>

/** `a:avLst` guide values (`val N`) by name. */
export function readAdjust(geom: XmlElement | null): Adj {
  const out: Adj = {}
  for (const gd of geom?.child(NS.a, 'avLst')?.childrenOf(NS.a, 'gd') ?? []) {
    const m = /^val\s+(-?\d+)/.exec(gd.attr('fmla') ?? '')
    const name = gd.attr('name')
    if (m && name) out[name] = Number(m[1])
  }
  return out
}

const f = (n: number) => (Math.round(n * 100) / 100).toString()
const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')} Z`

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${f(cx - rx)},${f(cy)} A${f(rx)},${f(ry)} 0 1 0 ${f(cx + rx)},${f(cy)} A${f(rx)},${f(ry)} 0 1 0 ${f(cx - rx)},${f(cy)} Z`
}

function roundRectPath(w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  if (rr === 0)
    return poly([
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ])
  return (
    `M${f(rr)},0 L${f(w - rr)},0 A${f(rr)},${f(rr)} 0 0 1 ${f(w)},${f(rr)} ` +
    `L${f(w)},${f(h - rr)} A${f(rr)},${f(rr)} 0 0 1 ${f(w - rr)},${f(h)} ` +
    `L${f(rr)},${f(h)} A${f(rr)},${f(rr)} 0 0 1 0,${f(h - rr)} L0,${f(rr)} A${f(rr)},${f(rr)} 0 0 1 ${f(rr)},0 Z`
  )
}

function star(w: number, h: number, points: number, innerRatio: number): string {
  const cx = w / 2
  const cy = h / 2
  const pts: [number, number][] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 1 : innerRatio
    const ang = -Math.PI / 2 + (i * Math.PI) / points
    pts.push([cx + (Math.cos(ang) * r * w) / 2, cy + (Math.sin(ang) * r * h) / 2])
  }
  return poly(pts)
}

function regular(w: number, h: number, sides: number, startDeg = -90): string {
  const pts: [number, number][] = []
  for (let i = 0; i < sides; i++) {
    const ang = ((startDeg + (360 * i) / sides) * Math.PI) / 180
    pts.push([w / 2 + (Math.cos(ang) * w) / 2, h / 2 + (Math.sin(ang) * h) / 2])
  }
  return poly(pts)
}

const filled = (d: string): ShapePath[] => [{ d, filled: true, stroked: true }]
const open = (d: string): ShapePath[] => [{ d, filled: false, stroked: true }]

/** Draw preset `name` in a w×h box. */
export function presetPath(name: string, w: number, h: number, adj: Adj = {}): ShapePath[] {
  const ss = Math.min(w, h)
  const a = (key: string, dflt: number) => (adj[key] ?? adj[key.replace(/1$/, '')] ?? dflt) / 100000
  switch (name) {
    case 'line':
    case 'straightConnector1':
      return open(`M0,0 L${f(w)},${f(h)}`)
    case 'bentConnector2':
      return open(`M0,0 L${f(w)},0 L${f(w)},${f(h)}`)
    case 'bentConnector3': {
      const x = w * a('adj1', 50000)
      return open(`M0,0 L${f(x)},0 L${f(x)},${f(h)} L${f(w)},${f(h)}`)
    }
    case 'bentConnector4':
    case 'bentConnector5': {
      const x = w * a('adj1', 50000)
      const y = h * a('adj2', 50000)
      return open(`M0,0 L${f(x)},0 L${f(x)},${f(y)} L${f(w)},${f(y)} L${f(w)},${f(h)}`)
    }
    case 'curvedConnector2':
    case 'curvedConnector3':
    case 'curvedConnector4':
    case 'curvedConnector5':
      return open(`M0,0 C${f(w / 2)},0 ${f(w / 2)},${f(h)} ${f(w)},${f(h)}`)
    case 'ellipse':
    case 'flowChartConnector':
    case 'flowChartOffpageConnector':
      return filled(ellipsePath(w / 2, h / 2, w / 2, h / 2))
    case 'roundRect':
    case 'flowChartAlternateProcess':
      return filled(roundRectPath(w, h, ss * a('adj', 16667)))
    case 'round1Rect':
    case 'round2SameRect':
    case 'round2DiagRect':
    case 'snipRoundRect':
      return filled(roundRectPath(w, h, ss * a('adj1', 16667)))
    case 'flowChartTerminator':
      return filled(roundRectPath(w, h, Math.min(w, h) / 2))
    case 'triangle':
    case 'flowChartExtract': {
      const x = w * a('adj', 50000)
      return filled(
        poly([
          [x, 0],
          [w, h],
          [0, h],
        ])
      )
    }
    case 'flowChartMerge':
      return filled(
        poly([
          [0, 0],
          [w, 0],
          [w / 2, h],
        ])
      )
    case 'rtTriangle':
      return filled(
        poly([
          [0, 0],
          [w, h],
          [0, h],
        ])
      )
    case 'diamond':
    case 'flowChartDecision':
      return filled(
        poly([
          [w / 2, 0],
          [w, h / 2],
          [w / 2, h],
          [0, h / 2],
        ])
      )
    case 'parallelogram':
    case 'flowChartInputOutput': {
      const x = name === 'parallelogram' ? ss * a('adj', 25000) : w / 5
      return filled(
        poly([
          [x, 0],
          [w, 0],
          [w - x, h],
          [0, h],
        ])
      )
    }
    case 'trapezoid':
    case 'flowChartManualOperation': {
      const x = name === 'trapezoid' ? ss * a('adj', 25000) : w / 5
      return filled(
        poly([
          [x, 0],
          [w - x, 0],
          [w, h],
          [0, h],
        ])
      )
    }
    case 'pentagon':
      return filled(regular(w, h, 5))
    case 'hexagon': {
      const x = ss * a('adj', 25000)
      return filled(
        poly([
          [x, 0],
          [w - x, 0],
          [w, h / 2],
          [w - x, h],
          [x, h],
          [0, h / 2],
        ])
      )
    }
    case 'heptagon':
      return filled(regular(w, h, 7))
    case 'octagon': {
      const x = ss * a('adj', 29289)
      return filled(
        poly([
          [x, 0],
          [w - x, 0],
          [w, x],
          [w, h - x],
          [w - x, h],
          [x, h],
          [0, h - x],
          [0, x],
        ])
      )
    }
    case 'decagon':
      return filled(regular(w, h, 10))
    case 'dodecagon':
      return filled(regular(w, h, 12))
    case 'star4':
      return filled(star(w, h, 4, a('adj', 12500) * 2))
    case 'star5':
      return filled(star(w, h, 5, 0.382))
    case 'star6':
      return filled(star(w, h, 6, 0.577))
    case 'star7':
    case 'star8':
    case 'star10':
    case 'star12':
    case 'star16':
    case 'star24':
    case 'star32':
      return filled(star(w, h, Number(name.slice(4)), 0.75))
    case 'plus':
    case 'flowChartSummingJunction':
    case 'mathPlus': {
      const x = ss * a('adj', 25000)
      return filled(
        poly(
          [
            [x, 0],
            [w - x, 0],
            [w - x, x],
            [w, x],
            [w, h - x],
            [w - x, h - x],
            [w - x, h],
            [x, h],
            [x, h - x],
            [0, h - x],
            [0, x],
            [x, x],
          ].map(([px, py]) => [px, py]) as [number, number][]
        )
      )
    }
    case 'rightArrow':
    case 'leftArrow':
    case 'upArrow':
    case 'downArrow': {
      const horizontal = name === 'rightArrow' || name === 'leftArrow'
      const len = horizontal ? w : h
      const thick = horizontal ? h : w
      const shaft = thick * a('adj1', 50000)
      const head = Math.min(len, ss * a('adj2', 50000))
      const s0 = (thick - shaft) / 2
      // Drawn pointing right in (len × thick), then mapped.
      const pts: [number, number][] = [
        [0, s0],
        [len - head, s0],
        [len - head, 0],
        [len, thick / 2],
        [len - head, thick],
        [len - head, thick - s0],
        [0, thick - s0],
      ]
      const map = (p: [number, number]): [number, number] => {
        if (name === 'rightArrow') return p
        if (name === 'leftArrow') return [w - p[0], p[1]]
        if (name === 'downArrow') return [p[1], p[0]]
        return [p[1], h - p[0]]
      }
      return filled(poly(pts.map(map)))
    }
    case 'leftRightArrow': {
      const shaft = h * a('adj1', 50000)
      const head = Math.min(w / 2, ss * a('adj2', 50000))
      const s0 = (h - shaft) / 2
      return filled(
        poly([
          [0, h / 2],
          [head, 0],
          [head, s0],
          [w - head, s0],
          [w - head, 0],
          [w, h / 2],
          [w - head, h],
          [w - head, h - s0],
          [head, h - s0],
          [head, h],
        ])
      )
    }
    case 'upDownArrow': {
      const shaft = w * a('adj1', 50000)
      const head = Math.min(h / 2, ss * a('adj2', 50000))
      const s0 = (w - shaft) / 2
      return filled(
        poly([
          [w / 2, 0],
          [w, head],
          [w - s0, head],
          [w - s0, h - head],
          [w, h - head],
          [w / 2, h],
          [0, h - head],
          [s0, h - head],
          [s0, head],
          [0, head],
        ])
      )
    }
    case 'chevron': {
      const x = ss * a('adj', 50000)
      return filled(
        poly([
          [0, 0],
          [w - x, 0],
          [w, h / 2],
          [w - x, h],
          [0, h],
          [x, h / 2],
        ])
      )
    }
    case 'homePlate':
    case 'flowChartPunchedTape': {
      const x = ss * a('adj', 50000)
      return filled(
        poly([
          [0, 0],
          [w - x, 0],
          [w, h / 2],
          [w - x, h],
          [0, h],
        ])
      )
    }
    case 'snip1Rect': {
      const x = ss * a('adj', 16667)
      return filled(
        poly([
          [0, 0],
          [w - x, 0],
          [w, x],
          [w, h],
          [0, h],
        ])
      )
    }
    case 'snip2SameRect': {
      const x = ss * a('adj1', 16667)
      return filled(
        poly([
          [x, 0],
          [w - x, 0],
          [w, x],
          [w, h],
          [0, h],
          [0, x],
        ])
      )
    }
    case 'snip2DiagRect': {
      const x = ss * a('adj2', 16667)
      return filled(
        poly([
          [0, 0],
          [w - x, 0],
          [w, x],
          [w, h],
          [x, h],
          [0, h - x],
        ])
      )
    }
    case 'plaque':
    case 'bevel':
    case 'frame':
    case 'halfFrame':
    case 'corner':
      if (name === 'frame') {
        const t = ss * a('adj1', 12500)
        return [
          {
            d: `${poly([
              [0, 0],
              [w, 0],
              [w, h],
              [0, h],
            ])} ${poly([
              [t, t],
              [t, h - t],
              [w - t, h - t],
              [w - t, t],
            ])}`,
            filled: true,
            stroked: true,
          },
        ]
      }
      return filled(
        poly([
          [0, 0],
          [w, 0],
          [w, h],
          [0, h],
        ])
      )
    case 'donut': {
      const t = ss * a('adj', 25000)
      return [
        {
          d: `${ellipsePath(w / 2, h / 2, w / 2, h / 2)} ${ellipsePath(w / 2, h / 2, Math.max(0, w / 2 - t), Math.max(0, h / 2 - t))}`,
          filled: true,
          stroked: true,
        },
      ]
    }
    case 'can':
    case 'flowChartMagneticDisk': {
      const ry = Math.min(h / 2, (ss * a('adj', 25000)) / 2)
      return [
        {
          d:
            `M0,${f(ry)} A${f(w / 2)},${f(ry)} 0 0 1 ${f(w)},${f(ry)} L${f(w)},${f(h - ry)} ` +
            `A${f(w / 2)},${f(ry)} 0 0 1 0,${f(h - ry)} Z`,
          filled: true,
          stroked: true,
        },
        {
          d: `M0,${f(ry)} A${f(w / 2)},${f(ry)} 0 0 0 ${f(w)},${f(ry)}`,
          filled: false,
          stroked: true,
        },
      ]
    }
    case 'cube': {
      const d = ss * a('adj', 25000)
      return [
        {
          d: poly([
            [0, d],
            [w - d, d],
            [w - d, h],
            [0, h],
          ]),
          filled: true,
          stroked: true,
        },
        {
          d: poly([
            [0, d],
            [d, 0],
            [w, 0],
            [w - d, d],
          ]),
          filled: true,
          stroked: true,
        },
        {
          d: poly([
            [w - d, d],
            [w, 0],
            [w, h - d],
            [w - d, h],
          ]),
          filled: true,
          stroked: true,
        },
      ]
    }
    case 'foldedCorner': {
      const d = ss * a('adj', 16667)
      return [
        {
          d: poly([
            [0, 0],
            [w, 0],
            [w, h - d],
            [w - d, h],
            [0, h],
          ]),
          filled: true,
          stroked: true,
        },
        {
          d: `M${f(w - d)},${f(h)} L${f(w - d * 0.8)},${f(h - d * 0.8)} L${f(w)},${f(h - d)}`,
          filled: false,
          stroked: true,
        },
      ]
    }
    case 'flowChartDocument':
      return filled(
        `M0,0 L${f(w)},0 L${f(w)},${f(h * 0.83)} C${f(w * 0.75)},${f(h * 0.7)} ${f(w * 0.25)},${f(h * 1.05)} 0,${f(h * 0.9)} Z`
      )
    case 'flowChartPredefinedProcess':
      return [
        {
          d: poly([
            [0, 0],
            [w, 0],
            [w, h],
            [0, h],
          ]),
          filled: true,
          stroked: true,
        },
        {
          d: `M${f(w / 8)},0 L${f(w / 8)},${f(h)} M${f((w * 7) / 8)},0 L${f((w * 7) / 8)},${f(h)}`,
          filled: false,
          stroked: true,
        },
      ]
    case 'wedgeRectCallout':
    case 'wedgeRoundRectCallout':
    case 'wedgeEllipseCallout':
    case 'cloudCallout': {
      const tx = w / 2 + w * a('adj1', -20833)
      const ty = h / 2 + h * a('adj2', 62500)
      const body =
        name === 'wedgeEllipseCallout' || name === 'cloudCallout'
          ? ellipsePath(w / 2, h / 2, w / 2, h / 2)
          : name === 'wedgeRoundRectCallout'
            ? roundRectPath(w, h, ss * 0.16667)
            : poly([
                [0, 0],
                [w, 0],
                [w, h],
                [0, h],
              ])
      const base = Math.min(w, h) * 0.15
      const tail = poly([
        [w / 2 - base, h / 2],
        [w / 2 + base, h / 2],
        [tx, ty],
      ])
      return [
        { d: tail, filled: true, stroked: true },
        { d: body, filled: true, stroked: true },
      ]
    }
    case 'cloud':
      return filled(
        `M${f(w * 0.2)},${f(h * 0.35)} C${f(w * 0.15)},${f(h * 0.05)} ${f(w * 0.45)},${f(h * -0.02)} ${f(w * 0.55)},${f(h * 0.15)} ` +
          `C${f(w * 0.7)},${f(h * -0.05)} ${f(w * 0.95)},${f(h * 0.1)} ${f(w * 0.88)},${f(h * 0.4)} ` +
          `C${f(w * 1.05)},${f(h * 0.55)} ${f(w * 0.95)},${f(h * 0.95)} ${f(w * 0.7)},${f(h * 0.88)} ` +
          `C${f(w * 0.55)},${f(h * 1.05)} ${f(w * 0.25)},${f(h * 1.02)} ${f(w * 0.2)},${f(h * 0.8)} ` +
          `C${f(w * -0.05)},${f(h * 0.8)} ${f(w * -0.05)},${f(h * 0.4)} ${f(w * 0.2)},${f(h * 0.35)} Z`
      )
    case 'heart':
      return filled(
        `M${f(w / 2)},${f(h * 0.25)} C${f(w / 2)},0 0,0 0,${f(h * 0.3)} C0,${f(h * 0.6)} ${f(w / 2)},${f(h * 0.8)} ${f(w / 2)},${f(h)} ` +
          `C${f(w / 2)},${f(h * 0.8)} ${f(w)},${f(h * 0.6)} ${f(w)},${f(h * 0.3)} C${f(w)},0 ${f(w / 2)},0 ${f(w / 2)},${f(h * 0.25)} Z`
      )
    case 'pie':
    case 'chord':
    case 'arc':
    case 'blockArc': {
      const st = ((adj.adj1 ?? (name === 'arc' ? 16200000 : 0)) / 60000) * (Math.PI / 180)
      const en = ((adj.adj2 ?? (name === 'arc' ? 0 : 16200000)) / 60000) * (Math.PI / 180)
      const rx = w / 2
      const ry = h / 2
      const p = (ang: number): [number, number] => [
        rx + rx * Math.cos(ang),
        ry + ry * Math.sin(ang),
      ]
      let sweep = en - st
      while (sweep <= 0) sweep += Math.PI * 2
      const [x1, y1] = p(st)
      const [x2, y2] = p(st + sweep)
      const large = sweep > Math.PI ? 1 : 0
      const arc = `M${f(x1)},${f(y1)} A${f(rx)},${f(ry)} 0 ${large} 1 ${f(x2)},${f(y2)}`
      if (name === 'arc') return open(arc)
      if (name === 'chord') return filled(`${arc} Z`)
      return filled(
        `M${f(rx)},${f(ry)} L${f(x1)},${f(y1)} A${f(rx)},${f(ry)} 0 ${large} 1 ${f(x2)},${f(y2)} Z`
      )
    }
    case 'leftBracket':
      return open(`M${f(w)},0 Q0,0 0,${f(h * 0.1)} L0,${f(h * 0.9)} Q0,${f(h)} ${f(w)},${f(h)}`)
    case 'rightBracket':
      return open(
        `M0,0 Q${f(w)},0 ${f(w)},${f(h * 0.1)} L${f(w)},${f(h * 0.9)} Q${f(w)},${f(h)} 0,${f(h)}`
      )
    case 'leftBrace':
      return open(
        `M${f(w)},0 Q${f(w / 2)},0 ${f(w / 2)},${f(h * 0.1)} L${f(w / 2)},${f(h * 0.4)} Q${f(w / 2)},${f(h / 2)} 0,${f(h / 2)} Q${f(w / 2)},${f(h / 2)} ${f(w / 2)},${f(h * 0.6)} L${f(w / 2)},${f(h * 0.9)} Q${f(w / 2)},${f(h)} ${f(w)},${f(h)}`
      )
    case 'rightBrace':
      return open(
        `M0,0 Q${f(w / 2)},0 ${f(w / 2)},${f(h * 0.1)} L${f(w / 2)},${f(h * 0.4)} Q${f(w / 2)},${f(h / 2)} ${f(w)},${f(h / 2)} Q${f(w / 2)},${f(h / 2)} ${f(w / 2)},${f(h * 0.6)} L${f(w / 2)},${f(h * 0.9)} Q${f(w / 2)},${f(h)} 0,${f(h)}`
      )
    default:
      return filled(
        poly([
          [0, 0],
          [w, 0],
          [w, h],
          [0, h],
        ])
      )
  }
}

/** The presets the Insert menu offers, with their names. */
export const INSERTABLE_SHAPES: { preset: string; label: string }[] = [
  { preset: 'rect', label: 'Rectangle' },
  { preset: 'roundRect', label: 'Rounded rectangle' },
  { preset: 'ellipse', label: 'Oval' },
  { preset: 'triangle', label: 'Triangle' },
  { preset: 'rightArrow', label: 'Right arrow' },
  { preset: 'star5', label: 'Star' },
  { preset: 'line', label: 'Line' },
]

/**
 * `a:custGeom`: each `a:path` in its own coordinate space (w×h, default the
 * shape's), scaled to the box.
 */
export function customPaths(custGeom: XmlElement, w: number, h: number): ShapePath[] {
  const out: ShapePath[] = []
  for (const path of custGeom.path([NS.a, 'pathLst'])?.childrenOf(NS.a, 'path') ?? []) {
    const pw = Number(path.attr('w')) || w
    const ph = Number(path.attr('h')) || h
    const sx = pw ? w / pw : 1
    const sy = ph ? h / ph : 1
    const pt = (el: XmlElement | null): [number, number] => [
      (Number(el?.attr('x')) || 0) * sx,
      (Number(el?.attr('y')) || 0) * sy,
    ]
    let d = ''
    let cur: [number, number] = [0, 0]
    for (const cmd of path.elements()) {
      const pts = cmd.childrenOf(NS.a, 'pt')
      switch (cmd.local) {
        case 'moveTo':
          cur = pt(pts[0])
          d += `M${f(cur[0])},${f(cur[1])} `
          break
        case 'lnTo':
          cur = pt(pts[0])
          d += `L${f(cur[0])},${f(cur[1])} `
          break
        case 'cubicBezTo': {
          const [p1, p2, p3] = pts.map(pt)
          if (p1 && p2 && p3) {
            d += `C${f(p1[0])},${f(p1[1])} ${f(p2[0])},${f(p2[1])} ${f(p3[0])},${f(p3[1])} `
            cur = p3
          }
          break
        }
        case 'quadBezTo': {
          const [p1, p2] = pts.map(pt)
          if (p1 && p2) {
            d += `Q${f(p1[0])},${f(p1[1])} ${f(p2[0])},${f(p2[1])} `
            cur = p2
          }
          break
        }
        case 'arcTo': {
          const wR = (Number(cmd.attr('wR')) || 0) * sx
          const hR = (Number(cmd.attr('hR')) || 0) * sy
          const stAng = ((Number(cmd.attr('stAng')) || 0) / 60000) * (Math.PI / 180)
          const swAng = ((Number(cmd.attr('swAng')) || 0) / 60000) * (Math.PI / 180)
          // The arc starts at the current point, which sits at stAng on the ellipse.
          const cx = cur[0] - wR * Math.cos(stAng)
          const cy = cur[1] - hR * Math.sin(stAng)
          const end: [number, number] = [
            cx + wR * Math.cos(stAng + swAng),
            cy + hR * Math.sin(stAng + swAng),
          ]
          const large = Math.abs(swAng) > Math.PI ? 1 : 0
          const sweep = swAng > 0 ? 1 : 0
          d += `A${f(wR)},${f(hR)} 0 ${large} ${sweep} ${f(end[0])},${f(end[1])} `
          cur = end
          break
        }
        case 'close':
          d += 'Z '
          break
      }
    }
    if (!d) continue
    const fill = path.attr('fill')
    const stroke = path.attr('stroke')
    out.push({
      d: d.trim(),
      // DrawingML fills a path unless it says fill="none", closed or not.
      filled: fill !== 'none',
      stroked: stroke !== '0' && stroke !== 'false',
    })
  }
  return out
}
