import type { ShapeModel, SlideModel } from '../engine/model'

export type EditingState = {
  id: string
  caret: 'end' | 'all' | { x: number; y: number }
  session: number
}

/** Shapes the stage can select: the slide's own, at the top level. */
export function selectable(model: SlideModel | null): ShapeModel[] {
  return model ? model.shapes.filter((s) => s.origin === 'slide') : []
}

/** Shapes whose text can be edited in place. */
export function canEditText(shape: ShapeModel | undefined | null): boolean {
  return !!shape && shape.kind === 'shape' && !shape.isLine && !!shape.el && shape.el.local === 'sp'
}
