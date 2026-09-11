const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** `2026-09-10` -> `10 September 2026`. Dates are shown to people, never as codes. */
export function humanDate(iso) {
  if (typeof iso !== 'string') return ''
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return iso
  return `${day} ${MONTHS[month - 1]} ${year}`
}

/** How this project's own history is keyed, alongside the apps. */
export const LOCAL_KEY = '__local'
