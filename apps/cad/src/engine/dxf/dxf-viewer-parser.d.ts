// Types for the two modules CAD takes from dxf-viewer (MPL-2.0): its DXF
// parser, a maintained fork of dxf-parser, and the AutoCAD Color Index table.
// The package ships types for its viewer only. Only the fields CAD reads are
// declared; everything else stays `unknown`.

declare module 'dxf-viewer/src/parser/DxfParser.js' {
  export type ParsedPoint = { x: number; y: number; z?: number; bulge?: number }

  export type ParsedEntity = {
    type: string
    handle?: string | number
    layer?: string
    colorIndex?: number
    color?: number
    lineType?: string
    lineTypeScale?: number
    lineweight?: number
    inPaperSpace?: boolean
    [field: string]: unknown
  }

  export type ParsedBlock = {
    name: string
    handle?: string
    position?: ParsedPoint
    type?: number
    entities?: ParsedEntity[]
  }

  export type ParsedLayer = {
    name: string
    colorIndex?: number
    color?: number
    visible?: boolean
    frozen?: boolean
  }
  export type ParsedLineType = {
    name: string
    description?: string
    pattern?: number[]
    patternLength?: number
  }

  export type ParsedDxf = {
    header: Record<string, unknown>
    tables: {
      layer?: { layers: Record<string, ParsedLayer> }
      lineType?: { lineTypes: Record<string, ParsedLineType> }
      style?: { styles: Record<string, unknown> }
    }
    blocks: Record<string, ParsedBlock>
    entities: ParsedEntity[]
  }

  export default class DxfParser {
    parseSync(text: string): ParsedDxf
  }
}

declare module 'dxf-viewer/src/parser/AutoCadColorIndex.js' {
  /** Index 1–255 → 0xRRGGBB. */
  const table: readonly number[]
  export default table
}
