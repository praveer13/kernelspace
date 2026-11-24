/**
 * K0-FIX-T7: two sentences of the t7 lane said more than their sources do.
 * - t7.l2 Rule 1: a closed-loop run bounds the queue by its N clients; it does not stop a queue forming (N clients over the
 *   engine's running slots leave N minus slots waiting), and Rule 3's sweep runs closed-loop concurrency past SLO collapse.
 * - The t7.l5 erratum on ModelExpress: its README (v0.8.0, line 104) lists the client as "Rust CLI for cache management;
 *   Python package with inference engine loaders" and gives the server's language nowhere, so "only its CLI is Rust" was
 *   more than it says.
 */
import { describe, expect, test } from 'bun:test'
import modelExpress from '@/data/errata/2026-11-23-t7-l5-two-schools-of-autoscaling'
import { lessonById } from '@/data/lessons'

describe('the t7 lane says what its sources say (K0-FIX-T7)', () => {
  test('t7.l2 bounds the closed-loop queue by N instead of saying no queue can build', () => {
    const text = JSON.stringify(lessonById('t7.l2'))
    expect(text).not.toContain('no queue can build')
    expect(text).toContain('the queue can never hold more than N requests, however slow the server gets')
    expect(text).toContain('(the effect is called coordinated omission)')
  })

  test('the ModelExpress erratum names a Python loader package and a Rust client CLI, and no "only"', () => {
    expect(modelExpress.after).not.toContain('only its CLI is Rust')
    expect(modelExpress.after).toContain('its engine loaders are a Python package and its client CLI is Rust')
    expect(modelExpress.source.url).toContain('/blob/v0.8.0/README.md')
  })
})
