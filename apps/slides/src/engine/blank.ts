/**
 * New presentation: a blank 16:9 deck written from scratch (this file is the
 * template, authored here). One master with six layouts (Title Slide, Title
 * and Content, Section Header, Two Content, Title Only, Blank), a theme with
 * Office's standard colour values and Calibri, a notes master so notes can be
 * added, and one Title Slide.
 */
import { NS } from './ns.ts'
import { writeZip } from './zip.ts'

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
const P_NS = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`
const CX = 12192000
const CY = 6858000

const T = 'application/vnd.openxmlformats-officedocument'

const ph = (
  id: number,
  name: string,
  type: string | null,
  idx: number | null,
  box: [number, number, number, number] | null,
  extra = '',
  text = ''
) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
  `<p:nvPr><p:ph${type ? ` type="${type}"` : ''}${idx !== null ? ` idx="${idx}"` : ''}${extra}/></p:nvPr></p:nvSpPr>` +
  `<p:spPr>${box ? `<a:xfrm><a:off x="${box[0]}" y="${box[1]}"/><a:ext cx="${box[2]}" cy="${box[3]}"/></a:xfrm>` : ''}</p:spPr>` +
  `<p:txBody><a:bodyPr/><a:lstStyle/>${text || '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</p:txBody></p:sp>`

const para = (t: string, lvl = 0) =>
  `<a:p>${lvl ? `<a:pPr lvl="${lvl}"/>` : ''}<a:r><a:rPr lang="en-US"/><a:t>${t}</a:t></a:r></a:p>`

const tree = (shapes: string) =>
  `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
  `${shapes}</p:spTree></p:cSld>`

const namedTree = (name: string, shapes: string) =>
  tree(shapes).replace('<p:cSld>', `<p:cSld name="${name}">`)

const footers = (first: number) =>
  ph(first, 'Date Placeholder', 'dt', 10, null, ' sz="half"') +
  ph(first + 1, 'Footer Placeholder', 'ftr', 11, null, ' sz="quarter"') +
  ph(
    first + 2,
    'Slide Number Placeholder',
    'sldNum',
    12,
    null,
    ' sz="quarter"',
    '<a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p>'
  )

const MASTER_TEXT = para('Click to edit Master title style')
const BODY_TEXT =
  para('Click to edit Master text styles') +
  para('Second level', 1) +
  para('Third level', 2) +
  para('Fourth level', 3) +
  para('Fifth level', 4)

function level(n: number, size: number, marL: number, bullet: boolean, before = 1000) {
  return (
    `<a:lvl${n}pPr marL="${marL}" indent="${bullet ? -228600 : 0}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">` +
    `<a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="${before}"/></a:spcBef>` +
    (bullet
      ? '<a:buFont typeface="Arial" panose="020B0604020202020204"/><a:buChar char="&#8226;"/>'
      : '<a:buNone/>') +
    `<a:defRPr sz="${size}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${n}pPr>`
  )
}

function plainLevels(size = 1800) {
  let s = '<a:defPPr><a:defRPr lang="en-US"/></a:defPPr>'
  for (let n = 1; n <= 9; n++) {
    s +=
      `<a:lvl${n}pPr marL="${(n - 1) * 457200}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">` +
      `<a:defRPr sz="${size}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${n}pPr>`
  }
  return s
}

