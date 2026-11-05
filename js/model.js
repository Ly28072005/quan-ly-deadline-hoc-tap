import {
  DAY, STEP, WEEKDAYS, atTime, clock, dateISO, daysUntil, endOfDay, fold, formatDMY, formatHours,
  formatISO, formatSpan, formatWhen, isoOf, minutes, pad, parseDate, roundUp30, startOfDay, uid, weekdayMon,
} from './format.js'
import { composeTutor } from './tutor.js'
import { estimateWorkload, parseWorkload, roundHalf, sittingsOf, spreadHours } from './estimate.js?v=73'

export { estimateWorkload, roundHalf }

export const STATUS = {
  todo: { label: 'Chưa thực hiện', tone: 'gray' },
  doing: { label: 'Đang thực hiện', tone: 'blue' },
  done: { label: 'Hoàn thành', tone: 'green', check: true },
  overdue: { label: 'Quá hạn', tone: 'red' },
  class: { label: 'Lớp học', tone: 'gray' },
  studying: { label: 'Đang thực hiện', tone: 'green' },
  ended: { label: 'Kết thúc', tone: 'gray' },
}

export const DIFFICULTY = [
  [1, 'Rất dễ', 8],
  [2, 'Dễ', 12],
  [3, 'Vừa', 16],
  [4, 'Khó', 20],
  [5, 'Rất khó', 24],
]

export function emptyData() {
  return {
    courses: [], documents: [], freeSlots: [], plans: [], notices: [],
    assistant: [], taskChats: {}, settings: defaultSettings(),
  }
}

export const SNOOZE_LIMIT = 3

export function defaultSettings() {
  return {
    deadlineOn: true, scheduleOn: true, warningOn: true,
    deadlineDays: 7, snoozeMinutes: 15, frequency: 'instant', push: false,
    aiAck: false,
  }
}

export function nextBatch(now) {
  const date = new Date(now)
  for (const hour of [9, 13, 17]) {
    const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0)
    if (at.getTime() >= now) return at.getTime()
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 9, 0, 0, 0).getTime()
}

export function noticeDue(notice, now) {
  if (!notice || notice.read) return false
  if (notice.snoozeUntil > now) return false
  if ((notice.deliverAt || 0) > now) return false
  return true
}

export function fileType(name) {
  const ext = String(name || '').split('.').pop().toLowerCase()
  if (ext === 'pdf') return 'PDF'
  if (['ppt', 'pptx'].includes(ext)) return 'Slide'
  if (['doc', 'docx'].includes(ext)) return 'Word'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'Ảnh'
  return 'Ghi chú'
}

export function courseStatus(course, now) {
  return endOfDay(course.end) < now ? 'ended' : 'studying'
}

export function isParent(task, tasks) {
  return tasks.some((item) => item.parentId === task.id)
}

export function leafTasks(tasks) {
  return (tasks || []).filter((task) => !isParent(task, tasks))
}

export function taskHours(task) {
  if (Number.isFinite(Number(task.hours)) && Number(task.hours) !== 0) return Number(task.hours)
  if (task.start && task.end && task.end > task.start) return (task.end - task.start) / 3600000
  return Number(task.hours) || 0
}

export function taskStatus(task, now) {
  if (task.status === 'done') return 'done'
  if (task.end && task.end < now) return 'overdue'
  if (task.status === 'doing') return 'doing'
  return 'todo'
}

export function planStatus(plan, now) {
  const leaves = leafTasks(plan.tasks)
  if (!leaves.length) return 'todo'
  if (leaves.every((task) => task.status === 'done')) return 'done'
  if (leaves.some((task) => taskStatus(task, now) === 'overdue') || (plan.deadline && plan.deadline < now)) return 'overdue'
  if (leaves.some((task) => task.status === 'doing' || task.status === 'done')) return 'doing'
  return 'todo'
}

export function planStats(plan, now) {
  const leaves = leafTasks(plan.tasks)
  const total = leaves.length
  const done = leaves.filter((task) => task.status === 'done').length
  const hours = leaves.reduce((sum, task) => sum + taskHours(task), 0)
  const remain = leaves.filter((task) => task.status !== 'done').reduce((sum, task) => sum + taskHours(task), 0)
  const overdue = leaves.filter((task) => taskStatus(task, now) === 'overdue').length
  return { total, done, ratio: total ? done / total : 0, hours, remain, overdue, status: planStatus(plan, now) }
}

function spanHours(start, end) {
  return Math.round(((end - start) / 3600000) * 10) / 10
}

