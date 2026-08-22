import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { COLORS } from '../lib/colors'

const inputStyle = { width: '100%', height: '44px', padding: '0 36px 0 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontWeight: 500, boxSizing: 'border-box', background: COLORS.white }
const clearBtnStyle = { position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', width: '24px', height: '24px', border: 'none', background: 'none', color: COLORS.slate400, fontSize: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const optionStyle = { display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: `1px solid ${COLORS.slate100}`, background: 'none', color: COLORS.slate900, fontSize: '13px', fontWeight: 500, cursor: 'pointer' }

function labelFor(property) {
  return `${property.address}${property.high_vulnerability ? ' ⚠️ [HIGH VULNERABILITY]' : ''}`
}

// Type-to-filter replacement for a plain <select> of properties -- a native
// select's "type a letter to jump" only matches one option at a time and
// only from the start, which doesn't scale once the property list is long.
// This filters the whole list by substring as the user types.
//
// The dropdown is rendered via a portal into document.body, positioned with
// `fixed` coordinates read from the input's own bounding rect. It can't just
// be an absolutely-positioned child here: the ticket form's outer card uses
// `overflow: hidden` (to get rounded corners on the whole card), which would
// otherwise clip the dropdown whenever this is the only/last visible step.
export default function PropertySearchSelect({ properties, value, onChange, placeholder = 'Select a property...', badgeFor }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const wrapperRef = useRef(null)
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)
  const blurTimeoutRef = useRef(null)

  const selected = properties.find(p => String(p.id) === String(value))

  function updateRect() {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect())
  }

  useEffect(() => {
    if (!open) return
    updateRect()
    window.addEventListener('scroll', updateRect, true)
    window.addEventListener('resize', updateRect)
    return () => {
      window.removeEventListener('scroll', updateRect, true)
      window.removeEventListener('resize', updateRect)
    }
  }, [open])

  useEffect(() => {
    function handleClickOutside(e) {
      const clickedWrapper = wrapperRef.current?.contains(e.target)
      const clickedDropdown = dropdownRef.current?.contains(e.target)
      if (!clickedWrapper && !clickedDropdown) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => () => clearTimeout(blurTimeoutRef.current), [])

  const filtered = query.trim()
    ? properties.filter(p => p.address.toLowerCase().includes(query.trim().toLowerCase()))
    : properties

  function openDropdown() {
    updateRect()
    setOpen(true)
  }

  function selectProperty(property) {
    onChange(String(property.id))
    setQuery('')
    setOpen(false)
  }

  function clearSelection(e) {
    e.stopPropagation()
    onChange('')
    setQuery('')
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={open ? query : (selected ? labelFor(selected) : '')}
        onChange={(e) => { setQuery(e.target.value); openDropdown() }}
        onFocus={() => { setQuery(''); openDropdown() }}
        onClick={openDropdown}
        onBlur={() => { blurTimeoutRef.current = setTimeout(() => setOpen(false), 150) }}
        onKeyDown={(e) => { if (e.key === 'Escape') e.target.blur() }}
        placeholder={placeholder}
        style={inputStyle}
      />
      {selected && !open && (
        <button type="button" onClick={clearSelection} title="Clear selection" style={clearBtnStyle}>✕</button>
      )}
      {open && rect && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width,
            background: COLORS.white, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px',
            boxShadow: '0 8px 24px rgba(15,23,42,0.12)', maxHeight: '260px', overflowY: 'auto', zIndex: 1000,
          }}
        >
          {filtered.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No matching properties</div>
          )}
          {filtered.map(property => {
            const badge = badgeFor?.(property)
            return (
              <button
                type="button"
                key={property.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectProperty(property)}
                style={{ ...optionStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}
              >
                <span>{labelFor(property)}</span>
                {badge && (
                  <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '3px 8px', borderRadius: '999px', background: badge.bg, color: badge.color }}>
                    {badge.label}
                  </span>
                )}
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </div>
  )
}
