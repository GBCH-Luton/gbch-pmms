// Video equivalent of imageCompression.js -- applied to every video before
// it reaches ticket-photos, since a raw phone clip (often 100MB+ for well
// under a minute) is the direct cause of uploads that "take forever" on
// site wifi/mobile data. No new dependency: built entirely on the
// browser's own <video>/<canvas>/MediaRecorder APIs, the same trio
// real-world in-browser video tools use instead of bundling something
// like ffmpeg.wasm, matching this app's existing minimal-dependency
// pattern (see imageCompression.js).
//
// Re-encoding runs in real time -- the source has to actually play through
// once to be re-captured frame by frame, so a 40s clip takes ~40s to
// compress. That cost is deliberate: it happens locally before the upload
// even starts, and the output is typically a fraction of the original
// size, which is a much bigger net win than the extra wait on any
// connection slower than fast wifi.
//
// Self-selects on MIME type and silently falls back to the original file
// whenever the browser doesn't support the APIs involved (Safari/iOS has
// historically had gaps in MediaRecorder/captureStream support -- same
// "not available everywhere, that's expected" situation as
// VoiceInputButton) or whenever anything goes wrong -- never let
// compression block a real upload, same rule imageCompression.js follows.
export async function compressVideo(file, { maxDimension = 1280, videoBitsPerSecond = 1_500_000, onProgress } = {}) {
  if (!file.type.startsWith('video/')) return file
  if (typeof MediaRecorder === 'undefined') return file

  const probe = document.createElement('video')
  const canCapture = typeof probe.captureStream === 'function' || typeof probe.mozCaptureStream === 'function'
  if (!canCapture || typeof document.createElement('canvas').captureStream !== 'function') return file

  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => { if (!settled) { settled = true; cleanup(); resolve(result) } }

    const video = document.createElement('video')
    video.muted = true // decoded audio is still captured via captureStream() below; this only silences local playback
    video.playsInline = true
    video.preload = 'auto'
    const objectUrl = URL.createObjectURL(file)
    video.src = objectUrl

    let rafId, watchdog
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl)
      if (rafId) cancelAnimationFrame(rafId)
      if (watchdog) clearTimeout(watchdog)
    }

    video.onerror = () => finish(file)

    video.onloadedmetadata = async () => {
      const srcW = video.videoWidth, srcH = video.videoHeight
      if (!srcW || !srcH || !isFinite(video.duration)) { finish(file); return }

      const scale = Math.min(1, maxDimension / Math.max(srcW, srcH))
      const width = Math.round(srcW * scale)
      const height = Math.round(srcH * scale)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')

      let sourceStream
      try {
        sourceStream = video.captureStream ? video.captureStream() : video.mozCaptureStream()
      } catch {
        finish(file); return
      }

      const canvasStream = canvas.captureStream(30)
      const combined = new MediaStream([...canvasStream.getVideoTracks(), ...sourceStream.getAudioTracks()])

      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find(t => MediaRecorder.isTypeSupported(t))
      if (!mimeType) { finish(file); return }

      let recorder
      try {
        recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond })
      } catch {
        finish(file); return
      }

      const chunks = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' })
        // Only keep the re-encode if it actually shrank the file -- an
        // already-compressed clip can come out larger after re-encoding.
        if (blob.size === 0 || blob.size >= file.size) { finish(file); return }
        onProgress?.(100)
        const newName = file.name.replace(/\.[^.]+$/, '') + '.webm'
        finish(new File([blob], newName, { type: 'video/webm' }))
      }

      const drawFrame = () => {
        if (video.paused || video.ended || settled) return
        ctx.drawImage(video, 0, 0, width, height)
        if (onProgress && video.duration) onProgress(Math.min(99, Math.round((video.currentTime / video.duration) * 100)))
        rafId = requestAnimationFrame(drawFrame)
      }

      video.onended = () => { if (recorder.state !== 'inactive') recorder.stop() }

      // Backstop in case 'ended' never fires (corrupt/streamed source) --
      // never let a bad file hang the compression step forever.
      watchdog = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop() }, (video.duration * 1000) + 15000)

      recorder.start()
      try {
        await video.play()
      } catch {
        if (recorder.state !== 'inactive') recorder.stop()
        return
      }
      drawFrame()
    }
  })
}
