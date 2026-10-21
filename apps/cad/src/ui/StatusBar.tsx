import { useState, useSyncExternalStore } from 'react'
import { ChevronUp } from 'lucide-react'
import { ContextMenu, Select, cn } from '@imbatranim/ui'
import type { Editor, EditorState } from '../engine/editor'
import { SNAP_LABEL, SNAP_MODES } from '../engine/input/snap'
import type { UnitSystem } from '../engine/model/types'

const UNIT_OPTIONS: { value: UnitSystem; label: string }[] = [
  { value: 'decimal', label: 'Decimal' },
  { value: 'architectural', label: 'Feet and inches' },
  { value: 'metric', label: 'Metric' },
]

function Toggle({
  label,
  title,
  on,
  onClick,
}: {
  label: string
  title: string
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'border px-1.5 text-[11px] font-semibold tracking-wider outline-none focus-visible:ring-2 focus-visible:ring-inset',
        on
          ? 'bg-primary border-primary text-on-primary focus-visible:ring-on-primary'
          : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high focus-visible:ring-primary'
      )}
    >
      {label}
    </button>
  )
}

export function StatusBar({ editor, state }: { editor: Editor; state: EditorState }) {
  const coords = useSyncExternalStore(
    (cb) => editor.subscribe((c) => c === 'overlay' && cb()),
    () => editor.cursorText()
  )
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const t = state.toggles
  return (
    <div className="border-outline-variant bg-surface-container-low font-ui text-on-surface-variant flex shrink-0 items-center gap-1 border-t px-2 py-0.5 text-[11px]">
      <span
        className="text-on-surface w-[220px] shrink-0 truncate tabular-nums"
        data-testid="cad-coordinates"
      >
        {coords}
      </span>
      <Toggle
        label="ORTHO"
        title="Ortho (F8)"
        on={t.ortho}
        onClick={() => editor.setToggles({ ortho: !t.ortho })}
      />
      <Toggle
        label="POLAR"
        title={`Polar tracking every ${t.polarIncrement}° (F10)`}
        on={t.polar}
        onClick={() => editor.setToggles({ polar: !t.polar })}
      />
      <Toggle
        label="OSNAP"
        title="Object snaps (F3)"
        on={t.osnap}
        onClick={() => editor.setToggles({ osnap: !t.osnap })}
      />
      <button
        type="button"
        aria-label="Object snap settings"
        title="Object snap settings"
        className="border-outline-variant text-on-surface-variant hover:bg-surface-container-high focus-visible:ring-primary flex h-[18px] items-center border px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-inset"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ x: r.left, y: r.top - 4 })
        }}
      >
        <ChevronUp size={11} />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="Object snaps"
          onClose={() => setMenu(null)}
          items={[
            ...SNAP_MODES.map((m) => ({
              label: SNAP_LABEL[m],
              checked: t.snapModes.includes(m),
              onSelect: () =>
                editor.setToggles({
                  snapModes: t.snapModes.includes(m)
                    ? t.snapModes.filter((x) => x !== m)
                    : [...t.snapModes, m],
                }),
            })),
            { type: 'separator' as const },
            ...[15, 30, 45, 90].map((deg) => ({
              label: `Polar every ${deg}°`,
              checked: t.polarIncrement === deg,
              onSelect: () => editor.setToggles({ polarIncrement: deg }),
            })),
          ]}
        />
      )}
      <div className="flex-1" />
      {state.selectionCount > 0 && <span className="mr-2">{state.selectionCount} selected</span>}
      <span>Units</span>
      <div className="w-[130px]">
        <Select
          value={state.units.system}
          options={UNIT_OPTIONS}
          onValueChange={(v) => {
            if (typeof v === 'string')
              editor.doc.setUnits({ ...state.units, system: v as UnitSystem })
          }}
          className="py-0 text-[11px]"
          aria-label="Units"
        />
      </div>
    </div>
  )
}
