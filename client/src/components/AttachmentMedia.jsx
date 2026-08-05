// Ticket photo fields (photo_url, completion_photo_url, no_access_photo_url)
// have always allowed video too -- see ticket-photos bucket's own comment
// ("photos and videos") -- but every render site used a plain <img>,
// which silently shows a broken-image icon for a video file and offers no
// way to actually play it. This is the one place that decides image vs
// video and renders the right element; every ticket-photo display site
// should go through it rather than reaching for <img> directly.
const VIDEO_EXTENSION_PATTERN = /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i

export function isVideoAttachment(url) {
  if (!url) return false
  try {
    return VIDEO_EXTENSION_PATTERN.test(new URL(url).pathname)
  } catch {
    return VIDEO_EXTENSION_PATTERN.test(url)
  }
}

// controls=true (the default) makes a video playable in place -- the fix
// for "can't click to see the video". linkImages wraps a plain photo in a
// same-tab-safe link to view it full-size, matching how photo attachments
// already behaved in most of this app; set false for a small list-card
// thumbnail that was never clickable before either.
export default function AttachmentMedia({ url, alt = '', style, linkImages = true, controls = true }) {
  if (!url) return null

  if (isVideoAttachment(url)) {
    return <video src={url} controls={controls} muted={!controls} playsInline style={style} />
  }

  const img = <img src={url} alt={alt} style={style} />
  return linkImages ? <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>{img}</a> : img
}
