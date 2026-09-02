// Add Temporary Task -- Landlord Liaison's structured place to log work
// that doesn't need a full inspection/maintenance/compliance workflow but
// still needs tracking/chasing (directors' spec, 2026-09-02; mocked up as
// the "Follow-Ups" artifact, approved, now built for real). See
// scripts/add_temporary_tasks_table.sql for the pmms.temporary_tasks table
// this depends on -- run it before using this page.
//
// Picking a Task Type changes which fields show underneath. 5 types are
// built for real here (Landlord Complaint, Neighbour Complaint, Landlord
// Contact / Follow-Up, External Agency / Third-Party Task, Rent Review
// Update) -- the other 9 types from the spec are selectable but have no
// fields designed yet.
//
// Rent Review Update also writes back to pmms.properties' own
// rent_review_* summary columns (see scripts/add_rent_review_columns.sql)
// -- the spec's "connects to the main Rent Reviews section, not a separate
// duplicate record" requirement, resolved the same way Managing Agent was
// (flat columns on properties, no standalone Rent Reviews system exists).

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { modalLabelStyle, modalErrorStyle } from './shared'
import { compressImage } from '../../lib/imageCompression'
import { getSignedUrl } from '../../lib/storage'
import PropertySearchSelect from '../../components/PropertySearchSelect'
import VoiceInputButton from '../../components/VoiceInputButton'

const TASK_TYPES = [
  'Landlord Complaint', 'Neighbour Complaint', 'External Agency / Third-Party Task', 'Rent Review Update',
  'Landlord Contact / Follow-Up', 'Managing Agent Contact', 'Estate Agent / Property Viewing', 'Lease / Renewal Follow-Up',
  'Compliance Document Chase', 'Maintenance Follow-Up', 'Contractor Follow-Up', 'Internal Department Follow-Up',
  'Document / Signature Chase', 'Other',
]
const BUILT_TYPES = ['Landlord Complaint', 'Neighbour Complaint', 'Landlord Contact / Follow-Up', 'External Agency / Third-Party Task', 'Rent Review Update']
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']
const DEPARTMENTS = ['Maintenance', 'Support', 'Housing', 'Compliance', 'Management', 'Other']
const STATUSES = ['New', 'In Progress', 'Awaiting Response', 'Awaiting Internal Team', 'Resolved', 'Closed']
const RECEIVED_VIA = ['Call', 'Email', 'Text', 'In Person', 'Other']
const NEIGHBOUR_CATEGORIES = [
  'Noise / Disturbance', 'Anti-Social Behaviour', 'Service User Behaviour', 'Cannabis / Drug-Related Concern',
  'Smoking / Odour', 'Rubbish / Waste', 'Garden / Property Condition', 'Parking / Vehicles',
  'Visitors / Unauthorised Guests', 'Boundary / Fence', 'Damage to Neighbouring Property',
  'Harassment / Intimidation', 'Criminal Activity / Police Concern', 'Other',
]
const COMPLAINT_CATEGORIES = ['Property Condition', 'Maintenance', 'Service User Behaviour', 'Property Damage', 'Tenancy / Licence Concern', 'Rent / Payment', 'Communication', 'Compliance', 'Other']
const EXTERNAL_AGENCIES = ['Local Authority', 'Police', 'Managing Agent', 'Landlord', 'Other']
const NEIGHBOUR_OUTCOMES = ['Upheld', 'Partially Upheld', 'Not Upheld', 'Unsubstantiated', 'Unable to Determine']
const CONTACT_METHODS = ['Call - Outgoing', 'Call - Incoming', 'Email - Outgoing', 'Email - Incoming', 'Text / WhatsApp - Outgoing', 'Text / WhatsApp - Incoming', 'Meeting', 'Property Visit', 'Other']
const CONTACT_REASONS = ['Maintenance', 'Rent Review', 'Lease Renewal', 'Complaint', 'Property Condition', 'Compliance', 'Inspection', 'Service User Concern', 'Payment', 'Documents', 'General Relationship / Check-In', 'Other']
const EXTERNAL_AGENCY_TYPES = [
  'Managing Agent', 'Freeholder', 'Block Management', 'Local Authority', 'Estate Agent', 'Landlord',
  'Neighbouring Property', 'Contractor', 'Insurer', 'Police', 'Fire Service', 'Utility Company', 'Other External Organisation',
]
const EXTERNAL_CONTACT_METHODS = ['Call', 'Email', 'Meeting', 'Visit']
const EXTERNAL_ISSUE_TYPES = [
  'Leak', 'Structural Damage', 'Water Damage', 'Access Issue', 'Drainage', 'Roof',
  'Boundary or Fence', 'Tree or Vegetation', 'Criminal Damage', 'Other',
]
const COST_RECOVERY_STATUSES = ['Not Required', 'To Be Claimed', 'Submitted', 'Agreed', 'Disputed', 'Part Paid', 'Paid']
const UPDATE_TYPES = [
  'Initial Landlord Contact', 'Landlord Requested Increase', 'GBCH Offer Made', 'Negotiation Update',
  'Management Approval Required', 'Rent Agreed', 'Memorandum Sent', 'Awaiting Signature', 'Signed', 'Review Completed', 'Other',
]

