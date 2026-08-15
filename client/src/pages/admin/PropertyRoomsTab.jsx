// Rooms & Occupancy tab of the Property Profile. See
// scripts/add_pmms_property_rooms_tables.sql for the pmms.property_rooms /
// pmms.property_room_history tables this component depends on -- run it
// before using this tab.
//
// CREATE TABLE pmms.property_rooms (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   property_id uuid NOT NULL REFERENCES pmms.properties(id) ON DELETE CASCADE,
//   room_name text NOT NULL,
//   room_type text,
//   current_status text NOT NULL DEFAULT 'Occupied',
//   tenant_name text,
//   void_since date,
//   created_at timestamptz DEFAULT now()
// );
//
// CREATE TABLE pmms.property_room_history (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   room_id uuid NOT NULL REFERENCES pmms.property_rooms(id) ON DELETE CASCADE,
//   property_id uuid REFERENCES pmms.properties(id), -- exists on the live table but unused by this component; insertHistory() never sets it
//   action text NOT NULL,
//   action_date date NOT NULL,
//   tenant_name text,
//   notes text,
//   created_at timestamptz DEFAULT now()
// );
//
// Status-change history logging rule (see handleFormSave): switching
// Occupied -> Void or Void -> Occupied through the general Edit modal logs
// an automatic history row with action_date = today, regardless of what's
// typed into the Void Since field that same save -- the dedicated Mark as
// Void/Mark as Occupied buttons are the way to log a transition with a
// specific historical date. Editing a room without changing its status
// (e.g. just fixing the room name) never touches history. Creating a
// brand-new room also logs one starting-state entry ("Moved In" if
// created Occupied, "Room Added (Void)" if created Void), so history
// captures a room's full lifecycle from creation, not just later changes.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import {
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalLabelStyle, modalErrorStyle,
  modalCancelBtnStyle, modalConfirmBtnStyle, formatUKDate,
} from './shared'

const ROOM_TYPES = ['Bedroom', 'Bathroom', 'Kitchen', 'Living Room', 'Other']
const BED_TYPES = ['Single', 'Double', 'Twin', 'Bunk']

const STATUS_STYLES = {
  Occupied: { bg: COLORS.green100, color: COLORS.green600 },
  Void: { bg: COLORS.amber100, color: COLORS.amber600 },
}

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

async function insertHistory(roomId, propertyId, action, actionDate, tenantName, notes) {
  await supabase
    .schema('pmms')
    .from('property_room_history')
    .insert({ room_id: roomId, property_id: propertyId, action, action_date: actionDate, tenant_name: tenantName || null, notes: notes || null })
}

const emptyForm = { room_name: '', room_type: 'Bedroom', bed_type: '', current_status: 'Occupied', tenant_name: '', void_since: '' }