function isoDay(value) {
  const text = isoOf(value) || String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

export function slotWindow(course, slot) {
  return {
    from: isoDay(slot?.from) || isoDay(course?.start) || '',
    until: isoDay(slot?.until) || isoDay(course?.end) || '',
  }
}

function slotRepeat(slot) {
  const value = slot?.repeat
  return value === 'once' || value === 'biweek' ? value : 'week'
}

function firstWeekdayOnOrAfter(iso, weekday) {
  let day = startOfDay(parseDate(iso))
  for (let i = 0; i < 7; i += 1) {
    if (weekdayMon(new Date(day)) === Number(weekday)) return dateISO(day)
    day += DAY
  }
  return iso
}

function slotOrigin(course, slot) {
  const { from } = slotWindow(course, slot)
  if (!from) return ''
  return firstWeekdayOnOrAfter(from, slot.weekday)
}

function dayInSlot(course, slot, day) {
  if (Number(slot.weekday) !== weekdayMon(new Date(day))) return false
  const iso = dateISO(day)
  const { from, until } = slotWindow(course, slot)
  if (from && iso < from) return false
  if (until && iso > until) return false
  const origin = slotOrigin(course, slot)
  const repeat = slotRepeat(slot)
  if (repeat === 'once') return origin ? iso === origin : iso === (from || iso)
  if (repeat === 'biweek' && origin) {
    const weeks = Math.round((startOfDay(day) - startOfDay(parseDate(origin))) / (7 * DAY))
    return weeks >= 0 && weeks % 2 === 0
  }
  return true
}

function slotDays(course, slot) {
  const { from, until } = slotWindow(course, slot)
  if (!from && !until) return ['*']
  const start = startOfDay(parseDate(from || until))
  const last = startOfDay(parseDate(until || from))
  const days = []
  for (let day = start; day <= last; day += DAY) {
    if (dayInSlot(course, slot, day)) days.push(dateISO(day))
  }
  return days
}

function slotsCollide(aCourse, aRow, bCourse, bRow) {
  if (Number(aRow.weekday) !== Number(bRow.weekday)) return false
  if (!timesOverlap(aRow.start, aRow.end, bRow.start, bRow.end)) return false
  const aDays = slotDays(aCourse, aRow)
  const bDays = slotDays(bCourse, bRow)
  if (aDays[0] === '*' || bDays[0] === '*') return true
  const set = new Set(bDays)
  return aDays.some((day) => set.has(day))
}

export function classIntervals(courses, from, to) {
  const list = []
  for (let day = startOfDay(from); day < to; day += DAY) {
    for (const course of courses) {
      for (const slot of course.schedule || []) {
        if (!dayInSlot(course, slot, day)) continue
        const start = atTime(day, slot.start)
        const end = atTime(day, slot.end)
        if (end > from && start < to) list.push({ start, end, name: course.name, room: slot.room || '', color: course.color, courseId: course.id })
      }
    }
  }
  return list
}

function blocksOf(tasks, ignoreId, includeDone = false) {
  return leafTasks(tasks)
    .filter((task) => task.id !== ignoreId && task.start && task.end && (includeDone || task.status !== 'done'))
    .map((task) => [task.start, task.end])
}

function overlaps(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1
}

export function coveredByFree(start, end, freeSlots) {
  const wd = weekdayMon(new Date(start))
  if (startOfDay(start) !== startOfDay(end - 1)) return false
  return freeSlots.some((slot) => Number(slot.weekday) === wd && atTime(start, slot.start) <= start && atTime(start, slot.end) >= end)
}

function slotFree(start, end, freeSlots, blocked) {
  if (!coveredByFree(start, end, freeSlots)) return false
  return !blocked.some(([a, b]) => overlaps(start, end, a, b))
}

export function findWindow({ duration, from, until, freeSlots, blocked, skipDays = null }) {
  const need = Math.max(STEP, Math.round(duration / STEP) * STEP)
  if (!freeSlots?.length || from + need > until) return null
  for (let day = startOfDay(from); day < until; day += DAY) {
    if (skipDays && skipDays.has(dateISO(day))) continue
    const wd = weekdayMon(new Date(day))
    const daySlots = freeSlots.filter((slot) => Number(slot.weekday) === wd)
    if (!daySlots.length) continue
    let minStart = Infinity
    let maxEnd = 0
    for (const slot of daySlots) {
      const s = atTime(day, slot.start)
      const e = atTime(day, slot.end)
      if (s < minStart) minStart = s
      if (e > maxEnd) maxEnd = e
    }
    let cursor = roundUp30(Math.max(from, minStart))
    const limit = Math.min(until, maxEnd)
    while (cursor + need <= limit) {
      if (slotFree(cursor, cursor + need, daySlots, blocked)) return { start: cursor, end: cursor + need }
      cursor += STEP
    }
  }
  return null
}

function busyDays(tasks, ignoreId) {
  const set = new Set()
  for (const task of leafTasks(tasks)) {
    if (task.id === ignoreId || !task.start) continue
    set.add(dateISO(task.start))
  }
  return set
}

function slotStamp(start, end) {
  return `${formatWhen(start)} ${clock(start)} – ${clock(end)}`
}

function fixedBlocks(data, ignorePlanId, from, until) {
  const hard = foreignLeaves(data, ignorePlanId).filter((item) => item.end > from && item.start < until)
  return classIntervals(data.courses, from, until).map((item) => [item.start, item.end])
    .concat(hard.map((item) => [item.start, item.end]))
}

export function proposeFix(task, tasks, data, deadline, ignorePlanId = '') {
  const hours = Math.max(0.5, taskHours(task) || 1)
  const duration = hours * 3600000
  const from = Math.max(Date.now(), Number(data?.floor) || 0)
  const until = deadline || from
  const blocked = fixedBlocks(data, ignorePlanId, Math.min(from, task.start || from), until).concat(blocksOf(tasks, task.id))
  const preferred = findWindow({
    duration,
    from: Math.max(from, task.start ? startOfDay(task.start) : from),
    until,
    freeSlots: data.freeSlots,
    blocked,
  }) || findWindow({ duration, from, until, freeSlots: data.freeSlots, blocked })
  if (!preferred) return { kind: 'free', hours, label: 'Thêm giờ rảnh' }
  return {
    kind: 'move',
    hours,
    start: preferred.start,
    end: preferred.end,
    label: `Chuyển sang khung ${formatHours(hours)}h trống gần nhất: ${slotStamp(preferred.start, preferred.end)}`,
  }
}

function cascadeLeaves(tasks, pivot, data, deadline, ignorePlanId) {
  const from = Math.max(Date.now(), Number(data?.floor) || 0)
  const until = deadline || pivot.end
  const others = leafTasks(tasks)
    .filter((task) => task.id !== pivot.id && task.status !== 'done' && task.start && task.end)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const minStart = others.reduce((m, t) => Math.min(m, t.start), Math.min(from, pivot.start || from))
  const foreign = fixedBlocks(data, ignorePlanId, minStart, until)

  // Cac nhiem vu ket thuc truoc khi pivot bat dau (khong va cham voi pivot) thi giu nguyen
  const unaffected = others.filter((task) => task.end <= pivot.start && !overlaps(pivot.start, pivot.end, task.start, task.end))
  // Moi nhiem vu bi pivot de len (ke ca cung gio bat dau) hoac nam sau pivot deu duoc xet day lui
  const queue = others.filter((task) => !unaffected.includes(task))
  const placed = [...unaffected, pivot]

  for (const task of queue) {
    const duration = Math.max(STEP, (taskHours(task) || 0.5) * 3600000)
    const blocked = foreign.concat(placed.map((item) => [item.start, item.end]))
    if (!overlaps(pivot.start, pivot.end, task.start, task.start + duration) && slotFree(task.start, task.start + duration, data.freeSlots, blocked)) {
      task.end = task.start + duration
      placed.push(task)
      continue
    }
    const window = findWindow({
      duration,
      from: Math.max(from, pivot.end, task.start),
      until,
      freeSlots: data.freeSlots,
      blocked,
    }) || findWindow({
      duration,
      from,
      until,
      freeSlots: data.freeSlots,
      blocked,
    })
    if (!window) {
      task.start = 0
      task.end = 0
      continue
    }
    task.start = window.start
    task.end = window.end
    placed.push(task)
  }
}

export function placeTaskWindow(tasks, taskId, start, end, data, deadline, ignorePlanId) {
  const next = tasks.map((task) => ({ ...task, files: task.files || [] }))
  const task = next.find((item) => item.id === taskId)
  if (!task || !start || !end) return next
  task.start = start
  task.end = end
  task.needFree = 0
  if (!(Number(task.hours) > 0)) task.hours = (end - start) / 3600000
  cascadeLeaves(next, task, data, deadline, ignorePlanId)
  refreshParents(next)
  return next
}

export function applyHoursChange(tasks, taskId, hours, data, deadline, ignorePlanId) {
  const next = tasks.map((task) => ({ ...task, files: task.files || [] }))
  const task = next.find((item) => item.id === taskId)
  if (!task) return { tasks: next, kind: 'ok' }
  const oldEnd = task.end
  // Chi tinh cac nhiem vu da co lich truoc khi chinh gio; nhiem vu von chua xep khong duoc coi la "bi day mat"
  const wasPlaced = new Set(leafTasks(next).filter((item) => item.start && item.end).map((item) => item.id))
  task.hours = hours
  task.needFree = 0
  if (!(hours > 0) || hours > 24 || !task.start) {
    refreshParents(next)
    return { tasks: next, kind: 'ok' }
  }
  const need = hours * 3600000
  const wantEnd = task.start + need
  const from = Math.max(Date.now(), Number(data?.floor) || 0)
  const until = deadline || wantEnd
  const minFrom = Math.min(from, task.start)
  const foreign = foreignLeaves(data, ignorePlanId).filter((item) => item.end > minFrom && item.start < until)
  const classes = classIntervals(data.courses, minFrom, until)
  const fixed = classes.map((item) => [item.start, item.end]).concat(foreign.map((item) => [item.start, item.end]))

  // 1. Neu giam gio hoac giu nguyen trong khung cu va khong va cham ai
  if (wantEnd <= oldEnd && slotFree(task.start, wantEnd, data.freeSlots, fixed.concat(blocksOf(next, taskId)))) {
    task.end = wantEnd
    refreshParents(next)
    return { tasks: next, kind: 'ok' }
  }

  // 2. Kiem tra trung lich voi MON KHAC hoac LICH HOC TREN LOP tai khung [task.start, wantEnd]
  const hitForeign = foreign.some((item) => overlaps(task.start, wantEnd, item.start, item.end))
  const hitClass = classes.some((item) => overlaps(task.start, wantEnd, item.start, item.end))
  if (hitForeign || hitClass) {
    task.end = wantEnd
    refreshParents(next)
    const window = findWindow({
      duration: need,
      from: Math.max(from, startOfDay(task.start)),
      until,
      freeSlots: data.freeSlots,
      blocked: fixed.concat(blocksOf(next, taskId)),
    }) || findWindow({
      duration: need,
      from,
      until,
      freeSlots: data.freeSlots,
      blocked: fixed.concat(blocksOf(next, taskId)),
    })
    if (window) return { tasks: next, kind: 'need-slot', hours, window }
    task.needFree = hours
    return { tasks: next, kind: 'need-free', hours, hints: suggestFreeAdds(data, from, until, hours) }
  }

  // 3. Neu cac mon khac chua xep vao gio do va ca ranh hien tai du cho:
  // -> Cho chinh gio tai cho va day lui cac nhiem vu cung mon (khong day lui mon khac)
  const keep = wantEnd <= startOfDay(task.start) + DAY && slotFree(task.start, wantEnd, data.freeSlots, fixed)
  if (keep) {
    const snapshot = next.map((item) => ({ ...item }))
    task.end = wantEnd
    cascadeLeaves(next, task, data, deadline, ignorePlanId)
    refreshParents(next)
    const leftover = leafTasks(next).filter((item) => item.status !== 'done' && item.id !== taskId && !item.start && wasPlaced.has(item.id))
    if (leftover.length) {
      const miss = roundHalf(leftover.reduce((sum, item) => sum + taskHours(item), 0)) || hours
      for (let i = 0; i < next.length; i += 1) {
        next[i].start = snapshot[i].start
        next[i].end = snapshot[i].end
      }
      refreshParents(next)
      task.needFree = miss
      return { tasks: next, kind: 'need-free', hours, hints: suggestFreeAdds(data, from, until, miss) }
    }
    return { tasks: next, kind: 'ok' }
  }

  // 4. Neu ca ranh tai cho khong du do dai nhung van con khung gio ranh khac (khong trung mon khac):
  // -> Tim khung gio ranh du do dai va day lui cac nhiem vu cung mon bi va cham
  const candidateWindows = []
  const w1 = findWindow({
    duration: need,
    from: Math.max(from, task.start),
    until,
    freeSlots: data.freeSlots,
    blocked: fixed,
  })
  if (w1) candidateWindows.push(w1)
  const w2 = findWindow({
    duration: need,
    from,
    until,
    freeSlots: data.freeSlots,
    blocked: fixed.concat(blocksOf(next, taskId)),
  })
  if (w2 && (!w1 || w2.start !== w1.start)) candidateWindows.push(w2)

  let lastMiss = 0
  for (const movedWindow of candidateWindows) {
    const trial = next.map((item) => ({ ...item, files: item.files || [] }))
    const trialTask = trial.find((item) => item.id === taskId)
    trialTask.start = movedWindow.start
    trialTask.end = movedWindow.end
    cascadeLeaves(trial, trialTask, data, deadline, ignorePlanId)
    refreshParents(trial)
    const leftover = leafTasks(trial).filter((item) => item.status !== 'done' && item.id !== taskId && !item.start && wasPlaced.has(item.id))
    if (!leftover.length) {
      return { tasks: trial, kind: 'ok', window: movedWindow }
    }
    lastMiss = roundHalf(leftover.reduce((sum, item) => sum + taskHours(item), 0))
  }

  // 5. Het khung thoi gian ranh -> Giu nguyen khung cu de khong de len nhiem vu cung mon, bao can bo sung gio ranh
  const missHours = lastMiss > 0 ? lastMiss : hours
  task.end = oldEnd
  task.needFree = missHours
  refreshParents(next)
  return { tasks: next, kind: 'need-free', hours, hints: suggestFreeAdds(data, from, until, missHours) }
}

// Nhiem vu cua ke hoach AI co han muon hon data.displaceAfter se duoc xep lai (lui sau) khi xac nhan,
// nen khong tinh la "trung lich" voi ke hoach dang tao.
function movableLater(plan, task, data, now = Date.now()) {
  const after = Number(data?.displaceAfter) || 0
  if (!after || !autoScheduled(plan) || !((plan.deadline || 0) > after)) return false
  return task.status !== 'done' && task.status !== 'doing' && task.end > now
}

function foreignLeaves(data, ignorePlanId) {
  const list = []
  const now = Date.now()
  for (const plan of data?.plans || []) {
    if (ignorePlanId && plan.id === ignorePlanId) continue
    const course = (data.courses || []).find((item) => item.id === plan.courseId)
    for (const task of leafTasks(plan.tasks)) {
      if (!task.start || !task.end || task.status === 'done') continue
      if (movableLater(plan, task, data, now)) continue
      list.push({
        ...task,
        planId: plan.id,
        planName: plan.name || '',
        courseName: course?.name || '',
        deadline: plan.deadline || 0,
      })
    }
  }
  return list
}

function guardTasks(data, ignorePlanId, deadline, now) {
  const tasks = []
  for (const plan of data?.plans || []) {
    if (plan.id === ignorePlanId) continue
    const movable = autoScheduled(plan) && deadline && (plan.deadline || 0) >= deadline
    const course = (data.courses || []).find((item) => item.id === plan.courseId)
    for (const task of leafTasks(plan.tasks)) {
      if (!task.start || !task.end) continue
      if (movable && task.status !== 'done' && task.status !== 'doing' && task.end > now) continue
      tasks.push({
        ...task,
        planId: plan.id,
        planName: plan.name || '',
        courseName: course?.name || '',
        deadline: plan.deadline || 0,
      })
    }
  }
  return tasks
}

function sameStudyDay(start, end) {
  return startOfDay(start) === startOfDay(end - 1)
}

function coveredFreeHours(start, end, freeSlots) {
  if (!sameStudyDay(start, end)) return 0
  const wd = weekdayMon(new Date(start))
  let total = 0
  for (const slot of freeSlots || []) {
    if (Number(slot.weekday) !== wd) continue
    const from = Math.max(start, atTime(start, slot.start))
    const to = Math.min(end, atTime(start, slot.end))
    if (to > from) total += (to - from) / 3600000
  }
  return Math.round(total * 10) / 10
}

export function hourHardError(task, data, deadline, ignorePlanId = '', pre = null) {
  const hours = Number(task.hours)
  if (!(hours > 0)) return { level: 'bad', code: 'hours-zero', text: 'Thời lượng nhiệm vụ phải lớn hơn 0 giờ (tối thiểu 0,5 giờ).' }
  if (hours > 24) return { level: 'bad', code: 'hours-day', text: 'Thời lượng nhiệm vụ không thể vượt quá 24 giờ trong một ca.' }
  const now = pre ? pre.now : Date.now()
  const until = deadline || task.end || 0
  if (until > now) {
    const free = pre && deadline && until === deadline && pre.freeStrict !== null
      ? pre.freeStrict
      : openHours(data, now, until, ignorePlanId, 0)
    if (hours > free + 0.05) return { level: 'bad', code: 'hours-free', text: 'Số giờ nhập vào vượt quá toàn bộ tổng quỹ thời gian rảnh còn lại.' }
  }
  return null
}

export function taskWarnings(task, tasks, data, deadline, parent, ignorePlanId = '', course = null, pre = null) {
  const warnings = []
  const now = pre ? pre.now : Date.now()
  const hard = hourHardError(task, data, deadline, ignorePlanId, pre)
  const needFree = Number(task.needFree) > 0 || hard?.code === 'hours-free'
  if (hard && hard.code !== 'hours-free') warnings.push(hard)
  if (needFree) {
    const need = Number(task.needFree) > 0 ? Number(task.needFree) : Number(task.hours)
    warnings.push({
      level: 'bad',
      code: 'free',
      text: `Quỹ thời gian rảnh không đủ ${formatHours(need)} giờ cho nhiệm vụ này. Cần bổ sung thêm ${formatHours(need)} giờ rảnh.`,
    })
  }
  if (hard?.code === 'hours-zero') return warnings
  if (task.start && task.end && task.end <= task.start) {
    warnings.push({ level: 'bad', code: 'order', text: 'Ngày bắt đầu phải trước ngày kết thúc.' })
    return warnings
  }
  if (!task.start || !task.end) {
    warnings.push({ level: 'bad', code: 'missing', text: 'Chưa có giờ bắt đầu và kết thúc hợp lệ.' })
    return warnings
  }
  if (deadline && task.end > deadline) {
    warnings.push({ level: 'bad', code: 'deadline', text: `Kết thúc sau deadline ${formatWhen(deadline)} · ${clock(deadline)}` })
  }
  if (parent && (task.start < parent.start || task.end > parent.end)) {
    warnings.push({ level: 'bad', code: 'parent', text: `Nằm ngoài thời gian của mục cha (${formatWhen(parent.start)} – ${formatWhen(parent.end)})` })
  }
  const classes = pre ? pre.allClasses : classIntervals(data.courses, task.start, task.end)
  for (const item of classes) {
    if (overlaps(task.start, task.end, item.start, item.end)) {
      warnings.push({ level: 'bad', code: 'class', text: `Trùng lịch học ${item.name} ${formatSpan(item.start, item.end)}` })
    }
  }
  const siblings = pre ? pre.leaves : leafTasks(tasks)
  for (const other of siblings) {
    if (other.id === task.id || !other.start || !other.end || other.status === 'done') continue
    if (overlaps(task.start, task.end, other.start, other.end)) {
      warnings.push({ level: 'bad', code: 'overlap', text: `Khung giờ này đã có nhiệm vụ ‘${other.name}’ (${formatSpan(other.start, other.end)}).` })
    }
  }
  const foreign = pre ? pre.allForeign : foreignLeaves(data, ignorePlanId)
  for (const other of foreign) {
    if (other.id === task.id || !overlaps(task.start, task.end, other.start, other.end)) continue
    const who = other.courseName ? `môn ${other.courseName}` : (other.planName || 'kế hoạch khác')
    warnings.push({ level: 'bad', code: 'overlap-foreign', text: `Trùng lịch với nhiệm vụ ‘${other.name}’ của ${who} (${formatSpan(other.start, other.end)}).` })
  }
  const placed = spanHours(task.start, task.end)
  const cStart = pre ? pre.courseStartTs : (course?.start ? atTime(course.start, '00:00') : 0)
  const cEnd = pre ? pre.courseEndTs : (course?.end ? atTime(course.end, '23:59') : 0)
  if (cStart && task.start < cStart) {
    warnings.push({ level: 'bad', code: 'course', text: `Ngày làm bắt đầu trước ngày bắt đầu môn (${formatDMY(cStart)}).` })
  }
  if (cEnd && task.end > cEnd) {
    warnings.push({ level: 'bad', code: 'course', text: `Ngày làm kết thúc sau ngày kết thúc môn (${formatDMY(cEnd)}).` })
  }
  if (!sameStudyDay(task.start, task.end)) {
    warnings.push({ level: 'bad', code: 'span', text: `Nhiệm vụ này dài ${formatHours(placed)} giờ và trải qua nhiều ngày. Hãy đặt từng buổi trong một ngày, trong giờ rảnh.` })
  } else if (!coveredByFree(task.start, task.end, data.freeSlots)) {
    const fit = coveredFreeHours(task.start, task.end, data.freeSlots)
    warnings.push({
      level: 'bad',
      code: 'free',
      text: fit > 0
        ? `Khung này dài ${formatHours(placed)} giờ nhưng giờ rảnh chỉ phủ ${formatHours(fit)} giờ.`
        : `Khung ${formatHours(placed)} giờ này không trùng giờ rảnh đã khai báo.`,
    })
  }
  if (task.end < now) warnings.push({ level: 'warn', code: 'past', text: 'Ngày làm đã qua.' })
  const wanted = taskHours(task)
  if (!needFree && wanted - placed > 0.25) {
    const severe = placed <= wanted / 2
    warnings.push({
      level: severe ? 'bad' : 'warn',
      code: 'hours',
      text: `Nhiệm vụ cần ${formatHours(wanted)} giờ nhưng khung này chỉ có ${formatHours(placed)} giờ.`,
    })
  }
  return warnings
}

export function reviewTasks(tasks, data, deadline, ignorePlanId = '', course = null) {
  refreshParents(tasks)
  const now = Date.now()
  const leaves = leafTasks(tasks)
  const parentMap = new Map(tasks.map((item) => [item.id, item]))
  let minStart = Infinity
  let maxEnd = 0
  for (const t of leaves) {
    if (t.start && t.start < minStart) minStart = t.start
    if (t.end && t.end > maxEnd) maxEnd = t.end
  }
  const pre = {
    now,
    leaves,
    freeStrict: deadline > now ? openHours(data, now, deadline, ignorePlanId, Number(data?.displaceAfter) ? deadline + 1 : 0) : null,
    allForeign: foreignLeaves(data, ignorePlanId),
    allClasses: maxEnd > minStart ? classIntervals(data.courses, minStart, maxEnd) : [],
    courseStartTs: course?.start ? atTime(course.start, '00:00') : 0,
    courseEndTs: course?.end ? atTime(course.end, '23:59') : 0,
  }
  const rows = leaves.map((task) => {
    const parent = task.parentId ? (parentMap.get(task.parentId) || null) : null
    return { task, warnings: task.status === 'done' ? [] : taskWarnings(task, tasks, data, deadline, parent, ignorePlanId, course, pre) }
  })
  const bad = rows.reduce((sum, row) => sum + row.warnings.filter((item) => item.level === 'bad').length, 0)
  const warn = rows.reduce((sum, row) => sum + row.warnings.filter((item) => item.level === 'warn').length, 0)
  const placed = leaves.reduce((sum, task) => sum + (task.start && task.end ? spanHours(task.start, task.end) : 0), 0)
  const need = leaves.reduce((sum, task) => sum + taskHours(task), 0)
  const open = deadline > now ? openHours(data, now, deadline, ignorePlanId, deadline) : 0
  const short = deadline > now && need > 0 && open + 0.05 < need
  let tone = 'ok'
  let title = 'Kế hoạch hợp lý: không trùng lịch, đủ giờ và kịp deadline'
  if (bad) { tone = 'bad'; title = `${bad} vấn đề cần xử lý trước khi xác nhận` }
  else if (warn) { tone = 'warn'; title = `Kế hoạch dùng được, còn ${warn} lưu ý` }
  return { rows, bad, warn, tone, title, placed, need, short, open }
}

export function courseWindowWarnings(plan, course, data, now = Date.now()) {
  if (!course?.start || !course?.end) return []
  const start = atTime(course.start, '00:00')
  const end = atTime(course.end, '23:59')
  const reasons = []
  const leaves = leafTasks(plan.tasks)
  const openLeaves = leaves.filter((task) => task.status !== 'done')
  if (plan.deadline && plan.deadline > end) reasons.push(`Hạn kế hoạch ${formatDMY(plan.deadline)} nằm sau ngày kết thúc môn ${formatDMY(end)}.`)
  if (plan.deadline && plan.deadline < start) reasons.push(`Hạn kế hoạch ${formatDMY(plan.deadline)} nằm trước ngày bắt đầu môn ${formatDMY(start)}.`)
  const before = openLeaves.filter((task) => task.start && task.start < start)
  const after = openLeaves.filter((task) => task.end && task.end > end)
  if (before.length) reasons.push(`${before.length} nhiệm vụ bắt đầu trước ngày bắt đầu môn ${formatDMY(start)}.`)
  if (after.length) reasons.push(`${after.length} nhiệm vụ kết thúc sau ngày kết thúc môn ${formatDMY(end)}.`)
  const unplaced = openLeaves.filter((task) => !task.start)
  if (unplaced.length) reasons.push(`${unplaced.length} nhiệm vụ chưa xếp được giờ trong khoảng ngày của môn.`)
  const from = Math.max(now, start)
  const until = Math.min(plan.deadline || end, end)
  const wanted = wantedHours(course.output)
  if (wanted > 0) {
    const open = until > from ? openHours(data, from, until, plan.id, plan.deadline) : 0
    if (open + 0.05 < wanted) reasons.push(`Kế hoạch cần khoảng ${formatHours(wanted)} giờ, trong khoảng ngày môn chỉ còn khoảng ${formatHours(open)} giờ trống.`)
  }
  return reasons
}

export function parseOutput(text) {
  const source = String(text || '').replace(/\r/g, '').trim()
  if (!source) return []
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length === 1 && !lines[0].includes(':') && !/^phan\s+\d+/.test(fold(lines[0]))) {
    const bits = lines[0].split(/\s*(?:,|;|\+| và )\s*/i).map((bit) => bit.trim()).filter((bit) => bit.length > 2)
    if (bits.length > 1) return [{ title: '', items: bits.map((name) => ({ name, detail: '' })) }]
  }
  const sections = []
  let current = null
  const open = (title) => {
    current = { title, items: [] }
    sections.push(current)
  }
  const add = (name, detail) => {
    const clean = String(name || '').replace(/^[-*•]\s*/, '').trim()
    if (!clean) return
    if (!current) open('')
    current.items.push({ name: clean, detail: String(detail || '').trim() })
  }
  for (const line of lines) {
    if (/^phan\s+\d+/.test(fold(line)) || /^#{1,3}\s+/.test(line)) {
      open(line.replace(/^#+\s*/, ''))
      continue
    }
    const body = line.replace(/^[-*•]\s+/, '')
    const colon = body.match(/^([^:]{2,80}):\s*(.*)$/)
    if (colon) add(colon[1], colon[2])
    else add(body, '')
  }
  return sections.filter((section) => section.items.length)
}

export function sentenceCase(text) {
  const clean = String(text || '').trim().replace(/[.,;]+$/g, '')
  if (!clean) return ''
  return clean.charAt(0).toLocaleUpperCase('vi') + clean.slice(1)
}

function itemWeight(item) {
  const src = fold(`${item.name || ''} ${item.text || ''}`)
  if (/(bao cao|persona|prototype|wireframe|thuyet trinh|kien truc|erd|usecase|demo|dashboard)/.test(src)) return 2
  if (/(phan tich|analysis|research|nghien cuu|ke hoach|plan|survey|interview|phong van|muc tieu)/.test(src)) return 1.5
  return 1
}

// Tra ve so gio toi thieu cho mot item dua tren do kho nhan dien qua tu khoa.
// 2h  - lap trinh, so do he thong, bao cao dai, luan van, prototype
// 1.5h - phan tich, nghien cuu, thuyet trinh, slide, viet bai/essay
// 1h  - tom tat, ke hoach, tong hop, nhan xet
// 0.5h - doc, on lai, kiem tra nhanh, va moi thu con lai
export function recommendedHoursForTask(task) {
  const base = Number(task?.baseHours) || 0
  if (base > 0) return Math.max(0.5, roundHalf(base))
  return Math.max(0.5, minHoursForItem({ name: task?.name || '', text: task?.description || '' }))
}

function minHoursForItem(item) {
  const explicit = roundHalf(parseWorkload(item?.text || item?.name || '', { defaults: false }).hours || 0)
  const src = fold(`${item?.name || ''} ${item?.text || ''}`)
  let byDifficulty = 0.5
  if (/(code|lap trinh|api|endpoint|rest|lab|sql|truy van|bpmn|usecase|erd|uml|kien truc|architecture|prototype|wireframe|persona|demo|dashboard|bao cao|luan van|luan|toan|do thi|bieu do|so do)/.test(src)) byDifficulty = 2
  else if (/(phan tich|analysis|research|nghien cuu|thuyet trinh|slide|powerpoint|viet|essay|paper|bai bao|thiet ke|design|tong hop|trich xuat|phong van|interview|journey|flow|insight|ideate|findings|iteration|usability|evaluation)/.test(src)) byDifficulty = 1.5
  else if (/(tom tat|ke hoach|plan|muc tieu|review|kiem tra|tinh huong|scope|goal|statement|space|evidence|scenario|survey|idea|pain point|pov|value proposition|mvp)/.test(src)) byDifficulty = 1
  return Math.max(byDifficulty, explicit)
}

// Sau khi spreadHours() chia deu, nang tung chunk len minHoursForItem cua item.
// Tong co the tang so voi hours goc khi task kho can them gio.
function clampSplits(splits, items) {
  if (splits.length === items.length) {
    return splits.map((chunk, i) => {
      const min = minHoursForItem(items[i])
      return chunk < min ? min : chunk
    })
  }
  const per = items.length / splits.length
  return splits.map((chunk, i) => {
    const from = Math.round(i * per)
    const to = Math.max(from + 1, Math.round((i + 1) * per))
    const slice = items.slice(from, to)
    const min = slice.reduce((mx, item) => Math.max(mx, minHoursForItem(item)), 0.5)
    return chunk < min ? min : chunk
  })
}

function outputGroups(text) {
  const groups = []
  for (const section of parseOutput(text)) {
    const items = section.items.map((item) => ({
      name: sentenceCase(item.name),
      heading: sentenceCase(section.title || ''),
      text: [item.name, item.detail].filter(Boolean).join(' '),
    }))
    if (items.length) groups.push({ title: sentenceCase(section.title || ''), items })
  }
  if (!groups.length && String(text || '').trim()) {
    const first = String(text).trim().split('\n')[0].slice(0, 80)
    groups.push({ title: '', items: [{ name: sentenceCase(first), heading: '', text }] })
  }
  return groups
}

function allocateGroupHours(groups, total) {
  const want = roundHalf(Math.max(groups.length, total))
  const weights = groups.map((group) => {
    const parsed = roundHalf(parseWorkload(group.items.map((item) => item.text).join('\n'), { defaults: false }).hours || 0)
    if (parsed > 0) return Math.max(1, parsed)
    return group.items.reduce((sum, item) => sum + itemWeight(item), 0)
  })
  const sum = weights.reduce((a, b) => a + b, 0) || groups.length
  const hours = weights.map((weight) => Math.max(1, roundHalf(want * weight / sum)))
  let diff = roundHalf(want - hours.reduce((a, b) => a + b, 0))
  let guard = 0
  while (Math.abs(diff) >= 0.5 && hours.length && guard < hours.length * 8) {
    const index = guard % hours.length
    if (diff > 0) {
      hours[index] = roundHalf(hours[index] + 0.5)
      diff = roundHalf(diff - 0.5)
    } else if (hours[index] > 1) {
      hours[index] = roundHalf(hours[index] - 0.5)
      diff = roundHalf(diff + 0.5)
    }
    guard += 1
  }
  return hours
}

export function wantedHours(output) {
  return estimateWorkload(output).hours
}

function placeUnit(hours, from, until, freeSlots, blocked) {
  const sizes = []
  for (let size = hours; size >= 0.5; size = Math.round((size - 0.5) * 2) / 2) sizes.push(size)
  for (const size of sizes) {
    const window = findWindow({ duration: size * 3600000, from, until, freeSlots, blocked })
    if (window) return { ...window, hours: size }
  }
  return null
}

function sittingName(name, tasks = []) {
  const base = String(name || '').replace(/\s·\sbuổi\s\d+$/i, '').trim()
  let max = 1
  for (const task of tasks) {
    if (fold(task.name).indexOf(fold(base)) !== 0) continue
    const mark = String(task.name).match(/buổi\s(\d+)$/i)
    if (mark) max = Math.max(max, Number(mark[1]))
  }
  return `${base} · buổi ${max + 1}`
}

function wrapUnits(scheduled) {
  const tasks = []
  let index = 0
  while (index < scheduled.length) {
    const task = scheduled[index]
    const siblings = [task]
    let next = index + 1
    while (task.parent && next < scheduled.length && scheduled[next].parent === task.parent) {
      siblings.push(scheduled[next])
      next += 1
    }
    const titled = task.parent && (siblings.length > 1 || fold(siblings[0].name) !== fold(task.parent))
    if (!titled) {
      for (const item of siblings) tasks.push({ ...item, parentId: '', parent: undefined })
    } else {
      const timed = siblings.filter((item) => item.start && item.end)
      const parentId = uid('t')
      tasks.push({
        id: parentId, parentId: '', name: task.parent,
        hours: siblings.reduce((sum, item) => sum + item.hours, 0),
        start: timed.length ? Math.min(...timed.map((item) => item.start)) : 0,
        end: timed.length ? Math.max(...timed.map((item) => item.end)) : 0,
        status: 'todo', description: '', files: [], doneAt: 0,
      })
      for (const item of siblings) tasks.push({ ...item, parentId, parent: undefined })
    }
    index = next
  }
  return tasks
}

function pushLeaf(tasks, parentId, name, hours, note = '') {
  sittingsOf(hours).forEach((chunk, sitting, chunks) => {
    tasks.push({
      id: uid('t'), parentId, name: chunks.length > 1 ? `${name} · buổi ${sitting + 1}` : name,
      hours: chunk, baseHours: chunk, start: 0, end: 0, status: 'todo', description: note, files: [], doneAt: 0,
    })
  })
}

// AI groups come from api/tutor.js plan mode: [{ title, items: [{ name, detail, hours }] }]
function aiOutputGroups(aiGroups) {
  return (aiGroups || []).map((group) => ({
    title: sentenceCase(String(group.title || '').trim()),
    items: (group.items || [])
      .filter((item) => String(item?.name || '').trim())
      .map((item) => ({
        name: sentenceCase(String(item.name).trim()),
        heading: sentenceCase(String(group.title || '').trim()),
        text: String(item.detail || item.name).trim(),
        hours: Math.min(6, Math.max(0.5, roundHalf(Number(item.hours) || 1))),
      })),
  })).filter((group) => group.items.length)
}

function breakdownTasks(output, docs, aiGroups) {
  const estimate = estimateWorkload(output)
  const fromAi = aiOutputGroups(aiGroups)
  const groups = fromAi.length ? fromAi : outputGroups(output)
  if (!groups.length) return { tasks: [], estimate }
  const docNote = docs?.length ? `Tài liệu môn: ${docs.map((doc) => doc.name).join(', ')}.` : ''
  const tasks = []
  groups.forEach((group) => {
    // AI đã ước giờ cho từng nhiệm vụ; nếu không có thì gán theo độ khó (0.5h / 1h / 1.5h / 2h+)
    const itemHours = group.items.map((item) => item.hours || minHoursForItem(item))
    const hours = roundHalf(itemHours.reduce((s, v) => s + v, 0))
    const titled = group.title && fold(group.title) !== fold(group.items[0].name)
    const parentNeeded = titled || group.items.length > 1
    const parentId = parentNeeded ? uid('t') : ''
    const note = [estimate.summary, docNote].filter(Boolean).join(' ')
    if (parentNeeded) {
      tasks.push({
        id: parentId, parentId: '', name: titled ? group.title : group.items[0].name, hours,
        start: 0, end: 0, status: 'todo', description: note, files: [], doneAt: 0, baseHours: hours,
      })
    }
    group.items.forEach((item, i) => pushLeaf(tasks, parentId, item.name, itemHours[i], item.text || note))
  })
  return { tasks, estimate }
}

export function suggestPlan({ course, output, docs, deadline, start, data, ignorePlanId, aiGroups }) {
  const made = breakdownTasks(output, docs, aiGroups)
  if (!made.tasks.length) {
    return { tasks: [], comment: 'Chưa có yêu cầu đầu ra để chia nhiệm vụ.', source: 'sim', estimate: made.estimate }
  }
  const now = Date.now()
  const draftId = ignorePlanId || '__draft__'
  const ghost = {
    id: draftId, courseId: course?.id || '', deadline, source: 'ai', createdAt: now,
    start: start || 0, tasks: made.tasks,
  }
  const others = (data.plans || []).filter((plan) => plan.id !== ignorePlanId)
  const before = new Map()
  for (const plan of others) {
    for (const task of leafTasks(plan.tasks)) {
      if (task.start) before.set(task.id, task.start)
    }
  }
  const packed = packOpenTasks(
    { ...data, plans: [...others, ghost] },
    [draftId, ...others.filter(autoScheduled).map((plan) => plan.id)],
    now,
  )
  const tasks = packed.plans.find((plan) => plan.id === draftId)?.tasks || made.tasks
  const leaves = leafTasks(tasks)
  const missing = leaves.filter((task) => !task.start).length
  let displaced = 0
  for (const plan of packed.plans) {
    if (plan.id === draftId || !(plan.deadline > deadline)) continue
    for (const task of leafTasks(plan.tasks)) {
      if (before.has(task.id) && task.start && task.start !== before.get(task.id)) displaced += 1
    }
  }
  const load = scheduleLoad({ ...data, plans: packed.plans }, now)
  const placed = leaves.reduce((sum, task) => sum + (task.start ? taskHours(task) : 0), 0)
  const comment = missing
    ? `Đã xếp ${formatHours(placed)} giờ. ${missing} nhiệm vụ chưa đủ giờ rảnh trước hạn — hãy thêm thời gian rảnh.`
    : `Đã xếp ${formatHours(placed)} giờ.`
  return { tasks, comment, source: 'sim', displaced, estimate: made.estimate, load }
}

function refreshParents(tasks) {
  for (const task of tasks) {
    if (!isParent(task, tasks)) continue
    const kids = tasks.filter((item) => item.parentId === task.id && item.start && item.end)
    if (!kids.length) {
      task.start = 0
      task.end = 0
      continue
    }
    task.start = Math.min(...kids.map((item) => item.start))
    task.end = Math.max(...kids.map((item) => item.end))
  }
}

function openLeaves(plan) {
  return leafTasks(plan.tasks).filter((task) => task.status !== 'done' && task.status !== 'doing')
}

export function hasScheduleIssue(data) {
  const seen = []
  for (const plan of data.plans || []) {
    for (const task of leafTasks(plan.tasks)) {
      if (task.status === 'done' || task.status === 'doing' || !task.start || !task.end) continue
      for (const other of seen) {
        if (overlaps(task.start, task.end, other.start, other.end)) return true
      }
      seen.push({ start: task.start, end: task.end })
    }
  }
  const autos = (data.plans || []).filter((plan) => autoScheduled(plan) && plan.deadline)
    .sort((a, b) => a.deadline - b.deadline || (a.createdAt || 0) - (b.createdAt || 0))
  for (let i = 0; i < autos.length; i += 1) {
    const early = autos[i]
    const earlyOpen = openLeaves(early)
    if (!earlyOpen.length) continue
    const earlyUnplaced = earlyOpen.some((task) => !task.start)
    for (let j = i + 1; j < autos.length; j += 1) {
      const late = autos[j]
      if (!(late.deadline > early.deadline)) continue
      const lateFirst = openLeaves(late).reduce((min, task) => (task.start ? Math.min(min, task.start) : min), Infinity)
      if (!Number.isFinite(lateFirst)) continue
      if (earlyUnplaced && lateFirst < early.deadline) return true
    }
  }
  return false
}

function autoScheduled(plan) {
  return plan && plan.source !== 'manual'
}

function planBounds(plan, data) {
  const course = (data.courses || []).find((item) => item.id === plan.courseId)
  const courseStart = course?.start ? atTime(course.start, '00:00') : 0
  const courseEnd = course?.end ? atTime(course.end, '23:59') : 0
  const rawStart = plan.start
  const planStart = !rawStart ? 0 : typeof rawStart === 'number' ? rawStart : atTime(rawStart, '00:00')
  const from = planStart || courseStart || startOfDay(plan.createdAt || Date.now())
  const until = Math.min(plan.deadline || Infinity, courseEnd || Infinity)
  return {
    from,
    until: Number.isFinite(until) ? until : (plan.deadline || 0),
    deadline: plan.deadline || until,
  }
}

function remainingFree(from, until, freeSlots, blocked) {
  if (!freeSlots?.length || !(until > from)) return 0
  let count = 0
  for (let day = startOfDay(from); day < until; day += DAY) {
    const wd = weekdayMon(new Date(day))
    const daySlots = freeSlots.filter((slot) => Number(slot.weekday) === wd)
    if (!daySlots.length) continue
    let minStart = Infinity
    let maxEnd = 0
    for (const slot of daySlots) {
      const s = atTime(day, slot.start)
      const e = atTime(day, slot.end)
      if (s < minStart) minStart = s
      if (e > maxEnd) maxEnd = e
    }
    let cursor = roundUp30(Math.max(from, minStart))
    const limit = Math.min(until, maxEnd)
    while (cursor + STEP <= limit) {
      if (slotFree(cursor, cursor + STEP, daySlots, blocked)) count += 1
      cursor += STEP
    }
  }
  return count * 0.5
}

function placeHere(hours, from, until, freeSlots, blocked, cap = 2) {
  const want = Math.min(Math.max(0.5, hours), cap)
  const maxEnd = Math.min(until, startOfDay(from) + DAY)
  const floor = 0.5
  for (let size = want; size >= floor; size = Math.round((size - 0.5) * 2) / 2) {
    const end = from + size * 3600000
    if (end <= maxEnd && slotFree(from, end, freeSlots, blocked)) return { start: from, end, hours: size }
  }
  return null
}

function groupNeed(group) {
  return group.remaining.reduce((sum, item) => sum + item.hours, 0)
}

function dayCapFor(group, cursor, freeSlots, blocked, used) {
  const need = groupNeed(group)
  const daysLeft = Math.max(1, Math.ceil((group.until - cursor) / DAY))
  const freeLeft = remainingFree(cursor, group.until, freeSlots, blocked)
  const hoursToDeadline = Math.max(0, (group.deadline - cursor) / 3600000)
  const hard = hoursToDeadline <= 24 || need > freeLeft + 0.05 || need > daysLeft * 4 + 0.05
  const soft = hoursToDeadline <= 72 || need > daysLeft * 2 + 0.05
  if (hard) return 24
  if (soft) return Math.max(0.5, Math.min(4, roundHalf(4 - used) || 4))
  return Math.max(0.5, Math.min(2, roundHalf(2 - used) || 2))
}

function pickPlacement(groups, cursor, freeSlots, blocked, todayUsed) {
  const eligible = groups.filter((group) => group.remaining.length && cursor >= group.from && cursor + STEP <= group.until)
  if (!eligible.length) return null
  const urgent = eligible.filter((group) => groupNeed(group) > remainingFree(cursor + STEP, group.until, freeSlots, blocked) + 0.05)
  const pool = (urgent.length ? urgent : eligible).slice()
  pool.sort((a, b) => a.deadline - b.deadline || a.createdAt - b.createdAt)
  const primary = pool[0]
  const day = startOfDay(cursor)
  const used = todayUsed.get(`${primary.id}:${day}`) || 0
  const cap = dayCapFor(primary, cursor, freeSlots, blocked, used)
  if (cap <= 2 && used >= 1.95) {
    const others = eligible
      .filter((group) => group.id !== primary.id && (todayUsed.get(`${group.id}:${day}`) || 0) < 1.95)
      .sort((a, b) => b.deadline - a.deadline || a.createdAt - b.createdAt)
    if (others.length) return { group: others[0], cap: 1 }
    return null
  }
  if (cap <= 4 && used >= 3.95) {
    const others = eligible
      .filter((group) => group.id !== primary.id && (todayUsed.get(`${group.id}:${day}`) || 0) < 3.95)
      .sort((a, b) => b.deadline - a.deadline || a.createdAt - b.createdAt)
    if (others.length) return { group: others[0], cap: Math.min(2, dayCapFor(others[0], cursor, freeSlots, blocked, todayUsed.get(`${others[0].id}:${day}`) || 0)) }
    if (cap < 24) return null
  }
  return { group: primary, cap }
}

function packOpenTasks(data, planIds, now = Date.now()) {
  const next = new Map((data.plans || []).map((plan) => [plan.id, { ...plan, tasks: plan.tasks.map((task) => ({ ...task, files: task.files || [] })) }]))
  const groups = []
  const floor = now
  for (const plan of data.plans || []) {
    const copy = next.get(plan.id)
    const inQueue = planIds.includes(plan.id) && autoScheduled(plan)
    if (!inQueue) continue
    const bounds = planBounds(plan, data)
    const remaining = []
    for (const task of leafTasks(copy.tasks)) {
      if (task.status === 'done' || task.status === 'doing') continue
      remaining.push({
        id: task.id,
        hours: Math.max(0.5, taskHours(task) || 1),
        parentId: task.parentId || '',
        name: task.name,
        phase: task.phase || '',
        baseHours: task.baseHours || taskHours(task) || 1,
      })
      task.start = 0
      task.end = 0
    }
    refreshParents(copy.tasks)
    if (!remaining.length || !bounds.until) continue
    groups.push({
      id: plan.id,
      deadline: bounds.deadline || Infinity,
      createdAt: plan.createdAt || 0,
      from: Math.max(bounds.from || 0, floor),
      until: bounds.until,
      remaining,
      lastDay: 0,
    })
  }
  if (!groups.length) return { plans: planIds.map((id) => next.get(id)).filter(Boolean), moved: 0 }

  const spanFrom = groups.reduce((min, group) => Math.min(min, group.from || Date.now()), Date.now())
  const spanUntil = groups.reduce((max, group) => Math.max(max, group.until || 0), 0)
  const blocked = classIntervals(data.courses, spanFrom, spanUntil).map((item) => [item.start, item.end])
  for (const plan of data.plans || []) {
    const copy = next.get(plan.id)
    const inQueue = planIds.includes(plan.id) && autoScheduled(plan)
    for (const task of leafTasks(copy.tasks)) {
      if (!task.start || !task.end) continue
      if (!inQueue || task.status === 'done' || task.status === 'doing') blocked.push([task.start, task.end])
    }
  }

  let cursor = roundUp30(spanFrom)
  let moved = 0
  const todayUsed = new Map()
  while (cursor + STEP <= spanUntil && groups.some((group) => group.remaining.length)) {
    if (!slotFree(cursor, cursor + STEP, data.freeSlots, blocked)) {
      cursor += STEP
      continue
    }
    const pick = pickPlacement(groups, cursor, data.freeSlots, blocked, todayUsed)
    if (!pick) {
      cursor += STEP
      continue
    }
    const group = pick.group
    const item = group.remaining[0]
    const window = placeHere(item.hours, cursor, group.until, data.freeSlots, blocked, pick.cap)
    if (!window || (item.hours >= 1 && window.hours < 1)) {
      cursor += STEP
      continue
    }
    group.remaining.shift()
    const plan = next.get(group.id)
    const task = plan.tasks.find((row) => row.id === item.id)
    task.start = window.start
    task.end = window.end
    task.hours = window.hours
    if (!task.userAdjustedHours) task.baseHours = window.hours
    const leftover = roundHalf(item.hours - window.hours)
    if (leftover >= 0.5) {
      const extra = {
        id: uid('t'), parentId: item.parentId, name: sittingName(item.name, plan.tasks),
        hours: leftover, phase: item.phase, baseHours: leftover,
        start: 0, end: 0, status: 'todo', description: '', files: [], doneAt: 0,
      }
      plan.tasks.push(extra)
      group.remaining.unshift({
        id: extra.id, hours: leftover, parentId: item.parentId, name: extra.name,
        phase: item.phase, baseHours: leftover,
      })
    }
    blocked.push([window.start, window.end])
    const key = `${group.id}:${startOfDay(window.start)}`
    todayUsed.set(key, (todayUsed.get(key) || 0) + window.hours)
    group.lastDay = startOfDay(window.start)
    moved += 1
    cursor = window.end
  }
  for (const group of groups) refreshParents(next.get(group.id).tasks)
  return { plans: planIds.map((id) => next.get(id)).filter(Boolean), moved }
}

export function reflowAll(data, now = Date.now()) {
  const ids = (data.plans || []).filter(autoScheduled).map((plan) => plan.id)
  if (!ids.length) return []
  return packOpenTasks(data, ids, now).plans
}

export function previewReflow(data, draft, now = Date.now()) {
  const others = (data.plans || []).filter((plan) => plan.id !== draft.id)
  const packed = packOpenTasks(
    { ...data, plans: [...others, draft] },
    [draft.id, ...others.filter(autoScheduled).map((plan) => plan.id)],
    now,
  )
  return packed.plans.find((plan) => plan.id === draft.id) || draft
}

export function scheduleLoad(data, now = Date.now()) {
  const autos = (data.plans || []).filter(autoScheduled)
  const from = now
  const until = autos.reduce((max, plan) => Math.max(max, plan.deadline || 0), 0)
  const need = autos.reduce((sum, plan) => sum + openLeaves(plan).reduce((inner, task) => inner + taskHours(task), 0), 0)
  const blocked = classIntervals(data.courses, from, until || from).map((item) => [item.start, item.end])
  for (const plan of data.plans || []) {
    if (autoScheduled(plan)) continue
    for (const task of leafTasks(plan.tasks)) {
      if (task.start && task.end) blocked.push([task.start, task.end])
    }
  }
  const open = until > from ? remainingFree(from, until, data.freeSlots, blocked) : 0
  const delta = Math.max(0, roundHalf(need - open))
  const hints = suggestFreeAdds(data, from, until, delta)
  return { need, open, delta, hints, short: delta > 0.05 }
}

export function suggestFreeAdds(data, from, until, needHours) {
  const hints = []
  if (!(needHours > 0.05) || !(until > from)) return hints
  const seen = new Set()
  let remain = needHours
  for (let day = startOfDay(from); day < until && remain > 0.05; day += DAY) {
    const weekday = weekdayMon(new Date(day))
    const weekend = weekday >= 6
    const start = weekend ? '08:00' : '19:00'
    const end = weekend ? '10:00' : '21:00'
    const key = `${weekday}:${start}`
    if (seen.has(key)) continue
    const slotStart = atTime(dateISO(day), start)
    const slotEnd = atTime(dateISO(day), end)
    const classHit = classIntervals(data.courses, slotStart, slotEnd).some((item) => overlaps(slotStart, slotEnd, item.start, item.end))
    if (classHit) continue
    const already = (data.freeSlots || []).some((slot) => Number(slot.weekday) === weekday && slot.start <= start && slot.end >= end)
    if (already) continue
    const hours = (slotEnd - slotStart) / 3600000
    const when = weekend ? `${WEEKDAYS.find((item) => item.id === weekday)?.full || ''} buổi sáng ${start}–${end}` : `${WEEKDAYS.find((item) => item.id === weekday)?.full || ''} buổi tối ${start}–${end}`
    hints.push({ weekday, start, end, hours, label: when.trim() })
    seen.add(key)
    remain -= hours
  }
  return hints
}

export function compressFarBuffers(data, keepDeadline, now = Date.now()) {
  const next = {
    ...data,
    plans: (data.plans || []).map((plan) => ({ ...plan, tasks: plan.tasks.map((task) => ({ ...task, files: task.files || [] })) })),
  }
  for (const plan of next.plans) {
    if (!autoScheduled(plan) || !(plan.deadline > keepDeadline)) continue
    const last = openLeaves(plan).slice().pop()
    if (last && last.hours > 0.5) {
      last.hours = Math.max(0.5, roundHalf(last.hours * 0.5))
      if (last.start && last.end) last.end = last.start + last.hours * 3600000
    }
  }
  const moved = reflowAll(next, now)
  const byId = new Map(moved.map((plan) => [plan.id, plan]))
  return next.plans.map((plan) => byId.get(plan.id) || plan)
}

export function reseatLater(data, deadline, now = Date.now()) {
  const ids = (data.plans || []).filter((plan) => autoScheduled(plan) && plan.deadline > deadline).map((plan) => plan.id)
  if (!ids.length) return []
  return packOpenTasks(data, ids, now).plans
}

export function shortPlans(data) {
  return (data.plans || []).filter((plan) => autoScheduled(plan) && openLeaves(plan).some((task) => !task.start || (plan.deadline && task.end && task.end > plan.deadline)))
}

export function alignPlansToOutput(data, now) {
  const ordered = [...data.plans].sort((a, b) => (a.deadline || Infinity) - (b.deadline || Infinity))
  const built = new Map()
  for (const plan of ordered) {
    const course = data.courses.find((item) => item.id === plan.courseId)
    if (plan.source === 'manual' || !course || !String(course.output || '').trim() || !plan.deadline) {
      built.set(plan.id, plan)
      continue
    }
    const made = suggestPlan({
      course,
      output: course.output,
      docs: data.documents.filter((doc) => doc.courseId === course.id),
      deadline: plan.deadline,
      start: now - 4 * DAY,
      data: { ...data, plans: [...built.values()] },
      ignorePlanId: plan.id,
      allowPast: true,
    })
    if (!made.tasks.length) {
      built.set(plan.id, plan)
      continue
    }
    const tasks = made.tasks.map((task) => {
      if (task.parentId && task.end && task.end < now) return { ...task, status: 'done', doneAt: task.end }
      if (!task.parentId && task.end && task.end < now) return { ...task, status: 'done', doneAt: task.end }
      return task
    })
    built.set(plan.id, { ...plan, tasks })
  }
  return { ...data, plans: data.plans.map((plan) => built.get(plan.id) || plan) }
}

export function weeklyFreeHours(slots) {
  return slots.reduce((sum, slot) => sum + (minutes(slot.end) - minutes(slot.start)) / 60, 0)
}

export function openHours(data, from, until, ignorePlanId, displaceAfter = 0) {
  const others = []
  for (const plan of data.plans || []) {
    if (plan.id === ignorePlanId) continue
    const later = displaceAfter && autoScheduled(plan) && (plan.deadline || 0) >= displaceAfter
    for (const task of leafTasks(plan.tasks)) {
      if (!task.start || !task.end) continue
      if (later && task.status !== 'done' && task.status !== 'doing' && task.end > from) continue
      others.push(task)
    }
  }
  const blocked = classIntervals(data.courses, from, until).map((item) => [item.start, item.end]).concat(blocksOf(others))
  return remainingFree(from, until, data.freeSlots, blocked)
}

export function slotClashClass(slot, courses) {
  return courses.some((course) => (course.schedule || []).some((row) => Number(row.weekday) === Number(slot.weekday) && row.start < slot.end && slot.start < row.end))
}

function dayName(weekday) {
  return WEEKDAYS.find((item) => item.id === Number(weekday))?.full || 'Ngày này'
}

function weekdayShortName(weekday) {
  const item = WEEKDAYS.find((day) => day.id === Number(weekday))
  if (!item) return 'Ngày này'
  return item.id === 7 ? 'Chủ Nhật' : `Thứ ${item.id + 1}`
}

function timesOverlap(aStart, aEnd, bStart, bEnd) {
  return minutes(aStart) < minutes(bEnd) && minutes(bStart) < minutes(aEnd)
}

function classStamp(course, row) {
  const when = `${dayName(row.weekday)} ${row.start}–${row.end}`
  const repeat = slotRepeat(row)
  const origin = slotOrigin(course, row)
  const { until } = slotWindow(course, row)
  if (repeat === 'biweek') return origin ? `${when} · cách tuần từ ${formatISO(origin)}` : `${when} · cách tuần`
  if (repeat === 'once') return origin ? `${when} · ${formatISO(origin)}` : `${when} · một buổi`
  if (until && until !== isoDay(course?.end)) return `${when} (đến ${formatISO(until)})`
  return when
}

function slotFrame(row) {
  return `Khung giờ [${weekdayShortName(row.weekday)}, ${row.start} – ${row.end}]`
}

function clashText(row, otherCourse, otherRow) {
  const frame = slotFrame(row)
  const name = String(otherCourse?.name || '').trim() || 'môn này'
  if (slotRepeat(otherRow) === 'biweek') {
    return `${frame} tuần này đã có lịch học cách tuần của môn ${name}.`
  }
  return `${frame} đã có lịch học cho môn ${name}.`
}

function isoPlusDays(iso, days) {
  return dateISO(startOfDay(parseDate(iso)) + days * DAY)
}

function clashHits(self, row, courses, skipId, siblings) {
  const hits = []
  for (const other of siblings || []) {
    if (!other.start || !other.end || minutes(other.end) <= minutes(other.start)) continue
    if (slotsCollide(self, row, self, other)) hits.push({ course: self, row: other })
  }
  for (const course of courses || []) {
    if (skipId && course.id === skipId) continue
    for (const slot of course.schedule || []) {
      if (!slot.start || !slot.end || minutes(slot.end) <= minutes(slot.start)) continue
      if (slotsCollide(self, row, course, slot)) hits.push({ course, row: slot })
    }
  }
  return hits
}

function fitScheduleRow(form, row, courses, siblings) {
  const self = { start: form.start, end: form.end, name: form.name }
  const hits = clashHits(self, row, courses, form.id, siblings)
  if (!hits.length) return { row }
  const first = hits[0]
  const clash = clashText(row, first.course, first.row)
  if (slotRepeat(row) !== 'biweek') return { row, clash }
  const origin = slotOrigin(self, row)
  if (!origin) return { row, clash }
  const shiftedFrom = isoPlusDays(origin, 7)
  const { until } = slotWindow(self, row)
  if (until && shiftedFrom > until) return { row, clash }
  const shifted = { ...row, from: shiftedFrom }
  if (clashHits(self, shifted, courses, form.id, siblings).length) return { row, clash }
  const names = [...new Set(hits.map((item) => String(item.course?.name || '').trim()).filter(Boolean))]
  return {
    row: shifted,
    note: `${slotFrame(row)} tuần ${formatISO(origin)} đã có ${names.join(', ')}. Môn này học các tuần còn lại, buổi đầu ${formatISO(shiftedFrom)}.`,
  }
}

export function alignCourseSchedule(form, courses) {
  const schedule = []
  const notes = []
  for (const row of form.schedule || []) {
    if (!row.start || !row.end || minutes(row.end) <= minutes(row.start)) {
      schedule.push(row)
      continue
    }
    const result = fitScheduleRow(form, row, courses, schedule)
    if (result.clash) return { schedule: form.schedule || [], notes: [], clash: result.clash }
    if (result.note) notes.push(result.note)
    schedule.push(result.row)
  }
  return { schedule, notes, clash: '' }
}

export function pruneClassClashes(courses) {
  const kept = []
  const removed = []
  const changed = new Set()
  const next = (courses || []).map((course) => {
    const schedule = []
    for (const row of course.schedule || []) {
      if (!row.start || !row.end || minutes(row.end) <= minutes(row.start)) {
        schedule.push(row)
        continue
      }
      const hit = kept.find((item) => slotsCollide(item.course, item.row, course, row))
      if (hit) {
        removed.push(`${classStamp(course, row)} của môn ${course.name}`)
        changed.add(course.id)
        continue
      }
      schedule.push(row)
      kept.push({ course, row })
    }
    return { ...course, schedule }
  })
  return { courses: next, removed, changed }
}

export function classOverlaps(courses) {
  const slots = []
  for (const course of courses || []) {
    for (const row of course.schedule || []) {
      if (!row.start || !row.end || minutes(row.end) <= minutes(row.start)) continue
      slots.push({ course, row })
    }
  }
  const found = []
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      const a = slots[i]
      const b = slots[j]
      if (!slotsCollide(a.course, a.row, b.course, b.row)) continue
      found.push({
        aId: a.course.id,
        bId: b.course.id,
        text: clashText(a.row, b.course, b.row),
      })
    }
  }
  return found
}

