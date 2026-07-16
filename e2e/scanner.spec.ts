import { expect, test } from '@playwright/test'
import { encodeEan13, withCheckDigit } from './ean13'

/**
 * Proves the scanning engine actually works: that the ~1 MB .wasm we bundle loads
 * from our own origin (no CDN, so it works in a warehouse with no signal) and
 * decodes a real EAN-13.
 *
 * We feed the detector a canvas rather than a camera. getUserMedia is thin plumbing;
 * the part that can silently break — wasm loading, version lockstep, format config —
 * is all downstream of it and is exactly what this covers.
 */
test('bundled wasm engine decodes an EAN-13 with no network', async ({ page }) => {
  const code = withCheckDigit('544900000099')
  const pattern = encodeEan13(code)

  // Record every request so we can prove the engine came from us, not a CDN.
  const external: string[] = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (url.host !== 'localhost:4173') external.push(req.url())
  })

  await page.goto('./e2e/harness.html')
  await page.waitForFunction(() => (window as any).__harnessReady === true)

  const decoded = await page.evaluate(
    async ({ pattern, moduleWidth, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = pattern.length * moduleWidth + 40 // quiet zone on both sides
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#000'
      for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] === '1') ctx.fillRect(20 + i * moduleWidth, 10, moduleWidth, height - 20)
      }
      return (window as any).__detect(canvas)
    },
    { pattern, moduleWidth: 3, height: 140 },
  )

  expect(decoded).toEqual([{ value: code, format: 'ean_13' }])

  // A CDN fallback would pass the decode above and then fail on a phone with no
  // signal — which is where this app lives.
  expect(external).toEqual([])
})