function RoomFormModal({ property, room, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (room) {
      setForm({
        room_name: room.room_name || '',
        room_type: room.room_type || 'Bedroom',
        bed_type: room.bed_type || '',
        current_status: room.current_status || 'Occupied',
        tenant_name: room.tenant_name || '',
        void_since: room.void_since || '',
      })
    } else {
      setForm(emptyForm)
    }
    setError('')
  }, [room])

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setError('')
    if (!form.room_name.trim()) { setError('Room Name is required.'); return }
    if (!form.bed_type) { setError('Bed Type is required.'); return }
    if (form.current_status === 'Occupied' && !form.tenant_name.trim()) { setError('Tenant Name is required for an occupied room.'); return }

    setSaving(true)

    const statusChanged = room && room.current_status !== form.current_status
    const today = todayIso()

    const payload = {
      property_id: property.id,
      room_name: form.room_name.trim(),
      room_type: form.room_type,
      bed_type: form.bed_type,
      current_status: form.current_status,
      tenant_name: form.current_status === 'Occupied' ? form.tenant_name.trim() : null,
      void_since: form.current_status === 'Void' ? (statusChanged ? today : (form.void_since || today)) : null,
      // Always reset the aging-alert dedup here -- whether the room is
      // (still) live-Void (re-arms alerting for this void period) or has
      // just been marked Occupied (keeps the column clean/never stale).
      void_alert_sent_at: null,
    }

    let result
    if (room) {
      result = await supabase.schema('pmms').from('property_rooms').update(payload).eq('id', room.id).select().single()
    } else {
      result = await supabase.schema('pmms').from('property_rooms').insert(payload).select().single()
    }

    if (result.error) { setSaving(false); setError(result.error.message); return }

    if (statusChanged) {
      if (form.current_status === 'Void') {
        await insertHistory(room.id, property.id, 'Moved Out', today, room.tenant_name, null)
      } else {
        await insertHistory(room.id, property.id, 'Moved In', today, form.tenant_name.trim(), null)
      }
    } else if (!room) {
      // Brand-new room -- log its starting state too, not just later status
      // changes, so history captures the room's full lifecycle from creation.
      if (form.current_status === 'Occupied') {
        await insertHistory(result.data.id, property.id, 'Moved In', today, form.tenant_name.trim(), null)
      } else {
        await insertHistory(result.data.id, property.id, 'Room Added (Void)', today, null, null)
      }
    }

    setSaving(false)
    onSaved(result.data)
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={modalCardStyle}>
        <p style={modalTitleStyle}>{room ? 'Edit Room' : 'Add Room'}</p>

        <p style={modalLabelStyle}>Room Name</p>
        <input type="text" value={form.room_name} onChange={(e) => set('room_name', e.target.value)} placeholder="e.g. Room 1, Master Bedroom" style={inputStyle} />

        <p style={modalLabelStyle}>Room Type</p>
        <select value={form.room_type} onChange={(e) => set('room_type', e.target.value)} style={inputStyle}>
          {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <p style={modalLabelStyle}>Bed Type</p>
        <select value={form.bed_type} onChange={(e) => set('bed_type', e.target.value)} style={inputStyle}>
          <option value="">Select bed type…</option>
          {BED_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <p style={modalLabelStyle}>Current Status</p>
        <select value={form.current_status} onChange={(e) => set('current_status', e.target.value)} style={inputStyle}>
          <option value="Occupied">Occupied</option>
          <option value="Void">Void</option>
        </select>

        {form.current_status === 'Occupied' && (
          <>
            <p style={modalLabelStyle}>Tenant Name</p>
            <input type="text" value={form.tenant_name} onChange={(e) => set('tenant_name', e.target.value)} style={inputStyle} />
          </>
        )}

        {form.current_status === 'Void' && (
          <>
            <p style={modalLabelStyle}>Void Since</p>
            <input type="date" value={form.void_since} onChange={(e) => set('void_since', e.target.value)} style={inputStyle} />
          </>
        )}

        {error && <p style={modalErrorStyle}>{error}</p>}

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button onClick={onClose} style={modalCancelBtnStyle}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ ...modalConfirmBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving...' : room ? 'Save changes' : 'Add Room'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MarkVoidModal({ room, onClose, onSaved }) {
  const [moveOutDate, setMoveOutDate] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    setError('')
    setSaving(true)

    const { data, error: updateError } = await supabase
      .schema('pmms')
      .from('property_rooms')
      .update({ current_status: 'Void', void_since: moveOutDate, tenant_name: null, void_alert_sent_at: null })
      .eq('id', room.id)
      .select()
      .single()

    if (updateError) { setSaving(false); setError(updateError.message); return }

    await insertHistory(room.id, room.property_id, 'Moved Out', moveOutDate, room.tenant_name, notes)

    setSaving(false)
    onSaved(data)
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalCardStyle, maxWidth: '380px' }}>
        <p style={modalTitleStyle}>Mark "{room.room_name}" as Void</p>

        <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: COLORS.slate500 }}>
          Bed Type: {room.bed_type
            ? <strong style={{ color: COLORS.slate900 }}>{room.bed_type}</strong>
            : <span style={{ color: COLORS.slate400, fontStyle: 'italic' }}>Not set</span>}
        </p>

        <p style={modalLabelStyle}>Move-out Date</p>
        <input type="date" value={moveOutDate} onChange={(e) => setMoveOutDate(e.target.value)} style={inputStyle} />

        <p style={modalLabelStyle}>Notes</p>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />

        {error && <p style={modalErrorStyle}>{error}</p>}

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button onClick={onClose} style={modalCancelBtnStyle}>Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            style={{ flex: 2, padding: '10px', background: COLORS.amber600, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving...' : 'Confirm Void'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MarkOccupiedModal({ room, onClose, onSaved }) {
  const [tenantName, setTenantName] = useState('')
  const [moveInDate, setMoveInDate] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    setError('')
    if (!tenantName.trim()) { setError('Tenant Name is required.'); return }

    setSaving(true)

    const { data, error: updateError } = await supabase
      .schema('pmms')
      .from('property_rooms')
      .update({ current_status: 'Occupied', tenant_name: tenantName.trim(), void_since: null, void_alert_sent_at: null })
      .eq('id', room.id)
      .select()
      .single()

    if (updateError) { setSaving(false); setError(updateError.message); return }

    await insertHistory(room.id, room.property_id, 'Moved In', moveInDate, tenantName.trim(), notes)

    setSaving(false)
    onSaved(data)
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalCardStyle, maxWidth: '380px' }}>
        <p style={modalTitleStyle}>Mark "{room.room_name}" as Occupied</p>

        <p style={modalLabelStyle}>Tenant Name</p>
        <input type="text" value={tenantName} onChange={(e) => setTenantName(e.target.value)} style={inputStyle} />

        <p style={modalLabelStyle}>Move-in Date</p>
        <input type="date" value={moveInDate} onChange={(e) => setMoveInDate(e.target.value)} style={inputStyle} />

        <p style={modalLabelStyle}>Notes</p>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />

        {error && <p style={modalErrorStyle}>{error}</p>}

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button onClick={onClose} style={modalCancelBtnStyle}>Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            style={{ flex: 2, padding: '10px', background: COLORS.green600, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving...' : 'Confirm Occupied'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RoomHistoryModal({ room, onClose }) {
  const [history, setHistory] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { data, error: fetchError } = await supabase
        .schema('pmms')
        .from('property_room_history')
        .select('*')
        .eq('room_id', room.id)
        .order('action_date', { ascending: false })

      if (fetchError) { setError(fetchError.message); setHistory([]); return }
      setHistory(data || [])
    }
    load()
  }, [room.id])

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalCardStyle, maxWidth: '480px' }}>
        <p style={modalTitleStyle}>History — {room.room_name}</p>

        <div style={{ marginTop: '12px', maxHeight: '360px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {error && <p style={modalErrorStyle}>{error}</p>}
          {history === null && !error && (
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400 }}>Loading...</p>
          )}
          {history && history.length === 0 && (
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No history recorded for this room yet.</p>
          )}
          {history && history.map(h => {
            const isMoveIn = h.action === 'Moved In'
            return (
              <div key={h.id} style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{
                    fontSize: '11px', fontWeight: 800, padding: '2px 10px', borderRadius: '20px',
                    color: isMoveIn ? COLORS.green600 : COLORS.red600, background: isMoveIn ? COLORS.green100 : COLORS.red100,
                  }}>
                    {h.action}
                  </span>
                  <span style={{ fontSize: '12px', color: COLORS.slate400 }}>{formatUKDate(h.action_date)}</span>
                </div>
                {h.tenant_name && <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{h.tenant_name}</p>}
                {h.notes && <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>{h.notes}</p>}
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: '16px' }}>
          <button onClick={onClose} style={{ ...modalCancelBtnStyle, width: '100%' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

function RoomCard({ room, onEdit, onMarkVoid, onMarkOccupied, onViewHistory, readOnly = false }) {
  const statusStyle = STATUS_STYLES[room.current_status] || STATUS_STYLES.Occupied

  return (
    <div style={{ background: COLORS.white, borderRadius: '16px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: COLORS.slate900 }}>{room.room_name}</p>
        <span style={{ fontSize: '11px', fontWeight: 800, color: statusStyle.color, background: statusStyle.bg, padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
          {room.current_status}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {room.room_type && (
          <span style={{ display: 'inline-block', fontSize: '10px', fontWeight: 700, color: COLORS.blue700, background: COLORS.blue100, padding: '2px 8px', borderRadius: '20px' }}>
            {room.room_type}
          </span>
        )}
        {room.bed_type ? (
          <span style={{ display: 'inline-block', fontSize: '10px', fontWeight: 700, color: COLORS.violet600, background: COLORS.violet100, padding: '2px 8px', borderRadius: '20px' }}>
            {room.bed_type}
          </span>
        ) : (
          <span style={{ display: 'inline-block', fontSize: '10px', color: COLORS.slate400, fontStyle: 'italic', padding: '2px 8px' }}>
            Bed type not set
          </span>
        )}
      </div>

      <div style={{ marginBottom: '14px' }}>
        {room.current_status === 'Occupied' ? (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate900 }}>Tenant: <strong>{room.tenant_name || '—'}</strong></p>
        ) : (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.amber600, fontWeight: 600 }}>
            Void since {room.void_since ? formatUKDate(room.void_since) : '—'}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {!readOnly && (
          <>
            <button onClick={() => onEdit(room)} style={{ flex: '1 1 80px', padding: '8px', background: COLORS.slate100, color: COLORS.slate600, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              Edit
            </button>
            {room.current_status === 'Occupied' ? (
              <button onClick={() => onMarkVoid(room)} style={{ flex: '1 1 110px', padding: '8px', background: COLORS.amber50, color: COLORS.amber800, border: `1px solid ${COLORS.amber300}`, borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                Mark as Void
              </button>
            ) : (
              <button onClick={() => onMarkOccupied(room)} style={{ flex: '1 1 130px', padding: '8px', background: COLORS.green50, color: COLORS.green800, border: `1px solid ${COLORS.green200}`, borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                Mark as Occupied
              </button>
            )}
          </>
        )}
        <button onClick={() => onViewHistory(room)} style={{ flex: '1 1 100px', padding: '8px', background: COLORS.white, color: COLORS.slate500, border: `1px solid ${COLORS.slate200}`, borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
          View History
        </button>
      </div>
    </div>
  )
}

export default function PropertyRoomsTab({ property, profile }) {
  const readOnly = profile?.division === 'Landlord Liaison'
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [modalRoom, setModalRoom] = useState(undefined) // undefined = closed, null = add, object = edit
  const [voidTarget, setVoidTarget] = useState(null)
  const [occupyTarget, setOccupyTarget] = useState(null)
  const [historyTarget, setHistoryTarget] = useState(null)

  useEffect(() => {
    fetchRooms()
  }, [property.id])

  async function fetchRooms() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase
      .schema('pmms')
      .from('property_rooms')
      .select('*')
      .eq('property_id', property.id)
      .order('room_name')

    if (error) {
      setRooms([])
      setLoadError(error.message)
      setLoading(false)
      return
    }

    setRooms(data || [])
    setLoading(false)
  }

  function handleSaved(saved) {
    setRooms(prev => {
      const exists = prev.some(r => r.id === saved.id)
      return exists ? prev.map(r => r.id === saved.id ? saved : r) : [...prev, saved].sort((a, b) => a.room_name.localeCompare(b.room_name))
    })
    setModalRoom(undefined)
    setVoidTarget(null)
    setOccupyTarget(null)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: COLORS.slate400, fontWeight: 600 }}>Loading rooms...</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ background: COLORS.red50, border: `1px solid ${COLORS.red200}`, borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: COLORS.red600 }}>Couldn't load rooms</p>
        <p style={{ margin: 0, fontSize: '13px', color: COLORS.red900, fontFamily: 'monospace' }}>{loadError}</p>
      </div>
    )
  }

  const totalRooms = rooms.length
  const occupiedCount = rooms.filter(r => r.current_status === 'Occupied').length
  const voidCount = rooms.filter(r => r.current_status === 'Void').length

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase' }}>Total Rooms</span>
            <p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: COLORS.slate900 }}>{totalRooms}</p>
          </div>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase' }}>Occupied</span>
            <p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: COLORS.green600 }}>{occupiedCount}</p>
          </div>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase' }}>Void</span>
            <p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: COLORS.amber600 }}>{voidCount}</p>
          </div>
        </div>
        {!readOnly && (
          <button
            onClick={() => setModalRoom(null)}
            style={{ padding: '10px 18px', background: COLORS.blue900, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            ＋ Add Room
          </button>
        )}
      </div>

      {rooms.length === 0 ? (
        <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate400, fontStyle: 'italic' }}>No rooms recorded for this property yet.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
          {rooms.map(room => (
            <RoomCard
              key={room.id}
              room={room}
              onEdit={setModalRoom}
              onMarkVoid={setVoidTarget}
              onMarkOccupied={setOccupyTarget}
              onViewHistory={setHistoryTarget}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}

      {modalRoom !== undefined && (
        <RoomFormModal property={property} room={modalRoom} onClose={() => setModalRoom(undefined)} onSaved={handleSaved} />
      )}
      {voidTarget && (
        <MarkVoidModal room={voidTarget} onClose={() => setVoidTarget(null)} onSaved={handleSaved} />
      )}
      {occupyTarget && (
        <MarkOccupiedModal room={occupyTarget} onClose={() => setOccupyTarget(null)} onSaved={handleSaved} />
      )}
      {historyTarget && (
        <RoomHistoryModal room={historyTarget} onClose={() => setHistoryTarget(null)} />
      )}
    </div>
  )
}
