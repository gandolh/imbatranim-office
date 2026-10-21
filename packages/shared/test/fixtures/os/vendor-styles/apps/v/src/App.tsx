// Reads process.env the way bundled Node-aware helpers do: behind a check for
// Node. The build replaces process.env, so the emitted module never reads it.
declare const process: { release?: unknown; env: Record<string, string | undefined> }

const forceColor = typeof process < 'u' && process.release ? process.env.FORCE_COLOR : undefined

// NODE_ENV is still folded to "production": the narrower define wins over process.env.
export const App = () => (
  <div className="wd-toolbar flex">
    {String(forceColor)} {process.env.NODE_ENV}
  </div>
)