const inputStyle = { width: '100%', padding: '9px 11px', borderRadius: '9px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', background: COLORS.white }
const disabledInputStyle = { ...inputStyle, background: COLORS.slate50, color: COLORS.slate500 }
const sectionLabelStyle = { margin: '20px 0 12px', fontSize: '11px', fontWeight: 800, color: COLORS.teal700, textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: '14px', borderTop: `1px solid ${COLORS.slate100}` }

function initialForm() {
  return {
    task_title: '', details_notes: '', priority: 'Medium', department_involved: '', due_date: '', follow_up_date: '', status: 'New',
    complaint_category: '', complaint_received_via: '', complaint_received_date: '', complaint_details: '', acknowledged: false, acknowledgement_date: '',
    department_assigned_to: '', action_taken: '', landlord_updated: false, next_update_due: '', complaint_outcome_text: '', root_cause: '', recurring_issue: false, resolved_date: '',
    complainant_name: '', complainant_address: '', complainant_contact_details: '', complaint_received_datetime: '', incident_datetime: '', service_user_room: '',
    previous_complaints_same_neighbour: false, investigation_required: false, property_visit_required: false, service_user_identified: false, support_worker_contacted: false,
    external_agency_involved: false, external_agency: '', warning_action_issued: '', reference_case_number: '', further_action_required: false, next_follow_up_date: '',
    neighbour_updated: false, date_last_updated: '', update_response_provided: '', further_update_required: false, neighbour_outcome: '', escalation_required: false, closed_date: '', resolution_final_action: '',
    contact_datetime: '', contact_method: 'Call - Outgoing', reason_for_contact: '', contact_outcome_text: '', responsible_person_department: '',
    external_agency_type: '', organisation_name: '', contact_person: '', initial_contact_date: '', action_required_from_them: '',
    evidence_sent: false, response_received: false, response_details: '',
    external_source_outside_property: false, external_issue_type: '', responsible_party: '', source_confirmed: false,
    photos_videos_uploaded: false, external_contractor_attended: false, source_resolved: false, gbch_damage_repaired: false,
    cost_recovery_status: '', external_task_outcome_text: '',
    update_type: '', landlord_requested_rent: '', gbch_proposed_rent: '', agreed_rent: '', rent_effective_date: '',
    landlord_response: '', management_decision_notes: '', document_sent_date: '', signature_received_date: '',
  }
}