const MASTER =
  `${DECL}<p:sldMaster ${P_NS}>` +
  `<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>` +
  tree(
    ph(
      2,
      'Title Placeholder 1',
      'title',
      null,
      [838200, 365125, 10515600, 1325563],
      '',
      MASTER_TEXT
    ) +
      ph(3, 'Text Placeholder 2', 'body', 1, [838200, 1825625, 10515600, 4351338], '', BODY_TEXT) +
      ph(4, 'Date Placeholder 3', 'dt', 2, [838200, 6356350, 2743200, 365125], ' sz="half"') +
      ph(
        5,
        'Footer Placeholder 4',
        'ftr',
        3,
        [4038600, 6356350, 4114800, 365125],
        ' sz="quarter"'
      ) +
      ph(
        6,
        'Slide Number Placeholder 5',
        'sldNum',
        4,
        [8610600, 6356350, 2743200, 365125],
        ' sz="quarter"',
        '<a:p><a:pPr algn="r"/><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p>'
      )
  ).replace(/^<p:cSld>/, '') +
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
  `<p:sldLayoutIdLst>${[1, 2, 3, 4, 5, 6].map((n) => `<p:sldLayoutId id="${2147483648 + n}" r:id="rId${n}"/>`).join('')}</p:sldLayoutIdLst>` +
  `<p:txStyles><p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/>` +
  `<a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>` +
  `<p:bodyStyle>${level(1, 2800, 228600, true)}${level(2, 2400, 685800, true, 500)}${level(3, 2000, 1143000, true, 500)}${level(4, 1800, 1600200, true, 500)}${level(5, 1800, 2057400, true, 500)}</p:bodyStyle>` +
  `<p:otherStyle>${plainLevels()}</p:otherStyle></p:txStyles></p:sldMaster>`

type LayoutDef = { name: string; type: string; shapes: string }

const LAYOUTS: LayoutDef[] = [
  {
    name: 'Title Slide',
    type: 'title',
    shapes:
      ph(
        2,
        'Title 1',
        'ctrTitle',
        null,
        [1524000, 1122363, 9144000, 2387600],
        '',
        MASTER_TEXT
      ).replace(
        '<a:bodyPr/><a:lstStyle/>',
        '<a:bodyPr anchor="b"/><a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="6000"/></a:lvl1pPr></a:lstStyle>'
      ) +
      ph(
        3,
        'Subtitle 2',
        'subTitle',
        1,
        [1524000, 3602038, 9144000, 1655762],
        '',
        para('Click to edit Master subtitle style')
      ).replace(
        '<a:bodyPr/><a:lstStyle/>',
        '<a:bodyPr/><a:lstStyle><a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="2400"/></a:lvl1pPr></a:lstStyle>'
      ) +
      footers(4),
  },
  {
    name: 'Title and Content',
    type: 'obj',
    shapes:
      ph(2, 'Title 1', 'title', null, null, '', MASTER_TEXT) +
      ph(3, 'Content Placeholder 2', null, 1, null, '', BODY_TEXT) +
      footers(4),
  },
  {
    name: 'Section Header',
    type: 'secHead',
    shapes:
      ph(
        2,
        'Title 1',
        'title',
        null,
        [831850, 1709738, 10515600, 2852737],
        '',
        MASTER_TEXT
      ).replace(
        '<a:bodyPr/><a:lstStyle/>',
        '<a:bodyPr anchor="b"/><a:lstStyle><a:lvl1pPr><a:defRPr sz="6000"/></a:lvl1pPr></a:lstStyle>'
      ) +
      ph(
        3,
        'Text Placeholder 2',
        'body',
        1,
        [831850, 4589463, 10515600, 1500187],
        '',
        para('Click to edit Master text styles')
      ).replace(
        '<a:bodyPr/><a:lstStyle/>',
        '<a:bodyPr/><a:lstStyle><a:lvl1pPr marL="0" indent="0"><a:buNone/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle>'
      ) +
      footers(4),
  },
  {
    name: 'Two Content',
    type: 'twoObj',
    shapes:
      ph(2, 'Title 1', 'title', null, null, '', MASTER_TEXT) +
      ph(
        3,
        'Content Placeholder 2',
        null,
        1,
        [838200, 1825625, 5181600, 4351338],
        ' sz="half"',
        BODY_TEXT
      ) +
      ph(
        4,
        'Content Placeholder 3',
        null,
        2,
        [6172200, 1825625, 5181600, 4351338],
        ' sz="half"',
        BODY_TEXT
      ) +
      footers(5),
  },
  {
    name: 'Title Only',
    type: 'titleOnly',
    shapes: ph(2, 'Title 1', 'title', null, null, '', MASTER_TEXT) + footers(3),
  },
  { name: 'Blank', type: 'blank', shapes: footers(2) },
]

