import type { ContextMenuItem } from '@imbatranim/ui'
import { Swatches } from './Swatches'

/** PowerPoint's standard colour row. */
export const STANDARD_COLORS = [
  'C00000',
  'FF0000',
  'FFC000',
  'FFFF00',
  '92D050',
  '00B050',
  '00B0F0',
  '0070C0',
  '002060',
  '7030A0',
]

const THEME_ORDER: [string, string][] = [
  ['lt1', 'Background 1'],
  ['dk1', 'Text 1'],
  ['lt2', 'Background 2'],
  ['dk2', 'Text 2'],
  ['accent1', 'Accent 1'],
  ['accent2', 'Accent 2'],
  ['accent3', 'Accent 3'],
  ['accent4', 'Accent 4'],
  ['accent5', 'Accent 5'],
  ['accent6', 'Accent 6'],
]

/**
 * Colour menu rows: the deck's theme colours, the standard row, and
 * optionally "No fill". `close` dismisses the menu (swatch rows are custom
 * rows, which do not close it themselves).
 */
export function colorMenu(
  scheme: Record<string, string>,
  pick: (hex: string | null) => void,
  close: () => void,
  noneLabel: string | null
): ContextMenuItem[] {
  const theme = THEME_ORDER.filter(([k]) => scheme[k]).map(([k, label]) => ({
    hex: scheme[k],
    label,
  }))
  const choose = (hex: string | null) => {
    pick(hex)
    close()
  }
  const items: ContextMenuItem[] = [
    {
      type: 'custom',
      key: 'theme-label',
      children: (
        <div className="font-ui text-on-surface-variant px-3 pt-1 text-[10px] font-semibold tracking-wider uppercase">
          Theme colours
        </div>
      ),
    },
    { type: 'custom', key: 'theme', children: <Swatches colors={theme} onPick={choose} /> },
    {
      type: 'custom',
      key: 'std-label',
      children: (
        <div className="font-ui text-on-surface-variant px-3 pt-1 text-[10px] font-semibold tracking-wider uppercase">
          Standard colours
        </div>
      ),
    },
    {
      type: 'custom',
      key: 'std',
      children: (
        <Swatches
          colors={STANDARD_COLORS.map((hex) => ({ hex, label: `#${hex}` }))}
          onPick={choose}
        />
      ),
    },
  ]
  if (noneLabel) {
    items.push({ type: 'separator' }, { label: noneLabel, onSelect: () => choose(null) })
  }
  return items
}
