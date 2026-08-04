// Sidebar line icons ("Clean Outline" style, picked 2026-08-03 from a set
// of drafts previewed as an artifact). Plain shapes, no colour -- deliberately
// simple rather than a full icon library since only ~20 are ever needed here.
const PATHS = {
  dashboard: (
    <>
      <polyline points="3,11 12,4 21,11" />
      <path d="M5,10 V20 H19 V10" />
      <rect x="10" y="13" width="4" height="7" />
    </>
  ),
  chat: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="3" />
      <polyline points="8,17 6,21 11,17" />
    </>
  ),
  pipeline: (
    <path d="M14.5 5.5a3.5 3.5 0 0 1-4.6 4.9L6 14.3l-2.3 2.3 3 3 2.3-2.3 3.9-3.9a3.5 3.5 0 0 1 4.9-4.6l-3.3-3.3z" />
  ),
  ticket: (
    <>
      <path d="M4 20 V16 L15 5 a2.1 2.1 0 0 1 3 3 L7 19 Z" />
      <line x1="13" y1="7" x2="17" y2="11" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8,12.5 11,15.5 16,9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </>
  ),
  building: (
    <>
      <rect x="6" y="3" width="12" height="18" />
      <rect x="9" y="6.5" width="1.8" height="1.8" />
      <rect x="13.2" y="6.5" width="1.8" height="1.8" />
      <rect x="9" y="10.5" width="1.8" height="1.8" />
      <rect x="13.2" y="10.5" width="1.8" height="1.8" />
      <rect x="9" y="14.5" width="1.8" height="1.8" />
      <rect x="13.2" y="14.5" width="1.8" height="1.8" />
    </>
  ),
  key: (
    <>
      <circle cx="7" cy="15" r="4" />
      <path d="M10 12 L20 2" />
      <path d="M16 6 L19 9" />
      <path d="M13 9 L16 12" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 L20 6 V11 C20 16 16.5 20 12 21 C7.5 20 4 16 4 11 V6 Z" />
      <polyline points="9,12 11,14.2 15,9" />
    </>
  ),
  broom: (
    <>
      <line x1="18.5" y1="4" x2="9.5" y2="13" />
      <path d="M9.5 13 L4 21 L14.5 16 Z" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20 C3 16 6 14 9 14 C12 14 15 16 15 20" />
      <circle cx="17.3" cy="9.3" r="2.3" />
      <path d="M15.3 20 C15.3 17.2 17 15.4 19.2 15.4 C20.6 15.4 21.2 16.3 21.4 17.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="7" x2="12" y2="12" />
      <line x1="12" y1="12" x2="15.6" y2="14" />
    </>
  ),
  box: (
    <>
      <path d="M3 8 L12 3.5 L21 8 L21 17 L12 21.5 L3 17 Z" />
      <polyline points="3,8 12,12.2 21,8" />
      <line x1="12" y1="12.2" x2="12" y2="21.5" />
    </>
  ),
  chart: (
    <>
      <line x1="5" y1="20" x2="5" y2="12" />
      <line x1="11" y1="20" x2="11" y2="7" />
      <line x1="17" y1="20" x2="17" y2="15" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </>
  ),
  chevronLeft: (
    <polyline points="15,5 9,12 15,19" />
  ),
  sparkle: (
    <>
      <path d="M12 3 L13.6 9 L20 10.5 L13.6 12 L12 18 L10.4 12 L4 10.5 L10.4 9 Z" />
      <path d="M19 3.5 L19.5 5.3 L21.3 5.8 L19.5 6.3 L19 8 L18.5 6.3 L16.7 5.8 L18.5 5.3 Z" />
    </>
  ),
  sunrise: (
    <>
      <line x1="4" y1="18" x2="20" y2="18" />
      <path d="M7 18 a5 5 0 0 1 10 0" />
      <line x1="12" y1="6" x2="12" y2="9" />
      <line x1="5.5" y1="10.5" x2="7.8" y2="12.3" />
      <line x1="18.5" y1="10.5" x2="16.2" y2="12.3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <line x1="12" y1="2.5" x2="12" y2="5.3" />
      <line x1="12" y1="18.7" x2="12" y2="21.5" />
      <line x1="2.5" y1="12" x2="5.3" y2="12" />
      <line x1="18.7" y1="12" x2="21.5" y2="12" />
      <line x1="5.3" y1="5.3" x2="7.3" y2="7.3" />
      <line x1="16.7" y1="16.7" x2="18.7" y2="18.7" />
      <line x1="18.7" y1="5.3" x2="16.7" y2="7.3" />
      <line x1="7.3" y1="16.7" x2="5.3" y2="18.7" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11 V7 a4 4 0 0 1 8 0 V11" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12 C5 6 19 6 22 12 C19 18 5 18 2 12 Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  book: (
    <>
      <path d="M4 5 C7 3 10 3 12 5 C14 3 17 3 20 5 V19 C17 17 14 17 12 19 C10 17 7 17 4 19 Z" />
      <line x1="12" y1="5" x2="12" y2="19" />
    </>
  ),
  logout: (
    <>
      <path d="M13 4 H6 a1 1 0 0 0-1 1 V19 a1 1 0 0 0 1 1 H13" />
      <polyline points="16,8 20,12 16,16" />
      <line x1="20" y1="12" x2="9" y2="12" />
    </>
  ),
}

export function NavIcon({ name, size = 17 }) {
  const shape = PATHS[name]
  if (!shape) return null
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size}
      fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block' }}
    >
      {shape}
    </svg>
  )
}
