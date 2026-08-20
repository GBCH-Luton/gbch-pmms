// Applied at every photo-upload site in this app before the file reaches
// Supabase Storage, to keep storage usage down as real usage grows. Pure
// Canvas API, no new dependency -- matches this app's existing
// minimal-dependency pattern.
//
// Self-selects on the file's real MIME type, not which bucket/feature it
// belongs to -- some upload sites (property-docs, and the compliance-media
// flows in ticket-photos) genuinely handle PDFs or videos alongside
// images, and those must pass through completely unchanged.
//
// iPhones save camera photos as HEIC by default. No desktop/Android browser
// (and no Safari <img> tag either) can decode HEIC, so a HEIC file upload
// used to hit createImageBitmap() below, fail silently, and get uploaded
// completely unconverted -- looked fine in the sender's own phone gallery
// (the OS decodes HEIC natively there) but rendered as a broken image
// everywhere inside PMMS. Found live via ticket #360 (Aamir). Converting to
// JPEG via heic2any (a WASM build of libheif, the same decoder iOS itself
// uses) before the existing resize/compress pass fixes this at the one
// choke point every upload site already calls through.
const HEIC_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']

function looksLikeHeic(file) {
  return HEIC_TYPES.includes(file.type) || /\.(heic|heif)$/i.test(file.name || '')
}

export async function compressImage(file, { maxDimension = 1600, quality = 0.8 } = {}) {
  if (!file.type.startsWith('image/') && !looksLikeHeic(file)) return file

  let workingFile = file
  if (looksLikeHeic(file)) {
    try {
      // Dynamic import -- heic2any bundles a ~1.4MB WASM build of libheif,
      // and this app is otherwise careful about bundle size (see the
      // lazy-loaded admin pages). A static import would ship that to every
      // visitor on first load; this way it's only ever fetched the moment
      // someone actually picks a HEIC file.
      const { default: heic2any } = await import('heic2any')
      const result = await heic2any({ blob: file, toType: 'image/jpeg', quality })
      const blob = Array.isArray(result) ? result[0] : result
      workingFile = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
    } catch {
      throw new Error('This photo couldn\'t be converted (unreadable HEIC file). Try a different photo, or turn off "High Efficiency" in your phone\'s camera settings so it saves as JPEG instead.')
    }
  }

  let bitmap
  try {
    bitmap = await createImageBitmap(workingFile)
  } catch {
    // Previously returned the original file unchanged here -- silently
    // uploading a photo the browser itself admits it can't decode, which
    // is exactly how the HEIC bug above went unnoticed until it reached a
    // real ticket. An image that fails to decode now is a genuine problem
    // (corrupt file, camera write error, unsupported format), not
    // something safe to wave through -- callers should catch this and
    // ask the user to pick a different photo rather than uploading it blind.
    throw new Error('This photo appears to be broken or unreadable. Try a different photo.')
  }

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) return workingFile

  // Always re-encoded as JPEG when compression actually runs -- every
  // image site in this app is a real-world photo (ticket/property/
  // garden/asset/compliance evidence), never something needing
  // transparency or lossless output.
  const newName = workingFile.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], newName, { type: 'image/jpeg' })
}
