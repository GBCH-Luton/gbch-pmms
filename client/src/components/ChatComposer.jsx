import { useState, useRef } from 'react'

// Shared by AdminTeamChat.jsx and BuilderDashboard.jsx's Team Chat view.
// Mentions are tracked structurally as you pick them from the dropdown
// (pendingMentions), not parsed back out of the "@Name" text afterward --
// far more reliable than matching partial/colliding names after the fact.
export default function ChatComposer({ members, onSend, sending, placeholder, sendButtonStyle, inputStyle }) {
  const [text, setText] = useState('')
  const [pendingMentions, setPendingMentions] = useState([])
  const [mentionQuery, setMentionQuery] = useState(null) // null = picker closed
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const inputRef = useRef(null)
  const photoInputRef = useRef(null)

  function handlePhotoPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
    e.target.value = '' // lets picking the same file again re-trigger onChange
  }

  function removePhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(null)
    setPhotoPreview(null)
  }

  function handleChange(e) {
    const value = e.target.value
    setText(value)

    const cursor = e.target.selectionStart
    const upToCursor = value.slice(0, cursor)
    const atIndex = upToCursor.lastIndexOf('@')
    if (atIndex === -1 || /\s/.test(upToCursor.slice(atIndex + 1))) {
      setMentionQuery(null)
      return
    }
    setMentionQuery(upToCursor.slice(atIndex + 1).toLowerCase())
  }

  function pickMention(member) {
    const cursor = inputRef.current?.selectionStart ?? text.length
    const upToCursor = text.slice(0, cursor)
    const atIndex = upToCursor.lastIndexOf('@')
    const before = text.slice(0, atIndex)
    const after = text.slice(cursor)
    const inserted = `@${member.name} `
    setText(`${before}${inserted}${after}`)
    setPendingMentions(prev => prev.some(m => m.id === member.id) ? prev : [...prev, member])
    setMentionQuery(null)

    // setSelectionRange has to run after React re-renders the input with
    // the new value -- doing it in the same tick as setText() would still
    // see the OLD value/length, landing the cursor in the wrong place
    // (found live: it defaulted to the very start of the text, making it
    // unclear where typing would continue from).
    const newCursorPos = before.length + inserted.length
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(newCursorPos, newCursorPos)
    })
  }

  function handleSend() {
    const body = text.trim()
    if (!body && !photoFile) return
    // Only mention people whose "@Name" actually still appears in the text --
    // if someone picked a mention then deleted it, don't notify them.
    const mentionedIds = pendingMentions.filter(m => body.includes(`@${m.name}`)).map(m => m.id)
    onSend(body, mentionedIds, photoFile)
    setText('')
    setPendingMentions([])
    setMentionQuery(null)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(null)
    setPhotoPreview(null)
  }

  const matches = mentionQuery === null
    ? []
    : members.filter(m => m.name.toLowerCase().includes(mentionQuery)).slice(0, 6)

  return (
    <div style={{ position: 'relative' }}>
      {mentionQuery !== null && matches.length > 0 && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: '6px',
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
          boxShadow: '0 8px 20px rgba(0,0,0,0.12)', overflow: 'hidden', minWidth: '160px', zIndex: 20,
        }}>
          {matches.map(m => (
            <button
              key={m.id}
              onClick={() => pickMention(m)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                background: 'none', border: 'none', borderBottom: '1px solid #f1f5f9',
                fontSize: '13px', fontWeight: 600, color: '#0f172a', cursor: 'pointer',
              }}
            >
              @{m.name}
            </button>
          ))}
        </div>
      )}
      {photoPreview && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <img src={photoPreview} alt="" style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
          <button
            onClick={removePhoto}
            aria-label="Remove photo"
            style={{ background: '#f1f5f9', border: 'none', borderRadius: '999px', width: '22px', height: '22px', fontSize: '12px', color: '#64748b', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoPick} style={{ display: 'none' }} />
        <button
          onClick={() => photoInputRef.current?.click()}
          aria-label="Attach photo"
          style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', flexShrink: 0, padding: '4px' }}
        >
          📷
        </button>
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={handleChange}
          onKeyDown={(e) => { if (e.key === 'Enter' && !sending) handleSend() }}
          placeholder={placeholder || 'Message... (type @ to mention someone)'}
          style={inputStyle}
        />
        <button onClick={handleSend} disabled={sending || (!text.trim() && !photoFile)} style={sendButtonStyle} aria-label="Send">
          {sending ? '⋯' : '➤'}
        </button>
      </div>
    </div>
  )
}