export function scheduleClash(form, courses) {
  return alignCourseSchedule(form, courses).clash
}

export function validateCourse(form) {
  const errors = {}
  if (!String(form.name || '').trim()) errors.name = 'Vui lòng nhập tên môn học.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.start || '')) errors.start = 'Nhập ngày bắt đầu theo dd/mm/yyyy.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.end || '')) errors.end = 'Nhập ngày kết thúc theo dd/mm/yyyy.'
  else if (form.start && form.end < form.start) errors.end = 'Ngày kết thúc phải sau ngày bắt đầu.'
  for (const row of form.schedule || []) {
    if (row.start && row.end && row.end <= row.start) errors.schedule = 'Giờ kết thúc buổi học phải sau giờ bắt đầu.'
    const from = isoDay(row.from)
    const until = isoDay(row.until)
    if (from && until && from > until) errors.schedule = 'Ngày kết thúc buổi học phải sau ngày bắt đầu buổi học.'
  }
  return errors
}

export function validateManual(form) {
  const errors = {}
  if (!String(form.name || '').trim()) errors.name = 'Vui lòng nhập tên kế hoạch.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date || '')) errors.date = 'Nhập hạn theo dd/mm/yyyy.'
  if (!/^\d{2}:\d{2}$/.test(form.time || '')) errors.time = 'Nhập giờ nộp hoặc chọn giờ trên đồng hồ.'
  const parents = (form.tasks || []).filter((task) => !task.parentId)
  if (!parents.length) errors.tasks = 'Thêm ít nhất một đầu mục.'
  return errors
}

