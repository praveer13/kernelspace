/**
 * A small DOM for mounting React components under `bun test` (no browser, and no DOM package: the repo has none).
 *
 * It implements what react-dom/client and our components touch: nodes and elements, attributes, events with capture and
 * bubble phases, and focus (`focus()`, `blur()`, `document.activeElement`, focus events, and a focused element that is
 * removed falling back to `body`). Layout and the CSS cascade are not simulated: `effectiveOpacity` reads inline
 * `opacity` up the ancestors, which is where a framer-motion entrance puts its first frame. What a browser alone can
 * answer (real fade, real tab order, contrast) stays with the a11y harness and Playwright.
 *
 * `installDom()` puts the DOM on `globalThis` for one test file and returns `mount` and `uninstall`; call it in
 * `beforeAll` and `uninstall` in `afterAll`, because bun runs every test file in one process.
 */

type Fn = (e: MiniEvent) => void
interface Listener {
  fn: Fn | { handleEvent: Fn }
  capture: boolean
  once: boolean
}

export class MiniEvent {
  type: string
  bubbles = false
  cancelable = false
  composed = false
  defaultPrevented = false
  eventPhase = 0
  isTrusted = false
  timeStamp = Date.now()
  target: unknown = null
  currentTarget: unknown = null
  relatedTarget: unknown = null
  stopped = false
  immediate = false
  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type
    Object.assign(this, init)
  }
  get srcElement() {
    return this.target
  }
  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true
  }
  stopPropagation() {
    this.stopped = true
  }
  stopImmediatePropagation() {
    this.stopped = true
    this.immediate = true
  }
  composedPath() {
    return []
  }
}

/** The event path from a target up to the window (the document's parent is the window's event target). */
function eventPath(start: Target): Target[] {
  const path: Target[] = []
  for (let t: Target | null = start; t; t = t.eventParent) path.push(t)
  return path
}

class Target {
  listeners = new Map<string, Listener[]>()
  addEventListener(type: string, fn: Listener['fn'] | null, opts?: boolean | { capture?: boolean; once?: boolean }) {
    if (!fn) return
    const capture = typeof opts === 'boolean' ? opts : (opts?.capture ?? false)
    const list = this.listeners.get(type) ?? []
    if (list.some((l) => l.fn === fn && l.capture === capture)) return
    list.push({ fn, capture, once: typeof opts === 'object' && opts.once === true })
    this.listeners.set(type, list)
  }
  removeEventListener(type: string, fn: Listener['fn'] | null, opts?: boolean | { capture?: boolean }) {
    const capture = typeof opts === 'boolean' ? opts : (opts?.capture ?? false)
    const list = this.listeners.get(type)
    if (!list) return
    this.listeners.set(
      type,
      list.filter((l) => !(l.fn === fn && l.capture === capture)),
    )
  }
  /** The next target up the event path (a node's parent; the document's is the window). */
  get eventParent(): Target | null {
    return null
  }
  dispatchEvent(ev: MiniEvent): boolean {
    const path = eventPath(this)
    ev.target = this
    const run = (t: Target, capture: boolean, phase: number) => {
      ev.currentTarget = t
      ev.eventPhase = phase
      for (const l of [...(t.listeners.get(ev.type) ?? [])]) {
        if (l.capture !== capture && phase !== 2) continue
        if (l.once) t.removeEventListener(ev.type, l.fn, l.capture)
        if (typeof l.fn === 'function') l.fn.call(t, ev)
        else l.fn.handleEvent(ev)
        if (ev.immediate) return
      }
    }
    for (let i = path.length - 1; i > 0 && !ev.stopped; i--) run(path[i], true, 1)
    if (!ev.stopped) run(path[0], false, 2)
    if (ev.bubbles) for (let i = 1; i < path.length && !ev.stopped; i++) run(path[i], false, 3)
    ev.currentTarget = null
    ev.eventPhase = 0
    return !ev.defaultPrevented
  }
}

/** A node, then its parent, and so on up to the root. */
function selfAndAncestors(start: MiniNode): MiniNode[] {
  const chain: MiniNode[] = []
  for (let n: MiniNode | null = start; n; n = n.parentNode) chain.push(n)
  return chain
}

