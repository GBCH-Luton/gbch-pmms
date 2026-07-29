// Applied at every photo-upload site in this app before the file reaches
// Supabase Storage, to keep storage usage down as real usage grows. Pure
// Canvas API, no new dependency -- matches this app's existing
// minimal-dependency pattern.
//
// Self-selects on the file's real MIME type, not which bucket/feature it
// belongs to -- some upload sites (property-docs, and the compliance-media
// flows in ticket-photos) genuinely handle PDFs or videos alongside
// images, and those must pass through completely unchanged.
export async function compressImage(file, { maxDimension = 1600, quality = 0.8 } = {}) {
  if (!file.type.startsWith('image/')) return file

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // Corrupt/unsupported image -- never let compression block a real upload.
    return file
  }

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) return file

  // Always re-encoded as JPEG when compression actually runs -- every
  // image site in this app is a real-world photo (ticket/property/
  // garden/asset/compliance evidence), never something needing
  // transparency or lossless output.
  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], newName, { type: 'image/jpeg' })
}
