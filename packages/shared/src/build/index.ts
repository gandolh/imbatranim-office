// Build-side helpers (Node only): the externals, the CSS rule, the OS build and
// the kit snapshot. Apps never import this; vite.config.ts and tools/ do.
export { appCssSource, appStyles, compileAppCss } from './appCss.ts'
export { checkUtilitiesOnly, parseCss, type CssRuleProblem } from './cssRule.ts'
export { kitExports, reactExports, readSharedExports } from './exportNames.ts'
export {
  formatKitCommit,
  parseKitCommit,
  readKitSnapshot,
  syncKit,
  type KitCommit,
  type KitSnapshot,
} from './kitSnapshot.ts'
export {
  discoverApps,
  osBuildConfig,
  osOutputChecks,
  type OsApp,
  type OsBuildOptions,
} from './osBuild.ts'
export {
  BARE_SHARED_IMPORT,
  SHARED_GLOBAL,
  SHARED_SPECIFIERS,
  isSharedSpecifier,
  noSharedKitInWorkers,
  sharedKitExternals,
  sharedModuleSource,
  type ModuleExports,
  type SharedExports,
  type SharedSpecifier,
} from './sharedKit.ts'