function decoratePlan(plan, data, now) {
  const course = data.courses.find((item) => item.id === plan.courseId) || null
  const stats = planStats(plan, now)
  return { ...plan, course, stats }
}

export function completionTrend(plans, now, mode) {
  const done = plans.flatMap((plan) => leafTasks(plan.tasks).filter((task) => task.status === 'done' && task.doneAt))
  const points = []
  if (mode === 'month') {
    const start = new Date(now)
    start.setDate(1)
    start.setMonth(start.getMonth() - 5)
    start.setHours(0, 0, 0, 0)
    for (let i = 0; i < 6; i += 1) {
      const from = new Date(start)
      from.setMonth(start.getMonth() + i)
      const to = new Date(from)
      to.setMonth(from.getMonth() + 1)
      points.push({ label: `T${from.getMonth() + 1}`, value: done.filter((task) => task.doneAt >= from.getTime() && task.doneAt < to.getTime()).length })
    }
    return points
  }
  if (mode === 'week') {
    const end = startOfDay(now) + DAY
    for (let i = 5; i >= 0; i -= 1) {
      const from = end - (i + 1) * 7 * DAY
      const to = from + 7 * DAY
      const d = new Date(from)
      points.push({ label: `${d.getDate()}/${d.getMonth() + 1}`, value: done.filter((task) => task.doneAt >= from && task.doneAt < to).length })
    }
    return points
  }
  for (let i = 6; i >= 0; i -= 1) {
    const from = startOfDay(now) - i * DAY
    const d = new Date(from)
    points.push({ label: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()], value: done.filter((task) => task.doneAt >= from && task.doneAt < from + DAY).length })
  }
  return points
}

