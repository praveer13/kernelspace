/**
 * capstone-sandbox.js — the relay inside the Capstone's sandboxed frame (spec wave-1 §14.1).
 *
 * This document is only ever loaded as <iframe sandbox="allow-scripts">, so its
 * origin is opaque: no app IndexedDB, storage, cookies or BroadcastChannel, and
 * neither are there for the Blob worker it starts. The page posts the built
 * capstone.worker bundle in as a string ('init'), then one job at a time.
 * Each job gets a fresh worker and 2 s; past that the worker is terminated and the
 * page hears 'timeout'. Messages are accepted only from window.parent.
 *
 * Plain JS on purpose (no build step). It mirrors WorkerRelay in
 * src/lib/capstone/sandbox.ts; tests/capstone/sandbox-protocol.test.ts runs this file.
 */
(function () {
  'use strict'
  var TAG = 'ks-capstone'
  var BUDGET_MS = 2000
  var BOOT_MS = 4000

  var workerUrl = null
  var warm = null
  var queue = Promise.resolve()

  function send(msg) {
    window.parent.postMessage(msg, '*')
  }

  function reason(e) {
    return String((e && e.message) || e || 'unknown error')
  }

  function spawn() {
    var worker = new Worker(workerUrl)
    var ready = new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('the sandbox worker did not start'))
      }, BOOT_MS)
      worker.onmessage = function (ev) {
        if (!ev.data || ev.data.type !== 'ready') return
        clearTimeout(timer)
        worker.onmessage = null
        worker.onerror = null
        resolve()
      }
      worker.onerror = function (ev) {
        clearTimeout(timer)
        reject(new Error((ev && ev.message) || 'the sandbox worker failed to start'))
      }
    })
    ready.catch(function () {})
    return { worker: worker, ready: ready }
  }

  function ensureWarm() {
    if (!warm) warm = spawn()
    return warm
  }

  function init(source) {
    if (workerUrl) return
    try {
      workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      ensureWarm().ready.then(
        function () {
          send({ tag: TAG, type: 'ready' })
        },
        function (e) {
          send({ tag: TAG, type: 'unsupported', reason: reason(e) })
        },
      )
    } catch (e) {
      send({ tag: TAG, type: 'unsupported', reason: reason(e) })
    }
  }

  // the budget runs from submission, a worker still booting included, so no job outlives it
  function run(nonce, stepId, code) {
    var w = ensureWarm()
    warm = null
    return new Promise(function (resolve) {
      var settled = false
      var timer = setTimeout(function () {
        finish({ tag: TAG, type: 'timeout', nonce: nonce })
      }, BUDGET_MS)
      function finish(msg) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        w.worker.onmessage = null
        w.worker.onerror = null
        w.worker.terminate()
        ensureWarm()
        send(msg)
        resolve()
      }
      w.ready.then(
        function () {
          if (settled) return
          w.worker.onmessage = function (ev) {
            var m = ev.data
            if (m && m.type === 'done') finish({ tag: TAG, type: 'result', nonce: nonce, reply: m.reply })
          }
          w.worker.postMessage({ type: 'job', stepId: stepId, code: code })
        },
        function () {
          finish({ tag: TAG, type: 'timeout', nonce: nonce })
        },
      )
    })
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return
    var m = ev.data
    if (!m || typeof m !== 'object' || m.tag !== TAG) return
    if (m.type === 'init' && typeof m.source === 'string') {
      init(m.source)
    } else if (m.type === 'job' && workerUrl && typeof m.nonce === 'string') {
      var nonce = m.nonce
      var stepId = String(m.stepId)
      var code = String(m.code)
      queue = queue.then(function () {
        return run(nonce, stepId, code)
      })
    }
  })

  send({ tag: TAG, type: 'hello' })
})()
