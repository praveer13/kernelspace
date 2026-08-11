import type { SchedulerDriver } from './fleet-model'
import type { LabModule } from './wasm-lab'

const ACTION_PATTERN = /^admit(?: ([0-9,]*))?\npreempt(?: ([0-9,]*))?$/

function parseIds(raw: string, field: string): number[] {
  if (raw === '') return []
  const ids = raw.split(',').map((part) => Number(part))
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 0)) {
    throw new Error(`scheduler returned an invalid ${field} list`)
  }
  if (new Set(ids).size !== ids.length) throw new Error(`scheduler returned duplicate ${field} ids`)
  return ids
}

/** Strict adapter for the lab 06 line ABI; malformed actions fail closed. */
export function makeWasmScheduler(mod: LabModule & { hasInvoke: boolean }): SchedulerDriver {
  if (!mod.hasInvoke) throw new Error('batching-scheduler module has no ks_invoke bridge')
  const init = mod.invoke('init').trim()
  if (init !== 'ok') throw new Error(`scheduler init failed: ${init}`)
  return {
    name: 'wasm submission',
    schedule(view) {
      const waiting = view.waiting.map((request) => `W ${request.id} ${request.arrival} ${request.prompt}`).join(' ; ')
      const running = view.running
        .map(
          (request) =>
            `R ${request.id} ${request.arrival} ${request.prompt} ${request.decoded} ${request.prefillLeft}`,
        )
        .join(' ; ')
      const reply = mod.invoke(
        `schedule ${view.iter} ${view.maxRunning} ${view.memCap} ${view.memUsed}\n${waiting}\n${running}`,
      )
      const match = ACTION_PATTERN.exec(reply.trim())
      if (!match) throw new Error('scheduler returned a malformed action reply')
      return {
        admit: parseIds(match[1] ?? '', 'admit'),
        preempt: parseIds(match[2] ?? '', 'preempt'),
      }
    },
  }
}
