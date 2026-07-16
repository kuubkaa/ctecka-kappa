/**
 * Renders the app icon (public/favicon.svg) into the PNG sizes a home-screen
 * install needs. Android's manifest and iOS's apple-touch-icon both want raster.
 *
 * Run with `npm run icons` after editing the SVG. Output is committed.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const svg = await readFile(join(PUB, 'favicon.svg'))

for (const size of [192, 512]) {
  const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()
  await writeFile(join(PUB, `icon-${size}.png`), png)
  console.log(`✓ icon-${size}.png (${(png.length / 1024).toFixed(1)} kB)`)
}

// iOS ignores the manifest and reads this tag; 180px is the current Retina size.
const touch = await sharp(svg, { density: 384 }).resize(180, 180).png().toBuffer()
await writeFile(join(PUB, 'apple-touch-icon.png'), touch)
console.log(`✓ apple-touch-icon.png (${(touch.length / 1024).toFixed(1)} kB)`)
