/**
 * K0-FIX2-T2: the lane t2 second fix round. One account of Dynamo's transports, as the course states it in t3.l6,
 * the claim status.dynamo.transport and the erratum 2026-11-21-dynamo-tcp-default: the request plane (RPC between
 * components) is TCP by default, and the KV blocks move worker to worker through NIXL, not over that TCP plane.
 */
import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'

const textOf = (id: string) => {
  const lesson = ALL_LESSONS.find((l) => l.id === id)
  if (!lesson) throw new Error(`${id} not found`)
  return JSON.stringify(lesson)
}

describe('t2.l6 puts only the request plane on TCP', () => {
  test('the data plane is not said to run over plain TCP', () => {
    const t = textOf('t2.l6')
    expect(t).not.toContain("Dynamo's data plane is Rust + tokio over plain TCP")
    expect(t).toContain('with its request plane on plain TCP by default (the KV blocks themselves move worker to worker through NIXL)')
  })
})
