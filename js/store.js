import {
  alignPlansToOutput, createDemo, defaultSettings, desiredNotices, emptyData, fileType, mergeNotices, SNOOZE_LIMIT, unreadCount, welcomeMessage,
} from './model.js?v=75'
import { atTime, isoOf, uid } from './format.js'

const ACCOUNTS = 'sf-accounts-v1'
const SESSION = 'sf-session-v1'
const memory = new Map()

function readRaw(key) {
  try { return localStorage.getItem(key) } catch { return memory.get(key) ?? null }
}
function writeRaw(key, value) {
  try { localStorage.setItem(key, value) } catch { memory.set(key, value) }
}
function removeRaw(key) {
  try { localStorage.removeItem(key) } catch { memory.delete(key) }
}
function dataKey(email) { return `sf-data-v2:${email}` }

function emailOk(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function sanitize(raw) {
  const data = emptyData()
  if (!raw || typeof raw !== 'object') return data
  data.courses = asArray(raw.courses)
  data.documents = asArray(raw.documents)
  data.freeSlots = asArray(raw.freeSlots)
  data.plans = asArray(raw.plans)
  data.notices = asArray(raw.notices)
  data.assistant = asArray(raw.assistant)
  data.taskChats = raw.taskChats && typeof raw.taskChats === 'object' ? raw.taskChats : {}
  data.settings = { ...defaultSettings(), ...(raw.settings || {}) }
  if (data.settings.frequency === 'morning') data.settings.frequency = 'batch'
  return data
}

export function createStore() {
  let accounts = {}
  let user = null
  let data = emptyData()
  const codes = new Map()

  function readAccounts() {
    try { accounts = JSON.parse(readRaw(ACCOUNTS) || '{}') || {} } catch { accounts = {} }
  }
  function writeAccounts() { writeRaw(ACCOUNTS, JSON.stringify(accounts)) }
  function readData(email) {
    try { return sanitize(JSON.parse(readRaw(dataKey(email)) || 'null')) } catch { return emptyData() }
  }
  function writeData() {
    if (user) writeRaw(dataKey(user.email), JSON.stringify(data))
  }
  function sync(now = Date.now()) {
    const merged = mergeNotices(data.notices, desiredNotices(data, now), now)
    if (merged.changed) data.notices = merged.notices
    return merged
  }
  function enter(email, remember) {
    user = accounts[email]
    data = readData(email)
    if (data.settings.outlineTasks !== 6) {
      data = alignPlansToOutput(data, Date.now())
      data.settings = { ...data.settings, outlineTasks: 6 }
    }
    if (!data.assistant.length) data.assistant = [welcomeMessage(user.name.split(/\s+/).pop())]
    sync()
    writeData()
    const payload = JSON.stringify({ email })
    removeRaw(SESSION)
    try { sessionStorage.removeItem(SESSION) } catch { /* ignore */ }
    if (remember) writeRaw(SESSION, payload)
    else {
      try { sessionStorage.setItem(SESSION, payload) } catch { writeRaw(SESSION, payload) }
    }
    return data
  }

  async function ensureDemo() {
    readAccounts()
    const email = 'nam@sv.edu.vn'
    if (!accounts[email]) {
      accounts[email] = { name: 'Phạm Hoàng Nam', email, passwordHash: await sha256('123456') }
      writeAccounts()
    }
    if (!readRaw(dataKey(email))) writeRaw(dataKey(email), JSON.stringify(createDemo(Date.now())))
  }

  return {
    async init() {
      await ensureDemo()
      readAccounts()
      let raw = null
      try { raw = sessionStorage.getItem(SESSION) } catch { raw = null }
      raw = raw || readRaw(SESSION)
      if (!raw) return
      try {
        const parsed = JSON.parse(raw)
        if (parsed?.email && accounts[parsed.email]) enter(parsed.email, !!readRaw(SESSION))
      } catch { /* ignore */ }
    },
    current() { return user },
    snapshot() { sync(); return data },
    settings() { return data.settings },
    unread(now = Date.now()) { return unreadCount(data.notices, now) },
    hasAccount(email) { return !!accounts[String(email || '').trim().toLowerCase()] },
    async register({ name, email, password }) {
      readAccounts()
      const clean = String(email || '').trim().toLowerCase()
      if (!String(name || '').trim()) return { ok: false, errors: { name: 'Vui lòng nhập họ và tên.' } }
      if (!clean) return { ok: false, errors: { email: 'Vui lòng nhập email.' } }
      if (!emailOk(clean)) return { ok: false, errors: { email: 'Email chưa đúng định dạng.' } }
      if (accounts[clean]) return { ok: false, errors: { email: 'Email này đã được đăng ký.' } }
      if (String(password || '').length < 6) return { ok: false, errors: { password: 'Mật khẩu cần ít nhất 6 ký tự.' } }
      accounts[clean] = { name: String(name).trim(), email: clean, passwordHash: await sha256(password) }
      writeAccounts()
      writeRaw(dataKey(clean), JSON.stringify(emptyData()))
      enter(clean, true)
      return { ok: true }
    },
    async login({ email, password, remember }) {
      readAccounts()
      const clean = String(email || '').trim().toLowerCase()
      if (!clean) return { ok: false, errors: { email: 'Vui lòng nhập email.' } }
      if (!emailOk(clean)) return { ok: false, errors: { email: 'Email chưa đúng định dạng.' } }
      const account = accounts[clean]
      if (!account) return { ok: false, errors: { email: 'Chưa có tài khoản với email này.' } }
      if (await sha256(password || '') !== account.passwordHash) return { ok: false, errors: { password: 'Mật khẩu không đúng.' } }
      enter(clean, remember)
      return { ok: true }
    },
    loginDemo(remember) {
      enter('nam@sv.edu.vn', !!remember)
      return { ok: true }
    },
    logout() {
      user = null
      data = emptyData()
      removeRaw(SESSION)
      try { sessionStorage.removeItem(SESSION) } catch { /* ignore */ }
    },
    requestReset(email) {
      readAccounts()
      const clean = String(email || '').trim().toLowerCase()
      if (!clean) return { ok: false, error: 'Vui lòng nhập email.' }
      if (!emailOk(clean)) return { ok: false, error: 'Email chưa đúng định dạng.' }
      if (!accounts[clean]) return { ok: false, error: 'Không tìm thấy tài khoản với email này.' }
      const code = String(Math.floor(100000 + Math.random() * 900000))
      codes.set(clean, code)
      return { ok: true, code, email: clean }
    },
    async resetPassword(email, code, password) {
      const clean = String(email || '').trim().toLowerCase()
      if (codes.get(clean) !== String(code || '').trim()) return { ok: false, error: 'Mã xác nhận chưa đúng.' }
      if (!accounts[clean]) return { ok: false, error: 'Không tìm thấy tài khoản với email này.' }
      if (String(password || '').length < 6) return { ok: false, error: 'Mật khẩu cần ít nhất 6 ký tự.' }
      accounts[clean].passwordHash = await sha256(password)
      writeAccounts()
      codes.delete(clean)
      return { ok: true }
    },
    loadSample() {
      if (data.courses.length) return { ok: false }
      data = createDemo(Date.now())
      sync()
      writeData()
      return { ok: true }
    },
    saveCourse(form) {
      const schedule = (form.schedule || [])
        .filter((row) => row.start && row.end && row.end > row.start)
        .map((row) => ({
          id: row.id || uid('cs'),
          weekday: Number(row.weekday) || 1,
          start: row.start,
          end: row.end,
          room: String(row.room || '').trim(),
          from: isoOf(row.from) || '',
          until: isoOf(row.until) || '',
          repeat: row.repeat === 'once' || row.repeat === 'biweek' ? row.repeat : 'week',
        }))
      const record = {
        id: form.id || uid('c'),
        name: String(form.name || '').trim(),
        start: form.start, end: form.end,
        output: String(form.output || '').trim(),
        goal: String(form.goal || '').trim(),
        notes: String(form.notes || '').trim(),
        color: /^#[0-9a-fA-F]{6}$/.test(String(form.color || '')) ? String(form.color) : (Number(form.color) || 0),
        schedule,
      }
      const index = data.courses.findIndex((item) => item.id === record.id)
      const isNew = index < 0
      if (index >= 0) data.courses[index] = record
      else data.courses.push(record)
      sync()
      writeData()
      return { record, isNew }
    },
    deleteCourse(id) {
      const course = data.courses.find((item) => item.id === id)
      if (!course) return null
      const snapshot = {
        course,
        documents: data.documents.filter((item) => item.courseId === id),
        plans: data.plans.filter((item) => item.courseId === id),
      }
      data.courses = data.courses.filter((item) => item.id !== id)
      data.documents = data.documents.filter((item) => item.courseId !== id)
      data.plans = data.plans.filter((item) => item.courseId !== id)
      sync()
      writeData()
      return snapshot
    },
    restoreCourse(snapshot) {
      data.courses.push(snapshot.course)
      data.documents.push(...snapshot.documents)
      data.plans.push(...snapshot.plans)
      sync()
      writeData()
    },
    addDocuments(courseId, files) {
      const created = files.map((file) => ({
        id: uid('d'), courseId, name: file.name, type: fileType(file.name), mime: file.type || '', size: file.size || 0, updatedAt: Date.now(),
      }))
      data.documents.push(...created)
      writeData()
      return created
    },
    deleteDocument(id) {
      const doc = data.documents.find((item) => item.id === id)
      data.documents = data.documents.filter((item) => item.id !== id)
      writeData()
      return doc
    },
    restoreDocument(doc) {
      if (doc) data.documents.push(doc)
      writeData()
    },
    addFreeSlot(slot) {
      const row = { id: uid('f'), weekday: Number(slot.weekday), start: slot.start, end: slot.end }
      data.freeSlots.push(row)
      sync()
      writeData()
      return row
    },
    removeFreeSlot(id) {
      const row = data.freeSlots.find((item) => item.id === id)
      data.freeSlots = data.freeSlots.filter((item) => item.id !== id)
      sync()
      writeData()
      return row
    },
    restoreFreeSlot(row) {
      if (row) data.freeSlots.push(row)
      sync()
      writeData()
    },
    savePlan(plan) {
      const index = data.plans.findIndex((item) => item.id === plan.id)
      if (index >= 0) data.plans[index] = plan
      else data.plans.push(plan)
      sync()
      writeData()
      return plan
    },
    deletePlan(id) {
      const plan = data.plans.find((item) => item.id === id)
      data.plans = data.plans.filter((item) => item.id !== id)
      sync()
      writeData()
      return plan
    },
    restorePlan(plan) {
      if (plan) data.plans.push(plan)
      sync()
      writeData()
    },
    updateCourseOutput(courseId, output) {
      const course = data.courses.find((item) => item.id === courseId)
      if (!course) return
      course.output = output
      writeData()
    },
    findTask(taskId) {
      for (const plan of data.plans) {
        const task = plan.tasks.find((item) => item.id === taskId)
        if (task) return { plan, task }
      }
      return null
    },
    updateTask(taskId, patch) {
      const found = this.findTask(taskId)
      if (!found) return null
      const previous = JSON.parse(JSON.stringify(found.task))
      Object.assign(found.task, patch)
      if (patch.status === 'done') found.task.doneAt = found.task.doneAt || Date.now()
      if (patch.status && patch.status !== 'done') found.task.doneAt = 0
      sync()
      writeData()
      return { ...found, previous }
    },
    addTaskFile(taskId, file) {
      const found = this.findTask(taskId)
      if (!found) return null
      const row = { id: uid('f'), name: file.name, type: fileType(file.name), mime: file.type || '', size: file.size || 0, updatedAt: Date.now() }
      found.task.files = found.task.files || []
      found.task.files.push(row)
      writeData()
      return row
    },
    removeTaskFile(taskId, fileId) {
      const found = this.findTask(taskId)
      if (!found) return null
      const row = (found.task.files || []).find((item) => item.id === fileId)
      found.task.files = (found.task.files || []).filter((item) => item.id !== fileId)
      writeData()
      return row
    },
    restoreTaskFile(taskId, row) {
      const found = this.findTask(taskId)
      if (found && row) found.task.files.push(row)
      writeData()
    },
    setSettings(patch) {
      data.settings = { ...defaultSettings(), ...data.settings, ...patch }
      sync()
      writeData()
    },
    markRead(id) {
      const notice = data.notices.find((item) => item.id === id)
      if (notice && !notice.read) { notice.read = true; writeData() }
    },
    markAllRead() {
      data.notices.forEach((notice) => { notice.read = true })
      writeData()
    },
    snooze(id, mins) {
      const notice = data.notices.find((item) => item.id === id)
      const now = Date.now()
      if (!notice) return { ok: false, reason: 'missing' }
      if (notice.snoozeUntil > now) return { ok: false, reason: 'wait', until: notice.snoozeUntil }
      if ((notice.snoozeCount || 0) >= SNOOZE_LIMIT) return { ok: false, reason: 'limit' }
      notice.snoozeCount = (notice.snoozeCount || 0) + 1
      notice.snoozeUntil = now + mins * 60000
      notice.read = false
      writeData()
      return { ok: true, until: notice.snoozeUntil, count: notice.snoozeCount }
    },
    pushAssistant(message) {
      data.assistant.push(message)
      writeData()
    },
    clearAssistant(name) {
      data.assistant = [welcomeMessage(name)]
      writeData()
    },
    pushTaskChat(taskId, message) {
      data.taskChats[taskId] = data.taskChats[taskId] || []
      data.taskChats[taskId].push(message)
      writeData()
    },
  }
}

export { atTime }
