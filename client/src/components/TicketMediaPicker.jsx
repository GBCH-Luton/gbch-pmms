import { useEffect, useMemo, useState } from 'react'
import { COLORS } from '../lib/colors'

// Multi-file photo/video picker shared by every "log a ticket" form
// (AdminRaiseTicket.jsx, SubmitterDashboard.jsx, BuilderDashboard.jsx) --
// replaces what used to be a single hidden <input type="file"> per form.
// The caller just owns a File[] in state; this renders the button, the
// thumbnail grid, and per-file remove buttons.
//
// Broken-file detection (ticket #360, Aamir): a HEIC photo from an iPhone
// used to upload fine (no error) but render as a broken image everywhere
// afterward -- looked OK in his phone's own gallery, broken in PMMS,
// because no browser can decode HEIC in an <img> tag. compressImage() now
// converts/rejects HEIC at upload time (see lib/imageCompression.js), but
// catching it here too, at selection time, means the caller's Submit button
// can refuse to even try -- the same `<img>` decode failure that made the
// bug visible after the fact fires its onError just as reliably right now,
// before anything's uploaded.
export default function TicketMediaPicker({ files, onChange, inputId, onBrokenChange }) {
  const previews = useMemo(() => files.map(f => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach(p => URL.revokeObjectURL(p)), [previews])

  const [brokenFiles, setBrokenFiles] = useState(() => new Set())

  // Keyed by file identity, not index -- indices shift on remove, a stale
  // index would keep flagging (or stop flagging) the wrong file.
  useEffect(() => {
    setBrokenFiles(prev => {
      const next = new Set([...prev].filter(f => files.includes(f)))
      return next.size === prev.size ? prev : next
    })
  }, [files])

  useEffect(() => { onBrokenChange?.(brokenFiles.size > 0) }, [brokenFiles, onBrokenChange])

  function handlePick(e) {
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    onChange([...files, ...picked])
    e.target.value = ''
  }

  function removeAt(idx) {
    const removed = files[idx]
    onChange(files.filter((_, i) => i !== idx))
    setBrokenFiles(prev => {
      if (!prev.has(removed)) return prev
      const next = new Set(prev)
      next.delete(removed)
      return next
    })
  }

  function markBroken(file) {
    setBrokenFiles(prev => (prev.has(file) ? prev : new Set(prev).add(file)))
  }

  return (
    <div>
      <input
        type="file"
        accept="image/*,video/*"
        multiple
        id={inputId}
        onChange={handlePick}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        onClick={() => document.getElementById(inputId).click()}
        style={{ width: '100%', height: '44px', borderRadius: '10px', border: `2px dashed ${COLORS.slate300}`, background: COLORS.white, color: COLORS.slate500, fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }}
      >
        {files.length > 0 ? `+ Add another photo or video (${files.length} added)` : 'Add a photo or video'}
      </button>

      {brokenFiles.size > 0 && (
        <p style={{ margin: '8px 0 0 0', fontSize: '12.5px', fontWeight: 700, color: COLORS.red600 }}>
          ⚠ {brokenFiles.size === 1 ? "One photo couldn't be loaded" : `${brokenFiles.size} photos couldn't be loaded`} (marked in red below) — remove it or try a different photo before submitting.
        </p>
      )}

      {files.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px', marginTop: '10px' }}>
          {files.map((file, idx) => {
            const isBroken = brokenFiles.has(file)
            return (
            <div key={idx} style={{ position: 'relative' }}>
              {file.type.startsWith('video') ? (
                <video src={previews[idx]} style={{ width: '100%', height: '90px', objectFit: 'cover', borderRadius: '8px', display: 'block' }} />
              ) : isBroken ? (
                <div style={{ width: '100%', height: '90px', borderRadius: '8px', border: `2px solid ${COLORS.red600}`, background: COLORS.red50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', boxSizing: 'border-box' }}>
                  <span style={{ fontSize: '18px' }}>⚠</span>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: COLORS.red600, textAlign: 'center', padding: '0 4px' }}>Couldn't load</span>
                </div>
              ) : (
                <img src={previews[idx]} alt="" onError={() => markBroken(file)} style={{ width: '100%', height: '90px', objectFit: 'cover', borderRadius: '8px', display: 'block' }} />
              )}
              <button
                type="button"
                onClick={() => removeAt(idx)}
                style={{ position: 'absolute', top: '4px', right: '4px', width: '22px', height: '22px', borderRadius: '50%', border: 'none', background: 'rgba(15,23,42,0.65)', color: COLORS.white, fontSize: '12px', fontWeight: 700, cursor: 'pointer', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
