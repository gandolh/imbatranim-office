import { useEffect, useState } from 'react'
import { Button } from '@imbatranim/ui'
import { greet } from '../../../lib/greet'

export function App() {
  const [sum, setSum] = useState<number | null>(null)
  useEffect(() => {
    const worker = new Worker(new URL('./sum.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<number>) => setSum(e.data)
    worker.postMessage([1, 2, 3])
    return () => worker.terminate()
  }, [])
  return (
    <div className="tracking-widest">
      <Button>{greet('alpha')}</Button>
      {sum}
    </div>
  )
}
