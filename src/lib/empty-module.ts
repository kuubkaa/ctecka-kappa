/**
 * Stub standing in for jsPDF's optional dependencies (html2canvas, dompurify, canvg).
 *
 * jsPDF lazily imports them for `doc.html()` and inline-SVG rendering. This app builds
 * its PDF from text and autoTable only, so those paths never run — but the bundler
 * still emits ~380 kB of them and the service worker precaches every byte onto a phone
 * that will never execute it. See resolve.alias in vite.config.ts.
 *
 * If anything ever calls doc.html(), it will fail here rather than silently — which is
 * the intent. Drop the alias and this file at that point.
 */
export default undefined
