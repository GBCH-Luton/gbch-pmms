import { COLORS } from '../lib/colors'

// Small hand-rolled SVG bar chart -- this project has no charting library
// (@supabase/supabase-js, react, react-dom, react-router-dom are the only
// runtime deps), so a couple of chart types don't justify pulling one in.
// Renders one or more series as grouped bars per label, scaled to the
// largest single value across every series so bars stay comparable.
//
// data:   [{ label: string, values: number[] }]  -- one entry per x-axis tick
// series: [{ name: string, color: string }]      -- one entry per bar in a group
// onBarClick?: (dataItem, seriesIndex) => void    -- optional; when given, every
//   individual bar becomes clickable (data items can carry extra fields like a
//   week's ISO date range purely for the caller's own use -- this component
//   never reads anything but label/values off them).
// hideAxisLabels?: boolean -- drops the text label under each bar/group and
//   relies on the native SVG <title> hover tooltip (label + value) instead.
//   For callers whose labels are long/unpredictable (e.g. Ask AI's answer
//   modal -- ticket numbers plus a full address, or full staff names) where
//   the labels would otherwise overlap or clip past the chart's edge.

const CHART_HEIGHT = 180
const BAR_GAP = 4
const GROUP_GAP = 18

export default function SimpleBarChart({ data, series, height = CHART_HEIGHT, onBarClick, hideAxisLabels = false }) {
  if (!data || data.length === 0) {
    return <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No data for this range.</p>
  }

  const maxValue = Math.max(1, ...data.flatMap(d => d.values))
  const barWidth = 22
  const groupWidth = series.length * barWidth + (series.length - 1) * BAR_GAP
  const chartWidth = data.length * groupWidth + (data.length - 1) * GROUP_GAP
  // Labels rotate when there's only one bar per group and not much room per
  // label (the category/division breakdown) -- a grouped trend chart's
  // short date labels ("08/06") always fit horizontally, but longer text
  // like "Other / Unlisted Trade" overlaps its neighbour at this bar width
  // unless it's angled out of the way.
  const rotateLabels = !hideAxisLabels && series.length === 1 && data.some(d => d.label.length > 6)
  const labelHeight = hideAxisLabels ? 8 : (rotateLabels ? 70 : 34)
  // Rotated labels lean left from their anchor point, so the first one needs
  // breathing room on the left edge or it clips outside the SVG viewport.
  const sidePadding = rotateLabels ? 40 : 0

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={Math.max(chartWidth, 260) + sidePadding} height={height + labelHeight} role="img" aria-label="Bar chart">
        {data.map((d, groupIdx) => {
          const groupX = sidePadding + groupIdx * (groupWidth + GROUP_GAP)
          return (
            <g key={d.label}>
              {series.map((s, seriesIdx) => {
                const value = d.values[seriesIdx] || 0
                const barHeight = Math.round((value / maxValue) * (height - 20))
                const x = groupX + seriesIdx * (barWidth + BAR_GAP)
                const y = height - barHeight
                return (
                  <g key={s.name}>
                    <rect
                      x={x} y={y} width={barWidth} height={barHeight} rx={3} fill={s.color}
                      style={onBarClick && value > 0 ? { cursor: 'pointer' } : undefined}
                      onClick={onBarClick && value > 0 ? () => onBarClick(d, seriesIdx) : undefined}
                    >
                      {value > 0 && (
                        <title>{`${d.label}${series.length > 1 ? ` — ${s.name}` : ''}: ${value}${onBarClick ? ' -- click to view in Pipeline' : ''}`}</title>
                      )}
                    </rect>
                    {value > 0 && (
                      <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" fontSize="10" fontWeight="700" fill={COLORS.slate600}>
                        {value}
                      </text>
                    )}
                  </g>
                )
              })}
              {!hideAxisLabels && (rotateLabels ? (
                <text
                  x={groupX + groupWidth / 2} y={height + 14}
                  textAnchor="end" fontSize="11" fontWeight="600" fill={COLORS.slate500}
                  transform={`rotate(-40 ${groupX + groupWidth / 2} ${height + 14})`}
                >
                  {d.label}
                </text>
              ) : (
                <text x={groupX + groupWidth / 2} y={height + 18} textAnchor="middle" fontSize="11" fontWeight="600" fill={COLORS.slate500}>
                  {d.label}
                </text>
              ))}
            </g>
          )
        })}
      </svg>
      {series.length > 1 && (
        <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
          {series.map(s => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: s.color, display: 'inline-block' }} />
              <span style={{ fontSize: '12px', fontWeight: 600, color: COLORS.slate600 }}>{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
