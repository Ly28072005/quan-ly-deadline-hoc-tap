import { createStore } from './store.js'
import {
  buildView, chatReply, classIntervals, classifyChat, compressFarBuffers, courseWindowWarnings, findWindow, hasScheduleIssue, hourHardError, isParent, leafTasks, openHours, planStats, proposeFix, pruneClassClashes,
  alignCourseSchedule, applyHoursChange, placeTaskWindow, previewReflow, reflowAll, reviewTasks, scheduleClash, scheduleLoad, shortPlans, suggestPlan, validateCourse, validateManual, reseatLater, taskHours,
  batchHoursOf, deadlineMilestones, noticeDue,
} from './model.js?v=93'
import { atTime, clock, dateISO, dayPart, fold, formatHours, givenName, isoOf, parseTime, showDate, uid } from './format.js'
import { extractFileText, fileKind, loadBlob, removeBlob, saveBlob } from './files.js?v=93'
import { aiReady, askAi, askPlan, blobToJpeg, blobToPdf, buildTutorPayload, geminiKey, probeAi, setGeminiKey, testGeminiKey } from './claude.js?v=93'
import { esc, icon, logo } from './html.js?v=93'
import { renderAuth, renderCourseDetail, renderCourseForm, renderCourses, renderDocs, renderHome } from './pages-a.js?v=93'
import { deadlineOf, manualIssues, materialize, renderAi, renderManual, renderPlanDetail, renderPlans } from './pages-b.js?v=93'
import { drawerHtml, renderCalendar, renderFree, renderNotice, renderNotices, renderSettings, renderTask } from './pages-c.js?v=93'

const store = createStore()
const NAV = [
  ['home', '#/', 'Trang chủ', 'home'],
  ['courses', '#/mon-hoc', 'Môn học', 'book'],
  ['plans', '#/ke-hoach', 'Kế hoạch', 'list'],
  ['calendar', '#/lich', 'Lịch học', 'calendar'],
  ['notices', '#/thong-bao', 'Thông báo', 'bell'],
]

let route = { name: 'home', id: '', query: {} }
let lastHash = location.hash || '#/'
let taskBack = ''
let modal = null
let viewer = null
let auth = { errors: {}, email: '', name: '', remember: true }
let reset = { step: 1, email: '', code: '', typed: '', errors: {} }
let form = null
let formKey = ''
let ai = null
let aiKey = ''
let pendingCourse = null // { planId, course }: course edit waiting to be saved with that plan's "Xác nhận kế hoạch"
let manual = null
let manualKey = ''
let aiTimer = 0
let hoursInputTimer = 0
let rendering = false
let chatBusy = ''
let aiLive = false
let planRun = 0
let drawer = false
let aiHistory = null // null: current chat · 'list': past chats · '<id>': one past chat
let freshAi = true // next time the assistant opens, start a new chat

function closeAi() {
  drawer = false
  aiHistory = null
  freshAi = true
  render()
}
let pendingAsk = ''
let slotDay = 0
let toasts = []
let cal = { hide: [], status: { todo: true, doing: true, done: true, overdue: true }, klass: true, free: true, tasks: true }
const narrowQuery = matchMedia('(max-width: 760px)')

