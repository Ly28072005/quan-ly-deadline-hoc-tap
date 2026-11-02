export const DAY = 86400000
export const STEP = 30 * 60000

export const WEEKDAYS = [
  { id: 1, short: 'T2', full: 'Thứ Hai' },
  { id: 2, short: 'T3', full: 'Thứ Ba' },
  { id: 3, short: 'T4', full: 'Thứ Tư' },
  { id: 4, short: 'T5', full: 'Thứ Năm' },
  { id: 5, short: 'T6', full: 'Thứ Sáu' },
  { id: 6, short: 'T7', full: 'Thứ Bảy' },
  { id: 7, short: 'CN', full: 'Chủ Nhật' },
]

const BY_JS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']
const SHORT_JS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

export function pad(n) {
  return String(n).padStart(2, '0')
}

export function uid(prefix = 'id') {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3)
}

export function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

export function weekdayMon(date) {
  const d = date.getDay()
  return d === 0 ? 7 : d
}

export function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(isoOrTs) {
  const d = typeof isoOrTs === 'number' ? new Date(isoOrTs) : parseDate(isoOrTs)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export function parseDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number)
  return new Date(y || 1970, (m || 1) - 1, d || 1)
}

export function dateISO(ts) {
  const d = ts instanceof Date ? ts : new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function atTime(day, hhmm) {
  const d = typeof day === 'string' ? parseDate(day) : new Date(day)
  const [h, m] = String(hhmm || '00:00').split(':').map(Number)
  d.setHours(h || 0, m || 0, 0, 0)
  return d.getTime()
}

export function clock(ts) {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function roundUp30(ts) {
  const r = ts % STEP
  return r === 0 ? ts : ts + (STEP - r)
}

export function minutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}

export function formatHours(n) {
  const rounded = Math.round((Number(n) || 0) * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',')
}

export function formatPercent(ratio) {
  if (!Number.isFinite(ratio)) return '0'
  return String(Math.round(ratio * 100))
}

export function formatBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return `${Math.round(v)} B`
  if (v < 1048576) return `${Math.max(1, Math.round(v / 1024))} KB`
  return `${(v / 1048576).toFixed(1).replace('.', ',')} MB`
}

export function formatAgo(ts, now = Date.now()) {
  const mins = Math.round((now - ts) / 60000)
  if (mins < 1) return 'Vừa xong'
  if (mins < 60) return `${mins} phút trước`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} giờ trước`
  const days = Math.round(hours / 24)
  return days === 1 ? '1 ngày trước' : `${days} ngày trước`
}

export function formatDM(ts) {
  return formatDMY(ts)
}

export function formatDMY(ts) {
  const d = new Date(ts)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function formatISO(iso) {
  const [y, m, d] = String(iso || '').split('T')[0].split('-')
  if (!y || !m || !d) return ''
  return `${pad(d)}/${pad(m)}/${y}`
}

export function parseDMY(text) {
  const match = String(text || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return ''
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return ''
  return dateISO(date)
}

export function isoOf(value) {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  return parseDMY(text)
}

export function parseTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return ''
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return ''
  return `${pad(hour)}:${pad(minute)}`
}

export function showDate(value) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return formatISO(value)
  return String(value)
}

export function parseStamp(text) {
  const match = String(text || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/)
  if (!match) return ''
  const iso = parseDMY(`${match[1]}/${match[2]}/${match[3]}`)
  if (!iso) return ''
  return `${iso}T${pad(Number(match[4]))}:${pad(Number(match[5]))}`
}

export function showStamp(value) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return `${formatISO(value)} ${value.slice(11, 16)}`
  return String(value)
}

export function formatFullDate(ts) {
  return formatDMY(ts)
}

export function formatSpokenDate(ts) {
  return formatDMY(ts)
}

export function formatMonthTitle(start, end) {
  return `${formatDMY(start)} – ${formatDMY(end)}`
}

export function givenName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  return parts[parts.length - 1] || 'bạn'
}

export function formatWeekLabel(start, end) {
  return `${formatDMY(start)} – ${formatDMY(end)}`
}

export function formatWhen(ts) {
  return formatDMY(ts)
}

export function formatSpan(start, end) {
  return `${clock(start)}–${clock(end)}`
}

export function formatSession(start, end) {
  if (dateISO(start) === dateISO(end)) return `${formatDMY(start)} ${formatSpan(start, end)}`
  return `${formatDMY(start)} ${clock(start)} – ${formatDMY(end)} ${clock(end)}`
}

export function dayPart(now = new Date()) {
  const h = now.getHours()
  if (h >= 5 && h < 11) return 'sáng'
  if (h >= 11 && h < 13) return 'trưa'
  if (h >= 13 && h < 18) return 'chiều'
  return 'tối'
}

export function daysUntil(deadline, now) {
  return Math.round((startOfDay(deadline) - startOfDay(now)) / DAY)
}

export function remainLabel(deadline, now) {
  if (deadline < now) return { late: true, text: 'Quá hạn' }
  const days = daysUntil(deadline, now)
  if (days <= 0) return { late: false, text: 'Hôm nay' }
  return { late: false, text: `Còn ${days} ngày` }
}

export function weekRange(now) {
  const start = startOfDay(now) - (weekdayMon(new Date(now)) - 1) * DAY
  const end = start + 6 * DAY
  return { start, end }
}

export function sameDay(a, b) {
  return startOfDay(a) === startOfDay(b)
}

export function weekdayLabel(id, full = false) {
  const item = WEEKDAYS.find((day) => day.id === Number(id))
  if (!item) return ''
  return full ? item.full : item.short
}
