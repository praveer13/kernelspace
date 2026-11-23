import { expect, test } from '@playwright/test'

// A figure's node text is SVG text at a fixed size in a 100-wide viewBox, with no fitting: a label wider than the
// room around its node runs off the figure or over its neighbour. Measure the real boxes.
test.use({ viewport: { width: 1280, height: 900 } })

for (const lesson of ['t4.l3', 't5.l5', 't5.l6', 't5.l7']) {
  test(`every figure text in ${lesson} lies inside its viewBox`, async ({ page }) => {
    await page.goto(`/lesson/${lesson}`)
    const figures = page.locator('figure svg[role="img"]')
    await expect(figures.first()).toBeAttached()
    await page.evaluate(() => document.fonts.ready)
    const count = await figures.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const out = await figures.nth(i).evaluate((svg: SVGSVGElement) => {
        const vb = svg.viewBox.baseVal
        const bad: string[] = []
        for (const t of Array.from(svg.querySelectorAll('text'))) {
          const b = (t as SVGTextElement).getBBox()
          if (b.x < vb.x - 0.05 || b.y < vb.y - 0.05 || b.x + b.width > vb.x + vb.width + 0.05 || b.y + b.height > vb.y + vb.height + 0.05)
            bad.push(`${t.textContent}: x ${b.x.toFixed(1)}..${(b.x + b.width).toFixed(1)}, y ${b.y.toFixed(1)}..${(b.y + b.height).toFixed(1)}`)
        }
        return bad
      })
      expect(out, `${lesson} figure ${i + 1}`).toEqual([])
    }
  })
}

// The renderer paints edges first, then each node's rect with an opaque fill, in node order: an edge label under a
// box is hidden, and node text over another node's box is drawn across it or hidden by it. A node drawn on top of an
// earlier node it overlaps (a region on a frontier) may carry its text over that node.
for (const lesson of ['t1.l3', 't5.l8', 't6.l4', 't6.l10']) {
  test(`no figure text in ${lesson} lies over another node's box`, async ({ page }) => {
    await page.goto(`/lesson/${lesson}`)
    const figures = page.locator('figure svg[role="img"]')
    await expect(figures.first()).toBeAttached()
    await page.evaluate(() => document.fonts.ready)
    const count = await figures.count()
    for (let i = 0; i < count; i++) {
      const out = await figures.nth(i).evaluate((svg: SVGSVGElement) => {
        const box = (b: DOMRect) => [b.x, b.y, b.x + b.width, b.y + b.height]
        const over = (a: number[], b: number[]) => a[0] < b[2] - 0.05 && b[0] < a[2] - 0.05 && a[1] < b[3] - 0.05 && b[1] < a[3] - 0.05
        const rects = Array.from(svg.querySelectorAll('rect')).map((r) => box(r.getBBox()))
        const nodeRects = Array.from(svg.querySelectorAll('rect'))
        const bad: string[] = []
        for (const t of Array.from(svg.querySelectorAll('text'))) {
          const tb = box((t as SVGTextElement).getBBox())
          const own = t.parentElement?.querySelector('rect') ?? null
          const ownIndex = own ? nodeRects.indexOf(own) : -1
          rects.forEach((r, j) => {
            if (j === ownIndex) return
            if (ownIndex >= 0 && j < ownIndex && over(rects[ownIndex], r)) return
            if (over(tb, r)) bad.push(`${t.textContent} over box ${j + 1}`)
          })
        }
        return bad
      })
      expect(out, `${lesson} figure ${i + 1}`).toEqual([])
    }
  })
}
