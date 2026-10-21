// Test helpers every app brief reuses: a fake desktop handle and a React
// harness that renders inside a SystemProvider. Import from
// '@imbatranim-office/shared/testing' in *.test.tsx files only.
export {
  createFakeSystem,
  fakeHost,
  fileKey,
  type FakeSystem,
  type FakeSystemOptions,
} from './fakeSystem'
export { cleanupRendered, clickButton, renderWithSystem, settle, type Rendered } from './render'
