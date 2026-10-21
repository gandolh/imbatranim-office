/**
 * The left panel: Thumbnails + Outline tabs over a shared header. Rebuilt in the
 * OS design language.
 *
 * 224 px wide, not `w-56`: the desktop's root font is 13 px, which made norPDF's
 * panel 182 px and pushed its third tab (Forms) under the page.
 *
 * The frame (this module: its width and the tab row) is on screen from the
 * first frame, so the page's fitted width does not change when the panel
 * fills in. The panels are lazy chunks, mounted once the first page is drawn
 * (`painted`): the thumbnail rail painting its canvases before the page is what
 * made norPDF's first page slower than PDF Viewer's (OS brief 65).
 *
 * ── PART B SEAM ────────────────────────────────────────────────────────────
 * `extraTabs` appends tabs to the rail — Part B passes its **Forms** panel here
 * as `{ id: 'forms', label: 'Forms', icon: <lucide component>, render: () =>
 * <FormsPanel/> }`. The active tab id is the controller's `panelTab`, so Part B
 * can switch to its tab programmatically via `setPanelTab('forms')`.
 */
import { Suspense } from 'react'
import type { ComponentType, JSX, ReactNode } from 'react'
import { LayoutGrid, List } from 'lucide-react'
import { useReader } from '../app/context'
import type { PanelTab } from '../app/types'
import { OutlinePanel, ThumbnailsPanel } from '../lazy'

export interface SidePanelTab {
  id: PanelTab
  label: string
  icon: ComponentType<{ size?: number }>
  render: () => ReactNode
}

export interface SidePanelProps {
  /** PART B appends tabs (e.g. Forms) here. */
  extraTabs?: SidePanelTab[]
}

export function SidePanel({ extraTabs = [] }: SidePanelProps): JSX.Element {
  const { panelTab, setPanelTab, painted } = useReader()

  const tabs: SidePanelTab[] = [
    {
      id: 'thumbnails',
      label: 'Thumbnails',
      icon: LayoutGrid,
      render: () => <ThumbnailsPanel />,
    },
    {
      id: 'outline',
      label: 'Outline',
      icon: List,
      render: () => <OutlinePanel />,
    },
    ...extraTabs,
  ]

  const active = tabs.find((t) => t.id === panelTab) ?? tabs[0]

  return (
    <aside
      className="border-outline-variant bg-surface-container-low flex w-[224px] shrink-0 flex-col border-r"
      aria-label="Document navigation"
    >
      <div className="border-outline-variant flex border-b" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.id === active?.id
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={
                'font-ui flex min-w-0 flex-1 items-center justify-center gap-1 px-1 py-2 text-[11px] ' +
                (isActive
                  ? 'text-on-surface border-primary border-b-2'
                  : 'text-on-surface-variant hover:bg-surface-container-high border-b-2 border-transparent')
              }
              onClick={() => setPanelTab(tab.id)}
            >
              <Icon size={14} />
              <span className="truncate">{tab.label}</span>
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-auto" role="tabpanel" data-panel-scroll>
        {painted && <Suspense fallback={null}>{active?.render()}</Suspense>}
      </div>
    </aside>
  )
}