const layoutXml = (l: LayoutDef) =>
  `${DECL}<p:sldLayout ${P_NS} type="${l.type}" preserve="1">${namedTree(l.name, l.shapes)}` +
  `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`

const THEME = (name: string) =>
  `${DECL}<a:theme xmlns:a="${NS.a}" name="${name}"><a:themeElements>` +
  `<a:clrScheme name="Standard"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>` +
  `<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>` +
  `<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>` +
  `<a:fontScheme name="Standard"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
  `<a:fmtScheme name="Standard"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs>` +
  `<a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs>` +
  `<a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>` +
  `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs>` +
  `<a:gs pos="50000"><a:schemeClr val="phClr"><a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/></a:schemeClr></a:gs>` +
  `<a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst>` +
  `<a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>` +
  `<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>` +
  `<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst>` +
  `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>` +
  `<a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst>` +
  `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill>` +
  `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/></a:schemeClr></a:gs>` +
  `<a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="98000"/><a:satMod val="130000"/><a:shade val="90000"/><a:lumMod val="103000"/></a:schemeClr></a:gs>` +
  `<a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/><a:satMod val="120000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:bgFillStyleLst>` +
  `</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`

const NOTES_MASTER =
  `${DECL}<p:notesMaster ${P_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>` +
  tree(
    ph(2, 'Slide Image Placeholder 1', 'sldImg', 2, [685800, 1143000, 5486400, 3086100], '')
      .replace(/<p:txBody>.*<\/p:txBody>/, '')
      .replace('<a:spLocks noGrp="1"/>', '<a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/>') +
      ph(
        3,
        'Notes Placeholder 2',
        'body',
        3,
        [685800, 4400550, 5486400, 3600450],
        ' sz="quarter"',
        BODY_TEXT
      )
  ).replace(/^<p:cSld>/, '') +
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
  `<p:notesStyle>${plainLevels(1200)}</p:notesStyle></p:notesMaster>`

const SLIDE =
  `${DECL}<p:sld ${P_NS}>` +
  tree(ph(2, 'Title 1', 'ctrTitle', null, null) + ph(3, 'Subtitle 2', 'subTitle', 1, null)) +
  `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`

/** A notes master and a theme for it, for a deck that never had notes. */
export const NOTES_MASTER_XML = NOTES_MASTER
export const themeXml = THEME

