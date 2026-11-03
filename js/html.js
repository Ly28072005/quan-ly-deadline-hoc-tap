import { isoOf, parseTime, showDate } from './format.js'
import { STATUS } from './model.js?v=68'
import { icon } from './icons.js'

export { icon }

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

export function pill(key) {
  const item = STATUS[key] || STATUS.todo
  return `<span class="pill ${item.tone}">${item.check ? icon('check', 12) : ''}${esc(item.label)}</span>`
}

export function logo() {
  return `<span class="logo" aria-hidden="true"><svg viewBox="0 0 32 32" width="32" height="32"><rect width="32" height="32" rx="9" fill="currentColor"/><path d="M9 17c3.4-7.2 6.4-7.2 7.4-1.2C17.6 22 20.4 23 24 15" fill="none" stroke="var(--on-brand)" stroke-width="2.4" stroke-linecap="round"/></svg></span>`
}

const SWATCH = ['#1F7A68', '#3A5BA0', '#B0603A', '#7A4E9C', '#2F7FA3', '#8A7A2E']

export function accent(color) {
  if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) return color
  const n = Number(color)
  return `var(--c${Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0})`
}

export function swatch(color) {
  if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) return color
  return SWATCH[Number(color)] || SWATCH[0]
}

export function dot(color) {
  return `<i class="cdot" style="--accent:${accent(color)}"></i>`
}

export function wrapDate(inputHtml, iso = '') {
  return `<span class="date-field">${inputHtml}<button class="icon-btn date-btn" type="button" data-act="open-date" aria-label="Chọn trên lịch">${icon('calendar', 16)}</button><input class="date-native" type="date" tabindex="-1" value="${esc(iso || '')}" aria-hidden="true"></span>`
}

export function dateBox(name, value, bad = false, extra = '') {
  return wrapDate(
    `<input class="input${bad ? ' bad' : ''}" name="${esc(name)}" placeholder="dd/mm/yyyy" inputmode="numeric" autocomplete="off" value="${esc(showDate(value))}" ${extra}>`,
    isoOf(value),
  )
}

export function wrapTime(inputHtml, hhmm = '') {
  return `<span class="date-field">${inputHtml}<button class="icon-btn date-btn" type="button" data-act="open-time" aria-label="Chọn giờ">${icon('clock', 16)}</button><input class="date-native time-native" type="time" tabindex="-1" value="${esc(hhmm || '')}" aria-hidden="true"></span>`
}

export function timeBox(name, value, bad = false, extra = '') {
  const shown = parseTime(value)
  return wrapTime(
    `<input class="input${bad ? ' bad' : ''}" name="${esc(name)}" placeholder="hh:mm" inputmode="numeric" autocomplete="off" value="${esc(shown)}" ${extra}>`,
    shown,
  )
}

export function field(label, inner, error, required = false) {
  return `<label class="field"><span>${esc(label)}${required ? ' <i class="req">*</i>' : ''}</span>${inner}${error ? `<span class="err">${esc(error)}</span>` : ''}</label>`
}

export function empty(title, text, actions = '') {
  return `<div class="empty card"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="empty-actions">${actions}</div></div>`
}

export function banner(kind, title, body, actions = '') {
  const mark = kind === 'ok' ? 'check' : 'alert'
  return `<section class="banner ${kind}"><span class="banner-ico">${icon(mark, 18)}</span><div><strong>${esc(title)}</strong>${body ? `<p>${body}</p>` : ''}</div><div class="inline-actions">${actions}</div></section>`
}

export function progress(ratio, bad = false, number = true) {
  const pct = Math.max(0, Math.min(100, Math.round((Number(ratio) || 0) * 100)))
  return `<span class="progress ${bad ? 'bad' : ''}"><i style="width:${pct}%"></i></span>${number ? `<b class="num">${pct}%</b>` : ''}`
}

export function pageHead({ crumb = '', title, sub = '', back = '', actions = '', unread = 0 }) {
  return `<header class="page-head">
    <div class="page-titles">
      ${back ? `<a class="text-back" href="${esc(back)}">${icon('back', 16)} Quay lại</a>` : ''}
      ${crumb ? `<p class="crumb">${crumb}</p>` : ''}
      <h1>${title}</h1>
      ${sub ? `<p class="sub">${sub}</p>` : ''}
    </div>
    <div class="head-actions">
      ${actions}
      <a class="icon-btn" href="#/thong-bao" aria-label="Thông báo">${icon('bell')}${unread ? '<i class="dot-abs"></i>' : ''}</a>
    </div>
  </header>`
}

export function opts(pairs, current) {
  return pairs.map(([value, label]) => `<option value="${esc(value)}"${String(value) === String(current) ? ' selected' : ''}>${esc(label)}</option>`).join('')
}
