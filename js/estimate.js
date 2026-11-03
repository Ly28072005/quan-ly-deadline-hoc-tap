import { fold } from './format.js'

export const PHASES = [
  { key: 'research', name: 'Nghiên cứu & lập dàn ý', ratio: 0.2 },
  { key: 'execute', name: 'Thực thi chính', ratio: 0.5 },
  { key: 'review', name: 'Chỉnh sửa & hoàn thiện', ratio: 0.2 },
  { key: 'buffer', name: 'Kiểm tra cuối & đóng gói', ratio: 0.1 },
]

const PAGE_MIN = 45
const SLIDE_MIN = 20
const DIAGRAM_MIN = 30
const FN_MIN = 75

export function roundHalf(value) {
  return Math.round(Number(value) * 2) / 2
}

function qty(text) {
  return Number(String(text || '').replace(',', '.')) || 0
}

function takeRange(a, b) {
  return Math.max(qty(a), qty(b) || qty(a))
}

function sumUnit(src, units) {
  const body = units.join('|')
  let total = 0
  let rest = src
  const range = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:-|–|den|toi)\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:${body})\\b`, 'g')
  rest = rest.replace(range, (_, a, b) => {
    total += takeRange(a, b)
    return ' '
  })
  const single = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:${body})\\b`, 'g')
  rest = rest.replace(single, (_, n) => {
    total += qty(n)
    return ' '
  })
  return { total, rest }
}

function keywordHits(src, words) {
  let count = 0
  for (const word of words) {
    const re = new RegExp(`\\b${word}\\b`, 'g')
    const hits = src.match(re)
    if (hits) count += hits.length
  }
  return count
}

export function parseWorkload(text, opts = {}) {
  const defaults = opts.defaults !== false
  const src = fold(String(text || ''))
  const pages = sumUnit(src, ['trang', 'page', 'pages'])
  const slides = sumUnit(pages.rest, ['slide', 'slides', 'ppt'])
  const diagrams = sumUnit(slides.rest, ['so do', 'so-do', 'bpmn', 'uml', 'erd', 'usecase', 'use case', 'mo hinh', 'wireframe'])
  const fns = sumUnit(diagrams.rest, ['chuc nang', 'function', 'functions', 'ham', 'endpoint', 'module'])

  let pageN = pages.total
  let slideN = slides.total
  let diagramN = diagrams.total
  let fnN = fns.total
  const explicit = pageN * PAGE_MIN + slideN * SLIDE_MIN + diagramN * DIAGRAM_MIN + fnN * FN_MIN

  if (defaults) {
    if (!pageN && /bao cao|van ban|luan van|luan|essay|paper|bai bao/.test(src)) pageN = 8
    if (!slideN && /slide|thuyet trinh|powerpoint/.test(src)) slideN = 12
    if (!diagramN && /so do|bpmn|uml|erd|usecase|use case|mo hinh|wireframe|kien truc/.test(src)) {
      diagramN = Math.max(1, keywordHits(src, ['usecase', 'erd', 'bpmn', 'uml', 'so do', 'mo hinh', 'kien truc']))
    }
    if (!fnN && /lap trinh|chuc nang|function|api|endpoint|code|lab|rest/.test(src)) fnN = 4
  }

  const minutes = pageN * PAGE_MIN + slideN * SLIDE_MIN + diagramN * DIAGRAM_MIN + fnN * FN_MIN
  const fallback = defaults && src.trim() ? 8 : 0
  const hours = explicit > 0 ? minutes / 60 : Math.max(minutes / 60, fallback)
  const bits = []
  if (pageN) bits.push(`${pageN} trang × 45 phút`)
  if (slideN) bits.push(`${slideN} slide × 20 phút`)
  if (diagramN) bits.push(`${diagramN} sơ đồ × 30 phút`)
  if (fnN) bits.push(`${fnN} chức năng × 75 phút`)
  if (explicit <= 0 && hours >= fallback && fallback) bits.push('tối thiểu 8 giờ cho dàn ý định tính')
  if (!bits.length && hours) bits.push('định mức mặc định 8 giờ')
  return { hours, minutes: hours * 60, pages: pageN, slides: slideN, diagrams: diagramN, functions: fnN, bits }
}

export function splitPhases(hBase) {
  const target = Math.max(2, roundHalf(hBase) || 2)
  const raw = PHASES.map((phase) => target * phase.ratio)
  const hours = raw.map((value) => Math.floor(value * 2) / 2)
  let used = hours.reduce((sum, value) => sum + value, 0)
  const order = [1, 0, 2, 3]
  let index = 0
  while (used + 0.05 < target) {
    hours[order[index % 4]] += 0.5
    used += 0.5
    index += 1
  }
  return PHASES.map((phase, i) => ({ ...phase, hours: Math.max(0.5, hours[i]) }))
}

export function sittingsOf(hours) {
  const start = roundHalf(Math.max(0.5, hours))
  if (start <= 2) return [start]
  const chunks = []
  let left = start
  while (left > 2) {
    chunks.push(2)
    left = roundHalf(left - 2)
  }
  if (left >= 0.5) chunks.push(left)
  else if (chunks.length) {
    chunks[chunks.length - 1] = roundHalf(chunks[chunks.length - 1] + left)
  }
  return chunks
}

export function spreadHours(count, total) {
  const hours = roundHalf(Math.max(1, total))
  const maxSlots = Math.max(1, Math.floor(hours))
  const n = Math.min(Math.max(1, Math.floor(Number(count) || 1)), maxSlots)
  const base = Array.from({ length: n }, () => 1)
  let rest = roundHalf(hours - n)
  let i = 0
  while (rest >= 1) {
    base[i % n] = roundHalf(base[i % n] + 1)
    rest = roundHalf(rest - 1)
    i += 1
  }
  if (rest >= 0.5) {
    const idx = base.findIndex((value) => value < 2)
    if (idx >= 0) base[idx] = roundHalf(base[idx] + 0.5)
    else base[n - 1] = roundHalf(base[n - 1] + 0.5)
  }
  return base
}

export function estimateWorkload(text) {
  const work = parseWorkload(text)
  const hours = roundHalf(work.hours || 0)
  return {
    ...work,
    hours,
    summary: work.bits.length
      ? `H_base ${hours} giờ (${work.bits.join(', ')}).`
      : '',
  }
}
