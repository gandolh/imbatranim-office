/**
 * Renderer benchmark: open a DXF from /fixtures, fit it, then run a scripted
 * pan and a scripted zoom, one step per animation frame, recording the time
 * between frames and the renderer's own CPU time per frame. Results land in
 * `window.__perf` (and on the page) for agent-browser to read.
 */
import { readDxf } from '../src/engine/dxf/read'
import { translation } from '../src/engine/geom/affine'
import { CadDocument } from '../src/engine/model/document'
import { transformEntity } from '../src/engine/model/geometry'
import type { Entity } from '../src/engine/model/types'
import { DisplayCache } from '../src/engine/render/display'
import { Renderer, type RenderStats } from '../src/engine/render/renderer'
import { SpatialIndex } from '../src/engine/render/spatial'
import { View } from '../src/engine/view'

type Summary = {
  frames: number
  p50: number
  p95: number
  max: number
  mean: number
  fps: number
  over50: number
}

function summary(values: number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return {
    frames: values.length,
    p50: +at(0.5).toFixed(2),
    p95: +at(0.95).toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
    mean: +mean.toFixed(2),
    fps: +(1000 / mean).toFixed(1),
    over50: values.filter((v) => v > 50).length,
  }
}

const params = new URLSearchParams(location.search)
const file = params.get('file') ?? '3_us_main.dxf'
const frames = Number(params.get('frames') ?? 180)
const canvas = document.getElementById('c') as HTMLCanvasElement
const out = document.getElementById('out')!
const dpr = window.devicePixelRatio || 1
canvas.width = 1100 * dpr
canvas.height = 680 * dpr
const ctx = canvas.getContext('2d')!

const w = window as unknown as { __perf?: unknown; __perfRun?: () => Promise<unknown> }

async function main() {
  const t0 = performance.now()
  const bytes = new Uint8Array(
    await (await fetch(`/fixtures/${encodeURIComponent(file)}`)).arrayBuffer()
  )
  const tFetch = performance.now()
  const read = readDxf(bytes)
  const report = read.report
  let doc = read.doc
  const tRead = performance.now()
  // ?tile=N: a synthetic stress drawing, the sheet repeated N×N times side by side.
  const tile = Number(params.get('tile') ?? 1)
  if (tile > 1) {
    const src = doc
    const ext = new SpatialIndex(src).extents()!
    const w = (ext.maxX - ext.minX) * 1.05
    const h = (ext.maxY - ext.minY) * 1.05
    const entities: Entity[] = []
    let n = 0x1000
    for (let i = 0; i < tile; i++) {
      for (let j = 0; j < tile; j++) {
        for (const e of src.entities.values()) {
          const moved = e.kind === 'foreign' ? e : transformEntity(e, translation(i * w, j * h))
          if (moved) entities.push({ ...moved, handle: (n++).toString(16) })
        }
      }
    }
    doc = new CadDocument({
      entities,
      layers: [...src.layers.values()],
      linetypes: [...src.linetypes.values()],
      blocks: [...src.blocks.values()],
    })
  }
  const index = new SpatialIndex(doc)
  const tIndex = performance.now()
  const renderer = new Renderer(doc, index, new DisplayCache(doc))
  const view = new View()
  view.resize(1100, 680)
  const ext = index.extents()
  if (ext) view.fit(ext)
  const home = view.snapshot()
  const first = renderer.render(ctx, view, { background: '#141416', dpr })
  const load = {
    fetchMs: +(tFetch - t0).toFixed(1),
    readMs: +(tRead - tFetch).toFixed(1),
    indexMs: +(tIndex - tRead).toFixed(1),
    firstFrameMs: +first.ms.toFixed(1),
    firstPhases: Object.fromEntries(
      Object.entries(first.phases).map(([k, v]) => [k, +v.toFixed(1)])
    ),
    entities: doc.entities.size,
    tile,
    counts: report.counts,
  }
  out.textContent = JSON.stringify({ file, load }, null, 1)

  async function phase(
    step: (i: number) => void
  ): Promise<{ interval: Summary; cpu: Summary; last: RenderStats }> {
    const intervals: number[] = []
    const cpu: number[] = []
    let last: RenderStats = first
    let prev = await new Promise<number>((r) => requestAnimationFrame(r))
    for (let i = 0; i < frames; i++) {
      step(i)
      last = renderer.render(ctx, view, { background: '#141416', dpr })
      cpu.push(last.ms)
      const now = await new Promise<number>((r) => requestAnimationFrame(r))
      intervals.push(now - prev)
      prev = now
    }
    return { interval: summary(intervals), cpu: summary(cpu), last }
  }

  w.__perfRun = async () => {
    view.restore(home)
    // Pan across the whole drawing and back.
    const pan = await phase((i) => view.panBy(i < frames / 2 ? -8 : 8, i % 20 < 10 ? 2 : -2))
    view.restore(home)
    // Zoom in 1.03× per frame for half the run, then back out, about an off-centre point.
    const zoom = await phase((i) =>
      view.zoomAt({ x: 640, y: 300 }, i < frames / 2 ? 1.03 : 1 / 1.03)
    )
    view.restore(home)
    renderer.render(ctx, view, { background: '#141416', dpr })
    const result = {
      file,
      userAgent: navigator.userAgent,
      dpr,
      load,
      pan: { interval: pan.interval, cpu: pan.cpu, visibleAtEnd: pan.last.visible },
      zoom: { interval: zoom.interval, cpu: zoom.cpu, visibleAtEnd: zoom.last.visible },
    }
    w.__perf = result
    out.textContent = JSON.stringify(result, null, 1)
    return result
  }
  if (params.get('auto') !== '0') await w.__perfRun()
}

main().catch((err: unknown) => {
  out.textContent = `failed: ${String(err)}`
  w.__perf = { error: String(err) }
})