export function buildView(data, now = Date.now()) {
  const courses = data.courses.map((course) => {
    const plans = data.plans.filter((plan) => plan.courseId === course.id)
    const docs = data.documents.filter((doc) => doc.courseId === course.id)
    return {
      ...course,
      status: courseStatus(course, now),
      plans, docs,
      docCount: docs.length,
      planCount: plans.length,
      updatedAt: docs.reduce((max, doc) => Math.max(max, doc.updatedAt || 0), 0),
    }
  })
  const plans = data.plans.map((plan) => decoratePlan(plan, { ...data, courses }, now))
  const leaves = plans.flatMap((plan) => leafTasks(plan.tasks).map((task) => ({ ...task, plan, view: taskStatus(task, now) })))
  const done = leaves.filter((task) => task.view === 'done').length
  const overdue = leaves.filter((task) => task.view === 'overdue')
  const total = leaves.length
  const kpis = {
    total,
    done,
    open: total - done,
    overdue: overdue.length,
    ratio: total ? done / total : 0,
  }
  const byCourse = courses.filter((course) => course.status === 'studying').map((course) => {
    const mine = leaves.filter((task) => task.plan.courseId === course.id)
    return { id: course.id, name: course.name, color: course.color, done: mine.filter((task) => task.view === 'done').length, open: mine.filter((task) => task.view !== 'done').length }
  })
  const unplanned = courses.filter((course) => course.status === 'studying' && !course.planCount)
  const today = dayBlocks(data, now, now)
  const upcoming = plans.filter((plan) => plan.stats.status !== 'done').sort((a, b) => a.deadline - b.deadline).slice(0, 4)
  const outside = leaves.filter((task) => task.view !== 'done' && task.start >= now && task.start && !coveredByFree(task.start, task.end, data.freeSlots))
  return { courses, plans, leaves, kpis, byCourse, unplanned, overdue, today, upcoming, outside, notices: visibleNotices(data.notices, now) }
}

