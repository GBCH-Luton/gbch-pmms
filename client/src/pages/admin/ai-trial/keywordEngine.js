// Free, rule-based "AI Trial" text understanding -- no external API, no
// cost. Deliberately simple keyword / word-overlap matching, not a real
// language model. See memory project_ai_trial_menu.md for the real-AI
// upgrade path (swap this module's output for an actual API call; every
// AI Trial page already treats its result as "a suggestion to review", so
// the UI itself doesn't need to change).

const SEVERITY_BOOST_KEYWORDS = [
  'flooding', 'flood', 'burst', 'sparking', 'spark', 'gas smell', 'smell of gas',
  'no heat', 'no heating', 'no hot water', 'collapsed', 'collapsing', 'emergency',
  'urgent', 'exposed wire', 'exposed wires', 'live wire', 'fire', 'smoke',
]

const ROOM_KEYWORDS = {
  'Kitchen': ['kitchen'],
  'Bathroom': ['bathroom', 'toilet', 'shower', 'bath'],
  'Communal Area': ['communal', 'landing', 'stairwell'],
  'Bedroom': ['bedroom'],
  'Hallways / Stairs': ['hallway', 'stairs', 'staircase', 'corridor'],
  'Garden': ['garden', 'yard', 'outside', 'outdoor'],
}

// Static synonym boosts per category name -- catches common everyday
// phrasing that wouldn't literally appear in a configured issue-tag label
// (e.g. "tap" for Plumbing, "socket" for Electricity). Keyed by the
// default category names; a category renamed on the Settings page just
// won't get a synonym boost, falling back to plain word-overlap scoring.
const CATEGORY_SYNONYMS = {
  'Plumbing': ['leak', 'leaking', 'drip', 'dripping', 'pipe', 'tap', 'toilet', 'blocked', 'flooding', 'water', 'drain'],
  'Electricity': ['spark', 'sparking', 'electric', 'socket', 'power', 'outage', 'flicker', 'wiring', 'wire', 'fuse'],
  'Doors/Locks': ['lock', 'door', 'window', 'jammed', 'stuck', 'glazing', 'glass', 'key', 'hinge'],
}

function normalize(text) {
  return (text || '').toLowerCase()
}

function wordOverlapScore(text, label) {
  const words = label.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3)
  return words.reduce((sum, w) => sum + (text.includes(w) ? 1 : 0), 0)
}

// Reads a free-text description against the real, currently-configured
// maintenance categories (not a hardcoded copy) and suggests category,
// issue tag, and room. Returns nulls where nothing scored -- callers must
// let a person fill those in rather than guessing.
export function suggestTicketFields(description, maintenanceCategories) {
  const text = normalize(description)
  let best = null

  Object.entries(maintenanceCategories).forEach(([categoryName, cat]) => {
    const synonymScore = (CATEGORY_SYNONYMS[categoryName] || []).reduce((sum, w) => sum + (text.includes(w) ? 2 : 0), 0)
    ;(cat.subCategories || []).forEach(sub => {
      const score = wordOverlapScore(text, sub.label) + synonymScore
      if (score > 0 && (!best || score > best.score)) {
        best = { category: categoryName, issueTag: sub.label, score }
      }
    })
  })

  let room = null
  Object.entries(ROOM_KEYWORDS).forEach(([roomName, words]) => {
    if (!room && words.some(w => text.includes(w))) room = roomName
  })

  const severityHit = SEVERITY_BOOST_KEYWORDS.find(w => text.includes(w))

  return {
    category: best?.category || null,
    issueTag: best?.issueTag || null,
    confidence: best ? Math.min(best.score, 5) : 0,
    room,
    severityKeyword: severityHit || null,
  }
}

// Same severity-keyword scan, exposed on its own for AiPriorityScoring.jsx
// to run against already-raised tickets' stored description/issue_tag text.
export function suggestPriorityAdjustment(text) {
  const t = normalize(text)
  const hit = SEVERITY_BOOST_KEYWORDS.find(w => t.includes(w))
  return hit ? { bonus: 25, reason: `Description mentions "${hit}"` } : { bonus: 0, reason: null }
}
