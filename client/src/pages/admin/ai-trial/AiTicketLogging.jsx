// AI Trial: describe an issue in plain language, get a drafted ticket to
// review and submit. Uses the free, rule-based keywordEngine.js (no
// external API, no cost) -- not a real language model. See
// keywordEngine.js's own header comment for the real-AI upgrade path.

import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { COLORS } from '../../../lib/colors'
import { fetchMaintenanceCategories, sortedCategoryEntries, calculatePriorityScore } from '../../../lib/maintenanceCategories'
import { priorityTierLabel, fetchPriorityThresholds } from '../shared'
import { suggestTicketFields } from './keywordEngine'
import PropertySearchSelect from '../../../components/PropertySearchSelect'
import VoiceInputButton from '../../../components/VoiceInputButton'

const ROOM_OPTIONS = ['Kitchen', 'Bathroom', 'Communal Area', 'Bedroom', 'Hallways / Stairs', 'Garden', 'Other Area...']

const choiceBtn = (active) => ({
  padding: '8px 12px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, fontFamily: 'inherit',
  border: active ? `2px solid ${COLORS.teal700}` : `1px solid ${COLORS.slate200}`,
  background: active ? COLORS.teal700 : COLORS.white, color: active ? COLORS.white : COLORS.slate900,
  cursor: 'pointer',
})
const fieldLabelStyle = { margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }
const inputStyle = { width: '100%', height: '44px', padding: '0 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }
const cardStyle = { background: COLORS.white, borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '24px', maxWidth: '640px' }

function TrialBanner() {
  return (
    <div style={{ background: COLORS.violet100, border: `1px solid ${COLORS.violet500}`, borderRadius: '12px', padding: '16px 18px', marginBottom: '18px' }}>
      <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>✨ What this page is</p>
      <p style={{ margin: '0 0 8px 0', fontSize: '12.5px', color: COLORS.slate600, lineHeight: 1.6 }}>
        A quicker way to raise a ticket: describe the issue in your own words instead of clicking through Property → Room → Category → Issue Tag by hand. It's <b style={{ color: COLORS.slate900 }}>free, rule-based keyword matching</b> -- not a connected AI service yet -- so it works well on common, clearly-worded issues and may miss unusual phrasing. Nothing is created until you review and submit.
      </p>
      <p style={{ margin: '0 0 10px 0', fontSize: '12.5px', color: COLORS.slate600, lineHeight: 1.6 }}>
        <b style={{ color: COLORS.slate900 }}>How the priority score is worked out:</b> exactly the same way as the real Log a Ticket page. The keyword matching only guesses which category and issue tag fit your description -- the actual points come from the category weights and issue-tag scores configured on the <b>Settings</b> page, the same real numbers Log a Ticket uses. Change a score on Settings, and this page's results change too.
      </p>
      <p style={{ margin: '0 0 6px 0', fontSize: '12.5px', fontWeight: 800, color: COLORS.slate900 }}>Steps:</p>
      <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: COLORS.slate600, lineHeight: 1.7 }}>
        <li>Type (or speak) what's wrong, in plain language -- mention the property address if you can.</li>
        <li>Click <b>Draft the ticket</b>.</li>
        <li>Check the suggested property, room, category, and issue tag -- anything wrong or missing, click to change it by hand.</li>
        <li>Look at the priority score shown -- that's the real number this ticket would get, not a guess.</li>
        <li>Click <b>Submit</b> -- this creates a real ticket, exactly as if it were raised from Log a Ticket.</li>
      </ol>
    </div>
  )
}

