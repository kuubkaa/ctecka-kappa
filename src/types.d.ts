/**
 * The torch (flashlight) constraint is real and widely shipped on Android, but it
 * lives in the Image Capture spec and TypeScript's DOM lib doesn't declare it.
 * Declaring it here beats an `as any` at each call site.
 */
declare global {
  interface MediaTrackConstraintSet {
    torch?: boolean
  }
  interface MediaTrackCapabilities {
    torch?: boolean
  }
}

export {}