export function dayBlocks(data, dayTs, now) {
  const from = startOfDay(dayTs)
  const to = from + DAY
  const classes = classIntervals(data.courses, from, to).map((item) => ({ ...item, kind: 'class' }))
  const tasks = []
  for (const plan of data.plans) {
    const course = data.courses.find((item) => item.id === plan.courseId)
    for (const task of leafTasks(plan.tasks)) {
      if (!task.start || task.end <= from || task.start >= to) continue
      tasks.push({
        kind: 'task', ...task, plan, course,
        parentName: plan.tasks.find((item) => item.id === task.parentId)?.name || '',
        courseName: course?.name || '',
        view: taskStatus(task, now),
        color: course?.color ?? 0,
      })
    }
  }
  return classes.concat(tasks).sort((a, b) => a.start - b.start)
}

export function monthCells(anchor) {
  const date = new Date(anchor)
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const start = startOfDay(first) - ((weekdayMon(first) - 1) * DAY)
  return Array.from({ length: 42 }, (_, index) => start + index * DAY)
}

function noticeBody(kind, payload) {
  if (kind === 'deadline') return `Kế hoạch "${payload.name}" đến hạn ${formatDMY(payload.deadline)} ${clock(payload.deadline)}. Mở kế hoạch để xem các nhiệm vụ còn lại.`
  if (kind === 'schedule') return `Hôm nay bạn có ${payload.count} nhiệm vụ: ${payload.list}.`
  if (kind === 'overdue') return `Nhiệm vụ "${payload.name}" đã qua giờ kết thúc nhưng chưa được đánh dấu hoàn thành. Hãy dời sang khung trống hoặc cập nhật trạng thái.`
  return `Môn ${payload.name} đang học nhưng chưa có kế hoạch. Lịch trên lớp: ${payload.schedule || 'chưa khai báo'}.`
}

