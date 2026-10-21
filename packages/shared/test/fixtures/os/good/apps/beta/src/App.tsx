import { greet } from '../../../lib/greet'

export function App() {
  return <p className="text-primary underline">{greet('beta')}</p>
}