const rels = (items: [string, string, string][]) =>
  `${DECL}<Relationships xmlns="${NS.rels}">` +
  items
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join('') +
  `</Relationships>`

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** The bytes of a new, blank presentation. */
export function blankPresentation(now = new Date()): Uint8Array {
  const iso = `${now.toISOString().slice(0, 19)}Z`
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      `${DECL}<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>` +
        `<Override PartName="/ppt/presentation.xml" ContentType="${T}.presentationml.presentation.main+xml"/>` +
        `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${T}.presentationml.slideMaster+xml"/>` +
        LAYOUTS.map(
          (_, i) =>
            `<Override PartName="/ppt/slideLayouts/slideLayout${i + 1}.xml" ContentType="${T}.presentationml.slideLayout+xml"/>`
        ).join('') +
        `<Override PartName="/ppt/slides/slide1.xml" ContentType="${T}.presentationml.slide+xml"/>` +
        `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="${T}.presentationml.notesMaster+xml"/>` +
        `<Override PartName="/ppt/theme/theme1.xml" ContentType="${T}.theme+xml"/>` +
        `<Override PartName="/ppt/theme/theme2.xml" ContentType="${T}.theme+xml"/>` +
        `<Override PartName="/ppt/presProps.xml" ContentType="${T}.presentationml.presProps+xml"/>` +
        `<Override PartName="/ppt/viewProps.xml" ContentType="${T}.presentationml.viewProps+xml"/>` +
        `<Override PartName="/ppt/tableStyles.xml" ContentType="${T}.presentationml.tableStyles+xml"/>` +
        `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
        `<Override PartName="/docProps/app.xml" ContentType="${T}.extended-properties+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      rels([
        ['rId1', `${R}/officeDocument`, 'ppt/presentation.xml'],
        [
          'rId2',
          'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
          'docProps/core.xml',
        ],
        ['rId3', `${R}/extended-properties`, 'docProps/app.xml'],
      ]),
    ],
    [
      'docProps/app.xml',
      `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
        `<Application>imbatranim Slides</Application><Slides>1</Slides><Notes>0</Notes><PresentationFormat>Widescreen</PresentationFormat></Properties>`,
    ],
    [
      'docProps/core.xml',
      `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
        `xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:title>Presentation</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>` +
        `<dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`,
    ],
    [
      'ppt/presentation.xml',
      `${DECL}<p:presentation ${P_NS} saveSubsetFonts="1">` +
        `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
        `<p:notesMasterIdLst><p:notesMasterId r:id="rId3"/></p:notesMasterIdLst>` +
        `<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>` +
        `<p:sldSz cx="${CX}" cy="${CY}"/><p:notesSz cx="6858000" cy="9144000"/>` +
        `<p:defaultTextStyle>${plainLevels()}</p:defaultTextStyle></p:presentation>`,
    ],
    [
      'ppt/_rels/presentation.xml.rels',
      rels([
        ['rId1', `${R}/slideMaster`, 'slideMasters/slideMaster1.xml'],
        ['rId2', `${R}/slide`, 'slides/slide1.xml'],
        ['rId3', `${R}/notesMaster`, 'notesMasters/notesMaster1.xml'],
        ['rId4', `${R}/theme`, 'theme/theme1.xml'],
        ['rId5', `${R}/presProps`, 'presProps.xml'],
        ['rId6', `${R}/viewProps`, 'viewProps.xml'],
        ['rId7', `${R}/tableStyles`, 'tableStyles.xml'],
      ]),
    ],
    ['ppt/presProps.xml', `${DECL}<p:presentationPr ${P_NS}/>`],
    [
      'ppt/viewProps.xml',
      `${DECL}<p:viewPr ${P_NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`,
    ],
    [
      'ppt/tableStyles.xml',
      `${DECL}<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
    ],
    ['ppt/slideMasters/slideMaster1.xml', MASTER],
    [
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      rels([
        ...LAYOUTS.map(
          (_, i) =>
            [`rId${i + 1}`, `${R}/slideLayout`, `../slideLayouts/slideLayout${i + 1}.xml`] as [
              string,
              string,
              string,
            ]
        ),
        [`rId${LAYOUTS.length + 1}`, `${R}/theme`, '../theme/theme1.xml'],
      ]),
    ],
    ...LAYOUTS.flatMap(
      (l, i) =>
        [
          [`ppt/slideLayouts/slideLayout${i + 1}.xml`, layoutXml(l)],
          [
            `ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`,
            rels([['rId1', `${R}/slideMaster`, '../slideMasters/slideMaster1.xml']]),
          ],
        ] as [string, string][]
    ),
    ['ppt/slides/slide1.xml', SLIDE],
    [
      'ppt/slides/_rels/slide1.xml.rels',
      rels([['rId1', `${R}/slideLayout`, '../slideLayouts/slideLayout1.xml']]),
    ],
    ['ppt/notesMasters/notesMaster1.xml', NOTES_MASTER],
    [
      'ppt/notesMasters/_rels/notesMaster1.xml.rels',
      rels([['rId1', `${R}/theme`, '../theme/theme2.xml']]),
    ],
    ['ppt/theme/theme1.xml', THEME('Slides Default')],
    ['ppt/theme/theme2.xml', THEME('Slides Default Notes')],
  ]
  const enc = new TextEncoder()
  return writeZip(files.map(([name, text]) => [name, enc.encode(text)] as [string, Uint8Array]))
}
