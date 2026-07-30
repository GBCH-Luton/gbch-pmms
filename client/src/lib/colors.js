// Centralised colour palette -- named constants for the hex values already
// hand-typed as inline styles across pages/*, pages/admin/*, and
// components/*. These are Tailwind's default palette values (this app
// doesn't use Tailwind classes, just inline `style={{}}` objects, so this
// keeps that existing pattern but gives the values one place to live)
// rather than a repeated literal in every file. Only add a name here once
// a colour is actually reused elsewhere -- a one-off shade some component
// needs for itself doesn't belong in the shared palette.
//
// Migrate call sites incrementally (see AdminProperties.jsx for the first
// converted file) rather than all at once -- this file intentionally
// starts covering only the values already confirmed in use.

export const COLORS = {
  white: '#ffffff',

  // Slate (neutral text/background/border scale)
  slate50: '#f8fafc',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate600: '#475569',
  slate900: '#0f172a',

  // Stone (used for the Inactive property status -- deliberately distinct
  // from slate so it doesn't read as "just another neutral")
  stone200: '#e7e5e4',
  stone600: '#57534e',

  // Gray (Tailwind's neutral "gray" scale, distinct from the blue-tinted
  // "slate" scale above -- a few call sites use this one instead)
  gray700: '#374151',

  // Red (danger / expired / errors)
  red50: '#fef2f2',
  red100: '#fee2e2',
  red200: '#fecaca',
  red300: '#fca5a5',
  red500: '#ef4444',
  red600: '#dc2626',
  red900: '#7f1d1d',

  // Green (success / live / valid)
  green50: '#f0fdf4',
  green100: '#dcfce7',
  green200: '#bbf7d0',
  green600: '#16a34a',
  green800: '#166534',
  green900: '#14532d',
  greenDark: '#19562e',

  // Teal (brand accent -- primary buttons, "new" badges, active nav)
  teal50: '#f0fdfa',
  teal100: '#ccfbf1',
  teal300: '#99f6e4',
  teal600: '#0d9488',
  teal700: '#0f766e',

  // Amber (warning / due soon / procured)
  amber50: '#fffbeb',
  amber100: '#fef3c7',
  amber200: '#fde68a',
  amber300: '#fcd34d',
  amber500: '#f59e0b',
  amber600: '#d97706',
  amber700: '#b45309',
  amber800: '#92400e',
  amber900: '#78350f',
  orange50: '#fff7ed',
  orange100: '#ffedd5',
  orange200: '#fed7aa',
  orange700: '#c2410c',
  orange900: '#7c2d12',

  // Blue (primary / links / info)
  blue50: '#eff6ff',
  blue100: '#dbeafe',
  blue200: '#bfdbfe',
  blue400: '#60a5fa',
  blue500: '#3b82f6',
  blue600: '#2563eb',
  blue700: '#1d4ed8',
  blue900: '#1e3a8a',

  // Purple / violet / indigo / pink (category/type badge variety)
  purple100: '#f3e8ff',
  purple600: '#9333ea',
  violet100: '#ede9fe',
  violet500: '#8b5cf6',
  violet600: '#7c3aed',
  indigo100: '#e0e7ff',
  indigo700: '#4338ca',
  pink100: '#fce7f3',
  pink700: '#be185d',

  // Brand (logo/splash gradient -- not part of the neutral/status scales above)
  brandNavy: '#0D1B3E',
  brandNavyMid: '#0A2444',
  brandNavyLight: '#0D2F5E',
}
