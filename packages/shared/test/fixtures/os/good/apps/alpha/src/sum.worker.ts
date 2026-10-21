addEventListener('message', (event: MessageEvent<number[]>) => {
  postMessage(event.data.reduce((a, b) => a + b, 0))
})
