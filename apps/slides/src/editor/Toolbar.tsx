import type { ReactNode } from 'react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Baseline,
  Bold,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  Image as ImageIcon,
  ImageDown,
  Info,
  Italic,
  Loader2,
  Maximize2,
  Minus,
  NotebookText,
  PaintBucket,
  PanelLeft,
  Plus,
  Redo2,
  Save,
  Shapes,
  SquareDashed,
  Trash2,
  Type,
  Underline,
  Undo2,
} from 'lucide-react'
import { Button, Tooltip } from '@imbatranim/ui'

/** Every control a toolbar button can open a menu from: its bottom-left corner. */
export type MenuAnchor = { x: number; y: number }

export type ToolbarState = {
  name: string
  dirty: boolean
  saving: boolean
  exporting: boolean
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  slideCount: number
  current: number
  zoomLabel: string
  showRail: boolean
  showNotes: boolean
  /** Shapes are selected (or text is being edited): formatting applies. */
  hasSelection: boolean
  hasText: boolean
  bold: boolean
  italic: boolean
  underline: boolean
  sizeLabel: string
  canDownload: boolean
}

export type ToolbarActions = {
  newDeck: () => void
  open: () => void
  save: () => void
  saveAs: () => void
  undo: () => void
  redo: () => void
  toggleRail: () => void
  prev: () => void
  next: () => void
  zoomOut: () => void
  zoomIn: () => void
  toggleFit: () => void
  toggleNotes: () => void
  present: () => void
  exportPng: () => void
  download: () => void
  newSlideMenu: (at: MenuAnchor) => void
  duplicateSlide: () => void
  deleteSlide: () => void
  insertTextBox: () => void
  insertPicture: () => void
  shapeMenu: (at: MenuAnchor) => void
  toggle: (what: 'bold' | 'italic' | 'underline') => void
  sizeMenu: (at: MenuAnchor) => void
  sizeStep: (direction: 1 | -1) => void
  colorMenu: (at: MenuAnchor) => void
  align: (a: 'l' | 'ctr' | 'r' | 'just') => void
  fillMenu: (at: MenuAnchor) => void
  outlineMenu: (at: MenuAnchor) => void
  arrangeMenu: (at: MenuAnchor) => void
  deleteShapes: () => void
}

const anchorOf = (e: React.MouseEvent): MenuAnchor => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: r.left, y: r.bottom }
}