function parse(hash) {
  const raw = (hash || '#/').replace(/^#/, '')
  const [path, qs] = raw.split('?')
  const query = Object.fromEntries(new URLSearchParams(qs || ''))
  const parts = path.split('/').filter(Boolean)
  const id = parts[1] ? decodeURIComponent(parts[1]) : ''
  const name = !parts.length ? 'home'
    : parts[0] === 'dang-nhap' ? 'login'
    : parts[0] === 'dang-ky' ? 'register'
    : parts[0] === 'quen-mat-khau' ? 'forgot'
    : parts[0] === 'mon-hoc' && id === 'moi' ? 'course-new'
    : parts[0] === 'mon-hoc' ? 'courses'
    : parts[0] === 'mon' && parts[2] === 'sua' ? 'course-edit'
    : parts[0] === 'mon' ? 'course'
    : parts[0] === 'tai-lieu' ? 'docs'
    : parts[0] === 'ke-hoach' && id === 'tao' ? 'plan-new'
    : parts[0] === 'ke-hoach' && id === 'ai' ? 'ai'
    : parts[0] === 'ke-hoach' && parts[2] === 'sua' ? 'plan-edit'
    : parts[0] === 'ke-hoach' && id ? 'plan'
    : parts[0] === 'ke-hoach' ? 'plans'
    : parts[0] === 'lich' && id === 'ranh' ? 'free'
    : parts[0] === 'lich' ? 'calendar'
    : parts[0] === 'nhiem-vu' ? 'task'
    : parts[0] === 'thong-bao' && id === 'cai-dat' ? 'settings'
    : parts[0] === 'thong-bao' && id ? 'notice'
    : parts[0] === 'thong-bao' ? 'notices'
    : 'home'
  return { name, id, query }
}

function isAuth(name) { return name === 'login' || name === 'register' || name === 'forgot' }
function section(name) {
  if (name.startsWith('course') || name === 'docs') return 'courses'
  if (name === 'plans' || name === 'plan' || name === 'plan-new' || name === 'plan-edit' || name === 'ai') return 'plans'
  if (name === 'calendar' || name === 'free') return 'calendar'
  if (name === 'task') return taskBack ? 'calendar' : 'plans'
  if (name === 'notices' || name === 'notice' || name === 'settings') return 'notices'
  return 'home'
}

function navigate(hash) {
  const next = hash.startsWith('#') ? hash : `#${hash}`
  if ((location.hash || '#/') === next) { onRoute(); return }
  location.hash = next
}
function setQuery(patch) {
  const query = { ...route.query, ...patch }
  Object.keys(query).forEach((key) => { if (query[key] === '' || query[key] == null) delete query[key] })
  const path = (location.hash || '#/').split('?')[0]
  const qs = new URLSearchParams(query).toString()
  const active = document.activeElement
  const key = active?.dataset?.key || ''
  const caret = active?.selectionStart
  history.replaceState(null, '', path + (qs ? `?${qs}` : ''))
  route = parse(location.hash)
  render()
  if (key) {
    const next = document.querySelector(`[data-key="${key}"]`)
    if (next) {
      next.focus()
      if (caret != null && next.setSelectionRange) next.setSelectionRange(caret, caret)
    }
  }
}

const toastTimers = new Map()
function toast(message, action) {
  const duplicate = toasts.find((item) => item.message === message && !item.action && !action)
  if (duplicate) {
    clearTimeout(toastTimers.get(duplicate.id))
    toastTimers.set(duplicate.id, setTimeout(() => dismissToast(duplicate.id), 2000))
    renderToasts()
    return
  }
  const id = uid('toast')
  toasts.unshift({ id, message, action })
  if (toasts.length > 2) {
    const dropped = toasts.pop()
    clearTimeout(toastTimers.get(dropped.id))
    toastTimers.delete(dropped.id)
  }
  renderToasts()
  toastTimers.set(id, setTimeout(() => dismissToast(id), action ? 3200 : 2000))
}
function dismissToast(id) {
  clearTimeout(toastTimers.get(id))
  toastTimers.delete(id)
  toasts = toasts.filter((item) => item.id !== id)
  renderToasts()
}
function renderToasts() {
  const root = document.getElementById('toasts')
  if (!root) return
  root.innerHTML = toasts.map((item) => `<div class="toast" role="status" data-id="${item.id}"><span>${esc(item.message)}</span>${item.action ? `<button type="button" data-toast="${item.id}">${esc(item.action.label)}</button>` : ''}</div>`).join('')
}

function blankCourse() {
  // Each new course starts on the next palette color; the custom picker can change it.
  const color = (store.snapshot()?.courses?.length || 0) % 6
  return { id: '', name: '', start: '', end: '', output: '', goal: '', notes: '', color, schedule: [], errors: {} }
}
function blankAi(data) {
  const studying = data.courses.filter((course) => course.end && atTime(course.end, '23:59') >= Date.now())
  const picked = studying.find((course) => course.id === route.query.mon) || null
  return {
    step: 1, planId: '', courseId: picked?.id || '', name: picked ? `Kế hoạch môn ${picked.name}` : '',
    date: picked?.end || '', time: '', start: picked?.start || '', output: picked?.output || '',
    docIds: data.documents.filter((doc) => doc.courseId === picked?.id).map((doc) => doc.id),
    tasks: [], comment: '', deadline: 0, displaced: 0, errors: {}, chars: 0,
  }
}
function blankManual() {
  return { id: '', name: '', courseId: '', date: '', time: '', output: '', tasks: newSection(), checked: false, errors: {} }
}

// A section (heading only, no dates) plus its first empty task row.
function newSection() {
  const id = uid('t')
  return [
    { id, parentId: '', name: '', start: '', end: '', status: 'todo', files: [] },
    { id: uid('t'), parentId: id, name: '', date: '', start: '', end: '', status: 'todo', files: [] },
  ]
}

function prepare() {
  // Leaving the plan screen without confirming drops the pending course change.
  if (pendingCourse && !(route.name === 'ai' && route.query.sua === pendingCourse.planId)) pendingCourse = null
  const data = store.current() ? store.snapshot() : null
  if (route.name === 'course-new' && formKey !== 'course-new') { form = blankCourse(); formKey = 'course-new' }
  else if (route.name === 'course-edit' && formKey !== `c:${route.id}` && data) {
    const course = data.courses.find((item) => item.id === route.id)
    form = course ? { ...course, schedule: course.schedule.map((row) => ({ ...row })), errors: {} } : blankCourse()
    const clash = scheduleClash(form, data.courses)
    if (clash) form.errors = { schedule: clash }
    formKey = `c:${route.id}`
  }
  if (route.name === 'ai' && data && aiKey !== `ai:${route.query.mon || ''}:${route.query.sua || ''}`) {
    if (route.query.sua) {
      const plan = data.plans.find((item) => item.id === route.query.sua)
      ai = plan ? aiFromPlan(plan) : blankAi(data)
    } else ai = blankAi(data)
    aiKey = `ai:${route.query.mon || ''}:${route.query.sua || ''}`
  }
  if (route.name === 'plan-new' && manualKey !== 'new') { manual = blankManual(); manualKey = 'new' }
  if (route.name === 'plan-edit' && data && manualKey !== `e:${route.id}`) {
    const plan = data.plans.find((item) => item.id === route.id)
    manual = plan ? manualFromPlan(plan) : blankManual()
    manualKey = `e:${route.id}`
  }
  if (route.name === 'notice' && data) {
    const notice = data.notices.find((item) => item.id === route.id)
    const now = Date.now()
    if (notice && !(notice.snoozeUntil > now) && !((notice.deliverAt || 0) > now)) store.markRead(route.id)
  }
}

function aiFromPlan(plan) {
  const course = store.snapshot().courses.find((item) => item.id === plan.courseId)
  return {
    step: 3, planId: plan.id, courseId: plan.courseId, name: plan.name,
    date: dateISO(plan.deadline), time: clock(plan.deadline), start: course?.start || '',
    output: course?.output || '',
    docIds: store.snapshot().documents.filter((doc) => doc.courseId === plan.courseId).map((doc) => doc.id),
    tasks: plan.tasks.map((task) => ({ ...task, files: task.files || [] })),
    comment: 'Đây là các nhiệm vụ đang có. Đổi ngày hoặc giờ của nhiệm vụ nếu cần, rồi xác nhận lại.',
    deadline: plan.deadline, errors: {}, chars: 0, dirtyTimes: false,
  }
}
function manualFromPlan(plan) {
  return {
    id: plan.id, name: plan.name, courseId: plan.courseId || '', date: dateISO(plan.deadline), time: clock(plan.deadline),
    output: '', checked: false, errors: {},
    tasks: plan.tasks.flatMap((task) => {
      const asRow = (item, parentId) => ({
        ...item, parentId, date: item.start ? dateISO(item.start) : '', start: item.start ? clock(item.start) : '', end: item.end ? clock(item.end) : '',
      })
      if (task.parentId) return [asRow(task, task.parentId)]
      // Older plans used a lone top-level item as a timed task: keep it as a task under a section of the same name.
      if (!plan.tasks.some((kid) => kid.parentId === task.id)) {
        const sectionId = uid('t')
        return [{ id: sectionId, parentId: '', name: task.name, start: '', end: '', status: 'todo', files: [] }, asRow(task, sectionId)]
      }
      return [{ ...task, start: '', end: '' }]
    }),
  }
}

function context() {
  const now = Date.now()
  const user = store.current()
  const data = withPending(store.snapshot())
  const view = buildView(data, now)
  return {
    now, user, data, view, route, query: route.query, unread: store.unread(now),
    part: dayPart(new Date(now)), given: givenName(user?.name),
    form, ai, manual, slotDay, cal, narrow: narrowQuery.matches,
    source: data.settings.aiAck && aiReady(aiLive) ? 'gemini' : 'sim',
    aiOn: aiReady(aiLive),
    chatBusy,
    aiHistory,
    pendingCourse: pendingCourse && route.name === 'ai' && route.query.sua === pendingCourse.planId ? pendingCourse.course : null,
    taskBack,
  }
}

function shell(page) {
  const user = store.current()
  const unread = store.unread()
  const active = section(route.name)
  const nav = NAV.map(([key, href, label, name]) => `<a href="${href}" class="${active === key ? 'on' : ''}" title="${label}"><span class="nav-ico">${icon(name, 20)}</span><span>${label}</span>${key === 'notices' && unread ? `<b class="badge">${unread}</b>` : ''}</a>`).join('')
  const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
  return `<div class="shell">
    <aside class="side">
      <a class="brand" href="#/">${logo()}<span>Studyflow</span></a>
      <nav>${nav}</nav>
      <div class="me">
        <span class="avatar">${esc((user?.name || 'S').trim().slice(0, 1))}</span>
        <span class="me-id"><strong>${esc(user?.name || '')}</strong><span class="sub">${esc(user?.email || '')}</span></span>
        <span class="me-actions">
          <button class="icon-btn" type="button" data-act="theme" aria-label="Đổi chế độ sáng tối">${icon(theme === 'dark' ? 'moon' : 'sun', 18)}</button>
          <button class="icon-btn" type="button" data-act="logout" aria-label="Đăng xuất">${icon('logout', 18)}</button>
        </span>
      </div>
    </aside>
    <div class="main">
      <header class="top${page.taskHead ? ' task-head' : ''}${page.planHead ? ' plan-head' : ''}">
        <div class="page-titles">
          ${page.back ? `<a class="back" href="${page.back}" aria-label="Quay lại">${icon('back', 18)}</a>` : ''}
          <div>${page.crumb ? `<p class="crumb">${page.crumb}</p>` : ''}<h1>${esc(page.title || '')}</h1>${page.sub ? `<p class="sub">${esc(page.sub)}</p>` : ''}</div>
        </div>
        <div class="head-actions">
          ${page.actions || ''}
          ${page.ask ? `<button class="icon-btn ask" type="button" data-act="ask-plan" data-id="${page.ask}" title="Hỏi trợ lý AI về kế hoạch này">${icon('help', 18)}</button>` : ''}
          <button class="ai-pill" type="button" data-act="open-ai"><span class="ai-mark">${icon('sparkles', 14)}</span><span>Trợ lý AI</span></button>
        </div>
      </header>
      <div class="content ${page.wide ? 'wide' : ''}">${page.html || ''}</div>
      ${page.foot ? `<footer class="sticky-foot">${page.foot}</footer>` : ''}
    </div>
    <nav class="tabbar">${nav}</nav>
  </div>
  ${drawer && store.current() ? drawerHtml(context()) : ''}
  ${modal ? `<div class="modal-back"><div class="modal" role="dialog"><h2>${esc(modal.title)}</h2><p>${esc(modal.body)}</p>${modal.extra || ''}<div class="form-foot"><button class="btn btn-ghost" type="button" data-act="modal-no">${esc(modal.cancel || 'Hủy')}</button><button class="btn ${modal.danger ? 'btn-danger' : 'btn-primary'}" type="button" data-act="modal-yes">${esc(modal.ok || 'Xóa')}</button></div></div></div>` : ''}
  ${viewerHtml()}`
}

function viewerHtml() {
  if (!viewer) return ''
  const body = viewer.kind === 'image'
    ? `<img src="${viewer.url}" alt="${esc(viewer.name)}">`
    : viewer.kind === 'pdf'
      ? `<iframe src="${viewer.url}" title="${esc(viewer.name)}"></iframe>`
      : viewer.kind === 'text'
        ? `<pre>${esc(viewer.text || '')}</pre>`
        : `<div class="viewer-fallback"><p>Tệp này mở bằng ứng dụng trên máy.</p><a class="btn btn-primary" href="${viewer.url}" download="${esc(viewer.name)}">Tải xuống</a></div>`
  return `<div class="viewer-back"><section class="viewer" role="dialog" aria-label="${esc(viewer.name)}"><header><strong>${esc(viewer.name)}</strong><button class="icon-btn" type="button" data-act="close-viewer" aria-label="Đóng">${icon('x', 18)}</button></header>${body}</section></div>`
}

function safeSel(el) {
  if (!el || typeof el.selectionStart !== 'number') return null
  try { return { start: el.selectionStart, end: el.selectionEnd ?? el.selectionStart } } catch { return null }
}

function render() {
  const root = document.getElementById('app')
  if (!root) return
  if (!store.current()) {
    if (!isAuth(route.name)) { location.hash = '#/dang-nhap'; return }
    root.innerHTML = renderAuth(route.name === 'register' ? 'register' : route.name === 'forgot' ? 'forgot' : 'login', auth, reset)
    return
  }
  if (isAuth(route.name)) { location.hash = '#/'; return }
  const active = document.activeElement
  const focusAi = active?.dataset?.act === 'ai-field'
    ? { id: active.dataset.id, key: active.dataset.key, sel: safeSel(active) }
    : null
  const winY = window.scrollY
  settleSchedule()
  prepare()
  captureDrafts()
  const ctx = context()
  const page = pageOf(ctx)
  rendering = true
  try {
    root.innerHTML = shell(page)
  } finally {
    rendering = false
  }
  const scroller = root.querySelector('[data-scroll="cal"]')
  if (scroller) scroller.scrollTop = 44
  if (window.scrollY !== winY) window.scrollTo(0, winY)
  if (focusAi?.id && focusAi?.key) {
    const nextEl = root.querySelector(`[data-act="ai-field"][data-id="${focusAi.id}"][data-key="${focusAi.key}"]`)
    if (nextEl) {
      nextEl.focus({ preventScroll: true })
      if (focusAi.sel && typeof nextEl.setSelectionRange === 'function') {
        try {
          const len = nextEl.value.length
          nextEl.setSelectionRange(Math.min(focusAi.sel.start, len), Math.min(focusAi.sel.end, len))
        } catch { /* ignore */ }
      }
    }
  }
}

function pageOf(ctx) {
  if (route.name === 'home') return renderHome(ctx)
  if (route.name === 'courses') return renderCourses(ctx)
  if (route.name === 'course') return renderCourseDetail(ctx)
  if (route.name === 'course-new' || route.name === 'course-edit') return renderCourseForm(ctx)
  if (route.name === 'docs') return renderDocs(ctx)
  if (route.name === 'plans') return renderPlans(ctx)
  if (route.name === 'plan') return renderPlanDetail(ctx)
  if (route.name === 'ai') return renderAi(ctx)
  if (route.name === 'plan-new' || route.name === 'plan-edit') return renderManual(ctx)
  if (route.name === 'calendar') return renderCalendar(ctx)
  if (route.name === 'free') return renderFree(ctx)
  if (route.name === 'task') return renderTask(ctx)
  if (route.name === 'notices') return renderNotices(ctx)
  if (route.name === 'notice') return renderNotice(ctx)
  if (route.name === 'settings') return renderSettings(ctx)
  return renderHome(ctx)
}

function draftDate(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return isoOf(text) || text
}

function captureDrafts() {
  const courseForm = document.querySelector('form[data-act="save-course"]')
  const courseKey = route.name === 'course-new' ? 'course-new' : route.name === 'course-edit' ? `c:${route.id}` : ''
  if (courseForm && form && courseKey && courseForm.dataset.key === courseKey && formKey === courseKey) {
    const fields = formFields(courseForm)
    form.name = fields.name ?? form.name
    form.notes = fields.notes ?? form.notes
    form.output = fields.output ?? form.output
    form.start = draftDate(fields.start)
    form.end = draftDate(fields.end)
  }
  const manualForm = document.querySelector('form[data-act="manual-save"]')
  const planKey = route.name === 'plan-new' ? 'new' : route.name === 'plan-edit' ? `e:${route.id}` : ''
  if (manualForm && manual && planKey && manualForm.dataset.key === planKey && manualKey === planKey) {
    const fields = formFields(manualForm)
    manual.name = fields.name ?? manual.name
    manual.courseId = fields.courseId ?? manual.courseId
    manual.time = parseTime(fields.time) || fields.time || manual.time || ''
    manual.date = draftDate(fields.date)
  }
}

function onRoute() {
  const incoming = location.hash || '#/'
  const prev = parse(lastHash)
  const next = parse(incoming)
  if (next.name === 'task' && prev.name !== 'task') {
    taskBack = prev.name === 'calendar' ? lastHash : ''
  }
  lastHash = incoming
  if (next.name !== 'ai') {
    window.clearInterval(aiTimer)
    aiKey = ''
  }
  if (next.name !== 'course-new' && next.name !== 'course-edit') formKey = ''
  if (next.name !== 'plan-new' && next.name !== 'plan-edit') manualKey = ''
  route = next
  render()
}

function formFields(target) {
  return Object.fromEntries(new FormData(target).entries())
}

async function onSubmit(event) {
  const formEl = event.target.closest('form')
  if (!formEl) return
  event.preventDefault()
  const act = formEl.dataset.act
  const fields = formFields(formEl)
  if (act === 'login') {
    auth = { ...auth, email: fields.email, remember: !!fields.remember, errors: {} }
    const result = await store.login({ email: fields.email, password: fields.password, remember: !!fields.remember })
    if (!result.ok) { auth.errors = result.errors; render(); return }
    navigate('#/')
  } else if (act === 'register') {
    const errors = {}
    if (fields.password !== fields.again) errors.again = 'Mật khẩu nhập lại chưa khớp.'
    auth = { email: fields.email, name: fields.name, remember: true, errors }
    if (errors.again) { render(); return }
    const result = await store.register(fields)
    if (!result.ok) { auth.errors = result.errors; render(); return }
    navigate('#/')
  } else if (act === 'reset-email') {
    const result = store.requestReset(fields.email)
    if (!result.ok) { reset = { ...reset, email: fields.email, errors: { email: result.error } }; render(); return }
    reset = { step: 2, email: result.email, code: result.code, typed: '', errors: {} }
    render()
  } else if (act === 'reset-confirm') {
    const errors = {}
    if (fields.password !== fields.again) errors.again = 'Mật khẩu nhập lại chưa khớp.'
    if (String(fields.password || '').length < 6) errors.password = 'Mật khẩu cần ít nhất 6 ký tự.'
    if (errors.password || errors.again) { reset = { ...reset, typed: fields.code, errors }; render(); return }
    const result = await store.resetPassword(reset.email, fields.code, fields.password)
    if (!result.ok) { reset = { ...reset, typed: fields.code, errors: { code: result.error } }; render(); return }
    reset = { ...reset, step: 3, errors: {} }
    render()
  } else if (act === 'save-course') saveCourse(fields)
  else if (act === 'ai-go') startAi(fields, formEl)
  else if (act === 'manual-save') saveManual(fields)
  else if (act === 'save-slot') saveSlot(fields)
  else if (act === 'send') sendChat(formEl.dataset.scope, fields.text)
  else if (act === 'save-claude') {
    setGeminiKey(fields.gemini)
    render()
    if (!fields.gemini?.trim()) { toast('Đã xóa khóa Gemini'); return }
    toast('Đã lưu khóa, đang kiểm tra với Google…')
    testGeminiKey().then((check) => toast(check.ok ? check.text : `Khóa chưa dùng được: ${check.text}`))
  }
}

// opts.fixPlanId: saved from a "Kế hoạch bị ảnh hưởng" banner — leave that plan as it is and open it for editing.
function saveCourse(fields, opts = {}) {
  const before = form.id ? store.snapshot().courses.find((item) => item.id === form.id) : null
  form = {
    ...form, ...fields,
    start: isoOf(fields.start) || String(fields.start || '').trim(),
    end: isoOf(fields.end) || String(fields.end || '').trim(),
    color: form.color, schedule: form.schedule, errors: {},
  }
  const errors = validateCourse(form)
  const clash = applyScheduleAlign(form, store.snapshot().courses)
  if (clash) errors.schedule = clash
  if (Object.keys(errors).length) {
    form.errors = errors
    render()
    return
  }
  formKey = ''
  if (opts.fixPlanId) {
    // Not saved yet: the course change waits on the plan screen and is saved only with "Xác nhận kế hoạch".
    pendingCourse = { planId: opts.fixPlanId, course: { ...form, errors: {} } }
    aiKey = ''
    navigate(`#/ke-hoach/ai?sua=${opts.fixPlanId}`)
    return
  }
  const { isNew, record } = commitCourse(form, before)
  navigate(`#/mon/${record.id}`)
  if (isNew) toast('Tạo kế hoạch bằng AI cho môn này?', { label: 'Tạo ngay', run: () => navigate(`#/ke-hoach/ai?mon=${record.id}`) })
}

// Saves a course and brings its plans in line (all of them except skipPlanId).
function commitCourse(values, before, skipPlanId = '') {
  const { isNew, record } = store.saveCourse(values)
  const shifted = !isNew && before && (before.start !== record.start || before.end !== record.end || String(before.output || '').trim() !== record.output)
  const classChanged = !isNew && before && JSON.stringify(before.schedule || []) !== JSON.stringify(record.schedule || [])
  if (shifted) syncCoursePlans(record, skipPlanId)
  else if (classChanged) reindexPlans()
  return { isNew, record }
}

// While a course change is pending for the plan being edited, every view of that plan uses the new course values.
function withPending(data) {
  if (!pendingCourse || !data || route.name !== 'ai' || route.query.sua !== pendingCourse.planId) return data
  const id = pendingCourse.course.id
  return { ...data, courses: data.courses.map((item) => (item.id === id ? { ...item, ...pendingCourse.course } : item)) }
}

function reindexPlans() {
  for (const plan of reflowAll(store.snapshot())) store.savePlan(plan)
}

let settled = false
function settleSchedule() {
  if (settled || !store.current()) return
  settled = true
  const data = store.snapshot()
  const pruned = pruneClassClashes(data.courses)
  if (pruned.removed.length) {
    for (const course of pruned.courses) {
      if (pruned.changed.has(course.id)) store.saveCourse(course)
    }
    toast(`Đã bỏ lịch học trùng giờ: ${pruned.removed.join('; ')}.`)
  }
  const fresh = store.snapshot()
  if (!hasScheduleIssue(fresh)) return
  const plans = reflowAll(fresh)
  for (const plan of plans) store.savePlan(plan)
  toast('Đã xếp lại lịch: môn hạn gần vào trước; bình thường 2 giờ/môn/ngày, gần hạn thì nới lên.')
}

function syncCoursePlans(record, skipPlanId = '') {
  const plans = store.snapshot().plans.filter((plan) => plan.courseId === record.id && plan.id !== skipPlanId)
  if (!plans.length) return
  let short = false
  for (const plan of plans) {
    const fresh = store.snapshot()
    const deadline = atTime(record.end, '23:59')
    const made = suggestPlan({
      course: record,
      output: record.output,
      docs: fresh.documents.filter((doc) => doc.courseId === record.id),
      deadline,
      start: atTime(record.start, '08:00'),
      data: fresh,
      ignorePlanId: plan.id,
    })
    const now = Date.now()
    const doneNames = new Set(plan.tasks.filter((task) => task.status === 'done').map((task) => task.name.trim().toLocaleLowerCase('vi')))
    const tasks = made.tasks.map((task) => {
      if (isParent(task, made.tasks)) return task
      if (doneNames.has(task.name.trim().toLocaleLowerCase('vi'))) return { ...task, status: 'done', doneAt: task.doneAt || now }
      if (task.end && task.end < now) return { ...task, status: 'done', doneAt: task.end }
      return task
    })
    const next = { ...plan, deadline, tasks: tasks.length ? tasks : plan.tasks }
    store.savePlan(next)
    if (courseWindowWarnings(next, record, store.snapshot(), now).length) short = true
  }
  for (const plan of reflowAll(store.snapshot())) store.savePlan(plan)
  toast(short
    ? 'Kế hoạch đã theo ngày và yêu cầu đầu ra. Một số kế hoạch chưa đủ thời gian.'
    : 'Đã cập nhật kế hoạch theo ngày và yêu cầu đầu ra của môn.')
}

function startAi(fields, formEl) {
  const docIds = [...formEl.querySelectorAll('input[name="doc"]:checked')].map((input) => input.value)
  ai = {
    ...ai, ...fields, docIds, errors: {},
    start: isoOf(fields.start) || String(fields.start || '').trim(),
    date: isoOf(fields.date) || String(fields.date || '').trim(),
  }
  const errors = {}
  if (!ai.courseId) errors.courseId = 'Chọn môn đang học.'
  if (!String(ai.name || '').trim()) errors.name = 'Vui lòng nhập tên kế hoạch.'
  if (!isoOf(ai.start)) errors.start = 'Nhập ngày bắt đầu theo dd/mm/yyyy.'
  if (!isoOf(ai.date)) errors.date = 'Nhập ngày kết thúc theo dd/mm/yyyy.'
  else if (isoOf(ai.start) && isoOf(ai.date) < isoOf(ai.start)) {
    errors.start = 'Ngày bắt đầu phải trước ngày kết thúc.'
    errors.date = 'Ngày bắt đầu phải trước ngày kết thúc.'
  }
  if (!parseTime(ai.time)) errors.time = 'Nhập giờ kết thúc hoặc chọn giờ trên đồng hồ.'
  if (!String(ai.output || '').trim()) errors.output = 'Nhập yêu cầu đầu ra để AI tính số giờ và chia 4 giai đoạn.'
  const fresh = store.snapshot()
  const picked = fresh.courses.find((item) => item.id === ai.courseId)
  if (!fresh.freeSlots.length) errors.free = 'Hãy khai báo giờ rảnh trước khi tạo kế hoạch.'
  else if (isoOf(ai.date)) {
    const from = Math.max(Date.now(), isoOf(ai.start) ? atTime(ai.start, '00:00') : Date.now())
    const until = atTime(ai.date, parseTime(ai.time) || '23:59')
    if (until > from) {
      const open = openHours(fresh, from, until, ai.planId || '', until)
      if (open < 0.5) {
        errors.free = 'Giờ rảnh đến hạn kế hoạch đã được xếp hết nhiệm vụ. Hãy bổ sung thời gian rảnh trước khi tạo kế hoạch.'
      }
    }
  }
  if (picked && !(picked.schedule || []).length) errors.schedule = 'Môn này chưa có lịch học cố định. Hãy thêm buổi lên lớp trước.'
  if (Object.keys(errors).length) { ai.errors = errors; render(); return }
  store.updateCourseOutput(ai.courseId, ai.output || '')
  queueSuggest()
}

function rebuildAi() {
  if (!ai?.courseId) return
  const course = withPending(store.snapshot()).courses.find((item) => item.id === ai.courseId)
  if (!course) { toast('Không thấy môn học'); return }
  ai.output = course.output || ''
  ai.start = course.start
  ai.date = course.end
  if (!ai.docIds?.length) ai.docIds = store.snapshot().documents.filter((doc) => doc.courseId === course.id).map((doc) => doc.id)
  queueSuggest()
}

// Asks Gemini to split the output requirement into tasks. Resolves to null
// when no key is set, so the built-in estimator in model.js is used instead.
async function fetchAiPlan(signal) {
  if (!aiReady(aiLive)) return null
  const fresh = withPending(store.snapshot())
  const course = fresh.courses.find((item) => item.id === ai.courseId)
  const picked = fresh.documents.filter((doc) => (ai.docIds || []).includes(doc.id)).slice(0, 4)
  const docs = (await Promise.all(picked.map(readCorpusItem)))
    .filter((doc) => String(doc.text || '').trim())
    .map((doc) => ({ name: doc.name, text: doc.text.slice(0, 5000) }))
  const from = Math.max(Date.now(), isoOf(ai.start) ? atTime(ai.start, '00:00') : Date.now())
  const until = atTime(ai.date, parseTime(ai.time) || '23:59')
  const open = until > from ? openHours(fresh, from, until, ai.planId || '', until) : 0
  return askPlan({
    course: course?.name || '',
    planName: ai.name || '',
    window: `từ ${showDate(ai.start || dateISO(Date.now()))} đến ${parseTime(ai.time) || '23:59'} ngày ${showDate(ai.date)}`,
    openHours: open ? formatHours(open) : '',
    output: ai.output || '',
    docs,
  }, signal)
}

function queueSuggest() {
  const run = ++planRun
  const useAi = aiReady(aiLive)
  ai.step = 2
  ai.chars = 120
  ai.waitLabel = useAi ? `Gemini đang đọc yêu cầu đầu ra và chia nhiệm vụ…` : 'AI đang viết kế hoạch…'
  render()
  window.clearInterval(aiTimer)
  aiTimer = window.setInterval(() => {
    if (!ai || ai.step !== 2) { window.clearInterval(aiTimer); return }
    ai.chars += 90
    const node = document.querySelector('.center-card p')
    if (node) node.textContent = useAi ? ai.waitLabel : `${ai.waitLabel} (${ai.chars} ký tự)`
  }, 90)
  const stop = new AbortController()
  const timer = window.setTimeout(() => stop.abort(), 50000)
  const minWait = new Promise((resolve) => { window.setTimeout(resolve, 1100) })
  const aiPlan = fetchAiPlan(stop.signal).catch(() => ({ ok: false, text: 'AI chưa chia được nhiệm vụ.' }))
  Promise.all([aiPlan, minWait]).then(([plan]) => {
    window.clearTimeout(timer)
    if (!ai || ai.step !== 2 || run !== planRun) return
    window.clearInterval(aiTimer)
    const fresh = withPending(store.snapshot())
    const course = fresh.courses.find((item) => item.id === ai.courseId)
    const docs = fresh.documents.filter((doc) => (ai.docIds || []).includes(doc.id))
    const deadline = atTime(ai.date, parseTime(ai.time) || '23:59')
    const aiGroups = plan?.ok ? plan.groups : null
    const made = suggestPlan({ course, output: ai.output, docs, deadline, start: atTime(ai.start || dateISO(Date.now()), '08:00'), data: fresh, ignorePlanId: ai.planId, aiGroups })
    ai.tasks = made.tasks
    ai.comment = plan?.ok && plan.note ? `${plan.provider}: ${plan.note} ${made.comment}` : made.comment
    ai.deadline = deadline
    ai.displaced = made.displaced || 0
    ai.step = 3
    const fixed = autoResolveAi()
    render()
    if (plan && !plan.ok) toast(`${plan.text} Đã dùng cách chia nhiệm vụ mặc định.`)
    if (fixed) toast(`AI đã tự chuyển ${fixed} nhiệm vụ bị trùng lịch sang khung trống gần nhất.`)
  })
}

function confirmAi() {
  commitTypingHours(false)
  const review = reviewTasks(ai.tasks, aiData(), ai.deadline, ai.planId)
  if (review.bad) { render(); return }
  // Tasks outside the course's dates: the red notes under them say so; never save the plan like that.
  const course = withPending(store.snapshot()).courses.find((item) => item.id === ai.courseId)
  if (course?.start && course?.end) {
    const from = atTime(course.start, '00:00')
    const until = atTime(course.end, '23:59')
    const outside = leafTasks(ai.tasks).some((task) => task.status !== 'done' && ((task.end && task.end > until) || (task.start && task.start < from)))
    if (outside) { toast('Còn nhiệm vụ nằm ngoài ngày của môn. Bấm "Tạo lại bằng AI" hoặc dời các nhiệm vụ đó.'); return }
  }
  if (ai.deadline > Date.now() && review.open < 0.5) {
    toast('Giờ rảnh đến hạn kế hoạch đã được xếp hết nhiệm vụ. Hãy bổ sung thời gian rảnh.')
    return
  }
  // The course change that sent the user here is saved together with the plan.
  if (pendingCourse && pendingCourse.planId === ai.planId) {
    const before = store.snapshot().courses.find((item) => item.id === pendingCourse.course.id)
    commitCourse(pendingCourse.course, before, ai.planId)
    pendingCourse = null
  }
  const previous = ai.planId ? store.snapshot().plans.find((item) => item.id === ai.planId) : null
  const built = {
    id: ai.planId || uid('p'), courseId: ai.courseId, name: ai.name.trim(), deadline: ai.deadline,
    source: 'ai', createdAt: previous?.createdAt || Date.now(),
    start: isoOf(ai.start) ? atTime(ai.start, '08:00') : 0,
    tasks: ai.tasks,
  }
  store.savePlan(built)
  const moved = ai.dirtyTimes ? reseatLater(store.snapshot(), ai.deadline) : reflowAll(store.snapshot())
  for (const plan of moved) store.savePlan(plan)
  const count = leafTasks(built.tasks).length
  aiKey = ''
  navigate(`#/ke-hoach/${built.id}`)
  const late = shortPlans(store.snapshot())
  if (late.length) {
    toast(`Đã ưu tiên hạn sớm hơn và không chồng giờ. ${late.map((plan) => plan.name).join(', ')} chưa đủ giờ rảnh trước hạn — hãy thêm thời gian rảnh.`, { label: 'Thời gian rảnh', run: () => navigate('#/lich/ranh') })
  } else {
    const note = moved.some((plan) => plan.id !== built.id) ? ' Môn hạn gần được xếp trước, môn hạn xa lùi sau.' : ''
    toast(`Đã tạo kế hoạch · ${count} nhiệm vụ đã vào lịch học.${note}`, { label: 'Xem lịch', run: () => navigate('#/lich') })
  }
}

function syncManualTasks() {
  document.querySelectorAll('form[data-act="manual-save"] [data-act="man-field"]').forEach((node) => {
    const row = manual?.tasks?.find((task) => task.id === node.dataset.id)
    if (row) row[node.dataset.key] = node.value
  })
}

function saveManual(fields) {
  syncManualTasks()
  const typedDate = fields.date ?? manual.date
  manual = { ...manual, name: fields.name ?? manual.name, courseId: fields.courseId ?? manual.courseId, date: isoOf(typedDate) || String(typedDate || '').trim(), time: fields.time ?? manual.time }
  const errors = { ...validateManual(manual), ...manualIssues(manual) }
  if (Object.keys(errors).length) { manual.errors = errors; manual.checked = false; render(); return }
  const snap = store.snapshot()
  const course = snap.courses.find((item) => item.id === manual.courseId) || null
  const deadline = deadlineOf(manual)
  if (!manual.id && deadline > Date.now() && openHours(snap, Date.now(), deadline, manual.id || '', deadline) < 0.5) {
    manual.errors = { free: 'Giờ rảnh đến hạn kế hoạch đã được xếp hết nhiệm vụ. Hãy bổ sung thời gian rảnh trước khi tạo kế hoạch.' }
    manual.checked = true
    render()
    toast(manual.errors.free)
    return
  }
  const review = reviewTasks(materialize(manual), snap, deadline, manual.id, course)
  const clash = review.rows.flatMap((row) => row.warnings).find((item) => item.level === 'bad' && item.code !== 'missing')
  if (clash) {
    manual.checked = true
    render()
    toast(clash.text)
    return
  }
  const tasks = materialize(manual)
  const existing = manual.id ? store.snapshot().plans.find((item) => item.id === manual.id) : null
  const plan = {
    id: manual.id || uid('p'), courseId: manual.courseId || '', name: manual.name.trim(),
    deadline: deadlineOf(manual), source: existing?.source || 'manual', difficulty: existing?.difficulty || 3,
    createdAt: existing?.createdAt || Date.now(), tasks,
  }
  store.savePlan(plan)
  manualKey = ''
  navigate(`#/ke-hoach/${plan.id}`)
  toast(existing ? 'Đã lưu kế hoạch' : 'Đã tạo kế hoạch')
}

function saveSlot(fields) {
  if (!fields.start || !fields.end || fields.end <= fields.start) { toast('Giờ kết thúc phải sau giờ bắt đầu'); return }
  store.addFreeSlot({ weekday: slotDay, start: fields.start, end: fields.end })
  slotDay = 0
  render()
  toast('Đã thêm giờ rảnh')
}

function sendChat(scope, text) {
  const clean = String(text || '').trim()
  if (!clean || chatBusy) return
  if (!aiReady(aiLive)) {
    pendingAsk = `${scope}\n${clean}`
    modal = {
      title: 'Kết nối Gemini',
      body: 'Trợ lý đọc đề, tài liệu môn, rồi tìm trên web nếu cần — giống lúc bạn hỏi ChatGPT hay Gemini.',
      extra: geminiKeyField(),
      ok: 'Lưu và hỏi', cancel: 'Để sau', danger: false,
      run: () => {
        store.setSettings({ aiAck: true })
        const packed = pendingAsk
        pendingAsk = ''
        if (aiReady(aiLive) && packed) {
          const split = packed.indexOf('\n')
          sendChat(packed.slice(0, split), packed.slice(split + 1))
        } else toast('Cần khóa Gemini (miễn phí) để trợ lý trả lời.')
      },
    }
    render()
    return
  }
  const now = Date.now()
  const taskId = scope === 'task' ? route.id : ''
  if (scope === 'task') {
    store.pushTaskChat(taskId, { id: uid('m'), role: 'user', text: clean, at: now })
    chatBusy = taskId
  } else {
    if (freshAi) { store.archiveAssistant(givenName(store.current()?.name)); freshAi = false }
    aiHistory = null
    store.pushAssistant({ id: uid('m'), role: 'user', text: clean, at: now })
    chatBusy = 'ai'
    drawer = true
  }
  render()
  finishChat(scope, clean, taskId)
}

async function readCorpusItem(item) {
  try {
    const saved = await loadBlob(item.id)
    if (!saved?.blob) return { id: item.id, name: item.name, text: '', kind: 'missing' }
    const out = await extractFileText(saved.blob, saved.name || item.name, saved.type || item.mime || '')
    const row = { id: item.id, name: saved.name || item.name, text: out.text || '', kind: out.kind, note: out.note || '' }
    if (out.kind === 'image') row.image = await blobToJpeg(saved.blob)
    else if (out.kind === 'pdf' && (!row.text || row.text.length < 80)) row.pdf = await blobToPdf(saved.blob)
    return row
  } catch {
    return { id: item.id, name: item.name, text: '', kind: 'error' }
  }
}

async function loadTutorCorpus(data, taskId, text) {
  const view = buildView(data, Date.now())
  const found = (taskId && view.leaves.find((task) => task.id === taskId))
    || view.leaves.find((item) => fold(text).includes(fold(item.name)))
    || view.overdue[0]
    || view.leaves.find((item) => item.view !== 'done')
  if (!found) return { docs: [], files: [], taskId: '' }
  const docs = data.documents.filter((doc) => doc.courseId === found.plan.courseId)
  const files = found.files || []
  return {
    taskId: found.id,
    docs: await Promise.all(docs.map(readCorpusItem)),
    files: await Promise.all(files.map(readCorpusItem)),
  }
}

async function finishChat(scope, clean, taskId) {
  const data = store.snapshot()
  const topic = classifyChat(clean)
  const needFiles = Boolean(taskId) || topic === 'work'
  let corpus = { docs: [], files: [], taskId: '' }
  try {
    if (needFiles) corpus = await loadTutorCorpus(data, taskId, clean)
  } catch { /* still ask Gemini */ }
  const view = buildView(data, Date.now())
  const found = view.leaves.find((task) => task.id === (taskId || corpus.taskId)) || null
  const history = scope === 'task'
    ? (data.taskChats[taskId || route.id] || [])
    : (data.assistant || [])
  let reply = null
  try {
    const live = await askAi(buildTutorPayload({ question: clean, data, found, corpus, history }))
    if (live.ok) {
      const actions = found?.plan?.courseId
        ? [{ label: 'Mở tài liệu môn', hash: `#/tai-lieu/${found.plan.courseId}` }]
        : found ? [{ label: 'Xem kế hoạch', hash: `#/ke-hoach/${found.plan.id}` }] : []
      reply = {
        from: live.searched ? 'Gemini · đã tìm thêm nguồn trên web' : 'Gemini',
        suggestion: live.text,
        actions,
      }
    } else {
      reply = {
        from: 'Chưa gọi được Gemini',
        suggestion: live.text || 'Dán khóa Gemini (miễn phí) trong Cài đặt thông báo, mục Trợ lý AI, rồi hỏi lại.',
        actions: [{ label: 'Mở cài đặt', hash: '#/thong-bao/cai-dat' }],
      }
    }
  } catch {
    reply = {
      from: 'Mất kết nối Gemini',
      suggestion: 'Kiểm tra mạng rồi hỏi lại. Nếu chưa có khóa, dán khóa Gemini trong Cài đặt.',
      actions: [{ label: 'Mở cài đặt', hash: '#/thong-bao/cai-dat' }],
    }
  }
  if (!reply?.suggestion && !needFiles) reply = chatReply(topic, data, Date.now(), clean, '', corpus)
  const message = { id: uid('m'), role: 'ai', ...reply, at: Date.now() }
  if (scope === 'task') store.pushTaskChat(taskId || route.id, message)
  else store.pushAssistant(message)
  chatBusy = ''
  render()
}

function geminiKeyField() {
  return `<label class="field claude-key"><span>Khóa Gemini (miễn phí)</span><input class="input" name="gemini-key" type="password" autocomplete="off" placeholder="AIza…" value="${esc(geminiKey())}"></label><p class="fine">Lấy miễn phí tại aistudio.google.com/apikey (đăng nhập Google → Create API key).</p>`
}

function openAi(prefill) {
  aiHistory = null
  // Coming back after closing the assistant (or reloading) starts a new chat; the old one goes to history.
  if (freshAi && !chatBusy) {
    store.archiveAssistant(givenName(store.current()?.name))
    freshAi = false
  }
  if (!store.snapshot().settings.aiAck) {
    modal = {
      title: 'Cho phép trợ lý AI',
      body: 'Studyflow gọi Gemini để trả lời, đọc đề, tài liệu môn và tìm nguồn trên web — giống lúc bạn hỏi ChatGPT hay Gemini.',
      extra: aiReady(aiLive) ? '' : geminiKeyField(),
      ok: 'Cho phép', cancel: 'Để sau', danger: false,
      run: () => {
        store.setSettings({ aiAck: true })
        drawer = true
        if (prefill) sendChat('ai', prefill)
      },
    }
    render()
    return
  }
  if (!aiReady(aiLive)) {
    modal = {
      title: 'Kết nối Gemini',
      body: 'Dán khóa Gemini (miễn phí) để trợ lý trả lời và tìm trên web. Tài liệu môn vẫn được đọc trước.',
      extra: geminiKeyField(),
      ok: 'Lưu và hỏi', cancel: 'Để sau', danger: false,
      run: () => {
        drawer = true
        if (prefill && aiReady(aiLive)) sendChat('ai', prefill)
      },
    }
    render()
    return
  }
  drawer = true
  render()
  if (prefill) sendChat('ai', prefill)
}

function onClick(event) {
  const toastEl = event.target.closest('.toast')
  if (toastEl) {
    const toastBtn = event.target.closest('[data-toast]')
    const id = toastBtn?.dataset.toast || toastEl.dataset.id
    const item = toasts.find((entry) => entry.id === id)
    if (toastBtn && item?.action?.run) item.action.run()
    dismissToast(id)
    return
  }
  if (event.target.classList?.contains('viewer-back')) { closeViewer(); return }
  const node = event.target.closest('[data-act]')
  if (!node) return
  const act = node.dataset.act
  if (act === 'toggle-pass') {
    const input = node.parentElement.querySelector('input')
    input.type = input.type === 'password' ? 'text' : 'password'
    return
  }
  if (act === 'demo') { store.loginDemo(auth.remember); navigate('#/'); return }
  if (act === 'resend') {
    const result = store.requestReset(reset.email)
    if (result.ok) { reset.code = result.code; toast('Đã gửi lại mã') ; render() }
    return
  }
  if (act === 'logout') { store.logout(); drawer = false; navigate('#/dang-nhap'); return }
  if (act === 'theme') toggleTheme()
  if (act === 'open-ai') openAi('')
  if (act === 'close-ai') closeAi()
  if (act === 'clear-ai') { aiHistory = null; store.clearAssistant(givenName(store.current()?.name)); render(); toast('Đã mở phiên mới') }
  if (act === 'ai-history') { aiHistory = aiHistory ? null : 'list'; render() }
  if (act === 'ai-session') { aiHistory = node.dataset.id; render() }
  if (act === 'ai-session-back') { aiHistory = 'list'; render() }
  if (act === 'ai-session-resume') {
    if (chatBusy) { toast('Đợi trợ lý trả lời xong rồi mở lại phiên cũ'); return }
    store.restoreSession(node.dataset.id, givenName(store.current()?.name))
    aiHistory = null
    render()
  }
  if (act === 'ai-session-del') { store.deleteSession(node.dataset.id); aiHistory = 'list'; render(); toast('Đã xóa phiên') }
  if (act === 'ask-plan') {
    const plan = store.snapshot().plans.find((item) => item.id === node.dataset.id)
    openAi(`Đánh giá kế hoạch ${plan?.name || ''} giúp mình: tiến độ, nhiệm vụ nào có rủi ro và mình nên làm gì tiếp theo?`)
  }
  if (act === 'modal-no') { modal = null; render() }
  if (act === 'modal-yes') {
    const typedGemini = document.querySelector('[name="gemini-key"]')
    if (typedGemini) setGeminiKey(typedGemini.value)
    const run = modal?.run
    modal = null
    if (run) run()
    render()
  }
  if (act === 'range') setQuery({ range: node.dataset.value })
  if (act === 'open-date') openDate(node)
  if (act === 'open-time') openTime(node)
  if (act === 'add-sch') { form.schedule.push({ weekday: 2, start: '07:00', end: '09:30', room: '', from: '', until: '', repeat: 'week' }); refreshScheduleError(); render() }
  if (act === 'del-sch') { form.schedule.splice(Number(node.dataset.id), 1); refreshScheduleError(); render() }
  if (act === 'del-course') confirmDelete('Xóa môn học', 'Môn, tài liệu và kế hoạch của môn sẽ bị xóa.', () => {
    const snap = store.deleteCourse(node.dataset.id)
    reindexPlans()
    navigate('#/mon-hoc')
    if (snap) toast('Đã xóa môn học', { label: 'Hoàn tác', run: () => { store.restoreCourse(snap); reindexPlans() } })
  })
  if (act === 'del-doc') {
    const doc = store.deleteDocument(node.dataset.id)
    removeBlob(node.dataset.id).catch(() => {})
    render()
    if (doc) toast('Đã xóa tài liệu', { label: 'Hoàn tác', run: () => { store.restoreDocument(doc); render() } })
  }
  if (act === 'view-doc') viewFile(node.dataset.id)
  if (act === 'close-viewer') closeViewer()
  if (act === 'del-plan') confirmDelete('Xóa kế hoạch', 'Các nhiệm vụ trong kế hoạch sẽ biến khỏi lịch học.', () => {
    const plan = store.deletePlan(node.dataset.id)
    reindexPlans()
    if (route.name === 'plan') navigate('#/ke-hoach')
    else render()
    if (plan) toast('Đã xóa kế hoạch', { label: 'Hoàn tác', run: () => { store.restorePlan(plan); reindexPlans(); render() } })
  })
  if (act === 'toggle-task') toggleTask(node.dataset.id, node.checked)
  if (act === 'ai-stop') { window.clearInterval(aiTimer); if (ai) ai.step = 1; render() }
  if (act === 'ai-redo') { if (ai) { ai.step = 1; render() } }
  if (act === 'ai-rebuild') rebuildAi()
  if (act === 'ai-add') {
    // A new task joins the last section, so it shows under that heading.
    const sections = ai.tasks.filter((task) => isParent(task, ai.tasks))
    const parentId = sections.length ? sections[sections.length - 1].id : ''
    ai.tasks.push(newAiTask(parentId))
    render()
  }
  if (act === 'ai-add-section') {
    // A section is only a heading; it starts with one task so it is never empty.
    const sectionId = uid('t')
    const count = ai.tasks.filter((task) => isParent(task, ai.tasks)).length
    ai.tasks.push({ id: sectionId, parentId: '', name: `Phần ${count + 1}`, hours: 0, start: 0, end: 0, status: 'todo', description: '', files: [], doneAt: 0 })
    ai.tasks.push(newAiTask(sectionId))
    render()
  }
  if (act === 'ai-del') {
    window.clearTimeout(hoursInputTimer)
    if (ai) ai.typingHours = null
    const gone = ai.tasks.find((task) => task.id === node.dataset.id)
    ai.tasks = ai.tasks.filter((task) => task.id !== node.dataset.id && task.parentId !== node.dataset.id)
    // Drop a section whose last task was just removed.
    if (gone?.parentId && !ai.tasks.some((task) => task.parentId === gone.parentId)) ai.tasks = ai.tasks.filter((task) => task.id !== gone.parentId)
    render()
  }
  if (act === 'hours-step' && ai) {
    const stepTask = ai.tasks.find((t) => t.id === node.dataset.id)
    if (stepTask) {
      const dir = Number(node.dataset.dir)
      let base = stepTask.hours !== undefined && stepTask.hours !== '' ? Number(stepTask.hours) : 1
      if (ai.typingHours?.id === stepTask.id) {
        const typed = parseHoursInput(ai.typingHours.raw)
        if (Number.isFinite(typed)) base = typed
      } else if (ai.typingHours) {
        commitTypingHours(false)
      }
      window.clearTimeout(hoursInputTimer)
      ai.typingHours = null
      if (!Number.isFinite(base)) base = 1
      const next = Math.max(0, Math.min(24, Math.round((base + dir * 0.5) * 2) / 2))
      applyAiHours(stepTask.id, next)
    }
    return
  }
  if (act === 'ai-set-hours' && ai) {
    window.clearTimeout(hoursInputTimer)
    ai.typingHours = null
    const targetHours = Number(node.dataset.hours)
    if (Number.isFinite(targetHours) && targetHours > 0) {
      applyAiHours(node.dataset.id, targetHours, false)
    }
    return
  }
  if (act === 'ai-fix') { applyAiFix(node.dataset.id, node.dataset.start, node.dataset.end); return }
  if (act === 'ai-need-free' || act === 'ai-add-free' || act === 'hour-add-free') {
    modal = null
    navigate('#/lich/ranh')
    return
  }
  if (act === 'ai-confirm') confirmAi()
  if (act === 'course-fix-plan') {
    const formEl = node.closest('form')
    if (formEl && form) saveCourse(formFields(formEl), { fixPlanId: node.dataset.id })
  }
  if (act === 'ai-compress') { compressPreview(); return }
  if (act === 'add-parent') { syncManualTasks(); manual.tasks.push(...newSection()); render() }
  if (act === 'add-child') addChild(node.dataset.id)
  if (act === 'del-node') { manual.tasks = manual.tasks.filter((task) => task.id !== node.dataset.id && task.parentId !== node.dataset.id); render() }
  if (act === 'man-fix') applyManualFix(node.dataset.id)
  if (act === 'manual-force' || (act === 'manual-save' && node.tagName === 'BUTTON')) saveManual(readManualFields())
  if (act === 'cal-today') setQuery({ d: dateISO(Date.now()), view: 'ngay' })
  if (act === 'cal-move') moveCal(Number(node.dataset.dir))
  if (act === 'cal-month') moveMonth(Number(node.dataset.dir))
  if (act === 'cal-mode') setQuery({ view: node.dataset.value })
  if (act === 'cal-jump') setQuery({ d: node.dataset.d, view: route.query.view || (narrowQuery.matches ? 'ngay' : 'tuan') })
  if (act === 'cal-course') {
    const id = node.dataset.id
    cal.hide = node.checked ? cal.hide.filter((item) => item !== id) : cal.hide.concat(id)
    render()
  }
  if (act === 'cal-status') { cal.status[node.dataset.id] = node.checked; render() }
  if (act === 'cal-flag') { cal[node.dataset.id] = node.checked; render() }
  if (act === 'add-slot') { slotDay = Number(node.dataset.day); render() }
  if (act === 'cancel-slot') { slotDay = 0; render() }
  if (act === 'del-slot') {
    const row = store.removeFreeSlot(node.dataset.id)
    render()
    if (row) toast('Đã xóa giờ rảnh', { label: 'Hoàn tác', run: () => { store.restoreFreeSlot(row); render() } })
  }
  if (act === 'set-status') setStatus(node.dataset.id, node.dataset.status)
  if (act === 'move-task') moveTask(node.dataset.id)
  if (act === 'del-file') {
    const row = store.removeTaskFile(node.dataset.id, node.dataset.file)
    removeBlob(node.dataset.file).catch(() => {})
    render()
    if (row) toast('Đã xóa tệp', { label: 'Hoàn tác', run: () => { store.restoreTaskFile(node.dataset.id, row); render() } })
  }
  if (act === 'chip') sendChat(node.dataset.scope, node.dataset.text)
  if (act === 'read-all') { store.markAllRead(); render() }
  if (act === 'notice-filter') setQuery({ loc: node.dataset.value === 'all' ? '' : node.dataset.value })
  if (act === 'set-pref') {
    const key = node.dataset.key
    const value = node.dataset.value === 'toggle' ? node.checked : (Number.isNaN(Number(node.dataset.value)) ? node.dataset.value : Number(node.dataset.value))
    store.setSettings({ [key]: value })
    render()
    toast('Đã lưu cài đặt')
  }
  if (act === 'toggle-mark') {
    // Several milestones may be on at once (e.g. 7 and 1 day before the deadline).
    const day = Number(node.dataset.value)
    const marks = deadlineMilestones(store.settings())
    const next = marks.includes(day) ? marks.filter((item) => item !== day) : [...marks, day]
    store.setSettings({ deadlineDays: next })
    render()
    toast(next.length ? 'Đã lưu mốc nhắc hạn' : 'Đã tắt nhắc kế hoạch sắp đến hạn')
  }
  if (act === 'toggle-hour') {
    // "Gom theo khung giờ": any set of hours, but never none.
    const hour = Number(node.dataset.value)
    const hours = batchHoursOf(store.settings())
    const next = hours.includes(hour) ? hours.filter((item) => item !== hour) : [...hours, hour]
    if (!next.length) { toast('Cần giữ ít nhất 1 khung giờ'); return }
    store.setSettings({ batchHours: next.sort((a, b) => a - b) })
    render()
    toast('Đã lưu khung giờ nhận')
  }
}

function readManualFields() {
  const formEl = document.querySelector('form[data-act="manual-save"]')
  return formEl ? formFields(formEl) : {}
}

function confirmDelete(title, body, run) {
  modal = { title, body, ok: 'Xóa', cancel: 'Hủy', danger: true, run }
  render()
}

function toggleTask(id, done) {
  const found = store.findTask(id)
  if (!found) return
  const previous = found.task.status
  store.updateTask(id, { status: done ? 'done' : 'todo' })
  const stats = planStats(store.snapshot().plans.find((plan) => plan.id === found.plan.id), Date.now())
  render()
  if (done) toast(`Đã hoàn thành ${found.task.name} · Tiến độ kế hoạch ${Math.round(stats.ratio * 100)}%`, { label: 'Hoàn tác', run: () => { store.updateTask(id, { status: previous }); render() } })
}

function setStatus(id, status) {
  const found = store.findTask(id)
  if (!found) return
  const previous = found.task.status
  store.updateTask(id, { status })
  render()
  if (status === 'done') {
    const stats = planStats(store.snapshot().plans.find((plan) => plan.id === found.plan.id), Date.now())
    toast(`Đã hoàn thành ${found.task.name} · Tiến độ kế hoạch ${Math.round(stats.ratio * 100)}%`, { label: 'Hoàn tác', run: () => { store.updateTask(id, { status: previous }); render() } })
  }
}

function moveTask(id) {
  const data = store.snapshot()
  const found = store.findTask(id)
  if (!found) return
  const duration = Math.max(1800000, (found.task.end || 0) - (found.task.start || 0) || found.task.hours * 3600000)
  const blocked = classIntervals(data.courses, Date.now(), found.plan.deadline).map((item) => [item.start, item.end])
    .concat(data.plans.flatMap((plan) => plan.tasks).filter((task) => task.id !== id && task.start && task.end && task.status !== 'done').map((task) => [task.start, task.end]))
  const window = findWindow({
    duration, from: Date.now(), until: found.plan.deadline, freeSlots: data.freeSlots, blocked,
  })
  if (!window) { toast('Chưa có khung trống trước deadline'); return }
  const prev = { start: found.task.start, end: found.task.end }
  store.updateTask(id, window)
  render()
  toast('Đã dời nhiệm vụ', { label: 'Hoàn tác', run: () => { store.updateTask(id, prev); render() } })
}

function aiData() {
  const data = withPending(store.snapshot())
  const course = data.courses.find((item) => item.id === ai?.courseId)
  const floor = course?.start ? atTime(course.start, '00:00') : 0
  return { ...data, floor, displaceAfter: ai?.deadline || 0 }
}

// AI tu xep cac nhiem vu dang trung lich (voi mon khong the dich chuyen / lich hoc) sang khung trong gan nhat
function autoResolveAi() {
  if (!ai?.tasks?.length) return 0
  let moved = 0
  for (let round = 0; round < 60; round += 1) {
    const data = aiData()
    const review = reviewTasks(ai.tasks, data, ai.deadline, ai.planId)
    const row = review.rows.find((item) => item.warnings.some((w) => w.code === 'overlap-foreign' || w.code === 'class'))
    if (!row) break
    const fix = proposeFix(row.task, ai.tasks, data, ai.deadline, ai.planId)
    if (!fix?.start || fix.kind === 'free') { row.task.needFree = taskHours(row.task); break }
    ai.tasks = placeTaskWindow(ai.tasks, row.task.id, fix.start, fix.end, data, ai.deadline, ai.planId)
    moved += 1
  }
  return moved
}

function applyAiFix(id, startRaw, endRaw) {
  window.clearTimeout(hoursInputTimer)
  if (ai) ai.typingHours = null
  const task = ai?.tasks.find((item) => item.id === id)
  if (!task) return
  let start = Number(startRaw)
  let end = Number(endRaw)
  if (!(start > 0 && end > start)) {
    const fix = proposeFix(task, ai.tasks, aiData(), ai.deadline, ai.planId)
    if (!fix?.start || fix.kind === 'free') {
      task.needFree = taskHours(task)
      render()
      return
    }
    start = fix.start
    end = fix.end
  }
  task.needFree = 0
  ai.dirtyTimes = true
  ai.tasks = placeTaskWindow(ai.tasks, id, start, end, aiData(), ai.deadline, ai.planId)
  render()
  toast('Đã xếp vào khung trống gần nhất')
}

function applyManualFix(id) {
  const tasks = materialize(manual)
  const task = tasks.find((item) => item.id === id)
  const fix = proposeFix(task, tasks, store.snapshot(), deadlineOf(manual), manual.id)
  if (fix.kind === 'free') { navigate('#/lich/ranh'); return }
  const row = manual.tasks.find((item) => item.id === id)
  if (fix.kind === 'extra') {
    manual.tasks.push({ id: uid('t'), parentId: row.parentId, name: `${row.name} (bù)`, date: dateISO(fix.start), start: clock(fix.start), end: clock(fix.end), status: 'todo', files: [] })
  } else if (row.parentId) {
    row.date = dateISO(fix.start); row.start = clock(fix.start); row.end = clock(fix.end)
  } else {
    row.start = `${dateISO(fix.start)}T${clock(fix.start)}`
    row.end = `${dateISO(fix.end)}T${clock(fix.end)}`
  }
  render()
  toast('Đã chuyển nhiệm vụ')
}

function newAiTask(parentId) {
  return { id: uid('t'), parentId, name: 'Nhiệm vụ mới', hours: 1.5, start: 0, end: 0, status: 'todo', description: '', files: [], doneAt: 0 }
}

function addChild(parentId) {
  syncManualTasks()
  // Sections have no dates now, so suggest the first free hour before the plan deadline.
  const data = store.snapshot()
  const until = deadlineOf(manual)
  const window = until > Date.now() ? findWindow({
    duration: 3600000, from: Date.now(), until, freeSlots: data.freeSlots, blocked: [],
  }) : null
  manual.tasks.push({
    id: uid('t'), parentId, name: '', status: 'todo', files: [],
    date: window ? dateISO(window.start) : '', start: window ? clock(window.start) : '', end: window ? clock(window.end) : '',
  })
  render()
}

function moveCal(dir) {
  const anchor = route.query.d ? new Date(`${route.query.d}T12:00:00`).getTime() : Date.now()
  const mode = route.query.view === 'ngay' || (!route.query.view && narrowQuery.matches) ? 1 : 7
  setQuery({ d: dateISO(anchor + dir * mode * 86400000) })
}
function moveMonth(dir) {
  const anchor = route.query.d ? new Date(`${route.query.d}T12:00:00`) : new Date()
  anchor.setMonth(anchor.getMonth() + dir)
  setQuery({ d: dateISO(anchor) })
}

function onInput(event) {
  const live = event.target.closest('[data-live="query"]')
  if (live) setQuery({ [live.dataset.key]: live.value })
  const field = event.target.closest('[data-field]')
  if (field && form) {
    const row = form.schedule[Number(field.dataset.id)]
    if (!row) return
    if (field.dataset.field === 'sch-day') row.weekday = Number(field.value)
    if (field.dataset.field === 'sch-start') row.start = field.value
    if (field.dataset.field === 'sch-end') row.end = field.value
    if (field.dataset.field === 'sch-room') row.room = field.value
    if (field.dataset.field === 'sch-from') row.from = isoOf(field.value) || ''
    if (field.dataset.field === 'sch-until') row.until = isoOf(field.value) || ''
    if (field.dataset.field === 'sch-repeat') row.repeat = field.value
  }
  const aiField = event.target.closest('[data-act="ai-field"]')
  if (aiField && ai) {
    if (aiField.dataset.key === 'hours') {
      const cleaned = String(aiField.value ?? '').replace(/[^0-9.,]/g, '')
      if (cleaned !== aiField.value) {
        const pos = Math.max(0, (aiField.selectionStart || cleaned.length) - (aiField.value.length - cleaned.length))
        aiField.value = cleaned
        try { aiField.setSelectionRange(pos, pos) } catch { /* ignore */ }
      }
      const raw = cleaned.trim()
      ai.typingHours = { id: aiField.dataset.id, raw: cleaned }
      window.clearTimeout(hoursInputTimer)
      if (raw === '' || /[.,]$/.test(raw) || (raw.match(/[.,]/g) || []).length > 1) return
      const num = parseHoursInput(raw)
      if (!Number.isFinite(num)) return
      hoursInputTimer = window.setTimeout(() => {
        if (!ai || ai.typingHours?.id !== aiField.dataset.id) return
        applyAiHours(aiField.dataset.id, num, true, true, true)
      }, 450)
      return
    }
    patchAi(aiField)
  }
  const manField = event.target.closest('[data-act="man-field"]')
  if (manField && manual) {
    const row = manual.tasks.find((task) => task.id === manField.dataset.id)
    if (row) row[manField.dataset.key] = manField.value
  }
  if (ai && event.target.form?.dataset.act === 'ai-go' && ['date', 'time', 'start'].includes(event.target.name)) {
    const name = event.target.name
    ai[name] = name === 'time' ? (parseTime(event.target.value) || event.target.value.trim()) : (isoOf(event.target.value) || event.target.value.trim())
    const node = document.querySelector('[data-open]')
    const day = isoOf(ai.date)
    if (node && day) node.textContent = formatHours(openHours(store.snapshot(), Date.now(), atTime(day, ai.time || '23:59')))
  }
}

function draftAiPlan() {
  return {
    id: ai.planId || '__draft__',
    courseId: ai.courseId,
    deadline: ai.deadline,
    source: 'ai',
    createdAt: Date.now(),
    start: isoOf(ai.start) ? atTime(ai.start, '08:00') : 0,
    tasks: ai.tasks,
  }
}

function reflowAiPreview() {
  const next = previewReflow(store.snapshot(), draftAiPlan())
  ai.tasks = next.tasks
}

function compressPreview() {
  const data = store.snapshot()
  const ghost = draftAiPlan()
  const moved = compressFarBuffers({
    ...data,
    plans: [...data.plans.filter((plan) => plan.id !== ai.planId), ghost],
  }, ai.deadline)
  for (const plan of moved) {
    if (plan.id === ghost.id) ai.tasks = plan.tasks
    else store.savePlan(plan)
  }
  render()
  toast('Đã nén nhiệm vụ dự phòng của môn hạn xa và xếp lại lịch.')
}

function parseHoursInput(value) {
  const clean = String(value ?? '').trim().replace(',', '.')
  if (!clean) return 0
  const n = Number(clean)
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : NaN
}

function commitTypingHours(shouldRender = false) {
  window.clearTimeout(hoursInputTimer)
  if (!ai?.typingHours) return false
  const { id, raw } = ai.typingHours
  ai.typingHours = null
  const parsed = parseHoursInput(raw)
  const hours = Number.isFinite(parsed) ? parsed : 0
  applyAiHours(id, hours, true, false, shouldRender)
  return true
}

function applyAiHours(taskId, hours, fromUser = true, keepTyping = false, shouldRender = true) {
  if (!ai) return
  window.clearTimeout(hoursInputTimer)
  if (!keepTyping) ai.typingHours = null
  const task = ai.tasks.find((item) => item.id === taskId)
  if (!task) return
  ai.dirtyTimes = true
  ai.pendingHours = { id: task.id, hours }
  task.userAdjustedHours = fromUser
  if (!(hours > 0) || hours > 24) {
    task.hours = Number.isFinite(hours) ? hours : 0
    task.needFree = 0
    if (shouldRender) render()
    return
  }
  const data = aiData()
  const result = applyHoursChange(ai.tasks, task.id, hours, data, ai.deadline, ai.planId)
  let next = result.tasks
  let autoMoved = null
  if (result.kind === 'need-slot' && result.window) {
    next = placeTaskWindow(next, task.id, result.window.start, result.window.end, data, ai.deadline, ai.planId)
    autoMoved = result.window
  }
  const updated = next.find((item) => item.id === taskId)
  if (updated) updated.userAdjustedHours = fromUser
  ai.tasks = next
  if (shouldRender) render()
  if (autoMoved) toast(`Khung cũ trùng lịch môn khác — AI đã tự chuyển sang ${dateISO(autoMoved.start).split('-').reverse().join('/')} ${clock(autoMoved.start)}–${clock(autoMoved.end)}.`)
}

function patchAi(node) {
  const task = ai.tasks.find((item) => item.id === node.dataset.id)
  if (!task) return
  const key = node.dataset.key
  if (key === 'name') task.name = node.value
  if (key === 'hours') {
    const raw = String(node.value ?? '').trim().replace(',', '.')
    const hours = raw === '' ? 0 : Number(raw)
    ai.dirtyTimes = true
    ai.pendingHours = { id: task.id, hours }
    task.userAdjustedHours = true
    if (!(hours > 0) || hours > 24) {
      task.hours = Number.isFinite(hours) ? hours : 0
      task.needFree = 0
      return
    }
    const result = applyHoursChange(ai.tasks, task.id, hours, aiData(), ai.deadline, ai.planId)
    const updated = result.tasks.find((item) => item.id === task.id)
    if (updated) updated.userAdjustedHours = true
    ai.tasks = result.tasks
    return
  }
  const day = key === 'date' ? isoOf(node.value) : (task.start ? dateISO(task.start) : '')
  const start = key === 'start' ? node.value : (task.start ? clock(task.start) : '19:30')
  const end = key === 'end' ? node.value : (task.end ? clock(task.end) : '21:00')
  if ((key === 'date' || key === 'start' || key === 'end') && day) {
    task.start = atTime(day, start)
    task.end = atTime(day, end)
    ai.dirtyTimes = true
  }
}

function openDate(node) {
  const native = node.parentElement?.querySelector('.date-native')
  if (!native) return
  if (typeof native.showPicker === 'function') {
    try { native.showPicker(); return } catch { /* fall through */ }
  }
  native.click()
}

function openTime(node) {
  const native = node.parentElement?.querySelector('.time-native')
  if (!native) return
  if (typeof native.showPicker === 'function') {
    try { native.showPicker(); return } catch { /* fall through */ }
  }
  native.click()
}

function applyPickedTime(native) {
  const visible = native.parentElement?.querySelector('.input')
  if (!visible || !native.value) return
  visible.value = native.value
  visible.dispatchEvent(new Event('input', { bubbles: true }))
  visible.dispatchEvent(new Event('change', { bubbles: true }))
}

function applyPickedDate(native) {
  const visible = native.parentElement?.querySelector('.input')
  if (!visible || !/^\d{4}-\d{2}-\d{2}$/.test(native.value)) return
  const shown = showDate(native.value)
  const stamp = visible.placeholder?.includes('hh:mm')
  if (stamp) {
    const time = (String(visible.value).match(/(\d{1,2}:\d{2})\s*$/) || [])[1] || '08:00'
    const [hour, minute] = time.split(':')
    visible.value = `${shown} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  } else visible.value = shown
  visible.dispatchEvent(new Event('input', { bubbles: true }))
  visible.dispatchEvent(new Event('change', { bubbles: true }))
}

function applyScheduleAlign(target, courses) {
  const aligned = alignCourseSchedule(target, courses)
  target.schedule = aligned.schedule
  target.scheduleHint = aligned.clash ? '' : aligned.notes.join(' ')
  return aligned.clash
}

function refreshScheduleError() {
  if (!form) return
  const clash = applyScheduleAlign(form, store.snapshot().courses)
  if (clash) form.errors = { ...(form.errors || {}), schedule: clash }
  else if (form.errors?.schedule) {
    const { schedule, ...rest } = form.errors
    form.errors = rest
  }
}

function onChange(event) {
  const input = event.target
  if (input.dataset.act === 'task-status') { setStatus(input.dataset.id, input.value); return }
  if (input.classList?.contains('date-native') && input.classList.contains('time-native')) { applyPickedTime(input); return }
  if (input.classList?.contains('date-native')) { applyPickedDate(input); return }
  if (input.dataset.act === 'pick-custom' && form) { form.color = input.value; render(); return }
  if (form && ['sch-day', 'sch-start', 'sch-end', 'sch-from', 'sch-until', 'sch-repeat'].includes(input.dataset.field)) {
    const row = form.schedule[Number(input.dataset.id)]
    if (row && input.dataset.field === 'sch-day') row.weekday = Number(input.value)
    if (row && input.dataset.field === 'sch-start') row.start = input.value
    if (row && input.dataset.field === 'sch-end') row.end = input.value
    if (row && input.dataset.field === 'sch-from') row.from = isoOf(input.value) || ''
    if (row && input.dataset.field === 'sch-until') row.until = isoOf(input.value) || ''
    if (row && input.dataset.field === 'sch-repeat') row.repeat = input.value
    refreshScheduleError()
    render()
    return
  }
  if (ai && input.dataset.act === 'ai-field' && ['date', 'start', 'end', 'hours'].includes(input.dataset.key)) {
    if (input.dataset.key === 'hours') {
      window.clearTimeout(hoursInputTimer)
      const parsed = parseHoursInput(input.value)
      ai.typingHours = null
      applyAiHours(input.dataset.id, Number.isFinite(parsed) ? parsed : 0, true, false, true)
      return
    }
    patchAi(input)
    render()
    return
  }
  if (manual && input.dataset.act === 'man-field' && ['date', 'start', 'end'].includes(input.dataset.key)) {
    render()
    return
  }
  if (ai && input.form?.dataset.act === 'ai-go' && ['date', 'time', 'start'].includes(input.name)) {
    ai[input.name] = input.name === 'time' ? (parseTime(input.value) || input.value.trim()) : (isoOf(input.value) || input.value.trim())
    render()
    return
  }
  if (manual && input.form?.dataset.act === 'manual-save' && ['date', 'time', 'courseId'].includes(input.name)) {
    if (input.name === 'courseId') manual.courseId = input.value
    if (input.name === 'time') manual.time = parseTime(input.value) || input.value.trim()
    if (input.name === 'date') manual.date = isoOf(input.value) || input.value.trim()
    render()
    return
  }
  if (input.dataset.act === 'upload') uploadDocs(input.dataset.id, input.files)
  if (input.dataset.act === 'task-file') uploadTask(input.dataset.id, input.files)
  if (form && input.form?.dataset.act === 'save-course' && ['start', 'end', 'output'].includes(input.name)) {
    form[input.name] = input.name === 'output' ? input.value : (isoOf(input.value) || input.value.trim())
    render()
  }
  if (input.dataset.act === 'ai-course' && ai) {
    const course = store.snapshot().courses.find((item) => item.id === input.value)
    ai.courseId = input.value
    ai.name = course ? `Kế hoạch môn ${course.name}` : ai.name
    ai.output = course?.output || ''
    ai.start = course?.start || ''
    ai.date = course?.end || ''
    ai.docIds = store.snapshot().documents.filter((doc) => doc.courseId === input.value).map((doc) => doc.id)
    render()
  }
}

const MAX_FILE = 20 * 1024 * 1024

function uploadDocs(courseId, files) {
  const list = [...files]
  if (!list.length) return
  if (list.some((file) => file.size > MAX_FILE)) { toast('Mỗi tệp cần nhỏ hơn 20 MB'); return }
  const created = store.addDocuments(courseId, list)
  Promise.all(created.map((doc, index) => saveBlob(doc.id, list[index]))).then(() => {
    render()
    toast(`Đã tải ${list.length} tệp`)
  }).catch(() => {
    render()
    toast('Đã lưu tên tệp, chưa lưu được nội dung để xem')
  })
}
function uploadTask(taskId, files) {
  const list = [...files]
  if (!list.length) return
  if (list.some((file) => file.size > MAX_FILE)) { toast('Mỗi tệp cần nhỏ hơn 20 MB'); return }
  const rows = list.map((file) => store.addTaskFile(taskId, file)).filter(Boolean)
  Promise.all(rows.map((row, index) => saveBlob(row.id, list[index]))).then(() => {
    render()
    toast(`Đã đẩy ${list.length} tệp lên`, { label: 'Hỏi AI', run: () => sendChat('task', 'Giải bài tập này') })
  }).catch(() => {
    render()
    toast('Đã lưu tên tệp, chưa lưu được nội dung để xem')
  })
}

async function viewFile(id) {
  let saved = null
  try { saved = await loadBlob(id) } catch { saved = null }
  if (!saved?.blob) { toast('Tệp này chưa có nội dung để xem. Hãy tải lại tệp.'); return }
  if (viewer?.url) URL.revokeObjectURL(viewer.url)
  const kind = fileKind(saved.name, saved.type)
  const text = kind === 'text' ? await saved.blob.text() : ''
  viewer = { name: saved.name || 'Tài liệu', kind, text, url: kind === 'text' ? '' : URL.createObjectURL(saved.blob) }
  render()
}

function closeViewer() {
  if (viewer?.url) URL.revokeObjectURL(viewer.url)
  viewer = null
  render()
}

function onDrag(event) {
  const zone = event.target.closest('[data-drop]')
  if (!zone) return
  event.preventDefault()
  if (event.type === 'dragover') zone.classList.add('over')
  if (event.type === 'dragleave') zone.classList.remove('over')
  if (event.type === 'drop') {
    zone.classList.remove('over')
    if (zone.dataset.drop === 'task') uploadTask(route.id, event.dataTransfer.files)
    else uploadDocs(zone.dataset.drop, event.dataTransfer.files)
  }
}

function onMouseDown(event) {
  const actBtn = event.target.closest('[data-act="hours-step"], [data-act="ai-set-hours"], [data-act="ai-fix"], [data-act="ai-del"], [data-act="ai-confirm"]')
  if (actBtn) event.preventDefault()
}

function onFocusOut(event) {
  if (rendering) return
  const hoursField = event.target.closest?.('.hours-input')
  if (!hoursField || !ai || !document.contains(hoursField)) return
  window.clearTimeout(hoursInputTimer)
  const id = hoursField.dataset.id
  const parsed = parseHoursInput(hoursField.value)
  const hours = Number.isFinite(parsed) ? parsed : 0
  const task = ai.tasks.find((t) => t.id === id)
  const hadTyping = !!ai.typingHours
  ai.typingHours = null
  if (task && (Number(task.hours) !== hours || hadTyping)) {
    applyAiHours(id, hours, true, false, true)
  }
}

function onKey(event) {
  if (event.key === 'Escape' && viewer) { closeViewer(); return }
  if (event.key === 'Escape' && drawer) closeAi()
  const hoursField = event.target.closest?.('.hours-input')
  if (hoursField && ai) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const id = hoursField.dataset.id
      const dir = event.key === 'ArrowUp' ? 1 : -1
      const task = ai.tasks.find((t) => t.id === id)
      if (task) {
        const pending = ai.typingHours?.id === id ? parseHoursInput(ai.typingHours.raw) : NaN
        const base = Number.isFinite(pending) ? pending : (Number.isFinite(Number(task.hours)) ? Number(task.hours) : 1)
        window.clearTimeout(hoursInputTimer)
        ai.typingHours = null
        const next = Math.max(0, Math.min(24, Math.round((base + dir * 0.5) * 2) / 2))
        applyAiHours(id, next, true, false, true)
      }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      window.clearTimeout(hoursInputTimer)
      const id = hoursField.dataset.id
      const parsed = parseHoursInput(hoursField.value)
      ai.typingHours = null
      applyAiHours(id, Number.isFinite(parsed) ? parsed : 0, true, false, true)
      return
    }
  }
  const area = event.target.closest('.composer textarea')
  if (area && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendChat(area.closest('form').dataset.scope, area.value)
  }
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', next)
  try { localStorage.setItem('sf-theme', next) } catch { /* ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    const styles = getComputedStyle(document.documentElement)
    meta.content = (next === 'dark' ? styles.getPropertyValue('--bg') : styles.getPropertyValue('--brand')).trim()
  }
  render()
}

document.addEventListener('submit', onSubmit)
document.addEventListener('mousedown', onMouseDown)
document.addEventListener('click', onClick)
document.addEventListener('input', onInput)
document.addEventListener('change', onChange)
document.addEventListener('focusout', onFocusOut)
document.addEventListener('dragover', onDrag)
document.addEventListener('dragleave', onDrag)
document.addEventListener('drop', onDrag)
document.addEventListener('keydown', onKey)
window.addEventListener('hashchange', onRoute)
narrowQuery.addEventListener('change', () => { if (store.current()) render() })

store.init().then(() => {
  if (!location.hash) location.hash = '#/'
  onRoute()
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {})
  probeAi().then((live) => {
    aiLive = live
    if (store.current()) render()
  })
  window.setInterval(noticeTick, 60000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) noticeTick() })
})

// Every minute: create reminders that just became due (task/class starting soon, batch slot reached…).
// Only the bell badge and a toast change, so a form being typed in is never re-rendered.
let lastDue = -1
function noticeTick() {
  if (!store.current()) { lastDue = -1; return }
  const { due } = store.tick()
  if (lastDue >= 0 && due > lastDue) {
    const now = Date.now()
    const latest = store.snapshot().notices
      .filter((notice) => noticeDue(notice, now))
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    toast(latest ? latest.title : `Bạn có ${due} thông báo mới`, { label: 'Xem', run: () => navigate('#/thong-bao') })
  }
  if (due !== lastDue) {
    lastDue = due
    updateBadge(due)
    if (route.name === 'notices') render()
  }
}

function updateBadge(count) {
  document.querySelectorAll('a[href="#/thong-bao"]').forEach((link) => {
    let badge = link.querySelector('.badge')
    if (!count) { badge?.remove(); return }
    if (!badge) {
      badge = document.createElement('b')
      badge.className = 'badge'
      link.appendChild(badge)
    }
    badge.textContent = String(count)
  })
}

