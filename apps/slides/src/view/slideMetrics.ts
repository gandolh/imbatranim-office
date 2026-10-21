import type { CSSProperties } from 'react'
import { css, type Rgba } from '../engine/color'
import type { Fill, SlideModel } from '../engine/model'

/** The logical width every slide is drawn at; views scale it with a transform. */
export const BASE_WIDTH = 960

export function slideHeight(model: SlideModel, width = BASE_WIDTH): number {
  return (width * model.size.cy) / model.size.cx
}

/** CSS background for a slide or a table cell. */
export function backgroundCss(fill: Fill): CSSProperties {
  switch (fill.kind) {
    case 'solid':
      return { backgroundColor: css(fill.color) }
    case 'gradient': {
      const stops = fill.stops
        .map((s) => `${css(s.color)} ${Math.round(s.pos * 1000) / 10}%`)
        .join(', ')
      return {
        backgroundImage: fill.radial
          ? `radial-gradient(circle, ${stops})`
          : `linear-gradient(${Math.round(fill.angle + 90)}deg, ${stops})`,
      }
    }
    case 'image':
      return fill.src
        ? {
            backgroundImage: `url("${fill.src}")`,
            backgroundSize: fill.tile ? 'auto' : '100% 100%',
            backgroundRepeat: fill.tile ? 'repeat' : 'no-repeat',
          }
        : {}
    case 'pattern':
      return { backgroundColor: css(mix(fill.fg, fill.bg)) }
    default:
      return {}
  }
}

/** Halfway between two colours (how a pattern fill is approximated). */
export function mix(a: Rgba, b: Rgba): Rgba {
  return { r: (a.r + b.r) / 2, g: (a.g + b.g) / 2, b: (a.b + b.b) / 2, a: (a.a + b.a) / 2 }
}
