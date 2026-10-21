import type { KitAppProps } from '@imbatranim-office/shared'
import { CadApp } from './ui/CadApp'

/**
 * CAD (brief 03): a 2D drafting app in the AutoCAD mould. A command line
 * that takes typed coordinates and the toolbar start the same commands;
 * drawings are DXF files opened and saved through the desktop.
 */
export function App(_props: KitAppProps) {
  return <CadApp />
}