export class MiniNode extends Target {
  nodeType = 0
  nodeName = ''
  parentNode: MiniNode | null = null
  childNodes: MiniNode[] = []
  ownerDocument: MiniDocument
  constructor(doc: MiniDocument | null) {
    super()
    this.ownerDocument = doc as MiniDocument
  }
  get eventParent(): Target | null {
    return this.parentNode ?? (this.nodeType === 9 ? (this as unknown as MiniDocument).windowEvents : null)
  }
  get firstChild() {
    return this.childNodes[0] ?? null
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null
  }
  get nextSibling() {
    const sibs = this.parentNode?.childNodes
    return sibs ? (sibs[sibs.indexOf(this) + 1] ?? null) : null
  }
  get previousSibling() {
    const sibs = this.parentNode?.childNodes
    return sibs ? (sibs[sibs.indexOf(this) - 1] ?? null) : null
  }
  get isConnected(): boolean {
    return selfAndAncestors(this).some((n) => n.nodeType === 9)
  }
  appendChild<T extends MiniNode>(node: T): T {
    return this.insertBefore(node, null)
  }
  insertBefore<T extends MiniNode>(node: T, ref: MiniNode | null): T {
    node.parentNode?.removeChild(node)
    const at = ref === null ? this.childNodes.length : this.childNodes.indexOf(ref)
    if (at < 0) throw new Error('insertBefore: the reference node is not a child')
    this.childNodes.splice(at, 0, node)
    node.parentNode = this
    return node
  }
  removeChild<T extends MiniNode>(node: T): T {
    const at = this.childNodes.indexOf(node)
    if (at < 0) throw new Error('removeChild: not a child')
    // a focused node that leaves the page drops focus to the body, without a blur event, as a browser does
    const doc = this.ownerDocument ?? (this as unknown as MiniDocument)
    if (doc.focused && (doc.focused === node || node.contains(doc.focused))) doc.focused = null
    this.childNodes.splice(at, 1)
    node.parentNode = null
    return node
  }
  remove() {
    this.parentNode?.removeChild(this)
  }
  contains(other: MiniNode | null): boolean {
    for (let n = other; n; n = n.parentNode) if (n === this) return true
    return false
  }
  getRootNode(): MiniNode {
    return selfAndAncestors(this).at(-1)!
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('')
  }
  set textContent(text: string) {
    for (const c of [...this.childNodes]) this.removeChild(c)
    if (text !== '') this.appendChild(this.ownerDocument.createTextNode(text))
  }
}

export class MiniText extends MiniNode {
  nodeType = 3
  nodeName = '#text'
  data: string
  constructor(doc: MiniDocument, data: string) {
    super(doc)
    this.data = data
  }
  get nodeValue() {
    return this.data
  }
  set nodeValue(v: string) {
    this.data = String(v)
  }
  get textContent() {
    return this.data
  }
  set textContent(v: string) {
    this.data = String(v)
  }
}

export class MiniComment extends MiniText {
  nodeType = 8
  nodeName = '#comment'
}

/** Inline style: a bag by CSS property name, with the DOM's camelCase accessors mapped on. */
function makeStyle() {
  const bag = new Map<string, string>()
  const hyphen = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
  const api = {
    setProperty: (k: string, v: string | null) => void (v === null || v === '' ? bag.delete(k) : bag.set(k, String(v))),
    removeProperty: (k: string) => void bag.delete(k),
    getPropertyValue: (k: string) => bag.get(k) ?? '',
  }
  return new Proxy(api as Record<string, unknown>, {
    get: (t, k: string) => {
      if (typeof k !== 'string') return undefined
      if (k === 'cssText') return [...bag].map(([p, v]) => `${p}: ${v};`).join(' ')
      if (k in t) return t[k]
      return bag.get(hyphen(k)) ?? ''
    },
    set: (_t, k: string, v) => {
      if (typeof k !== 'string') return true
      if (k === 'cssText') {
        bag.clear()
        for (const decl of String(v).split(';')) {
          const [p, ...rest] = decl.split(':')
          if (rest.length > 0) bag.set(p.trim(), rest.join(':').trim())
        }
      } else if (v === null || v === '') bag.delete(hyphen(k))
      else bag.set(hyphen(k), String(v))
      return true
    },
  })
}