/** Formatting buttons keep the text editor's selection: no focus on press. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault()

function Icon({
  label,
  shortcut,
  onClick,
  disabled,
  pressed,
  children,
  menu,
  keep,
}: {
  label: string
  shortcut?: string
  onClick: (e: React.MouseEvent) => void
  disabled?: boolean
  pressed?: boolean
  children: ReactNode
  menu?: boolean
  keep?: boolean
}) {
  return (
    <Tooltip content={shortcut ? `${label} (${shortcut})` : label}>
      <Button
        variant={pressed ? 'primary' : 'ghost'}
        size="sm"
        className={menu ? 'h-6 gap-0.5 px-1' : 'h-6 w-6 justify-center p-0'}
        aria-label={label}
        aria-pressed={pressed}
        aria-haspopup={menu ? 'menu' : undefined}
        disabled={disabled}
        onMouseDown={keep ? keepFocus : undefined}
        onClick={onClick}
      >
        {children}
        {menu && <span className="text-[8px] leading-none">▾</span>}
      </Button>
    </Tooltip>
  )
}

const Sep = () => <div className="border-outline-variant mx-1 h-4 border-l" />

export function Toolbar({ state, actions }: { state: ToolbarState; actions: ToolbarActions }) {
  const s = state
  const a = actions
  const canNavigate = s.slideCount > 1
  return (
    <div className="shrink-0">
      <div className="border-outline-variant bg-surface-container-low flex flex-wrap items-center gap-1 border-b px-2 py-1">
        <Icon label="New presentation" onClick={a.newDeck}>
          <FilePlus2 size={12} />
        </Icon>
        <Icon label="Open" shortcut="Ctrl+O" onClick={a.open}>
          <FolderOpen size={12} />
        </Icon>
        <Tooltip content="Save (Ctrl+S)">
          <Button
            variant="default"
            size="sm"
            className="flex h-6 items-center gap-1"
            onClick={a.save}
            disabled={s.saving || !s.dirty}
          >
            {s.saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </Button>
        </Tooltip>
        <Tooltip content="Save a copy under another name">
          <Button variant="ghost" size="sm" className="h-6" onClick={a.saveAs} disabled={s.saving}>
            Save as…
          </Button>
        </Tooltip>
        <Sep />
        <Icon
          label={s.undoLabel ? `Undo ${s.undoLabel.toLowerCase()}` : 'Undo'}
          shortcut="Ctrl+Z"
          onClick={a.undo}
          disabled={!s.canUndo}
        >
          <Undo2 size={12} />
        </Icon>
        <Icon
          label={s.redoLabel ? `Redo ${s.redoLabel.toLowerCase()}` : 'Redo'}
          shortcut="Ctrl+Y"
          onClick={a.redo}
          disabled={!s.canRedo}
        >
          <Redo2 size={12} />
        </Icon>
        <Sep />
        <Icon label="Slide thumbnails" onClick={a.toggleRail} pressed={s.showRail}>
          <PanelLeft size={12} />
        </Icon>
        <Icon
          label="Previous slide"
          shortcut="Page Up"
          onClick={a.prev}
          disabled={!canNavigate || s.current === 0}
        >
          <ChevronLeft size={13} />
        </Icon>
        <span className="font-ui text-on-surface-variant min-w-[52px] text-center text-[11px] tabular-nums">
          {s.slideCount === 0 ? '—' : `${s.current + 1} / ${s.slideCount}`}
        </span>
        <Icon
          label="Next slide"
          shortcut="Page Down"
          onClick={a.next}
          disabled={!canNavigate || s.current >= s.slideCount - 1}
        >
          <ChevronRight size={13} />
        </Icon>
        <Sep />
        <Icon label="Zoom out" onClick={a.zoomOut}>
          <Minus size={12} />
        </Icon>
        <button
          type="button"
          onClick={a.toggleFit}
          className="font-ui text-on-surface-variant hover:text-on-surface min-w-[62px] text-center text-[11px] tabular-nums"
          title="Switch between fit width and fit page"
        >
          {s.zoomLabel}
        </button>
        <Icon label="Zoom in" onClick={a.zoomIn}>
          <Plus size={12} />
        </Icon>
        <Sep />
        <Icon label="Speaker notes" onClick={a.toggleNotes} pressed={s.showNotes}>
          <NotebookText size={12} />
        </Icon>
        <Icon
          label="Present (Escape to exit)"
          shortcut="F5"
          onClick={a.present}
          disabled={s.slideCount === 0}
        >
          <Maximize2 size={12} />
        </Icon>
        <Icon
          label="Export this slide as a PNG"
          onClick={a.exportPng}
          disabled={s.slideCount === 0 || s.exporting}
        >
          {s.exporting ? <Loader2 size={12} className="animate-spin" /> : <ImageDown size={12} />}
        </Icon>
        <div className="min-w-2 flex-1" />
        <Tooltip content="Drawn by this app — layout may differ from PowerPoint">
          <Info size={12} className="text-on-surface-variant shrink-0" />
        </Tooltip>
        <span className="font-ui text-on-surface-variant max-w-[160px] min-w-0 truncate text-[11px]">
          {s.name}
          {s.dirty ? ' •' : ''}
        </span>
        <Tooltip content="Download original (the file as last saved)">
          <Button
            variant="default"
            size="sm"
            className="flex h-6 items-center gap-1"
            onClick={a.download}
            disabled={!s.canDownload}
          >
            <Download size={12} />
            Download
          </Button>
        </Tooltip>
      </div>

      <div className="border-outline-variant bg-surface-container-low flex flex-wrap items-center gap-1 border-b px-2 py-1">
        <Icon label="New slide" shortcut="Ctrl+M" menu onClick={(e) => a.newSlideMenu(anchorOf(e))}>
          <Plus size={12} />
        </Icon>
        <Icon label="Duplicate slide" onClick={a.duplicateSlide} disabled={s.slideCount === 0}>
          <Copy size={12} />
        </Icon>
        <Icon label="Delete slide" onClick={a.deleteSlide} disabled={s.slideCount === 0}>
          <Trash2 size={12} />
        </Icon>
        <Sep />
        <Icon label="Text box" onClick={a.insertTextBox} disabled={s.slideCount === 0}>
          <Type size={12} />
        </Icon>
        <Icon label="Picture" onClick={a.insertPicture} disabled={s.slideCount === 0}>
          <ImageIcon size={12} />
        </Icon>
        <Icon
          label="Shape"
          menu
          onClick={(e) => a.shapeMenu(anchorOf(e))}
          disabled={s.slideCount === 0}
        >
          <Shapes size={12} />
        </Icon>
        <Sep />
        <Icon
          label="Bold"
          shortcut="Ctrl+B"
          keep
          pressed={s.bold}
          disabled={!s.hasText}
          onClick={() => a.toggle('bold')}
        >
          <Bold size={12} />
        </Icon>
        <Icon
          label="Italic"
          shortcut="Ctrl+I"
          keep
          pressed={s.italic}
          disabled={!s.hasText}
          onClick={() => a.toggle('italic')}
        >
          <Italic size={12} />
        </Icon>
        <Icon
          label="Underline"
          shortcut="Ctrl+U"
          keep
          pressed={s.underline}
          disabled={!s.hasText}
          onClick={() => a.toggle('underline')}
        >
          <Underline size={12} />
        </Icon>
        <Tooltip content="Font size">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 min-w-[40px] justify-between gap-0.5 px-1 tabular-nums"
            aria-label="Font size"
            aria-haspopup="menu"
            disabled={!s.hasText}
            onMouseDown={keepFocus}
            onClick={(e) => a.sizeMenu(anchorOf(e))}
          >
            {s.sizeLabel}
            <span className="text-[8px] leading-none">▾</span>
          </Button>
        </Tooltip>
        <Icon
          label="Increase font size"
          shortcut="Ctrl+]"
          keep
          disabled={!s.hasText}
          onClick={() => a.sizeStep(1)}
        >
          <span className="font-ui text-[11px] leading-none font-semibold">A+</span>
        </Icon>
        <Icon
          label="Decrease font size"
          shortcut="Ctrl+["
          keep
          disabled={!s.hasText}
          onClick={() => a.sizeStep(-1)}
        >
          <span className="font-ui text-[10px] leading-none font-semibold">A-</span>
        </Icon>
        <Icon
          label="Font colour"
          menu
          keep
          disabled={!s.hasText}
          onClick={(e) => a.colorMenu(anchorOf(e))}
        >
          <Baseline size={12} />
        </Icon>
        <Sep />
        <Icon
          label="Align left"
          shortcut="Ctrl+L"
          keep
          disabled={!s.hasText}
          onClick={() => a.align('l')}
        >
          <AlignLeft size={12} />
        </Icon>
        <Icon
          label="Centre"
          shortcut="Ctrl+E"
          keep
          disabled={!s.hasText}
          onClick={() => a.align('ctr')}
        >
          <AlignCenter size={12} />
        </Icon>
        <Icon
          label="Align right"
          shortcut="Ctrl+R"
          keep
          disabled={!s.hasText}
          onClick={() => a.align('r')}
        >
          <AlignRight size={12} />
        </Icon>
        <Icon
          label="Justify"
          shortcut="Ctrl+J"
          keep
          disabled={!s.hasText}
          onClick={() => a.align('just')}
        >
          <AlignJustify size={12} />
        </Icon>
        <Sep />
        <Icon
          label="Shape fill"
          menu
          disabled={!s.hasSelection}
          onClick={(e) => a.fillMenu(anchorOf(e))}
        >
          <PaintBucket size={12} />
        </Icon>
        <Icon
          label="Shape outline"
          menu
          disabled={!s.hasSelection}
          onClick={(e) => a.outlineMenu(anchorOf(e))}
        >
          <SquareDashed size={12} />
        </Icon>
        <Icon
          label="Arrange"
          menu
          disabled={!s.hasSelection}
          onClick={(e) => a.arrangeMenu(anchorOf(e))}
        >
          <span className="flex">
            <ArrowUpToLine size={12} />
            <ArrowDownToLine size={12} className="-ml-1" />
          </span>
        </Icon>
        <Icon label="Delete" shortcut="Delete" disabled={!s.hasSelection} onClick={a.deleteShapes}>
          <Trash2 size={12} className="text-error" />
        </Icon>
      </div>
    </div>
  )
}
