import { expect, test } from '@playwright/test'
import { encode } from 'uqr'
import { encodeEan13, withCheckDigit } from './ean13'
import { qrPngDataUrl } from './qr'

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

/**
 * Goods that carry no EAN get a QR with the firm's own article code on it.
 *
 * Two things must hold and neither is obvious: `qr_code` has to survive in FORMATS
 * (dropping it there is a one-word edit that nothing else would catch), and the
 * payload has to come back byte-for-byte. Case is the sharp edge — "311283-194-M"
 * arriving as "311283-194-m" would silently open a second line for one product.
 */
test('the engine reads an internal article code from a QR, case intact', async ({ page }) => {
  const code = '311283-194-M'
  const png = await qrPngDataUrl(code)

  await page.goto('./e2e/harness.html')
  await page.waitForFunction(() => (window as any).__harnessReady === true)

  const decoded = await page.evaluate(async (src) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const canvas = document.createElement('canvas')
    // Quiet zone. A QR flush to the edge is unreadable, and a test that proved that
    // would only be testing the test.
    canvas.width = img.width + 40
    canvas.height = img.height + 40
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 20, 20)
    return (window as any).__detect(canvas)
  }, png)

  expect(decoded).toEqual([{ value: code, format: 'qr_code' }])
})

/**
 * The labels we print must be readable by the scanner we ship — the two halves of the
 * loop, and nothing else checks that they meet.
 *
 * The encoder (uqr) is not the decoder (zxing), so this is a real interoperability
 * test rather than a library agreeing with itself. Every shape of code the app can hold
 * is covered, including the synthetic id of loose goods: that one never appears in
 * print, so a QR is the only way those goods are ever scannable.
 *
 * labels.spec.ts pins the other half — that the PDF contains exactly this matrix.
 */
test('QR codes we generate for labels are read by the scanner we ship', async ({ page }) => {
  const codes = [
    '311283-194-M', // internal article code
    '309244', // …which may be just the type, with no colour or size
    '8594001020304', // a plain EAN, for shelf labels
    'bez-kodu:0f8b1c2e-1111-4222-8333-444455556666', // loose goods
  ]

  await page.goto('./e2e/harness.html')
  await page.waitForFunction(() => (window as any).__harnessReady === true)

  for (const code of codes) {
    const { size, data } = encode(code, { border: 4, ecc: 'M' })
    const decoded = await page.evaluate(
      ({ size, data, scale }) => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size * scale
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#000'
        for (let y = 0; y < size; y++)
          for (let x = 0; x < size; x++)
            if (data[y]![x]) ctx.fillRect(x * scale, y * scale, scale, scale)
        return (window as any).__detect(canvas)
      },
      { size, data, scale: 8 },
    )
    expect(decoded, `QR pro ${code}`).toEqual([{ value: code, format: 'qr_code' }])
  }
})