const HTML_NS = 'http://www.w3.org/1999/xhtml'
const FOCUSABLE = new Set(['button', 'input', 'select', 'textarea', 'summary'])

export class MiniElement extends MiniNode {
  nodeType = 1
  tagName: string
  namespaceURI: string
  attrs = new Map<string, string>()
  style = makeStyle()
  value = ''
  checked = false
  scrollTop = 0
  scrollLeft = 0
  constructor(doc: MiniDocument, tag: string, ns: string) {
    super(doc)
    this.namespaceURI = ns
    this.tagName = ns === HTML_NS ? tag.toUpperCase() : tag
    this.nodeName = this.tagName
  }
  get localName() {
    return this.tagName.toLowerCase()
  }
  setAttribute(name: string, value: unknown) {
    this.attrs.set(this.namespaceURI === HTML_NS ? name.toLowerCase() : name, String(value))
  }
  setAttributeNS(_ns: string | null, name: string, value: unknown) {
    this.attrs.set(name, String(value))
  }
  getAttribute(name: string) {
    return this.attrs.get(name.toLowerCase()) ?? this.attrs.get(name) ?? null
  }
  hasAttribute(name: string) {
    return this.attrs.has(name.toLowerCase()) || this.attrs.has(name)
  }
  removeAttribute(name: string) {
    this.attrs.delete(name.toLowerCase())
    this.attrs.delete(name)
  }
  removeAttributeNS(_ns: string | null, name: string) {
    this.attrs.delete(name)
  }
  getAttributeNames() {
    return [...this.attrs.keys()]
  }
  get id() {
    return this.getAttribute('id') ?? ''
  }
  set id(v: string) {
    this.setAttribute('id', v)
  }
  get className() {
    return this.getAttribute('class') ?? ''
  }
  set className(v: string) {
    this.setAttribute('class', v)
  }
  get hidden() {
    return this.hasAttribute('hidden')
  }
  get disabled() {
    return this.hasAttribute('disabled')
  }
  get type() {
    return this.getAttribute('type') ?? (this.localName === 'button' ? 'submit' : 'text')
  }
  set type(v: string) {
    this.setAttribute('type', v)
  }
  get dataset(): Record<string, string | undefined> {
    return new Proxy({} as Record<string, string | undefined>, {
      get: (_t, k: string) => (typeof k !== 'string' ? undefined : (this.getAttribute(`data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`) ?? undefined)),
    })
  }
  get tabIndex(): number {
    const t = this.getAttribute('tabindex')
    if (t !== null && Number.isFinite(Number(t))) return Number(t)
    return this.focusableByDefault() ? 0 : -1
  }
  set tabIndex(v: number) {
    this.setAttribute('tabindex', v)
  }
  get selectionStart() {
    return this.value.length
  }
  get selectionEnd() {
    return this.value.length
  }
  setSelectionRange() {}
  select() {}
  get contentEditable() {
    return this.getAttribute('contenteditable') ?? 'inherit'
  }
  private focusableByDefault() {
    const tag = this.localName
    if (tag === 'a') return this.hasAttribute('href')
    if (tag === 'input' && this.type === 'hidden') return false
    return FOCUSABLE.has(tag)
  }
  /** Whether a browser would let this element take focus now. */
  get canFocus(): boolean {
    if (!this.isConnected) return false
    if (!this.hasAttribute('tabindex') && !this.focusableByDefault()) return false
    if (this.disabled) return false
    for (const n of selfAndAncestors(this)) {
      if (n instanceof MiniElement) {
        if (n.hidden) return false
        if (n !== this && n.localName === 'fieldset' && n.disabled && this.focusableByDefault()) return false
      }
    }
    return true
  }
  focus() {
    const doc = this.ownerDocument
    if (!this.canFocus || doc.focused === this) return
    const old = doc.focused
    if (old) {
      doc.focused = null
      old.dispatchEvent(new MiniEvent('blur', { relatedTarget: this }))
      old.dispatchEvent(new MiniEvent('focusout', { bubbles: true, relatedTarget: this }))
    }
    doc.focused = this
    this.dispatchEvent(new MiniEvent('focus', { relatedTarget: old }))
    this.dispatchEvent(new MiniEvent('focusin', { bubbles: true, relatedTarget: old }))
  }
  blur() {
    const doc = this.ownerDocument
    if (doc.focused !== this) return
    doc.focused = null
    this.dispatchEvent(new MiniEvent('blur'))
    this.dispatchEvent(new MiniEvent('focusout', { bubbles: true }))
  }
  /** `element.click()`: no focus change, and nothing for a disabled control. */
  click() {
    if (this.disabled) return
    const clicked = this.dispatchEvent(new MiniEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }))
    // a submit button's default action: its form gets a `submit` event
    if (clicked && this.localName === 'button' && this.type === 'submit') this.closest('form')?.dispatchEvent(new MiniEvent('submit', { bubbles: true, cancelable: true }))
  }
  scrollIntoView() {}
  scrollTo() {}
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }
  }
  checkVisibility() {
    return !selfAndAncestors(this).some((n) => n instanceof MiniElement && n.hidden)
  }
  matches(sel: string) {
    return compile(sel).some((c) => matchComplex(this, c))
  }
  closest(sel: string): MiniElement | null {
    return (selfAndAncestors(this).find((n) => n instanceof MiniElement && n.matches(sel)) as MiniElement | undefined) ?? null
  }
  querySelectorAll(sel: string): MiniElement[] {
    const found: MiniElement[] = []
    const rules = compile(sel)
    const walk = (n: MiniNode) => {
      for (const c of n.childNodes) {
        if (c instanceof MiniElement) {
          if (rules.some((r) => matchComplex(c, r))) found.push(c)
          walk(c)
        }
      }
    }
    walk(this)
    return found
  }
  querySelector(sel: string): MiniElement | null {
    return this.querySelectorAll(sel)[0] ?? null
  }
  get classList() {
    return { contains: (c: string) => this.className.split(/\s+/).includes(c) }
  }
  get innerHTML(): string {
    return this.childNodes.map((c) => (c instanceof MiniElement ? c.outerHTML : c.nodeType === 3 ? c.textContent : '')).join('')
  }
  get outerHTML(): string {
    const attrs = [...this.attrs].map(([k, v]) => ` ${k}="${v}"`).join('')
    return `<${this.localName}${attrs}>${this.innerHTML}</${this.localName}>`
  }
}

