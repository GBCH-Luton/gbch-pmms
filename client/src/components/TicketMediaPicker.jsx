import { useEffect, useMemo } from 'react'
import { COLORS } from '../lib/colors'

// Multi-file photo/video picker shared by every "log a ticket" form
// (AdminRaiseTicket.jsx, SubmitterDashboard.jsx, BuilderDashboard.jsx) --
// replaces what used to be a single hidden <input type="file"> per form.
// The caller just owns a File[] in state; this renders the button, the
// thumbnail grid, and per-file remove buttons.
export default function TicketMediaPicker({ files, onChange, inputId }) {
  const previews = useMemo(() => files.map(f => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach(p => URL.revokeObjectURL(p)), [previews])

  function handlePick(e) {
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    onChange([...files, ...picked])
    e.target.value = ''
  }

  function removeAt(idx) {
    onChange(files.filter((_, i) => i !== idx))
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

      {files.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px', marginTop: '10px' }}>
          {files.map((file, idx) => (
            <div key={idx} style={{ position: 'relative' }}>
              {file.type.startsWith('video') ? (
                <video src={previews[idx]} style={{ width: '100%', height: '90px', objectFit: 'cover', borderRadius: '8px', display: 'block' }} />
              ) : (
                <img src={previews[idx]} alt="" style={{ width: '100%', height: '90px', objectFit: 'cover', borderRadius: '8px', display: 'block' }} />
              )}
              <button
                type="button"
                onClick={() => removeAt(idx)}
                style={{ position: 'absolute', top: '4px', right: '4px', width: '22px', height: '22px', borderRadius: '50%', border: 'none', background: 'rgba(15,23,42,0.65)', color: COLORS.white, fontSize: '12px', fontWeight: 700, cursor: 'pointer', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
