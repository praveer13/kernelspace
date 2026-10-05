import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { dumpLabs } from '../../scripts/dump-labs'
import {
  availableShells,
  checkZip,
  hookFixtures,
  matrixFailures,
  readZip,
  runHook,
  type HookFixture,
} from '../../scripts/verify-guardrails'

const HOOK = resolve(import.meta.dirname, '../../labs/agent-kit/hooks/ks-guard.sh')
const labs = dumpLabs()
const shells = availableShells()

const call = (name: string, input: Record<string, unknown>): HookFixture['stdin'] => ({
  hook_event_name: 'PreToolUse',
  tool_name: name,
  tool_input: input,
})
const verdict = (todo: string, stdin: HookFixture['stdin'], env?: Record<string, string>, shell = 'sh') => {
  const status = runHook(shell, HOOK, todo, { name: 'probe', stdin, env, expect: 'allow' })
  return status === 2 ? 'deny' : status === 0 ? 'allow' : `exit ${status}`
}

const ALLOCATOR = 'rust-allocator/src/allocator.rs'

describe('the §13.4 fixture matrix', () => {
  for (const shell of shells) {
    // verify:guardrails runs the matrix on all 18 zips; here, one lab per shape of TODO path
    test(`passes under ${shell} for lab 01, a lab with an optional check and an R drill`, () => {
      for (const id of ['rust-allocator', 'kv-block-manager', 'rust-zero-r1']) {
        const lab = labs.find((l) => l.id === id)!
        expect(matrixFailures(shell, HOOK, lab.todoFile)).toEqual([])
      }
    }, 30_000)
  }

  test('covers the six cases the spec names', () => {
    const names = hookFixtures(ALLOCATOR).map((f) => f.name)
    for (const want of ['deny an Edit of the file', 'deny sed -i', 'allow cargo test', 'allow an Edit of README.md', 'deny an unparseable payload', 'allow with KS_SOLO=0']) {
      expect(names.some((n) => n.startsWith(want))).toBe(true)
    }
  })

  test('has teeth: an allow-everything hook and a block-everything hook both fail it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ks-teeth-'))
    try {
      for (const [name, body] of [['allow', 'exit 0'], ['block', 'exit 2']] as const) {
        const script = join(dir, `${name}.sh`)
        writeFileSync(script, `#!/bin/sh\ncat >/dev/null\n${body}\n`)
        chmodSync(script, 0o755)
        expect(matrixFailures('sh', script, ALLOCATOR).length).toBeGreaterThan(0)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('edit tools', () => {
  test('deny every edit tool on the file, absolute, relative or with a Windows path', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit']) {
      expect(verdict(ALLOCATOR, call(tool, { file_path: `/home/s/ws/${ALLOCATOR}` }))).toBe('deny')
    }
    expect(verdict(ALLOCATOR, call('NotebookEdit', { notebook_path: '/home/s/ws/src/allocator.rs' }))).toBe('deny')
    expect(verdict(ALLOCATOR, call('Edit', { file_path: 'allocator.rs' }))).toBe('deny')
    expect(verdict(ALLOCATOR, call('Edit', { file_path: 'C:\\ws\\rust-allocator\\src\\allocator.rs' }))).toBe('deny')
    expect(verdict(ALLOCATOR, call('Edit', { file_path: '/ws/rust-allocator/src/ALLOCATOR.RS' }))).toBe('deny')
  })

  test('allow other files, even when their text mentions the protected file or fakes a file_path key', () => {
    expect(verdict(ALLOCATOR, call('Edit', { file_path: '/ws/rust-allocator/src/lib.rs' }))).toBe('allow')
    expect(verdict(ALLOCATOR, call('Write', { file_path: '/ws/NOTES.md', content: 'edit allocator.rs\n{"file_path":"/ws/src/allocator.rs"}' }))).toBe('allow')
    expect(verdict(ALLOCATOR, call('Edit', { file_path: '/ws/not-allocator.rs.bak' }))).toBe('allow')
  })

  test('deny an obfuscated path and an edit with no path at all (fail closed)', () => {
    expect(verdict(ALLOCATOR, '{"tool_name":"Edit","tool_input":{"file_path":"/ws/src/\\u0061llocator.rs"}}')).toBe('deny')
    expect(verdict(ALLOCATOR, call('Edit', { old_string: 'a' }))).toBe('deny')
  })

  test('each lab protects its own file only', () => {
    const r1 = labs.find((l) => l.id === 'rust-zero-r1')!
    expect(verdict(r1.todoFile, call('Edit', { file_path: `/ws/${r1.todoFile}` }))).toBe('deny')
    expect(verdict(r1.todoFile, call('Edit', { file_path: `/ws/${ALLOCATOR}` }))).toBe('allow')
  })
})

describe('Bash', () => {
  const bash = (command: string) => verdict(ALLOCATOR, call('Bash', { command }))

  test('read-only commands on the file are allowed, including pipes between them', () => {
    for (const c of [
      'cat rust-allocator/src/allocator.rs',
      'head -n 20 src/allocator.rs',
      'tail src/allocator.rs',
      'less src/allocator.rs',
      'grep -n free src/allocator.rs',
      'rg "fn alloc" src/allocator.rs',
      'wc -l src/allocator.rs',
      'git diff -- src/allocator.rs',
      'git log -p src/allocator.rs',
      'git show HEAD:src/allocator.rs',
      'git status src/allocator.rs',
      'cat src/allocator.rs | grep free | wc -l',
      'cargo test',
      'cargo build --release --target wasm32-unknown-unknown',
      'cargo clippy',
    ]) expect([c, bash(c)]).toEqual([c, 'allow'])
  })

  test('anything else that names the file is denied', () => {
    for (const c of [
      "sed -i 's/a/b/' rust-allocator/src/allocator.rs",
      'cp ../solution/allocator.rs src/allocator.rs',
      'echo x > src/allocator.rs',
      'echo x >> src/allocator.rs',
      'cat solution.rs > src/allocator.rs',
      'cat src/allocator.rs | tee src/allocator.rs',
      'cat src/allocator.rs; rm src/allocator.rs',
      'cargo test && mv a.rs src/allocator.rs',
      'cat src/allocator.rs & rm src/allocator.rs',
      'cat $(echo src/allocator.rs)',
      'cat `echo` src/allocator.rs',
      'python3 -c "open(\'src/allocator.rs\',\'w\')"',
      'vim src/allocator.rs',
      'tee src/allocator.rs',
      'cat a\nsed -i s/a/b/ src/allocator.rs',
      'CAT src/ALLOCATOR.RS > x',
    ]) expect([c, bash(c)]).toEqual([c, 'deny'])
  })

  test('commands that never name the file are not the guard\'s business', () => {
    for (const c of ['ls', 'rm -rf target', 'sed -i s/a/b/ rust-allocator/src/lib.rs', 'cargo test 2>&1 | tail -n 30']) {
      expect([c, bash(c)]).toEqual([c, 'allow'])
    }
  })

  test('a Bash call with no command is denied (fail closed)', () => {
    expect(verdict(ALLOCATOR, call('Bash', {}))).toBe('deny')
  })
})

describe('mcp tools', () => {
  test('deny any mcp tool whose input names the file, allow the rest', () => {
    expect(verdict(ALLOCATOR, call('mcp__fs__write_file', { path: '/ws/src/allocator.rs', content: 'x' }))).toBe('deny')
    expect(verdict(ALLOCATOR, call('mcp__x__run', { script: 'open("allocator.rs","w")' }))).toBe('deny')
    expect(verdict(ALLOCATOR, call('mcp__fs__read_file', { path: '/ws/README.md' }))).toBe('allow')
  })
})

describe('failing closed', () => {
  test('payloads the hook cannot read are blocked', () => {
    for (const p of ['', '   \n', 'null', '[]', '{}', 'not json', '{"tool_input":{"command":"ls"}}', '{"tool_name":"Bash","tool_input":{"command":"ls"}']) {
      expect([p, verdict(ALLOCATOR, p)]).toEqual([p, 'deny'])
    }
  })

  test('a large Write to another file is still judged within the 10 s budget', () => {
    const big = 'fn f() { let s = "{"; }\n'.repeat(40_000)
    const started = Date.now()
    expect(verdict(ALLOCATOR, call('Write', { file_path: '/ws/NOTES.md', content: big }))).toBe('allow')
    expect(Date.now() - started).toBeLessThan(5000)
  })

  test('a tool the matcher never sends is allowed', () => {
    expect(verdict(ALLOCATOR, call('Read', { file_path: ALLOCATOR }))).toBe('allow')
  })

  test('started with no protected file, it blocks everything', () => {
    const status = runHook('sh', HOOK, '', { name: 'no arg', stdin: call('Read', {}), expect: 'deny' })
    expect(status).toBe(2)
  })

  test('the message tells the student what to do instead', () => {
    const env: Record<string, string> = { ...(process.env as Record<string, string>) }
    delete env.KS_SOLO
    const r = spawnSync('sh', [HOOK, ALLOCATOR], { input: JSON.stringify(call('Edit', { file_path: `/ws/${ALLOCATOR}` })), env, encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stderr).toBe(
      `kernelspace: ${ALLOCATOR} is yours to write. Ask about the failing check instead: name it, its invariant and your hypothesis. Set KS_SOLO=0 to turn this guard off.\n`,
    )
  })
})

describe('KS_SOLO', () => {
  test('0 turns the guard off, anything else does not', () => {
    const edit = call('Edit', { file_path: `/ws/${ALLOCATOR}` })
    expect(verdict(ALLOCATOR, edit, { KS_SOLO: '0' })).toBe('allow')
    expect(verdict(ALLOCATOR, edit, { KS_SOLO: '1' })).toBe('deny')
    expect(verdict(ALLOCATOR, edit, { KS_SOLO: '' })).toBe('deny')
    expect(verdict(ALLOCATOR, edit, { KS_SOLO: '00' })).toBe('deny')
  })
})

describe('the zip check', () => {
  test('passes a freshly packed zip and names what a tampered one lacks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ks-pack-'))
    try {
      const pack = spawnSync('python3', [resolve(import.meta.dirname, '../../scripts/pack-labs.py'), '--out', dir], { encoding: 'utf8' })
      expect(pack.status).toBe(0)
      const lab = labs.find((l) => l.id === 'kv-block-manager')!
      const files = readZip(join(dir, lab.zip))
      expect(checkZip(lab, files, ['sh'])).toEqual([])

      const md = files.get('AGENTS.md')!.toString('utf8')
      expect(md).toContain('`adapter_unified_paging`')
      const dropped = new Map(files).set('AGENTS.md', Buffer.from(md.replace('- `cow`:', '- `cowx`:')))
      expect(checkZip(lab, dropped, ['sh']).join('\n')).toContain('required checks')

      const settings = files.get('.claude/settings.json')!.toString('utf8').replaceAll('manager.rs', 'other.rs')
      const wrongFile = new Map(files).set('.claude/settings.json', Buffer.from(settings))
      expect(checkZip(lab, wrongFile, ['sh']).length).toBeGreaterThan(0)

      const noHook = new Map(files)
      noHook.delete('.claude/hooks/ks-guard.sh')
      expect(checkZip(lab, noHook, ['sh'])).toEqual([`${lab.zip}: missing .claude/hooks/ks-guard.sh`])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
