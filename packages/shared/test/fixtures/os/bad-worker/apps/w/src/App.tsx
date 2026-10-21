export function App() {
  new Worker(new URL('./bad.worker.ts', import.meta.url), { type: 'module' })
  return null
}