export function desiredNotices(data, now) {
  const settings = { ...defaultSettings(), ...data.settings }
  const deliverAt = settings.frequency === 'batch' ? nextBatch(now) : now
  const view = buildView({ ...data, notices: [] }, now)
  const list = []
  if (settings.deadlineOn) {
    for (const plan of view.plans) {
      if (plan.stats.status === 'done') continue
      const late = plan.deadline < now
      const days = daysUntil(plan.deadline, now)
      if (!late && days > settings.deadlineDays) continue
      list.push({
        key: `deadline:${plan.id}:${plan.deadline}`, type: 'deadline',
        title: late ? `Quá hạn: ${plan.name}` : `Sắp đến hạn: ${plan.name}`,
        body: noticeBody('deadline', plan), planId: plan.id, taskId: '', courseId: plan.courseId || '', deliverAt,
      })
    }
  }
  if (settings.scheduleOn) {
    const tasks = view.today.filter((item) => item.kind === 'task')
    if (tasks.length) {
      list.push({
        key: `schedule:${dateISO(now)}`, type: 'schedule',
        title: `Hôm nay có ${tasks.length} nhiệm vụ`,
        body: noticeBody('schedule', { count: tasks.length, list: tasks.map((task) => `${clock(task.start)} ${task.name}`).join(', ') }),
        planId: tasks[0].plan.id, taskId: tasks[0].id, courseId: '', deliverAt,
      })
    }
  }
  if (settings.warningOn) {
    for (const task of view.overdue) {
      list.push({
        key: `over:${task.id}`, type: 'warning', title: `Quá hạn: ${task.name}`,
        body: noticeBody('overdue', task), planId: task.plan.id, taskId: task.id, courseId: task.plan.courseId || '', deliverAt,
      })
    }
    for (const course of view.unplanned) {
      const schedule = (course.schedule || []).map((slot) => `${WEEKDAYS.find((day) => day.id === Number(slot.weekday))?.short || ''} ${slot.start}–${slot.end}`).join(', ')
      list.push({
        key: `noplan:${course.id}`, type: 'warning', title: `Môn ${course.name} chưa có kế hoạch`,
        body: noticeBody('course', { name: course.name, schedule }), planId: '', taskId: '', courseId: course.id, deliverAt,
      })
    }
  }
  return list
}

export function mergeNotices(existing, desired, now) {
  const wanted = new Map(desired.map((item) => [item.key, item]))
  let changed = false
  const current = existing.filter((notice) => {
    if (wanted.has(notice.key)) return true
    if (String(notice.key).startsWith('over:') || String(notice.key).startsWith('noplan:')) { changed = true; return false }
    return true
  })
  const notices = current.map((notice) => {
    const next = wanted.get(notice.key)
    if (!next || (next.title === notice.title && next.body === notice.body)) return notice
    changed = true
    return { ...notice, title: next.title, body: next.body, planId: next.planId || '', taskId: next.taskId || '', courseId: next.courseId || '' }
  })
  const known = new Set(current.map((notice) => notice.key))
  const created = []
  for (const item of desired) {
    if (known.has(item.key)) continue
    changed = true
    created.push({ id: uid('n'), read: false, snoozeUntil: 0, snoozeCount: 0, createdAt: now, ...item })
  }
  return { notices: notices.concat(created), created, changed }
}

