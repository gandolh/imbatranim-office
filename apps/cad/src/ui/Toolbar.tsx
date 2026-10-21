import type { ComponentType } from 'react'
import {
  ArrowRightToLine,
  Circle,
  Copy,
  Equal,
  Eraser,
  Expand,
  FileDown,
  FileImage,
  FilePlus,
  FlipHorizontal2,
  FolderOpen,
  Hand,
  Layers,
  Loader2,
  Move,
  Radius,
  RectangleHorizontal,
  Redo2,
  RotateCw,
  Save,
  SaveAll,
  Scaling,
  Scan,
  Scissors,
  Slash,
  SquareRoundCorner,
  Type,
  Undo2,
  Waypoints,
} from 'lucide-react'
import { Button, Select } from '@imbatranim/ui'
import type { EditorState } from '../engine/editor'
import type { ExportKind } from '../engine/export/job'

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

/** Command buttons: each starts the same command its name or alias does on the command line. */
const DRAW_TOOLS: { command: string; label: string; icon: Icon }[] = [
  { command: 'LINE', label: 'Line (L)', icon: Slash },
  { command: 'PLINE', label: 'Polyline (PL)', icon: Waypoints },
  { command: 'CIRCLE', label: 'Circle (C)', icon: Circle },
  { command: 'ARC', label: 'Arc (A)', icon: Radius },
  { command: 'RECTANG', label: 'Rectangle (REC)', icon: RectangleHorizontal },
  { command: 'TEXT', label: 'Text (DT)', icon: Type },
]
const MODIFY_TOOLS: { command: string; label: string; icon: Icon }[] = [
  { command: 'MOVE', label: 'Move (M)', icon: Move },
  { command: 'COPY', label: 'Copy (CO)', icon: Copy },
  { command: 'ROTATE', label: 'Rotate (RO)', icon: RotateCw },
  { command: 'SCALE', label: 'Scale (SC)', icon: Scaling },
  { command: 'MIRROR', label: 'Mirror (MI)', icon: FlipHorizontal2 },
  { command: 'OFFSET', label: 'Offset (O)', icon: Equal },
  { command: 'TRIM', label: 'Trim (TR)', icon: Scissors },
  { command: 'EXTEND', label: 'Extend (EX)', icon: ArrowRightToLine },
  { command: 'FILLET', label: 'Fillet (F)', icon: SquareRoundCorner },
  { command: 'ERASE', label: 'Erase (E)', icon: Eraser },
]

type Props = {
  state: EditorState
  name: string
  dirty: boolean
  saving: boolean
  exporting: ExportKind | null
  onRun: (command: string) => void
  onZoomExtents: () => void
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onSaveAs: () => void
  onExport: (kind: ExportKind) => void
  onUndo: () => void
  onRedo: () => void
  onLayer: (name: string) => void
}

function ToolButton({
  label,
  icon: I,
  onClick,
  disabled,
  pressed,
}: {
  label: string
  icon: Icon
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
}) {
  return (
    <Button
      variant={pressed ? 'primary' : 'ghost'}
      size="sm"
      className="h-6 w-6 justify-center p-0"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
      onClick={onClick}
    >
      <I size={13} strokeWidth={2} />
    </Button>
  )
}

const Sep = () => <div className="bg-outline-variant mx-1 h-4 w-px shrink-0" aria-hidden="true" />

export function Toolbar(p: Props) {
  const active = p.state.commandName
  return (
    <div
      className="border-outline-variant bg-surface-container-low flex shrink-0 flex-wrap items-center gap-0.5 border-b px-2 py-1"
      role="toolbar"
      aria-label="CAD tools"
    >
      <ToolButton label="New drawing" icon={FilePlus} onClick={p.onNew} />
      <ToolButton label="Open… (DXF)" icon={FolderOpen} onClick={p.onOpen} />
      <ToolButton
        label="Save (Ctrl+S)"
        icon={p.saving ? Loader2 : Save}
        onClick={p.onSave}
        disabled={p.saving}
      />
      <ToolButton label="Save as…" icon={SaveAll} onClick={p.onSaveAs} disabled={p.saving} />
      <ToolButton
        label="Export as SVG…"
        icon={p.exporting === 'svg' ? Loader2 : FileImage}
        onClick={() => p.onExport('svg')}
        disabled={p.exporting !== null}
      />
      <ToolButton
        label="Export as PDF…"
        icon={p.exporting === 'pdf' ? Loader2 : FileDown}
        onClick={() => p.onExport('pdf')}
        disabled={p.exporting !== null}
      />
      <Sep />
      <ToolButton
        label="Undo (Ctrl+Z)"
        icon={Undo2}
        onClick={p.onUndo}
        disabled={!p.state.canUndo}
      />
      <ToolButton
        label="Redo (Ctrl+Y)"
        icon={Redo2}
        onClick={p.onRedo}
        disabled={!p.state.canRedo}
      />
      <Sep />
      {DRAW_TOOLS.map((t) => (
        <ToolButton
          key={t.command}
          label={t.label}
          icon={t.icon}
          pressed={active === t.command}
          onClick={() => p.onRun(t.command)}
        />
      ))}
      <Sep />
      {MODIFY_TOOLS.map((t) => (
        <ToolButton
          key={t.command}
          label={t.label}
          icon={t.icon}
          pressed={active === t.command}
          onClick={() => p.onRun(t.command)}
        />
      ))}
      <Sep />
      <ToolButton label="Zoom extents (Z E)" icon={Expand} onClick={p.onZoomExtents} />
      <ToolButton
        label="Zoom window (Z W)"
        icon={Scan}
        pressed={active === 'ZOOM'}
        onClick={() => p.onRun('ZOOM')}
      />
      <ToolButton
        label="Pan (P)"
        icon={Hand}
        pressed={active === 'PAN'}
        onClick={() => p.onRun('PAN')}
      />
      <Sep />
      <ToolButton label="Layers (LA)" icon={Layers} onClick={() => p.onRun('LAYER')} />
      <div
        className="w-[150px]"
        data-testid="cad-layer-select"
        title={
          p.state.selectionCount > 0 ? 'Move the selected objects to a layer' : 'Current layer'
        }
      >
        <Select
          value={p.state.selectionLayer ?? p.state.currentLayer}
          placeholder="Varies"
          options={p.state.layers.map((l) => ({ value: l.name, label: l.name }))}
          onValueChange={(v) => {
            if (typeof v === 'string') p.onLayer(v)
          }}
          className="py-0.5 text-[11px]"
          aria-label="Layer"
        />
      </div>
      <div className="flex-1" />
      <span
        className="font-ui text-on-surface-variant max-w-[220px] truncate text-[11px]"
        data-testid="cad-file-name"
      >
        {p.name}
        {p.dirty ? ' •' : ''}
      </span>
    </div>
  )
}
