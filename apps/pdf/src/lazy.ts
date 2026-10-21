/**
 * Everything the first page does not need, as separate chunks (brief 06). Each
 * is a dynamic import, so the build splits it out of app.mjs, and each mounts
 * only once a page is on screen or its control is first used:
 *
 *  • the rail's Thumbnails and Outline panels, and the Forms panel;
 *  • the annotate toolbar, the per-page annotation overlay and the signature
 *    pad;
 *  • the organise view.
 *
 * They import the engine (`@pdfcore/engine`) freely: it is loaded by then.
 */
import { lazy } from 'react'

export const ThumbnailsPanel = lazy(() =>
  import('./panels/ThumbnailsPanel').then((m) => ({ default: m.ThumbnailsPanel }))
)
export const OutlinePanel = lazy(() =>
  import('./panels/OutlinePanel').then((m) => ({ default: m.OutlinePanel }))
)
export const FormsPanel = lazy(() =>
  import('./forms/FormsPanel').then((m) => ({ default: m.FormsPanel }))
)
export const AnnotateToolbar = lazy(() =>
  import('./editor/AnnotateToolbar').then((m) => ({ default: m.AnnotateToolbar }))
)
export const PageAnnotateLayer = lazy(() =>
  import('./editor/PageAnnotateLayer').then((m) => ({ default: m.PageAnnotateLayer }))
)
export const SignatureDialog = lazy(() =>
  import('./editor/SignatureDialog').then((m) => ({ default: m.SignatureDialog }))
)
export const OrganizeView = lazy(() =>
  import('./organize/OrganizeView').then((m) => ({ default: m.OrganizeView }))
)