export default function AiTicketLogging({ profile }) {
  const [properties, setProperties] = useState([])
  const [maintenanceCategories, setMaintenanceCategories] = useState({})
  const [p1Threshold, setP1Threshold] = useState(70)
  const [p2Threshold, setP2Threshold] = useState(40)

  const [description, setDescription] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [drafted, setDrafted] = useState(false)

  const [propertyId, setPropertyId] = useState('')
  const [room, setRoom] = useState(null)
  const [category, setCategory] = useState(null)
  const [issueTag, setIssueTag] = useState(null)
  const [matchedFromText, setMatchedFromText] = useState({ property: false, room: false, category: false })

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    supabase.schema('pmms').rpc('builder_properties').order('address').then(({ data, error: fetchError }) => {
      if (!fetchError) setProperties(data || [])
    })
    fetchMaintenanceCategories().then(setMaintenanceCategories)
    fetchPriorityThresholds().then(({ p1, p2 }) => { setP1Threshold(p1); setP2Threshold(p2) })
  }, [])

  function handleAnalyze() {
    setAnalyzing(true)
    setError('')
    setTimeout(() => {
      const suggestion = suggestTicketFields(description, maintenanceCategories)

      const lowerDesc = description.toLowerCase()
      const matchedProperty = properties.find(p => lowerDesc.includes(p.address.toLowerCase()))

      setPropertyId(matchedProperty ? String(matchedProperty.id) : '')
      setRoom(suggestion.room)
      setCategory(suggestion.category)
      setIssueTag(suggestion.issueTag)
      setMatchedFromText({ property: !!matchedProperty, room: !!suggestion.room, category: !!suggestion.category })

      setAnalyzing(false)
      setDrafted(true)
    }, 550) // brief pause so the "analyzing" state is visible -- matching latency is real once a genuine AI call replaces this
  }

  async function handleSubmit() {
    setError('')
    setSubmitting(true)

    const priorityScore = category ? calculatePriorityScore(maintenanceCategories, category, issueTag) : 15

    const { data, error: insertError } = await supabase
      .schema('pmms')
      .from('tickets')
      .insert({
        property_id: propertyId || null,
        room: room === 'Other Area...' ? 'Other Area' : room,
        category,
        issue_tag: issueTag,
        description: description.trim(),
        priority_score: priorityScore,
        status: 'Pending',
        raised_by: profile.id,
        raised_by_name: profile.name,
        created_at: new Date().toISOString(),
        status_changed_at: new Date().toISOString(),
      })
      .select('id, ticket_number')

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setSuccess(`Logged as Job #${data[0].ticket_number}.`)
    setDescription(''); setDrafted(false); setPropertyId(''); setRoom(null); setCategory(null); setIssueTag(null)
  }

  const priorityScore = category ? calculatePriorityScore(maintenanceCategories, category, issueTag) : null
  const priorityTier = priorityScore != null ? priorityTierLabel(priorityScore, p1Threshold, p2Threshold) : null
  const canSubmit = propertyId && room && category && issueTag && !submitting

  return (
    <div>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>AI Trial · Ticket Logging</h1>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: COLORS.slate500 }}>Describe the issue in plain language -- fields get drafted for you to review.</p>
      <TrialBanner />

      <div style={cardStyle}>
        {success && (
          <div style={{ padding: '12px 14px', background: COLORS.green50, border: `1px solid ${COLORS.green300}`, borderRadius: '10px', marginBottom: '18px' }}>
            <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: COLORS.green700 }}>✓ {success}</p>
          </div>
        )}

        <p style={fieldLabelStyle}>What's going on?</p>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          <textarea
            value={description}
            onChange={(e) => { setDescription(e.target.value); setDrafted(false) }}
            rows={3}
            placeholder="e.g. Kitchen sink at 12 Elm St is leaking badly, water pooling on the floor since this morning"
            style={{ ...inputStyle, height: 'auto', padding: '10px 12px', flex: 1, resize: 'vertical' }}
          />
          <VoiceInputButton onResult={(text) => { setDescription(prev => prev ? `${prev} ${text}` : text); setDrafted(false) }} />
        </div>

        <button onClick={handleAnalyze} disabled={!description.trim() || analyzing} style={{ ...choiceBtn(true), width: '100%', padding: '12px', opacity: !description.trim() || analyzing ? 0.5 : 1, cursor: !description.trim() || analyzing ? 'not-allowed' : 'pointer' }}>
          {analyzing ? 'Analyzing...' : '✨ Draft the ticket'}
        </button>

        {drafted && (
          <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: `1px solid ${COLORS.slate100}` }}>
            <p style={{ margin: '0 0 14px 0', fontSize: '12px', fontWeight: 700, color: COLORS.violet600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Suggested — review and edit anything below
            </p>

            <p style={fieldLabelStyle}>Property {matchedFromText.property && <span style={{ color: COLORS.violet600, fontWeight: 400, textTransform: 'none' }}>· matched from text</span>}</p>
            <div style={{ marginBottom: '14px' }}>
              <PropertySearchSelect properties={properties} value={propertyId} onChange={setPropertyId} />
            </div>

            <p style={fieldLabelStyle}>Room {matchedFromText.room && <span style={{ color: COLORS.violet600, fontWeight: 400, textTransform: 'none' }}>· matched from text</span>}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
              {ROOM_OPTIONS.map(r => (
                <button key={r} onClick={() => setRoom(r)} style={choiceBtn(room === r)}>{r}</button>
              ))}
            </div>

            <p style={fieldLabelStyle}>Category {matchedFromText.category && <span style={{ color: COLORS.violet600, fontWeight: 400, textTransform: 'none' }}>· matched from text</span>}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
              {sortedCategoryEntries(maintenanceCategories).map(([key]) => (
                <button key={key} onClick={() => { setCategory(key); setIssueTag(null) }} style={choiceBtn(category === key)}>{key}</button>
              ))}
            </div>

            {category && (
              <>
                <p style={fieldLabelStyle}>Issue Tag</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                  {(maintenanceCategories[category]?.subCategories || []).map(sub => (
                    <button key={sub.label} onClick={() => setIssueTag(sub.label)} style={{ ...choiceBtn(issueTag === sub.label), textAlign: 'left' }}>{sub.label}</button>
                  ))}
                </div>
              </>
            )}

            {priorityTier && (
              <div style={{ padding: '12px 14px', borderRadius: '10px', background: COLORS.slate50, marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: COLORS.slate500 }}>Priority (same scoring engine as Log a Ticket)</span>
                <span style={{ fontSize: '12px', fontWeight: 800, color: priorityTier === 'P1 Critical' ? COLORS.red600 : COLORS.slate600 }}>{priorityTier} · {priorityScore} pts</span>
              </div>
            )}

            {!category && (
              <p style={{ fontSize: '12px', color: COLORS.amber600, marginBottom: '14px' }}>Couldn't confidently match a category from that description -- pick one above by hand.</p>
            )}

            {error && <p style={{ color: COLORS.red600, fontSize: '13px', fontWeight: 600, marginBottom: '14px' }}>{error}</p>}

            <button onClick={handleSubmit} disabled={!canSubmit} style={{ ...choiceBtn(true), width: '100%', padding: '12px', opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
              {submitting ? 'Submitting...' : 'Looks good — Submit →'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