// Every free-text field gets a mic button (VoiceInputButton, the same
// component already live on the ticket "Other" description fields) --
// extended here to every typed field per the 2026-09-02 mockup review.
function TextField({ label, value, onChange, textarea = false, placeholder }) {
  const Tag = textarea ? 'textarea' : 'input'
  return (
    <div>
      <p style={modalLabelStyle}>{label}</p>
      <div style={{ display: 'flex', alignItems: textarea ? 'flex-start' : 'center', gap: '6px' }}>
        <Tag
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={textarea ? 3 : undefined}
          style={{ ...inputStyle, flex: 1, resize: textarea ? 'vertical' : undefined }}
        />
        <VoiceInputButton onResult={(text) => onChange(value ? `${value} ${text}` : text)} />
      </div>
    </div>
  )
}
function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <p style={modalLabelStyle}>{label}</p>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="">Select...</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
function DateField({ label, value, onChange, withTime = false }) {
  return (
    <div>
      <p style={modalLabelStyle}>{label}</p>
      <input type={withTime ? 'datetime-local' : 'date'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </div>
  )
}
function BoolField({ label, value, onChange }) {
  return (
    <div>
      <p style={modalLabelStyle}>{label}</p>
      <select value={value ? 'yes' : 'no'} onChange={(e) => onChange(e.target.value === 'yes')} style={inputStyle}>
        <option value="no">No</option>
        <option value="yes">Yes</option>
      </select>
    </div>
  )
}

function landlordAgentDisplay(property) {
  if (!property) return ''
  if (property.managing_agent) return `${property.landlord_name || 'Unknown landlord'} (via ${property.managing_agent})`
  return property.landlord_name || ''
}

export default function AdminTemporaryTasks({ profile, onNavigate }) {
  const [properties, setProperties] = useState([])
  const [propertyId, setPropertyId] = useState('')
  const [taskType, setTaskType] = useState('Landlord Complaint')
  const [form, setForm] = useState(initialForm())
  const [evidenceFile, setEvidenceFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')

  useEffect(() => {
    supabase
      .schema('pmms')
      .from('properties')
      .select('id, address, landlord_name, managing_agent, rent_amount, rent_review_due_date, rent_review_status, rent_review_landlord_request, rent_review_gbch_offer')
      .order('address')
      .then(({ data }) => setProperties(data || []))
  }, [])

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const selectedProperty = properties.find(p => p.id === propertyId)

  async function handleSave() {
    if (!propertyId) { setError('Please select a property.'); return }
    if (!form.task_title.trim()) { setError('Please enter a task title.'); return }

    setSaving(true)
    setError('')
    setSavedMessage('')

    let evidenceUrl = null
    if (evidenceFile) {
      let compressed
      try {
        compressed = await compressImage(evidenceFile)
      } catch (compressErr) {
        setSaving(false)
        setError(compressErr.message)
        return
      }
      const path = `${propertyId}/temporary-tasks/${Date.now()}-${compressed.name}`
      const { error: uploadError } = await supabase.storage.from('property-docs').upload(path, compressed)
      if (uploadError) { setSaving(false); setError(`Upload failed: ${uploadError.message}`); return }
      evidenceUrl = await getSignedUrl('property-docs', path)
    }

    const { error: insertError } = await supabase
      .schema('pmms')
      .from('temporary_tasks')
      .insert({
        task_type: taskType,
        property_id: propertyId,
        ...form,
        // Empty-string dates/UUIDs must be null, not '', for Postgres date/uuid columns.
        due_date: form.due_date || null,
        follow_up_date: form.follow_up_date || null,
        complaint_received_date: form.complaint_received_date || null,
        acknowledgement_date: form.acknowledgement_date || null,
        next_update_due: form.next_update_due || null,
        resolved_date: form.resolved_date || null,
        complaint_received_datetime: form.complaint_received_datetime || null,
        incident_datetime: form.incident_datetime || null,
        next_follow_up_date: form.next_follow_up_date || null,
        date_last_updated: form.date_last_updated || null,
        closed_date: form.closed_date || null,
        contact_datetime: form.contact_datetime || null,
        initial_contact_date: form.initial_contact_date || null,
        rent_effective_date: form.rent_effective_date || null,
        document_sent_date: form.document_sent_date || null,
        signature_received_date: form.signature_received_date || null,
        rent_review_current_rent_snapshot: taskType === 'Rent Review Update' ? (selectedProperty?.rent_amount ?? null) : null,
        // Numeric columns -- these are plain text inputs (mic dictation
        // needs a text-shaped field), so convert empty-string-or-numeric-
        // string to null-or-Number explicitly rather than relying on
        // Postgres to coerce a JSON string for a numeric column.
        landlord_requested_rent: form.landlord_requested_rent === '' ? null : Number(form.landlord_requested_rent),
        gbch_proposed_rent: form.gbch_proposed_rent === '' ? null : Number(form.gbch_proposed_rent),
        agreed_rent: form.agreed_rent === '' ? null : Number(form.agreed_rent),
        assigned_to: profile.id,
        evidence_url: evidenceUrl,
        created_by: profile.id,
        created_by_name: profile.name,
      })

    setSaving(false)
    if (insertError) { setError(insertError.message); return }

    // The "connects to the main Rent Reviews section" behaviour from the
    // spec -- this task type also updates the property's own summary
    // fields (read on Lease & Legal, and re-pulled here next time this
    // property is selected), not just its own log row. Best-effort: if
    // this fails, the task itself is already saved, so surface the error
    // without discarding what did succeed.
    if (taskType === 'Rent Review Update') {
      const { error: propUpdateError } = await supabase
        .schema('pmms')
        .from('properties')
        .update({
          rent_review_status: form.update_type || null,
          rent_review_landlord_request: form.landlord_requested_rent === '' ? null : Number(form.landlord_requested_rent),
          rent_review_gbch_offer: form.gbch_proposed_rent === '' ? null : Number(form.gbch_proposed_rent),
          rent_review_last_contact_date: new Date().toISOString().slice(0, 10),
        })
        .eq('id', propertyId)
      if (propUpdateError) {
        setError(`Task saved, but couldn't update the property's Rent Review summary: ${propUpdateError.message}`)
      }
      setProperties(prev => prev.map(p => p.id === propertyId ? {
        ...p,
        rent_review_status: form.update_type || null,
        rent_review_landlord_request: form.landlord_requested_rent === '' ? null : Number(form.landlord_requested_rent),
        rent_review_gbch_offer: form.gbch_proposed_rent === '' ? null : Number(form.gbch_proposed_rent),
      } : p))
    }

    setForm(initialForm())
    setEvidenceFile(null)
    setSavedMessage('Task saved.')
  }

  return (
    <div style={{ maxWidth: '760px' }}>
      <p style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 800, color: COLORS.slate900 }}>Add Temporary Task</p>
      <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: COLORS.slate500 }}>Log work that doesn't need a full inspection/maintenance/compliance workflow, but still needs tracking.</p>

      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ background: COLORS.teal50, border: `1.5px solid ${COLORS.teal600}`, borderRadius: '12px', padding: '14px 16px', marginBottom: '18px' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 800, color: COLORS.teal700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Task Type</p>
          <select value={taskType} onChange={(e) => setTaskType(e.target.value)} style={{ ...inputStyle, fontWeight: 700 }}>
            {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <p style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>Standard Fields</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px', marginTop: '12px' }}>
          <div>
            <p style={modalLabelStyle}>Property</p>
            <PropertySearchSelect properties={properties} value={propertyId} onChange={setPropertyId} placeholder="Start typing an address..." />
          </div>
          <div>
            <p style={modalLabelStyle}>Landlord / Agent</p>
            <input value={landlordAgentDisplay(selectedProperty)} disabled placeholder="Select a property first" style={disabledInputStyle} />
          </div>
          <div>
            <p style={modalLabelStyle}>Assigned To</p>
            <input value={`${profile.name} (you)`} disabled style={disabledInputStyle} />
          </div>
          <SelectField label="Priority" value={form.priority} onChange={(v) => setField('priority', v)} options={PRIORITIES} />
          <SelectField label="Department Involved" value={form.department_involved} onChange={(v) => setField('department_involved', v)} options={DEPARTMENTS} />
          <SelectField label="Status" value={form.status} onChange={(v) => setField('status', v)} options={STATUSES} />
          <DateField label="Due Date" value={form.due_date} onChange={(v) => setField('due_date', v)} />
          <DateField label="Follow-Up Date" value={form.follow_up_date} onChange={(v) => setField('follow_up_date', v)} />
          <div>
            <p style={modalLabelStyle}>Evidence / Attachments</p>
            <input type="file" accept=".pdf,image/*" onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)} style={inputStyle} />
          </div>
        </div>
        <div style={{ marginTop: '12px' }}>
          <TextField label="Task Title" value={form.task_title} onChange={(v) => setField('task_title', v)} placeholder="Short summary" />
        </div>
        <div style={{ marginTop: '12px' }}>
          <TextField label="Details / Notes" value={form.details_notes} onChange={(v) => setField('details_notes', v)} textarea placeholder="What needs doing..." />
        </div>

        {taskType === 'Landlord Complaint' && (
          <>
            <p style={sectionLabelStyle}>Landlord Complaint</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px' }}>
              <SelectField label="Complaint Category" value={form.complaint_category} onChange={(v) => setField('complaint_category', v)} options={COMPLAINT_CATEGORIES} />
              <SelectField label="Complaint Received Via" value={form.complaint_received_via} onChange={(v) => setField('complaint_received_via', v)} options={RECEIVED_VIA} />
              <DateField label="Complaint Received Date" value={form.complaint_received_date} onChange={(v) => setField('complaint_received_date', v)} />
            </div>
            <div style={{ marginTop: '12px' }}><TextField label="Complaint Details" value={form.complaint_details} onChange={(v) => setField('complaint_details', v)} textarea /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px', marginTop: '12px' }}>
              <BoolField label="Acknowledged?" value={form.acknowledged} onChange={(v) => setField('acknowledged', v)} />
              <DateField label="Acknowledgement Date" value={form.acknowledgement_date} onChange={(v) => setField('acknowledgement_date', v)} />
              <SelectField label="Department Assigned To" value={form.department_assigned_to} onChange={(v) => setField('department_assigned_to', v)} options={DEPARTMENTS} />
            </div>
            <div style={{ marginTop: '12px' }}><TextField label="Action Taken" value={form.action_taken} onChange={(v) => setField('action_taken', v)} textarea /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px', marginTop: '12px' }}>
              <BoolField label="Landlord Updated?" value={form.landlord_updated} onChange={(v) => setField('landlord_updated', v)} />
              <DateField label="Next Update Due" value={form.next_update_due} onChange={(v) => setField('next_update_due', v)} />
              <BoolField label="Recurring Issue?" value={form.recurring_issue} onChange={(v) => setField('recurring_issue', v)} />
            </div>
            <div style={{ marginTop: '12px' }}><TextField label="Complaint Outcome" value={form.complaint_outcome_text} onChange={(v) => setField('complaint_outcome_text', v)} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px', marginTop: '12px' }}>
              <TextField label="Root Cause" value={form.root_cause} onChange={(v) => setField('root_cause', v)} />
              <DateField label="Resolved Date" value={form.resolved_date} onChange={(v) => setField('resolved_date', v)} />
            </div>
          </>
        )}

        {taskType === 'Neighbour Complaint' && (
          <>
            <p style={sectionLabelStyle}>Complaint Category</p>
            <SelectField label="Category" value={form.complaint_category} onChange={(v) => setField('complaint_category', v)} options={NEIGHBOUR_CATEGORIES} />

            <p style={sectionLabelStyle}>Complaint Details</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px' }}>
              <TextField label="Complainant Name" value={form.complainant_name} onChange={(v) => setField('complainant_name', v)} />
              <TextField label="Complainant Address" value={form.complainant_address} onChange={(v) => setField('complainant_address', v)} />
              <TextField label="Contact Details" value={form.complainant_contact_details} onChange={(v) => setField('complainant_contact_details', v)} />
              <DateField label="Complaint Received Date/Time" value={form.complaint_received_datetime} onChange={(v) => setField('complaint_received_datetime', v)} withTime />
              <SelectField label="Complaint Received Via" value={form.complaint_received_via} onChange={(v) => setField('complaint_received_via', v)} options={RECEIVED_VIA} />
              <DateField label="Date/Time of Alleged Incident" value={form.incident_datetime} onChange={(v) => setField('incident_datetime', v)} withTime />
              <TextField label="Service User / Room Concerned" value={form.service_user_room} onChange={(v) => setField('service_user_room', v)} placeholder="If known" />
              <BoolField label="Previous Complaints from Same Neighbour?" value={form.previous_complaints_same_neighbour} onChange={(v) => setField('previous_complaints_same_neighbour', v)} />
              <BoolField label="Recurring Issue?" value={form.recurring_issue} onChange={(v) => setField('recurring_issue', v)} />
            </div>
            <div style={{ marginTop: '12px' }}><TextField label="Complaint Details" value={form.complaint_details} onChange={(v) => setField('complaint_details', v)} textarea /></div>
            <div style={{ marginTop: '12px' }}>
              <p style={modalLabelStyle}>Evidence / Attachments</p>
              <input type="file" accept=".pdf,image/*" multiple onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)} style={inputStyle} />
            </div>

            <p style={sectionLabelStyle}>Investigation &amp; Action</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px' }}>
              <BoolField label="Acknowledged?" value={form.acknowledged} onChange={(v) => setField('acknowledged', v)} />
              <DateField label="Acknowledgement Date" value={form.acknowledgement_date} onChange={(v) => setField('acknowledgement_date', v)} />
              <SelectField label="Department Assigned To" value={form.department_assigned_to} onChange={(v) => setField('department_assigned_to', v)} options={DEPARTMENTS} />
              <BoolField label="Investigation Required?" value={form.investigation_required} onChange={(v) => setField('investigation_required', v)} />
              <BoolField label="Property Visit Required?" value={form.property_visit_required} onChange={(v) => setField('property_visit_required', v)} />
              <BoolField label="Service User Identified?" value={form.service_user_identified} onChange={(v) => setField('service_user_identified', v)} />
              <BoolField label="Support Worker Contacted?" value={form.support_worker_contacted} onChange={(v) => setField('support_worker_contacted', v)} />
              <BoolField label="External Agency Involved?" value={form.external_agency_involved} onChange={(v) => setField('external_agency_involved', v)} />
              <SelectField label="External Agency" value={form.external_agency} onChange={(v) => setField('external_agency', v)} options={EXTERNAL_AGENCIES} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px', marginTop: '12px' }}>
              <TextField label="Action Taken" value={form.action_taken} onChange={(v) => setField('action_taken', v)} textarea />
              <TextField label="Warning / Action Issued" value={form.warning_action_issued} onChange={(v) => setField('warning_action_issued', v)} textarea placeholder="If applicable" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px', marginTop: '12px' }}>
              <TextField label="Reference / Case Number" value={form.reference_case_number} onChange={(v) => setField('reference_case_number', v)} />
              <BoolField label="Further Action Required?" value={form.further_action_required} onChange={(v) => setField('further_action_required', v)} />
              <DateField label="Next Follow-Up Date" value={form.next_follow_up_date} onChange={(v) => setField('next_follow_up_date', v)} />
            </div>

            <p style={sectionLabelStyle}>Neighbour Communication</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px' }}>
              <BoolField label="Neighbour Updated?" value={form.neighbour_updated} onChange={(v) => setField('neighbour_updated', v)} />
              <DateField label="Date Last Updated" value={form.date_last_updated} onChange={(v) => setField('date_last_updated', v)} />
              <BoolField label="Further Update Required?" value={form.further_update_required} onChange={(v) => setField('further_update_required', v)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px', marginTop: '12px' }}>
              <TextField label="Update / Response Provided" value={form.update_response_provided} onChange={(v) => setField('update_response_provided', v)} textarea />
              <DateField label="Next Update Due" value={form.next_update_due} onChange={(v) => setField('next_update_due', v)} />
            </div>

            <p style={sectionLabelStyle}>Complaint Outcome</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px' }}>
              <SelectField label="Outcome" value={form.neighbour_outcome} onChange={(v) => setField('neighbour_outcome', v)} options={NEIGHBOUR_OUTCOMES} />
              <BoolField label="Escalation Required?" value={form.escalation_required} onChange={(v) => setField('escalation_required', v)} />
              <DateField label="Resolved Date" value={form.resolved_date} onChange={(v) => setField('resolved_date', v)} />
              <DateField label="Closed Date" value={form.closed_date} onChange={(v) => setField('closed_date', v)} />
            </div>
            <div style={{ marginTop: '12px' }}><TextField label="Resolution / Final Action" value={form.resolution_final_action} onChange={(v) => setField('resolution_final_action', v)} textarea /></div>
          </>
        )}

        {taskType === 'Landlord Contact / Follow-Up' && (
          <>
            <p style={sectionLabelStyle}>Landlord Contact — quick-entry, since this is used constantly through the day</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px' }}>
              <DateField label="Contact Date / Time" value={form.contact_datetime} onChange={(v) => setField('contact_datetime', v)} withTime />
              <SelectField label="Contact Method" value={form.contact_method} onChange={(v) => setField('contact_method', v)} options={CONTACT_METHODS} />
              <SelectField label="Reason for Contact" value={form.reason_for_contact} onChange={(v) => setField('reason_for_contact', v)} options={CONTACT_REASONS} />
            </div>
            <div style={{ marginTop: '12px' }}><TextField label="Conversation / Contact Notes" value={form.details_notes} onChange={(v) => setField('details_notes', v)} textarea placeholder="What was discussed..." /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px', marginTop: '12px' }}>
              <TextField label="Outcome" value={form.contact_outcome_text} onChange={(v) => setField('contact_outcome_text', v)} />
              <TextField label="Responsible Person / Department" value={form.responsible_person_department} onChange={(v) => setField('responsible_person_department', v)} placeholder="If action is required" />
            </div>
          </>
        )}

        {taskType === 'External Agency / Third-Party Task' && (
          <>
            <p style={sectionLabelStyle}>External Agency / Third-Party Task</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px' }}>
              <SelectField label="External Agency Type" value={form.external_agency_type} onChange={(v) => setField('external_agency_type', v)} options={EXTERNAL_AGENCY_TYPES} />
              <TextField label="Organisation Name" value={form.organisation_name} onChange={(v) => setField('organisation_name', v)} />
              <TextField label="Contact Person" value={form.contact_person} onChange={(v) => setField('contact_person', v)} />
              <DateField label="Initial Contact Date" value={form.initial_contact_date} onChange={(v) => setField('initial_contact_date', v)} />
              <SelectField label="Method" value={form.contact_method} onChange={(v) => setField('contact_method', v)} options={EXTERNAL_CONTACT_METHODS} />
              <TextField label="Reference / Case Number" value={form.reference_case_number} onChange={(v) => setField('reference_case_number', v)} />
            </div>
            <div style={{ marginTop: '12px' }}><TextField label="Reason for Contact" value={form.reason_for_contact} onChange={(v) => setField('reason_for_contact', v)} textarea /></div>
            <div style={{ marginTop: '12px' }}><TextField label="Action Required From Them" value={form.action_required_from_them} onChange={(v) => setField('action_required_from_them', v)} textarea /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px', marginTop: '12px' }}>
              <BoolField label="Evidence Sent?" value={form.evidence_sent} onChange={(v) => setField('evidence_sent', v)} />
              <BoolField label="Response Received?" value={form.response_received} onChange={(v) => setField('response_received', v)} />
              <BoolField label="Escalation Required?" value={form.escalation_required} onChange={(v) => setField('escalation_required', v)} />
            </div>
            <div style={{ marginTop: '12px' }}><TextField label="Response Details" value={form.response_details} onChange={(v) => setField('response_details', v)} textarea /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px', marginTop: '12px' }}>
              <DateField label="Next Chase Date" value={form.follow_up_date} onChange={(v) => setField('follow_up_date', v)} />
              <TextField label="Outcome" value={form.external_task_outcome_text} onChange={(v) => setField('external_task_outcome_text', v)} />
            </div>

            <p style={sectionLabelStyle}>External Property Issues</p>
            <BoolField label="Is the source outside a GBCH property?" value={form.external_source_outside_property} onChange={(v) => setField('external_source_outside_property', v)} />
            {form.external_source_outside_property && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px', marginTop: '12px' }}>
                  <SelectField label="External Issue Type" value={form.external_issue_type} onChange={(v) => setField('external_issue_type', v)} options={EXTERNAL_ISSUE_TYPES} />
                  <TextField label="Responsible Party" value={form.responsible_party} onChange={(v) => setField('responsible_party', v)} />
                  <BoolField label="Source Confirmed?" value={form.source_confirmed} onChange={(v) => setField('source_confirmed', v)} />
                  <BoolField label="Photos / Videos Uploaded?" value={form.photos_videos_uploaded} onChange={(v) => setField('photos_videos_uploaded', v)} />
                  <BoolField label="External Contractor Attended?" value={form.external_contractor_attended} onChange={(v) => setField('external_contractor_attended', v)} />
                  <BoolField label="Source Resolved?" value={form.source_resolved} onChange={(v) => setField('source_resolved', v)} />
                  <BoolField label="GBCH Damage Repaired?" value={form.gbch_damage_repaired} onChange={(v) => setField('gbch_damage_repaired', v)} />
                  <SelectField label="Cost Recovery Required?" value={form.cost_recovery_status} onChange={(v) => setField('cost_recovery_status', v)} options={COST_RECOVERY_STATUSES} />
                </div>
              </>
            )}
          </>
        )}

        {taskType === 'Rent Review Update' && (
          <>
            <p style={sectionLabelStyle}>Rent Review Update</p>
            {selectedProperty && (
              <div style={{ background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', padding: '12px 14px', marginBottom: '14px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 14px' }}>
                <div><p style={{ margin: 0, fontSize: '10px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase' }}>Current Rent</p><p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{selectedProperty.rent_amount != null ? `£${Number(selectedProperty.rent_amount).toLocaleString()}/wk` : '—'}</p></div>
                <div><p style={{ margin: 0, fontSize: '10px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase' }}>Rent Review Due</p><p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{selectedProperty.rent_review_due_date || '—'}</p></div>
                <div><p style={{ margin: 0, fontSize: '10px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase' }}>Existing Status</p><p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{selectedProperty.rent_review_status || 'No review in progress'}</p></div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 14px' }}>
              <SelectField label="Update Type" value={form.update_type} onChange={(v) => setField('update_type', v)} options={UPDATE_TYPES} />
              <TextField label="Landlord Requested Rent (£)" value={form.landlord_requested_rent} onChange={(v) => setField('landlord_requested_rent', v)} />
              <TextField label="GBCH Proposed Rent (£)" value={form.gbch_proposed_rent} onChange={(v) => setField('gbch_proposed_rent', v)} />
              <TextField label="Agreed Rent (£)" value={form.agreed_rent} onChange={(v) => setField('agreed_rent', v)} />
              <DateField label="Effective Date" value={form.rent_effective_date} onChange={(v) => setField('rent_effective_date', v)} />
              <DateField label="Document Sent Date" value={form.document_sent_date} onChange={(v) => setField('document_sent_date', v)} />
              <DateField label="Signature Received Date" value={form.signature_received_date} onChange={(v) => setField('signature_received_date', v)} />
              <DateField label="Next Follow-Up Date" value={form.follow_up_date} onChange={(v) => setField('follow_up_date', v)} />
            </div>
            <div style={{ marginTop: '12px' }}><TextField label="Landlord Response" value={form.landlord_response} onChange={(v) => setField('landlord_response', v)} textarea /></div>
            <div style={{ marginTop: '12px' }}><TextField label="Management Decision / Notes" value={form.management_decision_notes} onChange={(v) => setField('management_decision_notes', v)} textarea /></div>
            <p style={{ margin: '10px 0 0 0', fontSize: '11.5px', color: COLORS.slate500 }}>Saving this updates the property's own Rent Review summary (visible on Lease &amp; Legal) with this Update Type as the new Status, plus the requested/offered amounts above.</p>
          </>
        )}

        {!BUILT_TYPES.includes(taskType) && (
          <>
            <p style={sectionLabelStyle}>Type-Specific Fields</p>
            <div style={{ background: COLORS.slate50, border: `1.5px dashed ${COLORS.slate300}`, borderRadius: '12px', padding: '20px', textAlign: 'center', color: COLORS.slate500, fontSize: '13px' }}>
              Fields for <b>{taskType}</b> aren't designed yet — the standard fields above still save. Flag it if you want this one prioritized next.
            </div>
          </>
        )}

        {error && <p style={modalErrorStyle}>{error}</p>}
        {savedMessage && <p style={{ margin: '12px 0 0 0', fontSize: '13px', fontWeight: 700, color: COLORS.green600 }}>{savedMessage}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          style={{ marginTop: '20px', padding: '12px 24px', background: COLORS.teal700, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Saving...' : 'Save Task'}
        </button>
      </div>
    </div>
  )
}