/* ---------------------------------- selectors ---------------------------------- */

type Test = (el: MiniElement) => boolean
interface Step {
  combinator: ' ' | '>' | ''
  tests: Test[]
}

const ATTR_OPS: Record<string, (have: string, want: string) => boolean> = {
  '=': (h, w) => h === w,
  '^=': (h, w) => h.startsWith(w),
  '$=': (h, w) => h.endsWith(w),
  '*=': (h, w) => h.includes(w),
  '~=': (h, w) => h.split(/\s+/).includes(w),
}

function compound(src: string): Test[] {
  const tests: Test[] = []
  const re = /(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*]?=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/y
  let m: RegExpExecArray | null
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    const [, tag, id, cls, attr, op, dq, sq, bare] = m
    if (tag !== undefined) {
      if (tag !== '*') tests.push((el) => el.localName === tag.toLowerCase())
    } else if (id !== undefined) tests.push((el) => el.id === id)
    else if (cls !== undefined) tests.push((el) => el.className.split(/\s+/).includes(cls))
    else if (attr !== undefined) {
      const want = dq ?? sq ?? bare
      tests.push((el) => {
        const have = el.getAttribute(attr)
        return want === undefined ? have !== null : have !== null && ATTR_OPS[op](have, want)
      })
    }
  }
  if (re.lastIndex < src.length) throw new Error(`mini-dom: unsupported selector "${src}"`)
  return tests
}

