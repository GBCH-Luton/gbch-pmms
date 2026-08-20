// Temporary garden survey campaign (see GARDEN_SURVEY_CAMPAIGN_ENABLED in
// admin/shared.jsx) -- a stripped-down version of the real Gardens tab
// (admin/PropertyGardensTab.jsx) for Ticket Submitters, who visit
// properties daily and can record garden state/photos on the spot instead
// of waiting on an admin to enter it. Reads/writes go through two narrow
// SECURITY DEFINER functions (scripts/add_garden_survey_campaign.sql) since
// submitters have no direct row-level access to pmms.properties at all --
// same reasoning as pmms.builder_properties().
//
// A property drops off the picker the moment anyone submits it
// (garden_survey_completed_at gets stamped server-side), and the update
// itself only matches a still-null row -- so two support workers visiting
// the same property can't clobber each other; whoever's second just gets a
// clear "already surveyed" error instead of silently overwriting.

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { COLORS } from '../lib/colors'
import { GARDEN_STATE_OPTIONS } from './admin/shared'
import { compressImage } from '../lib/imageCompression'
import { getSignedUrl } from '../lib/storage'
import PropertySearchSelect from '../components/PropertySearchSelect'

const cardStyle = { background: COLORS.white, borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '20px', marginBottom: '16px' }
const fieldLabelStyle = { margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }
const uploadBtnStyle = { width: '100%', height: '44px', borderRadius: '10px', border: `2px dashed ${COLORS.slate300}`, background: COLORS.white, color: COLORS.slate500, fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }

export default function GardenSurvey() {
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [propertyId, setPropertyId] = useState('')
  const [hasGarden, setHasGarden] = useState(null) // null | true | false
  const [gardenState, setGardenState] = useState('')
  const [frontUrl, setFrontUrl] = useState('')
  const [backUrl, setBackUrl] = useState('')
  const [frontUploading, setFrontUploading] = useState(false)
  const [backUploading, setBackUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => { fetchProperties() }, [])

  async function fetchProperties() {
    setLoading(true)
    const { data, error: fetchError } = await supabase.schema('pmms').rpc('garden_survey_properties')
    if (!fetchError) setProperties(data || [])
    setLoading(false)
  }

  function resetForm() {
    setPropertyId('')
    setHasGarden(null)
    setGardenState('')
    setFrontUrl('')
    setBackUrl('')
    setError('')
  }

  async function handlePhotoUpload(e, side) {
    const file = e.target.files?.[0]
    if (!file) return

    const setUploading = side === 'front' ? setFrontUploading : setBackUploading
    const setUrl = side === 'front' ? setFrontUrl : setBackUrl
    setUploading(true)
    setError('')

    let compressed
    try {
      compressed = await compressImage(file)
    } catch (compressErr) {
      setUploading(false)
      setError(compressErr.message)
      return
    }
    const path = `${propertyId}/garden-${side}-${Date.now()}-${compressed.name}`
    const { error: uploadError } = await supabase.storage.from('property-photos').upload(path, compressed)

    if (uploadError) {
      setUploading(false)
      setError(`Upload failed: ${uploadError.message}`)
      return
    }

    setUrl(await getSignedUrl('property-photos', path))
    setUploading(false)
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError('')

    const { error: submitError } = await supabase.schema('pmms').rpc('submit_garden_survey', {
      p_property_id: propertyId,
      p_has_garden: hasGarden,
      p_state: hasGarden ? (gardenState || null) : null,
      p_front_photo_url: hasGarden ? (frontUrl || null) : null,
      p_back_photo_url: hasGarden ? (backUrl || null) : null,
    })

    setSubmitting(false)

    if (submitError) {
      setError('Someone may have already surveyed this one — refreshing your list.')
      resetForm()
      fetchProperties()
      return
    }

    const remaining = properties.length - 1
    setProperties(prev => prev.filter(p => p.id !== propertyId))
    setSuccess(`Saved. ${remaining} propert${remaining === 1 ? 'y' : 'ies'} left to check.`)
    resetForm()
    setTimeout(() => setSuccess(''), 4000)
  }

  const selectedProperty = properties.find(p => p.id === propertyId)
  const canSubmit = propertyId && hasGarden !== null && (!hasGarden || frontUrl) && !frontUploading && !backUploading

  return (
    <div style={{ maxWidth: '560px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>Garden Check</h2>
        <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>
          While you're at a property, quickly record its garden. Once you submit, it drops off this list so nobody else needs to redo it.
        </p>
      </div>

      {success && (
        <div style={{ background: COLORS.green50, border: `1px solid ${COLORS.green200}`, borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', fontWeight: 700, color: COLORS.green700 }}>
          ✓ {success}
        </div>
      )}

      <div style={cardStyle}>
        <p style={fieldLabelStyle}>Property ({properties.length} remaining)</p>
        {loading ? (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>Loading...</p>
        ) : properties.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.green700, fontWeight: 700 }}>All properties done! 🎉</p>
        ) : (
          <PropertySearchSelect
            properties={properties}
            value={propertyId}
            onChange={(id) => { resetForm(); setPropertyId(id) }}
            placeholder="Type to search properties..."
          />
        )}
      </div>

      {propertyId && (
        <div style={cardStyle}>
          <p style={fieldLabelStyle}>Does {selectedProperty?.address} have a garden?</p>
          <div style={{ display: 'flex', gap: '10px', marginBottom: hasGarden === true ? '20px' : 0 }}>
            <button
              onClick={() => setHasGarden(true)}
              style={{ flex: 1, padding: '10px', borderRadius: '10px', border: hasGarden === true ? `2px solid ${COLORS.green600}` : `1px solid ${COLORS.slate200}`, background: hasGarden === true ? COLORS.green50 : COLORS.white, color: COLORS.slate900, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
            >
              Yes
            </button>
            <button
              onClick={() => setHasGarden(false)}
              style={{ flex: 1, padding: '10px', borderRadius: '10px', border: hasGarden === false ? `2px solid ${COLORS.slate500}` : `1px solid ${COLORS.slate200}`, background: hasGarden === false ? COLORS.slate100 : COLORS.white, color: COLORS.slate900, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
            >
              No
            </button>
          </div>

          {hasGarden === true && (
            <>
              <p style={fieldLabelStyle}>State</p>
              <select value={gardenState} onChange={(e) => setGardenState(e.target.value)} style={{ ...inputStyle, marginBottom: '16px' }}>
                <option value="">Not set</option>
                {GARDEN_STATE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>

              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px' }}>
                  <p style={fieldLabelStyle}>Front Garden (required)</p>
                  {frontUrl && <img src={frontUrl} alt="Front garden" style={{ width: '100%', maxHeight: '160px', objectFit: 'cover', borderRadius: '10px', display: 'block', marginBottom: '8px' }} />}
                  <input type="file" accept="image/*" id="survey-front-photo" onChange={(e) => handlePhotoUpload(e, 'front')} style={{ display: 'none' }} />
                  <button onClick={() => document.getElementById('survey-front-photo').click()} disabled={frontUploading} style={{ ...uploadBtnStyle, cursor: frontUploading ? 'not-allowed' : 'pointer' }}>
                    {frontUploading ? 'Uploading...' : frontUrl ? 'Retake front photo' : 'Take/upload front photo'}
                  </button>
                </div>

                <div style={{ flex: '1 1 220px' }}>
                  <p style={fieldLabelStyle}>Back Garden (optional)</p>
                  {backUrl && <img src={backUrl} alt="Back garden" style={{ width: '100%', maxHeight: '160px', objectFit: 'cover', borderRadius: '10px', display: 'block', marginBottom: '8px' }} />}
                  <input type="file" accept="image/*" id="survey-back-photo" onChange={(e) => handlePhotoUpload(e, 'back')} style={{ display: 'none' }} />
                  <button onClick={() => document.getElementById('survey-back-photo').click()} disabled={backUploading} style={{ ...uploadBtnStyle, cursor: backUploading ? 'not-allowed' : 'pointer' }}>
                    {backUploading ? 'Uploading...' : backUrl ? 'Retake back photo' : 'Take/upload back photo'}
                  </button>
                </div>
              </div>
            </>
          )}

          {error && <p style={{ margin: '16px 0 0 0', fontSize: '13px', color: COLORS.red600, fontWeight: 600 }}>{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            style={{ marginTop: '20px', width: '100%', padding: '12px', background: canSubmit ? COLORS.green600 : COLORS.slate200, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, cursor: canSubmit && !submitting ? 'pointer' : 'not-allowed' }}
          >
            {submitting ? 'Saving...' : 'Submit'}
          </button>
        </div>
      )}
    </div>
  )
}
