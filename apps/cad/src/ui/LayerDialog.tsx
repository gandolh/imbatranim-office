import { Plus, Trash2 } from 'lucide-react'
import { Button, Checkbox, Dialog, ScrollArea, Select, useConfirm, usePrompt } from '@imbatranim/ui'
import { isLayerName } from '../engine/commands/registry'
import { DEFAULT_LAYER } from '../engine/model/document'
import type { Layer } from '../engine/model/types'
import type { Editor, EditorState } from '../engine/editor'
import { aciRgb, hex } from '../engine/render/style'

const COLOR_NAMES: Record<number, string> = {
  1: 'Red',
  2: 'Yellow',
  3: 'Green',
  4: 'Cyan',
  5: 'Blue',
  6: 'Magenta',
  7: 'White / black',
  8: 'Gray',
  9: 'Light gray',
}

function colorOptions(current: number) {
  const list = Object.entries(COLOR_NAMES).map(([n, label]) => ({
    value: n,
    label: `${n} ${label}`,
  }))
  if (!COLOR_NAMES[current]) list.push({ value: String(current), label: `${current}` })
  return list
}

/**
 * LAYER: the layer table. Every change is one undo step, made through the
 * document like any other edit.
 */
export function LayerDialog({
  editor,
  state,
  open,
  onClose,
}: {
  editor: Editor
  state: EditorState
  open: boolean
  onClose: () => void
}) {
  const { prompt, promptDialog } = usePrompt()
  const { confirm, confirmDialog } = useConfirm()
  const doc = editor.doc
  const linetypes = [...doc.linetypes.values()].map((l) => ({ value: l.name, label: l.name }))
  const used = new Set(doc.all().map((e) => e.layer))
  const set = (l: Layer, patch: Partial<Layer>) => doc.setLayer({ ...l, ...patch })

  const addLayer = async () => {
    const name = await prompt({
      title: 'New layer',
      message: 'Name of the new layer:',
      placeholder: 'WALLS',
      confirmLabel: 'Create',
    })
    if (!name) return
    if (!isLayerName(name)) {
      editor.message(`"${name}" is not a valid layer name.`)
      return
    }
    if ([...doc.layers.keys()].some((k) => k.toUpperCase() === name.toUpperCase())) {
      editor.message(`Layer "${name}" already exists.`)
      return
    }
    doc.setLayer({ ...DEFAULT_LAYER, name })
  }

  const removeLayer = async (l: Layer) => {
    const ok = await confirm({
      title: 'Delete layer?',
      message: `Delete layer "${l.name}"? It has no objects.`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (ok && !doc.deleteLayer(l.name)) editor.message(`Layer "${l.name}" cannot be deleted.`)
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title="Layers"
        className="w-[720px] max-w-[95vw]"
      >
        <div className="font-ui flex flex-col gap-2 text-[12px]">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => void addLayer()}>
              <Plus size={12} /> New layer
            </Button>
            <span className="text-on-surface-variant text-[11px]">
              Current layer: {state.currentLayer}
            </span>
          </div>
          <div className="border-outline-variant border">
            <div className="bg-surface-container-high text-on-surface-variant grid grid-cols-[52px_1fr_44px_56px_48px_150px_130px_32px] items-center gap-1 px-2 py-1 text-[11px] font-semibold tracking-wider uppercase">
              <span>Current</span>
              <span>Name</span>
              <span>On</span>
              <span>Freeze</span>
              <span>Lock</span>
              <span>Colour</span>
              <span>Linetype</span>
              <span />
            </div>
            <ScrollArea className="h-[260px]">
              <div role="list" aria-label="Layers">
                {state.layers.map((l) => (
                  <div
                    key={l.name}
                    role="listitem"
                    className="border-outline-variant grid grid-cols-[52px_1fr_44px_56px_48px_150px_130px_32px] items-center gap-1 border-t px-2 py-0.5"
                  >
                    <input
                      type="radio"
                      name="cad-current-layer"
                      aria-label={`Make ${l.name} current`}
                      checked={l.name === state.currentLayer}
                      disabled={l.frozen}
                      onChange={() => doc.setCurrentLayer(l.name)}
                      className="accent-primary"
                    />
                    <span className="text-on-surface truncate" title={l.name}>
                      {l.name}
                    </span>
                    <Checkbox
                      aria-label={`${l.name} on`}
                      checked={l.on}
                      onCheckedChange={(v) => set(l, { on: v === true })}
                    />
                    <Checkbox
                      aria-label={`${l.name} frozen`}
                      checked={l.frozen}
                      disabled={l.name === state.currentLayer}
                      onCheckedChange={(v) => set(l, { frozen: v === true })}
                    />
                    <Checkbox
                      aria-label={`${l.name} locked`}
                      checked={l.locked}
                      onCheckedChange={(v) => set(l, { locked: v === true })}
                    />
                    <div className="flex items-center gap-1">
                      {/* The layer's own drawing colour, as a swatch. */}
                      <span
                        className="border-outline-variant h-3 w-3 shrink-0 border"
                        style={{
                          backgroundColor: hex(l.rgb ?? aciRgb(l.color, editor.cache.foreground)),
                        }}
                        aria-hidden="true"
                      />
                      <Select
                        value={String(l.color)}
                        options={colorOptions(l.color)}
                        onValueChange={(v) => {
                          if (typeof v === 'string') set(l, { color: Number(v), rgb: undefined })
                        }}
                        className="py-0 text-[11px]"
                        aria-label={`${l.name} colour`}
                      />
                    </div>
                    <Select
                      value={
                        linetypes.find((o) => o.value.toUpperCase() === l.linetype.toUpperCase())
                          ?.value ?? 'Continuous'
                      }
                      options={linetypes}
                      onValueChange={(v) => {
                        if (typeof v === 'string') set(l, { linetype: v })
                      }}
                      className="py-0 text-[11px]"
                      aria-label={`${l.name} linetype`}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 justify-center p-0"
                      aria-label={`Delete layer ${l.name}`}
                      title={
                        l.name === '0' || l.name === state.currentLayer || used.has(l.name)
                          ? 'Only an empty layer that is not current can be deleted'
                          : 'Delete layer'
                      }
                      disabled={l.name === '0' || l.name === state.currentLayer || used.has(l.name)}
                      onClick={() => void removeLayer(l)}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="default" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
      {promptDialog}
      {confirmDialog}
    </>
  )
}