export function visibleNotices(notices, now) {
  return (notices || []).map((notice) => ({ ...notice, pending: noticeDue(notice, now) }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function unreadCount(notices, now) {
  return (notices || []).filter((notice) => noticeDue(notice, now)).length
}

export function welcomeMessage(name) {
  return {
    id: uid('m'), role: 'ai',
    from: `Đã đọc môn học, kế hoạch, lịch và giờ rảnh của ${name || 'bạn'}.`,
    suggestion: `Chào ${name || 'bạn'}, mình là trợ lý AI của Studyflow. Mình đọc môn học, kế hoạch, lịch và giờ rảnh của bạn để tư vấn.`,
    actions: [], at: Date.now(),
  }
}

export function classifyChat(text) {
  const value = fold(text)
  if (/huong dan|cach dung|o dau|bam/.test(value)) return 'guide'
  if (/cham|tre|lo|qua han|dieu chinh|rui ro|danh gia/.test(value)) return 'adjust'
  if (/thoi gian|ranh|tuan|gio/.test(value)) return 'time'
  if (/bai tap|de bai|lam bai|tai lieu|giai bai/.test(value)) return 'work'
  return 'plan'
}

export function chatReply(topic, data, now, text, taskId, corpus) {
  const view = buildView(data, now)
  if (taskId) {
    const found = view.leaves.find((task) => task.id === taskId)
    if (!found) return { from: 'Không thấy nhiệm vụ này.', suggestion: 'Hãy mở lại từ lịch học.', actions: [] }
    return composeTutor({ found, data, text, corpus })
  }
  if (topic === 'guide') {
    return {
      from: 'Studyflow có Trang chủ, Môn học, Kế hoạch, Lịch học và Thông báo.',
      suggestion: 'Thêm môn ở Môn học. Tạo kế hoạch bằng nút xanh trên trang Kế hoạch. Xem việc theo giờ ở Lịch học. Khai báo giờ tự học ở nút Thời gian rảnh. Trợ lý AI mở từ nút trên thanh đầu.',
      actions: [{ label: 'Tạo kế hoạch bằng AI', hash: '#/ke-hoach/ai' }],
    }
  }
  if (topic === 'work') {
    const task = (corpus?.taskId && view.leaves.find((item) => item.id === corpus.taskId))
      || view.leaves.find((item) => fold(text).includes(fold(item.name)))
      || view.overdue[0]
      || view.leaves.find((item) => item.view !== 'done')
    if (!task) return { from: 'Chưa có nhiệm vụ nào.', suggestion: 'Hãy tạo kế hoạch cho một môn đang học.', actions: [{ label: 'Tạo kế hoạch bằng AI', hash: '#/ke-hoach/ai' }] }
    if (corpus) return composeTutor({ found: task, data, text, corpus })
    const docs = data.documents.filter((doc) => doc.courseId === task.plan.courseId)
    return {
      from: `${task.name} thuộc ${task.plan.name}. Tài liệu: ${docs.map((doc) => doc.name).join(', ') || 'chưa có'}.`,
      suggestion: `Mở nhiệm vụ “${task.name}”, đẩy đề bài lên rồi hỏi “Giải bài tập này” để mình đọc tài liệu môn và soạn cách làm.`,
      actions: [{ label: 'Mở nhiệm vụ', hash: `#/nhiem-vu/${task.id}` }],
    }
  }
  if (topic === 'time') {
    const weekEnd = startOfDay(now) + (8 - weekdayMon(new Date(now))) * DAY
    const open = openHours(data, now, weekEnd)
    return {
      from: `Giờ rảnh ${formatHours(weeklyFreeHours(data.freeSlots))} giờ/tuần. Còn trống khoảng ${formatHours(open)} giờ đến hết Chủ nhật.`,
      suggestion: open < 3 ? 'Phần trống còn ít. Nên thêm giờ rảnh trước khi xếp thêm nhiệm vụ.' : 'Còn đủ chỗ cho các phiên đã xếp. Giữ các buổi đã xác nhận.',
      actions: [{ label: 'Sửa thời gian rảnh', hash: '#/lich/ranh' }],
    }
  }
  if (topic === 'adjust') {
    const names = view.overdue.map((task) => task.name)
    const ok = !names.length && !view.unplanned.length
    return {
      from: ok ? 'Không có nhiệm vụ quá hạn.' : `Quá hạn: ${names.join(', ') || 'không'}. Môn chưa có kế hoạch: ${view.unplanned.map((course) => course.name).join(', ') || 'không'}.`,
      suggestion: ok ? 'Đang đúng tiến độ. Cứ giữ các phiên đã xếp.' : 'Mở nhiệm vụ quá hạn và bấm Dời sang khung trống, hoặc tạo kế hoạch cho môn còn trống.',
      actions: view.overdue[0] ? [{ label: 'Mở nhiệm vụ quá hạn', hash: `#/nhiem-vu/${view.overdue[0].id}` }] : [{ label: 'Xem kế hoạch', hash: '#/ke-hoach' }],
    }
  }
  const target = view.unplanned[0]
  const doing = view.plans.filter((plan) => plan.stats.status === 'doing' || plan.stats.status === 'overdue')
  return {
    from: `${doing.length} kế hoạch đang làm. ${view.unplanned.length} môn chưa có kế hoạch. Còn ${formatHours(view.leaves.filter((task) => task.view !== 'done').reduce((sum, task) => sum + taskHours(task), 0))} giờ việc.`,
    suggestion: target ? `Nên lập kế hoạch cho môn ${target.name} trước vì môn này chưa có lịch tự học.` : 'Các môn đang học đều đã có kế hoạch. Hãy xử lý nhiệm vụ quá hạn trước.',
    actions: target ? [{ label: 'Tạo kế hoạch bằng AI', hash: `#/ke-hoach/ai?mon=${target.id}` }] : [{ label: 'Xem kế hoạch', hash: '#/ke-hoach' }],
  }
}

export function createDemo(now = Date.now()) {
  const data = emptyData()
  data.courses = [
    { id: 'c-ptk', name: 'Phân tích thiết kế hệ thống', start: '2026-09-01', end: '2026-12-20', color: 0, output: 'Báo cáo đặc tả, sơ đồ usecase, ERD và kiến trúc.', goal: 'Hoàn thành đặc tả hệ thống thư viện.', notes: '', schedule: [{ id: 'cs1', weekday: 2, start: '07:00', end: '09:30', room: 'P.B203' }, { id: 'cs2', weekday: 4, start: '13:00', end: '15:30', room: 'P.B203' }] },
    { id: 'c-csdl', name: 'Cơ sở dữ liệu', start: '2026-09-01', end: '2026-12-20', color: 1, output: 'Làm được các dạng truy vấn trong đề cương.', goal: 'Nắm SQL và chuẩn hóa.', notes: '', schedule: [{ id: 'cs3', weekday: 1, start: '09:30', end: '11:30', room: 'P.A101' }, { id: 'cs4', weekday: 3, start: '07:00', end: '09:30', room: 'P.A101' }] },
    { id: 'c-mkt', name: 'Marketing căn bản', start: '2026-09-01', end: '2026-12-20', color: 2, output: 'Báo cáo chiến dịch 8–10 trang.', goal: 'Viết báo cáo chiến dịch.', notes: '', schedule: [{ id: 'cs5', weekday: 5, start: '13:00', end: '15:30', room: 'P.C304' }] },
    { id: 'c-pre', name: 'Kỹ năng thuyết trình', start: '2026-09-01', end: '2026-12-20', color: 3, output: 'Slide và phần nói không quá 10 phút.', goal: 'Thuyết trình nhóm.', notes: '', schedule: [{ id: 'cs6', weekday: 2, start: '13:00', end: '15:00', room: 'Hội trường B' }] },
    { id: 'c-web', name: 'Lập trình Web', start: '2026-09-01', end: '2026-12-20', color: 4, output: 'API REST chạy được và README ngắn.', goal: 'Nộp bài lab đúng hạn.', notes: '', schedule: [{ id: 'cs7', weekday: 3, start: '09:45', end: '11:45', room: 'Lab 2' }, { id: 'cs8', weekday: 5, start: '07:00', end: '09:30', room: 'Lab 2' }] },
    { id: 'c-old', name: 'Tiếng Anh học kỳ trước', start: '2026-01-05', end: '2026-05-20', color: 5, output: '', goal: '', notes: '', schedule: [] },
  ]
  data.documents = [
    { id: 'd1', courseId: 'c-ptk', name: 'De_bai_PTKHT.pdf', type: 'PDF', size: 860000, updatedAt: atTime('2026-10-20', '09:00') },
    { id: 'd2', courseId: 'c-ptk', name: 'Slide_tuan_5.pptx', type: 'Slide', size: 2400000, updatedAt: atTime('2026-10-22', '14:00') },
    { id: 'd3', courseId: 'c-csdl', name: 'Giao_trinh_CSDL.pdf', type: 'PDF', size: 3200000, updatedAt: atTime('2026-10-18', '08:00') },
    { id: 'd4', courseId: 'c-mkt', name: 'Brief_chien_dich.pdf', type: 'PDF', size: 540000, updatedAt: atTime('2026-10-12', '10:00') },
    { id: 'd5', courseId: 'c-pre', name: 'Huong_dan_thuyet_trinh.docx', type: 'Word', size: 180000, updatedAt: atTime('2026-10-21', '16:00') },
    { id: 'd6', courseId: 'c-web', name: 'Lab4_REST.pdf', type: 'PDF', size: 420000, updatedAt: atTime('2026-10-25', '11:00') },
  ]
  data.freeSlots = [
    { id: 'f1', weekday: 1, start: '19:30', end: '22:00' },
    { id: 'f2', weekday: 2, start: '19:30', end: '22:00' },
    { id: 'f3', weekday: 3, start: '19:30', end: '21:30' },
    { id: 'f4', weekday: 4, start: '16:00', end: '18:00' },
    { id: 'f5', weekday: 4, start: '19:30', end: '21:30' },
    { id: 'f6', weekday: 5, start: '19:30', end: '22:00' },
    { id: 'f7', weekday: 6, start: '14:00', end: '17:00' },
    { id: 'f8', weekday: 7, start: '08:30', end: '11:30' },
    { id: 'f9', weekday: 7, start: '14:00', end: '15:30' },
  ]
  data.plans = [
    { id: 'p-ptk', courseId: 'c-ptk', name: 'Kế hoạch môn Phân tích thiết kế hệ thống', deadline: atTime('2026-11-15', '23:59'), source: 'ai', difficulty: 4, createdAt: atTime('2026-10-06', '20:00'), tasks: [] },
    { id: 'p-csdl', courseId: 'c-csdl', name: 'Ôn tập môn Cơ sở dữ liệu', deadline: atTime('2026-11-20', '23:59'), source: 'ai', difficulty: 3, createdAt: atTime('2026-10-08', '21:00'), tasks: [] },
    { id: 'p-mkt', courseId: 'c-mkt', name: 'Làm báo cáo môn Marketing', deadline: atTime('2026-11-05', '23:59'), source: 'manual', difficulty: 2, createdAt: atTime('2026-10-02', '19:00'), tasks: [] },
    { id: 'p-pre', courseId: 'c-pre', name: 'Chuẩn bị thuyết trình nhóm', deadline: atTime('2026-11-12', '23:59'), source: 'ai', difficulty: 3, createdAt: atTime('2026-10-09', '18:00'), tasks: [] },
  ]
  data.plans = alignPlansToOutput(data, now).plans
  data.settings.outlineTasks = 6
  data.assistant = [welcomeMessage('Nam')]
  data.notices = []
  const merged = mergeNotices([], desiredNotices(data, now), now - 5 * 3600000)
  data.notices = merged.notices
  return data
}

export function scheduleLabel(course) {
  return (course.schedule || []).map((slot) => {
    const day = WEEKDAYS.find((item) => item.id === Number(slot.weekday))
    return `${day?.short || ''} ${slot.start}–${slot.end}`
  }).join(', ')
}