/** Split on `sep` where it is outside [brackets] and quotes. */
function splitTop(src: string, sep: (c: string) => boolean): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let cur = ''
  for (const c of src) {
    if (quote) quote = c === quote ? '' : quote
    else if (c === '"' || c === "'") quote = c
    else if (c === '[') depth++
    else if (c === ']') depth--
    if (depth === 0 && quote === '' && sep(c)) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

function compile(sel: string): Step[][] {
  return splitTop(sel, (c) => c === ',').map((part) => {
    const steps: Step[] = []
    const tokens = splitTop(part.trim().replace(/\s*>\s*/g, ' > '), (c) => c === ' ').filter((t) => t !== '')
    let combinator: Step['combinator'] = ''
    for (const tok of tokens) {
      if (tok === '>') combinator = '>'
      else {
        steps.push({ combinator: steps.length === 0 ? '' : combinator || ' ', tests: compound(tok) })
        combinator = ''
      }
    }
    return steps
  })
}

function matchComplex(el: MiniElement, steps: Step[], at = steps.length - 1): boolean {
  const step = steps[at]
  if (!step.tests.every((t) => t(el))) return false
  if (at === 0) return true
  const parent = el.parentNode
  if (step.combinator === '>') return parent instanceof MiniElement && matchComplex(parent, steps, at - 1)
  for (let p = parent; p; p = p.parentNode) if (p instanceof MiniElement && matchComplex(p, steps, at - 1)) return true
  return false
}

/* ---------------------------------- document ---------------------------------- */

export class MiniDocument extends MiniNode {
  nodeType = 9
  nodeName = '#document'
  focused: MiniElement | null = null
  defaultView: object = {}
  /** The window's side of the event path. */
  windowEvents: Target | null = null
  documentElement: MiniElement
  head: MiniElement
  body: MiniElement
  visibilityState = 'visible'
  readyState = 'complete'
  constructor() {
    super(null)
    this.ownerDocument = this
    this.documentElement = this.createElement('html')
    this.head = this.createElement('head')
    this.body = this.createElement('body')
    this.appendChild(this.documentElement)
    this.documentElement.appendChild(this.head)
    this.documentElement.appendChild(this.body)
  }
  createElement(tag: string) {
    return new MiniElement(this, tag, HTML_NS)
  }
  createElementNS(ns: string, tag: string) {
    return new MiniElement(this, tag, ns)
  }
  createTextNode(data: string) {
    return new MiniText(this, data)
  }
  createComment(data: string) {
    return new MiniComment(this, data)
  }
  get activeElement(): MiniElement {
    return this.focused ?? this.body
  }
  hasFocus() {
    return true
  }
  getElementById(id: string) {
    return this.documentElement.querySelector(`#${id}`)
  }
  querySelector(sel: string) {
    return this.documentElement.querySelector(sel)
  }
  querySelectorAll(sel: string) {
    return this.documentElement.querySelectorAll(sel)
  }
  get fonts() {
    return { ready: Promise.resolve() }
  }
}

/** The product of every inline `opacity` from the element up: what a framer-motion first frame would show. */
export function effectiveOpacity(el: MiniElement): number {
  let o = 1
  for (let n: MiniNode | null = el; n; n = n.parentNode) {
    if (n instanceof MiniElement) {
      const v = n.style.opacity
      if (v !== '' && Number.isFinite(Number(v))) o *= Number(v)
    }
  }
  return o
}

/* ---------------------------------- install ---------------------------------- */

export interface Mounted {
  container: MiniElement
  /** Render another element into the same root. */
  render(el: unknown): Promise<void>
  unmount(): Promise<void>
}

export interface DomKit {
  document: MiniDocument
  window: Record<string, unknown>
  /** Render `el` into a fresh container on the body. */
  mount(el: unknown): Promise<Mounted>
  /** Run `fn` inside React's act (state updates flush before it resolves). */
  act(fn: () => unknown): Promise<void>
  /** A press as a person makes it: the control takes focus, then it is clicked. */
  press(el: MiniElement): Promise<void>
  /** Let timers and promises run inside act until `cond` holds (or `ms` pass), then one turn more. */
  until(cond: () => boolean, ms?: number): Promise<void>
  /** Unmount what was mounted, let React's last tasks run, and put the globals back. */
  uninstall(): Promise<void>
}

export async function installDom(): Promise<DomKit> {
  const doc = new MiniDocument()
  const store = new Map<string, string>()
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  const classes: Record<string, unknown> = {
    Node: MiniNode,
    Element: MiniElement,
    HTMLElement: MiniElement,
    SVGElement: MiniElement,
    HTMLIFrameElement: class HTMLIFrameElement {},
    HTMLInputElement: class HTMLInputElement {},
    HTMLTextAreaElement: class HTMLTextAreaElement {},
    HTMLSelectElement: class HTMLSelectElement {},
    HTMLButtonElement: class HTMLButtonElement {},
    HTMLAnchorElement: class HTMLAnchorElement {},
    HTMLDialogElement: class HTMLDialogElement {},
    Text: MiniText,
    Event: MiniEvent,
    MouseEvent: MiniEvent,
    KeyboardEvent: MiniEvent,
    FocusEvent: MiniEvent,
    PointerEvent: MiniEvent,
    CustomEvent: MiniEvent,
    ResizeObserver: Observer,
    IntersectionObserver: Observer,
    MutationObserver: Observer,
  }
  const raf = (fn: (t: number) => void) => setTimeout(() => fn(performance.now()), 16)
  const caf = (h: ReturnType<typeof setTimeout>) => clearTimeout(h)
  const computed = (el: MiniElement) => el.style
  const media = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  const base: Record<string, unknown> = {
    document: doc,
    ...classes,
    localStorage: storage,
    sessionStorage: storage,
    innerWidth: 1024,
    innerHeight: 768,
    devicePixelRatio: 1,
    location: { href: 'http://localhost/', pathname: '/', search: '', hash: '', origin: 'http://localhost', protocol: 'http:', host: 'localhost' },
    history: { pushState() {}, replaceState() {}, back() {}, state: null },
    matchMedia: media,
    getComputedStyle: computed,
    getSelection: () => ({ rangeCount: 0, removeAllRanges() {}, addRange() {} }),
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
    scrollTo() {},
    open: () => null,
  }
  const events = new Target()
  const win: Record<string, unknown> = new Proxy(base, {
    get(t, k: string) {
      if (k === 'addEventListener' || k === 'removeEventListener' || k === 'dispatchEvent') return (events[k] as (...a: unknown[]) => unknown).bind(events)
      if (k === 'window' || k === 'self' || k === 'globalThis') return win
      if (k in t) return t[k]
      const g = (globalThis as Record<string, unknown>)[k]
      return typeof g === 'function' && !/^[A-Z]/.test(k) ? (g as (...a: unknown[]) => unknown).bind(globalThis) : g
    },
  })
  doc.defaultView = win
  doc.windowEvents = events

  // what goes on globalThis, put back by `uninstall`
  const globals: Record<string, unknown> = {
    window: win,
    document: doc,
    IS_REACT_ACT_ENVIRONMENT: true,
    ...classes,
    localStorage: storage,
    sessionStorage: storage,
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
    getComputedStyle: computed,
    matchMedia: media,
  }
  const saved = new Map<string, PropertyDescriptor | undefined>()
  for (const [k, v] of Object.entries(globals)) {
    saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k))
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
  }

  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const roots: Array<{ unmount(): void }> = []
  const run = async (fn: () => unknown) => {
    await act(async () => {
      await fn()
    })
  }
  return {
    document: doc,
    window: win,
    act: run,
    async mount(el) {
      const container = doc.createElement('div')
      doc.body.appendChild(container)
      const root = createRoot(container as unknown as Element)
      roots.push(root)
      let live = true
      await run(() => root.render(el as never))
      return {
        container,
        render: (next) => run(() => root.render(next as never)),
        async unmount() {
          if (!live) return
          live = false
          await run(() => root.unmount())
          container.remove()
        },
      }
    },
    async press(el) {
      await run(() => {
        el.focus()
        el.dispatchEvent(new MiniEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
        el.click()
      })
    },
    async until(cond, ms = 4000) {
      const end = Date.now() + ms
      while (!cond()) {
        if (Date.now() > end) throw new Error('mini-dom: timed out waiting for the page')
        await run(() => new Promise((r) => setTimeout(r, 5)))
      }
      // one more turn inside act, so what the condition's own cause still has queued (a `.finally`, a status line) lands
      await run(() => new Promise((r) => setTimeout(r, 5)))
    },
    async uninstall() {
      for (const r of roots) {
        try {
          await run(() => r.unmount())
        } catch {
          // already gone
        }
      }
      await new Promise((r) => setTimeout(r, 20))
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(globalThis, k, d)
        else delete (globalThis as Record<string, unknown>)[k]
      }
    },
  }
}
