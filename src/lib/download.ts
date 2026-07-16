/**
 * Lives apart from pdf.ts on purpose: that module drags in jsPDF and the embedded
 * font (~430 kB) and is deliberately lazy-loaded. Importing a one-line helper from
 * it would pull the whole thing into the startup bundle.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately can cancel the download on some mobile browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
