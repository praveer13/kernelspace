/* real-engine generation worker: hosts transformers.js + the model OFF the
   main thread so the UI (and the scheduler loop) never blocks.
   Protocol:
     in:  { kind: 'load', modelId }
     out: { kind: 'progress', phase, frac } | { kind: 'ready', device }
     in:  { kind: 'gen', id, prompt, maxNew }
     out: { kind: 'done', id, text } | { kind: 'error', id, message }
*/

let gen = null

self.onmessage = async (e) => {
  const msg = e.data
  if (msg.kind === 'load') {
    try {
      const spec = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0'
      const tjs = await import(spec)
      let device = 'wasm'
      try {
        if (self.navigator?.gpu) {
          const adapter = await self.navigator.gpu.requestAdapter()
          if (adapter) device = 'webgpu'
        }
      } catch {
        device = 'wasm'
      }
      let done = 0
      const total = 6
      gen = await tjs.pipeline('text-generation', msg.modelId, {
        dtype: 'q4',
        device,
        progress_callback: (p) => {
          if (p.status === 'done') {
            done++
            self.postMessage({ kind: 'progress', phase: `weights ${done}/${total} (${device})`, frac: 0.05 + 0.9 * (done / total) })
          }
        },
      })
      self.postMessage({ kind: 'ready', device })
    } catch (err) {
      self.postMessage({ kind: 'error', id: -1, message: String(err?.message ?? err) })
    }
    return
  }
  if (msg.kind === 'gen') {
    if (!gen) {
      self.postMessage({ kind: 'error', id: msg.id, message: 'model not loaded' })
      return
    }
    try {
      const out = await gen([{ role: 'user', content: msg.prompt }], {
        max_new_tokens: msg.maxNew,
        do_sample: false,
      })
      const text = out?.[0]?.generated_text?.at(-1)?.content ?? ''
      self.postMessage({ kind: 'done', id: msg.id, text })
    } catch (err) {
      self.postMessage({ kind: 'error', id: msg.id, message: String(err?.message ?? err) })
    }
  }
}
