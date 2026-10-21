/** The namespaces and relationship types the editor reads and writes. */

export const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rels: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  p14: 'http://schemas.microsoft.com/office/powerpoint/2010/main',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  dgm: 'http://schemas.openxmlformats.org/drawingml/2006/diagram',
  dsp: 'http://schemas.microsoft.com/office/drawing/2008/diagram',
  a14: 'http://schemas.microsoft.com/office/drawing/2010/main',
} as const

const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export const REL = {
  officeDocument: `${OFFICE}/officeDocument`,
  slide: `${OFFICE}/slide`,
  slideLayout: `${OFFICE}/slideLayout`,
  slideMaster: `${OFFICE}/slideMaster`,
  notesSlide: `${OFFICE}/notesSlide`,
  notesMaster: `${OFFICE}/notesMaster`,
  handoutMaster: `${OFFICE}/handoutMaster`,
  theme: `${OFFICE}/theme`,
  image: `${OFFICE}/image`,
  hyperlink: `${OFFICE}/hyperlink`,
  chart: `${OFFICE}/chart`,
  comments: `${OFFICE}/comments`,
  tags: `${OFFICE}/tags`,
  diagramData: `${OFFICE}/diagramData`,
  diagramLayout: `${OFFICE}/diagramLayout`,
  diagramQuickStyle: `${OFFICE}/diagramQuickStyle`,
  diagramColors: `${OFFICE}/diagramColors`,
  diagramDrawing: 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',
  extendedProperties: `${OFFICE}/extended-properties`,
} as const

export const CONTENT_TYPE = {
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  notesSlide: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  notesMaster: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  relationships: 'application/vnd.openxmlformats-package.relationships+xml',
  xml: 'application/xml',
} as const

/** Image types the editor inserts, by extension. */
export const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
}

/** The prefixes a slide's root usually binds; new fragments are written with them. */
export const SLIDE_BINDINGS = { a: NS.a, r: NS.r, p: NS.p }
