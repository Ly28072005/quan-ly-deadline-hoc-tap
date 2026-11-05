import {
  DAY, WEEKDAYS, atTime, clock, dateISO, formatAgo, formatBytes, formatDM, formatDMY, formatHours, formatMonthTitle,
  formatSession, formatSpokenDate, formatSpan, formatWhen, sameDay, startOfDay, weekdayLabel, weekRange,
} from './format.js'
import { BATCH_HOURS, DEADLINE_MILESTONES, batchHoursOf, STATUS, deadlineMilestones, classOverlaps, dayBlocks, monthCells, slotClashClass, taskHours, taskStatus } from './model.js?v=89'
import { accent, banner, dot, empty, esc, icon, opts } from './html.js?v=89'
import { geminiKey } from './claude.js?v=89'

const HOUR = 64
const START_H = 6
const END_H = 24

export function renderCalendar(ctx) {
  const mode = ctx.query.view === 'ngay' ? 'day' : ctx.query.view === 'tuan' ? 'week' : (ctx.narrow ? 'day' : 'week')
  const anchor = ctx.query.d ? atTime(ctx.query.d, '12:00') : ctx.now
  const range = mode === 'day' ? { start: startOfDay(anchor), end: startOfDay(anchor) } : weekRange(anchor)
  const days = []
  for (let t = range.start; t <= range.end; t += DAY) days.push(t)
  const title = mode === 'day' ? formatSpokenDate(anchor) : formatMonthTitle(range.start, range.end)
  const events = days.flatMap((day) => dayBlocks(ctx.data, day, ctx.now))
  const visibleTasks = events.filter((event) => event.kind === 'task' && shown(event, ctx))
  const overlaps = classOverlaps(ctx.data.courses)
  return {
    title,
    wide: true,
    actions: `<button class="btn btn-ghost" type="button" data-act="cal-today">Hôm nay</button><button class="icon-btn" type="button" data-act="cal-move" data-dir="-1" aria-label="Trước">${icon('chevL', 18)}</button><button class="icon-btn" type="button" data-act="cal-move" data-dir="1" aria-label="Sau">${icon('chevR', 18)}</button><span class="muted">${visibleTasks.length} nhiệm vụ</span><div class="seg"><button type="button" data-act="cal-mode" data-value="ngay" aria-pressed="${mode === 'day'}">Ngày</button><button type="button" data-act="cal-mode" data-value="tuan" aria-pressed="${mode === 'week'}">Tuần</button></div><a class="btn btn-ghost" href="#/lich/ranh">${icon('clock', 16)} Thời gian rảnh</a>`,
    html: `${overlaps.length ? banner('bad', 'Lịch học cố định đang trùng giờ', esc(overlaps.map((item) => item.text).join(' ')), `<a class="btn btn-primary" href="#/mon/${overlaps[0].aId}/sua">Sửa môn học</a>`) : ''}<div class="cal-layout">
      <aside class="cal-side">
        ${miniMonth(anchor, ctx)}
        <h2>Trạng thái nhiệm vụ</h2>
        <div class="cal-filters">${[['todo', 'Chưa thực hiện'], ['doing', 'Đang thực hiện'], ['done', 'Hoàn thành'], ['overdue', 'Quá hạn']].map(([key, label]) => `<label class="check"><input type="checkbox" data-act="cal-status" data-id="${key}" ${ctx.cal.status[key] ? 'checked' : ''}> ${label}</label>`).join('')}</div>
        <h2>Hiển thị</h2>
        <div class="cal-filters">
          <label class="check"><input type="checkbox" data-act="cal-flag" data-id="tasks" ${ctx.cal.tasks ? 'checked' : ''}> Nhiệm vụ</label>
          <label class="check"><input type="checkbox" data-act="cal-flag" data-id="klass" ${ctx.cal.klass ? 'checked' : ''}> Lịch trên lớp</label>
          <label class="check"><input type="checkbox" data-act="cal-flag" data-id="free" ${ctx.cal.free ? 'checked' : ''}> Giờ rảnh</label>
        </div>
      </aside>
      <section class="card cal-card">
        <div class="cal-legend">
          <div class="cal-key">
            <span><i class="key-sample free" aria-hidden="true"></i>Giờ rảnh</span>
            <span><i class="key-sample class" aria-hidden="true">${icon('book', 12)}</i>Trên lớp</span>
            <span><i class="key-sample task" aria-hidden="true"></i>Nhiệm vụ</span>
          </div>
          ${courseKey(events.filter((event) => (event.kind === 'task' ? ctx.cal.tasks && shown(event, ctx) : ctx.cal.klass)))}
        </div>
        ${visibleTasks.length ? '' : '<div class="cal-empty">Chưa có nhiệm vụ trong tuần này · <a href="#/ke-hoach/ai">Tạo kế hoạch</a></div>'}
        ${mode === 'day' ? `<div class="day-strip">${daysOfWeek(anchor).map((day) => `<button type="button" class="${sameDay(day, anchor) ? 'on' : ''}" data-act="cal-jump" data-d="${dateISO(day)}"><span>${['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(day).getDay()]}</span><b>${new Date(day).getDate()}</b></button>`).join('')}</div>` : ''}
        <div class="cal-scroll" data-scroll="cal">
          <div class="cal-grid" style="--days:${days.length}">
            <div class="cal-corner">GMT+07</div>
            ${days.map((day) => `<div class="cal-date ${sameDay(day, ctx.now) ? 'today' : ''}"><span>${['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(day).getDay()]}</span><b>${new Date(day).getDate()}</b></div>`).join('')}
            <div class="cal-due-label">Hạn nộp</div>
            ${days.map((day) => `<div class="cal-due">${deadlines(ctx, day)}</div>`).join('')}
            <div class="cal-hours">${hours()}</div>
            ${days.map((day) => column(day, ctx)).join('')}
          </div>
        </div>
      </section>
    </div>`,
  }
}

function daysOfWeek(anchor) {
  const { start, end } = weekRange(anchor)
  const list = []
  for (let t = start; t <= end; t += DAY) list.push(t)
  return list
}

function shown(event, ctx) {
  if (event.course && ctx.cal.hide.includes(event.course.id || event.courseId)) return false
  if (event.kind === 'task' && !ctx.cal.status[event.view]) return false
  return true
}

function miniMonth(anchor, ctx) {
  const cells = monthCells(anchor)
  const month = new Date(anchor)
  const viewing = ctx.query.view === 'ngay' ? [startOfDay(anchor)] : daysOfWeek(anchor)
  return `<div class="mini">
    <div class="block-head"><strong>Tháng ${month.getMonth() + 1}</strong><span><button type="button" data-act="cal-month" data-dir="-1" aria-label="Tháng trước">${icon('chevL', 16)}</button><button type="button" data-act="cal-month" data-dir="1" aria-label="Tháng sau">${icon('chevR', 16)}</button></span></div>
    <div class="mini-grid">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((d) => `<span>${d}</span>`).join('')}${cells.map((day) => {
      const date = new Date(day)
      const outside = date.getMonth() !== month.getMonth()
      const has = ctx.data.plans.some((plan) => plan.tasks.some((task) => task.start && sameDay(task.start, day)))
      const on = viewing.some((item) => sameDay(item, day))
      const today = sameDay(day, ctx.now)
      return `<button type="button" class="${outside ? 'out' : ''} ${on ? 'on' : ''} ${today ? 'today' : ''}" data-act="cal-jump" data-d="${dateISO(day)}">${date.getDate()}${has ? '<i></i>' : ''}</button>`
    }).join('')}</div>
  </div>`
}

function deadlines(ctx, day) {
  return ctx.view.plans.filter((plan) => plan.stats.status !== 'done' && sameDay(plan.deadline, day)).map((plan) => `<span class="due-chip">Hạn ${clock(plan.deadline)}: ${esc(plan.name)}</span>`).join('')
}

function hours() {
  return Array.from({ length: END_H - START_H }, (_, i) => `<span style="top:${i * HOUR}px">${pad(START_H + i)}:00</span>`).join('')
}

function pad(n) { return String(n).padStart(2, '0') }

function column(day, ctx) {
  const blocks = dayBlocks(ctx.data, day, ctx.now)
  const free = ctx.cal.free ? ctx.data.freeSlots.filter((slot) => Number(slot.weekday) === weekdayOf(day)).map((slot) => band(slot.start, slot.end, 'free')) : []
  const classItems = ctx.cal.klass ? blocks.filter((item) => item.kind === 'class') : []
  const taskItems = ctx.cal.tasks ? blocks.filter((item) => item.kind === 'task' && shown(item, ctx)) : []
  const classLanes = laneLayout(classItems)
  const taskLanes = laneLayout(taskItems)
  const min = Math.max(classLanes.cols, taskLanes.cols, 1) * 132
  const nowLine = sameDay(day, ctx.now) ? `<i class="now-line" style="top:${((ctx.now - startOfDay(day)) / 3600000 - START_H) * HOUR}px"></i>` : ''
  return `<div class="cal-col ${sameDay(day, ctx.now) ? 'today' : ''}" style="min-width:${min}px">${free.join('')}${classLanes.rows.map((row) => classCard(row)).join('')}${taskLanes.rows.map((row) => taskCard(row)).join('')}${nowLine}</div>`
}

function laneLayout(items) {
  const list = (items || []).slice().sort((a, b) => a.start - b.start || a.end - b.end)
  const colEnd = []
  const assigned = list.map((item) => {
    let col = 0
    while (col < colEnd.length && colEnd[col] > item.start) col += 1
    if (col === colEnd.length) colEnd.push(0)
    colEnd[col] = item.end
    return { item, col }
  })
  const rows = assigned.map((row) => {
    let cols = row.col + 1
    for (const other of assigned) {
      if (other.item === row.item) continue
      if (row.item.start < other.item.end && other.item.start < row.item.end) cols = Math.max(cols, other.col + 1)
    }
    return { ...row, cols }
  })
  return { rows, cols: colEnd.length }
}

function laneBox(row, extra = '') {
  const left = `calc(3px + (100% - 6px) * ${row.col} / ${row.cols})`
  const width = `calc((100% - 6px) / ${row.cols} - 2px)`
  return `${box(row.item.start, row.item.end)};left:${left};width:${width};${extra}`
}

function classCard(row) {
  const item = row.item
  const clash = row.cols > 1
  return `<div class="block class${clash ? ' clash' : ''}" style="${laneBox(row, `--accent:${accent(item.color)}`)}"><span class="when">${esc(formatSpan(item.start, item.end))}</span><strong><i class="cdot"></i>${esc(item.name)}</strong>${item.room ? `<span>${esc(item.room)}</span>` : ''}<em>${icon('book', 12)} Trên lớp</em></div>`
}

function taskCard(row) {
  const item = row.item
  const course = item.courseName || item.course?.name || ''
  const status = STATUS[item.view]?.label || ''
  const title = [item.name, course, status].filter(Boolean).join(' · ')
  return `<a class="block task ${item.view}" href="#/nhiem-vu/${item.id}" style="${laneBox(row, `--accent:${accent(item.color)}`)}" title="${esc(title)}"><strong>${esc(item.name)}</strong>${course ? `<span class="course">${esc(course)}</span>` : ''}<em>${esc(status)}</em></a>`
}

// Every course that shows up this week, from its tasks or its classes.
function courseKey(events) {
  const seen = new Map()
  for (const event of events || []) {
    const name = event.kind === 'class' ? event.name : (event.courseName || event.course?.name)
    if (!name) continue
    const id = event.kind === 'class' ? event.courseId : (event.course?.id || event.plan?.courseId || name)
    if (!seen.has(id)) seen.set(id, { name, color: event.color })
  }
  if (!seen.size) return ''
  return `<div class="cal-key courses">${[...seen.values()].map((item) => `<span>${dot(item.color)}${esc(item.name)}</span>`).join('')}</div>`
}

function weekdayOf(day) {
  const js = new Date(day).getDay()
  return js === 0 ? 7 : js
}

function band(start, end, kind) {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const top = ((sh + sm / 60) - START_H) * HOUR
  const height = ((eh + em / 60) - (sh + sm / 60)) * HOUR
  return `<div class="band ${kind}" style="top:${top}px;height:${height}px"></div>`
}

function box(start, end) {
  const top = ((new Date(start).getHours() + new Date(start).getMinutes() / 60) - START_H) * HOUR
  const height = Math.max(32, (end - start) / 3600000 * HOUR)
  return `top:${top}px;height:${height}px`
}

export function renderFree(ctx) {
  const outside = ctx.view.outside
  return {
    title: 'Thời gian rảnh',
    back: '#/lich',
    html: `${outside.length ? banner('warn', `${outside.length} nhiệm vụ sắp tới nằm ngoài giờ rảnh`, esc(outside.map((task) => task.name).join(', ')), `<a class="btn btn-primary" href="#/nhiem-vu/${outside[0].id}">Xem</a>`) : ''}
      <section class="card list">${WEEKDAYS.map((day) => dayRow(day, ctx)).join('')}</section>`,
  }
}

function dayRow(day, ctx) {
  const free = ctx.data.freeSlots.filter((slot) => Number(slot.weekday) === day.id)
  const hours = free.reduce((sum, slot) => sum + (mins(slot.end) - mins(slot.start)) / 60, 0)
  const adding = ctx.slotDay === day.id
  return `<div class="free-row">
    <div class="free-day"><strong>${day.full}</strong><span class="sub num">${formatHours(hours)} giờ</span></div>
    <div class="chip-wrap">
      ${free.map((slot) => {
        const clash = slotClashClass(slot, ctx.data.courses)
        return `<span class="slot-chip ${clash ? 'bad' : ''}">${esc(slot.start)}–${esc(slot.end)}${clash ? ' · trùng giờ lên lớp' : ''}<button type="button" data-act="del-slot" data-id="${slot.id}" aria-label="Xóa">${icon('x', 12)}</button></span>`
      }).join('')}
      ${adding ? `<form class="inline-add" data-act="save-slot"><input class="input" type="time" name="start" value="19:30" required><input class="input" type="time" name="end" value="21:30" required><button class="btn btn-primary" type="submit">Lưu</button><button class="btn btn-ghost" type="button" data-act="cancel-slot">Hủy</button></form>` : `<button class="slot-chip add" type="button" data-act="add-slot" data-day="${day.id}">+ Thêm</button>`}
    </div>
  </div>`
}

function mins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function renderTask(ctx) {
  const found = ctx.view.leaves.find((task) => task.id === ctx.route.id)
  if (!found) return { title: 'Nhiệm vụ', html: empty('Không thấy nhiệm vụ', 'Nhiệm vụ này đã bị xóa.') }
  const parent = found.plan.tasks.find((task) => task.id === found.parentId)
  const docs = ctx.data.documents.filter((doc) => doc.courseId === found.plan.courseId)
  const messages = ctx.data.taskChats[found.id] || []
  const greeting = docs.length
    ? `Đẩy đề hoặc dán câu hỏi. Gemini đọc ${docs.length} tài liệu môn ${found.plan.course?.name || 'này'} trước; nếu đề cần thêm kiến thức thì tìm nguồn trên web rồi giải đầy đủ.`
    : `Đẩy đề hoặc dán câu hỏi. Gemini giải bằng kiến thức và tìm web; tải slide/giáo trình để ưu tiên đúng tài liệu môn.`
  return {
    title: found.name,
    crumb: `<a href="#/ke-hoach/${found.plan.id}">${esc(found.plan.name)}</a>`,
    back: ctx.taskBack || `#/ke-hoach/${found.plan.id}`,
    taskHead: true,
    wide: true,
    html: `<div class="task-layout">
      <div class="stack">
        <section class="card pad stack">
          <div class="facts">
            <div><span class="k">Môn học</span><b>${found.plan.course ? esc(found.plan.course.name) : 'Chưa gắn môn'}</b></div>
            ${parent ? `<div><span class="k">Nhiệm vụ cha</span><b>${esc(parent.name)}</b></div>` : ''}
            <div><span class="k">Thời lượng</span><b class="num">${formatHours(taskHours(found))} giờ</b></div>
            <div><span class="k">Tài liệu môn</span><b>${found.plan.courseId ? `<a href="#/tai-lieu/${found.plan.courseId}">${docs.length} tệp</a>` : `${docs.length} tệp`}</b></div>
          </div>
          <div class="when-row">
            <div class="when-card"><span class="k">Thời gian</span><b class="num">${found.start ? formatSession(found.start, found.end) : 'Chưa xếp'}</b></div>
            <div class="when-card"><span class="k">Hạn nộp</span><b class="num">${formatWhen(found.plan.deadline)} · ${clock(found.plan.deadline)}</b></div>
          </div>
          <div>
            <p class="k">Trạng thái</p>
            <div class="status-pick">${['todo', 'doing', 'done'].map((key) => `<button type="button" data-act="set-status" data-id="${found.id}" data-status="${key}" aria-pressed="${found.status === key}">${STATUS[key].label}</button>`).join('')}</div>
            ${found.view === 'overdue' ? `<p class="move-line">Đã quá giờ so với khung đã xếp. <button type="button" class="text-btn" data-act="move-task" data-id="${found.id}">Dời sang khung trống</button></p>` : ''}
          </div>
        </section>
        <section class="card pad">
          <h2>Bài tập của nhiệm vụ</h2>
          <label class="dropzone" data-drop="task"><input type="file" hidden multiple data-act="task-file" data-id="${found.id}" accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp"><strong>Đẩy bài tập lên</strong><span>PDF, Word, txt, markdown hoặc ảnh đề.</span></label>
          ${(found.files || []).map((file) => `<div class="list-row"><button class="doc-open" type="button" data-act="view-doc" data-id="${file.id}"><span class="doc-title">${icon(file.type === 'Ảnh' ? 'image' : 'file', 18)} <strong>${esc(file.name)}</strong></span><span class="sub">${formatBytes(file.size)} · ${formatAgo(file.updatedAt, ctx.now)} · Xem</span></button><button class="icon-btn" type="button" data-act="del-file" data-id="${found.id}" data-file="${file.id}" aria-label="Xóa">${icon('trash', 16)}</button></div>`).join('')}
        </section>
      </div>
      ${chatBox('Trợ lý làm bài', '', ctx.source, messages, greeting, ctx.chatBusy === found.id, [
        'Giải bài tập này', 'Giải thích yêu cầu bài tập', 'Gợi ý các bước làm', 'Nên đọc tài liệu nào?', 'Kiểm tra bài làm của mình',
      ], 'Dán đề hoặc hỏi cách làm…', 'task')}
    </div>`,
  }
}

export function chatBox(title, sub, source, messages, greeting, busy, chips, placeholder, scope) {
  const list = messages.length ? messages : [{ role: 'ai', suggestion: greeting, from: '', actions: [] }]
  return `<aside class="chat-pane">
    <header><span class="spark">${icon('sparkles', 18)}</span><div><strong>${title}</strong>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div><span class="source ${source === 'gemini' ? '' : 'sim'}">${source === 'gemini' ? 'Gemini' : 'Mô phỏng'}</span></header>
    <div class="msgs">${list.map((msg) => bubble(msg)).join('')}${busy ? `<div class="bubble ai"><span class="dots"></span> Gemini đang đọc đề, tìm nguồn và soạn câu trả lời…</div>` : ''}</div>
    <div class="chips">${chips.map((text) => `<button type="button" data-act="chip" data-scope="${scope}" data-text="${esc(text)}">${esc(text)}</button>`).join('')}</div>
    <form class="composer" data-act="send" data-scope="${scope}"><textarea class="input" name="text" rows="2" placeholder="${esc(placeholder)}"></textarea><button class="btn btn-primary icon-only" type="submit" aria-label="Gửi">${icon('send', 16)}</button></form>
  </aside>`
}

function inlineFmt(line) {
  return esc(line)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

function bubble(msg) {
  if (msg.role === 'user') return `<div class="bubble user">${esc(msg.text)}</div>`
  const body = String(msg.suggestion || '').split('\n').map((line) => {
    const text = line.trim()
    if (!text) return ''
    if (/^#{1,3}\s+/.test(text)) return `<p class="chat-h">${inlineFmt(text.replace(/^#{1,3}\s+/, ''))}</p>`
    if (/^[-•*]\s+/.test(text)) return `<p class="chat-li">${inlineFmt(text.replace(/^[-•*]\s+/, ''))}</p>`
    return `<p>${inlineFmt(text)}</p>`
  }).join('')
  const actions = (msg.actions || []).map((action) => `<a class="chip-act" href="${esc(action.hash)}">${esc(action.label)}</a>`).join('')
  return `<div class="bubble ai">${msg.from ? `<p class="fine">${esc(msg.from)}</p>` : ''}${body}${actions}</div>`
}

export function renderNotices(ctx) {
  const filter = ctx.query.loc || 'all'
  const type = ctx.query.loai || 'all'
  const sort = ctx.query.sort === 'old' ? 'old' : 'new'
  let items = ctx.view.notices.filter((notice) => {
    if (filter === 'unread' && !notice.pending) return false
    if (filter === 'read' && notice.pending) return false
    if (type !== 'all' && notice.type !== type) return false
    return true
  })
  items.sort((a, b) => sort === 'old' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt)
  const unread = ctx.view.notices.filter((notice) => notice.pending).length
  return {
    title: 'Thông báo',
    sub: `${unread} thông báo chưa đọc`,
    actions: `<button class="btn btn-ghost" type="button" data-act="read-all">${icon('check', 16)} Đọc hết</button><a class="btn btn-ghost" href="#/thong-bao/cai-dat">${icon('settings', 16)} Cài đặt</a>`,
    html: `<div class="tools-row">
      <div class="seg">${[['all', 'Tất cả'], ['unread', 'Chưa đọc'], ['read', 'Đã đọc']].map(([value, label]) => `<button type="button" data-act="notice-filter" data-value="${value}" aria-pressed="${filter === value}">${label}</button>`).join('')}</div>
      <select class="select" data-live="query" data-key="loai">${opts([['all', 'Tất cả thông báo'], ['deadline', 'Nhắc deadline'], ['schedule', 'Nhắc lịch học'], ['warning', 'Cảnh báo kế hoạch']], type)}</select>
      <select class="select" data-live="query" data-key="sort">${opts([['new', 'Mới nhất trước'], ['old', 'Cũ nhất trước']], sort)}</select>
    </div>
    <div class="card list">${items.map((notice) => `<a class="notice ${notice.pending ? 'unread' : ''}" href="#/thong-bao/${notice.id}">
      <span class="n-ico ${notice.type}">${icon(notice.type === 'deadline' ? 'clock' : notice.type === 'schedule' ? 'calendar' : 'alert', 18)}</span>
      <span class="doc-main"><strong>${esc(notice.title)}</strong><span class="sub">${noticeWhen(notice, ctx.now)}</span></span>
      ${notice.pending ? '<i class="unread-dot"></i>' : icon('chevR', 16)}
    </a>`).join('') || '<p class="muted pad">Không có thông báo</p>'}</div>`,
  }
}

export function renderNotice(ctx) {
  const notice = ctx.data.notices.find((item) => item.id === ctx.route.id)
  if (!notice) return { title: 'Thông báo', html: empty('Không thấy thông báo', 'Thông báo này không còn.') }
  const action = notice.courseId && !notice.planId
    ? `<a class="btn btn-primary" href="#/ke-hoach/ai?mon=${notice.courseId}">${icon('sparkles', 16)} Tạo kế hoạch bằng AI</a>`
    : notice.taskId
      ? `<a class="btn btn-primary" href="#/nhiem-vu/${notice.taskId}">Mở nhiệm vụ</a>`
      : notice.planId ? `<a class="btn btn-primary" href="#/ke-hoach/${notice.planId}">Mở kế hoạch</a>` : ''
  return {
    title: 'Thông báo',
    back: '#/thong-bao',
    html: `<article class="card pad narrow">
      <div class="plan-tags"><span class="n-ico ${notice.type}">${icon(notice.type === 'deadline' ? 'clock' : notice.type === 'schedule' ? 'calendar' : 'alert', 18)}</span><span class="sub">${formatAgo(notice.createdAt, ctx.now)}</span></div>
      <h2 class="notice-title">${esc(notice.title)}</h2>
      <p class="notice-body">${esc(notice.body)}</p>
      ${action ? `<div class="form-foot">${action}</div>` : ''}
    </article>`,
  }
}

export function renderSettings(ctx) {
  const s = ctx.data.settings
  const marks = deadlineMilestones(s)
  const hours = batchHoursOf(s)
  const chip =(key, value, label) => `<button type="button" class="${String(s[key]) === String(value) ? 'on' : ''}" data-act="set-pref" data-key="${key}" data-value="${value}">${label}</button>`
  return {
    title: 'Cài đặt thông báo',
    back: '#/thong-bao',
    html: `<div class="narrow stack">
      <section class="card pad"><h2>Loại thông báo</h2>
        ${toggle('deadlineOn', 'Nhắc deadline', '', s)}
        ${toggle('scheduleOn', 'Nhắc lịch học', '', s)}
        ${toggle('warningOn', 'Cảnh báo kế hoạch', '', s)}
      </section>
      <section class="card pad"><h2>Thời điểm và tần suất</h2>
        <p>Nhắc kế hoạch trước hạn nộp</p>
        <div class="chip-choice">${DEADLINE_MILESTONES.slice().reverse().map((day) => `<button type="button" class="${marks.includes(day) ? 'on' : ''}" data-act="toggle-mark" data-value="${day}" aria-pressed="${marks.includes(day)}">${day} ngày</button>`).join('')}</div>
        <p>Tần suất nhận</p><div class="chip-choice">${chip('frequency', 'instant', 'Ngay khi có')}${chip('frequency', 'batch', 'Gom theo khung giờ')}</div>
        ${s.frequency === 'batch' ? `<p>Khung giờ nhận</p>
        <div class="chip-choice">${BATCH_HOURS.map((hour) => `<button type="button" class="${hours.includes(hour) ? 'on' : ''}" data-act="toggle-hour" data-value="${hour}" aria-pressed="${hours.includes(hour)}">${hour}:00</button>`).join('')}</div>` : ''}
      </section>
      <section class="card pad"><h2>Thiết bị</h2>${toggle('push', 'Nhắc trên điện thoại', '', s)}</section>
      <section class="card pad stack"><h2>Trợ lý AI</h2>
        <form data-act="save-claude" class="stack">
          <label class="field"><span>Khóa Gemini (miễn phí)</span><input class="input" name="gemini" type="password" autocomplete="off" placeholder="AIza…" value="${esc(geminiKey())}"></label>
          <p class="fine">Lấy khóa: vào aistudio.google.com/apikey, đăng nhập Google, bấm Create API key rồi dán vào đây.</p>
          <div class="form-foot"><button class="btn btn-primary" type="submit">Lưu và kiểm tra khóa</button></div>
        </form>
      </section>
    </div>`,
  }
}

function noticeWhen(notice, now) {
  if (notice.deliverAt > now) return `Phát lúc ${formatDMY(notice.deliverAt)} ${clock(notice.deliverAt)}`
  return formatAgo(notice.createdAt, now)
}
function toggle(key, title, text, settings) {
  return `<label class="switch-row"><span><strong>${title}</strong>${text ? `<span class="sub">${text}</span>` : ''}</span><input type="checkbox" data-act="set-pref" data-key="${key}" data-value="toggle" ${settings[key] ? 'checked' : ''}></label>`
}

// Past chats, newest first; one chat read-only with "continue" and "delete".
function historyHtml(ctx) {
  const sessions = ctx.data.assistantSessions || []
  if (ctx.aiHistory !== 'list') {
    const session = sessions.find((item) => item.id === ctx.aiHistory)
    if (!session) return '<div class="msgs"><p class="muted">Không thấy phiên này.</p></div>'
    return `<div class="history-bar"><button class="btn btn-ghost" type="button" data-act="ai-session-back">${icon('back', 16)} Lịch sử</button><span class="history-when">${formatDMY(session.startedAt)} ${clock(session.startedAt)}</span></div>
      <div class="msgs">${session.messages.map((msg) => bubble(msg)).join('')}</div>
      <div class="history-foot"><button class="btn btn-primary" type="button" data-act="ai-session-resume" data-id="${session.id}">Tiếp tục phiên này</button><button class="btn btn-ghost" type="button" data-act="ai-session-del" data-id="${session.id}">${icon('trash', 16)} Xóa</button></div>`
  }
  return `<div class="history-bar"><strong>Lịch sử trò chuyện</strong><span class="history-when">${sessions.length} phiên</span></div>
    <div class="msgs history-list">${sessions.map((session) => {
      const count = session.messages.filter((msg) => msg.role === 'user').length
      return `<button type="button" class="history-item" data-act="ai-session" data-id="${session.id}"><strong>${esc(session.title)}</strong><span>${formatDMY(session.startedAt)} ${clock(session.startedAt)} · ${count} câu hỏi</span></button>`
    }).join('') || '<p class="muted">Chưa có phiên nào. Khi bạn đóng trợ lý, cuộc trò chuyện được lưu ở đây.</p>'}</div>`
}

export function drawerHtml(ctx) {
  const messages = ctx.data.assistant || []
  const history = !!ctx.aiHistory
  return `<div class="drawer-back" data-act="close-ai"></div>
    <aside class="drawer" role="dialog" aria-label="Trợ lý AI">
      <header><span class="spark">${icon('sparkles', 18)}</span><div><strong>Trợ lý AI</strong></div><span class="source ${ctx.source === 'gemini' ? '' : 'sim'}">${ctx.source === 'gemini' ? 'Gemini' : 'Mô phỏng'}</span><button class="icon-btn${history ? ' on' : ''}" type="button" data-act="ai-history" aria-label="Lịch sử trò chuyện" title="Lịch sử trò chuyện" aria-pressed="${history}">${icon('clock', 16)}</button><button class="icon-btn" type="button" data-act="clear-ai" aria-label="Phiên mới" title="Phiên mới">${icon('plus', 16)}</button><button class="icon-btn" type="button" data-act="close-ai" aria-label="Đóng">${icon('x', 18)}</button></header>
      ${history ? historyHtml(ctx) : `<div class="msgs">${messages.map((msg) => bubble(msg)).join('')}${ctx.chatBusy === 'ai' ? `<div class="bubble ai"><span class="dots"></span> Gemini đang đọc dữ liệu, tìm nguồn và soạn câu trả lời…</div>` : ''}</div>
      <div class="chips">${['Tư vấn kế hoạch', 'Vấn đề bài tập', 'Quản lý thời gian', 'Theo dõi, điều chỉnh', 'Hướng dẫn sử dụng'].map((text) => `<button type="button" data-act="chip" data-scope="ai" data-text="${esc(text)}">${esc(text)}</button>`).join('')}</div>
      <form class="composer" data-act="send" data-scope="ai"><textarea class="input" name="text" rows="2" placeholder="Hỏi trợ lý AI…"></textarea><button class="btn btn-primary icon-only" type="submit" aria-label="Gửi">${icon('send', 16)}</button></form>`}
    </aside>`
}

export { formatDM, weekdayLabel, dot }
