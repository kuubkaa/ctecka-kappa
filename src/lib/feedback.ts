/**
 * Confirmation that a scan landed.
 *
 * The user is looking at the barcode, not at the phone, and a warehouse is loud.
 * So the confirmation fires on three channels at once — sound, vibration, and a
 * full-screen flash — on the assumption that any one of them may be missed.
 */

let ctx: AudioContext | null = null

/**
 * Must be called from a user gesture (the Skenovat tap).
 *
 * iOS starts every AudioContext suspended and only a gesture can resume it. Create
 * it inside the detect loop instead and the beep is silently absent on iPhone —
 * the exact failure the user would report as "it doesn't tell me anything".
 */
export function primeAudio(): void {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    // Audio is a bonus channel; vibration and the flash carry on without it.
  }
}

export function releaseAudio(): void {
  void ctx?.close().catch(() => {})
  ctx = null
}

function tone(startAt: number, freq: number, duration: number, gainValue: number): void {
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square' // Cuts through background noise better than a sine.
  osc.frequency.value = freq
  osc.connect(gain)
  gain.connect(ctx.destination)
  // Ramp instead of a hard stop — an abrupt cut clicks and sounds like a glitch.
  gain.gain.setValueAtTime(gainValue, startAt)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  osc.start(startAt)
  osc.stop(startAt + duration)
}

/** Counted an item: a rising two-tone chirp. Deliberately unlike any system sound. */
export function scanSuccess(): void {
  // A double pulse is noticeable through a glove where one short buzz is not.
  navigator.vibrate?.([40, 50, 40])
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
  const t = ctx.currentTime
  tone(t, 990, 0.07, 0.2)
  tone(t + 0.085, 1480, 0.11, 0.2)
}

/** Unknown code: a lower, flatter note, so "needs your attention" sounds different. */
export function scanUnknown(): void {
  navigator.vibrate?.([140])
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
  const t = ctx.currentTime
  tone(t, 620, 0.16, 0.2)
}
