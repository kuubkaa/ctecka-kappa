import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { FAKE_CAMERA_CODE, FAKE_CAMERA_Y4M } from './fake-camera'
import { barcodeY4m } from './y4m'

/** Chromium needs the fake-camera video on disk before it launches. */
export default function globalSetup() {
  mkdirSync(dirname(FAKE_CAMERA_Y4M), { recursive: true })
  writeFileSync(FAKE_CAMERA_Y4M, barcodeY4m(FAKE_CAMERA_CODE))
}
