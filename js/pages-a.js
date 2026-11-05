import { WEEKDAYS, clock, dateISO, formatAgo, formatBytes, formatDMY, formatHours, formatISO, formatSpan, formatSpokenDate, formatWhen, showDate, weekdayLabel } from './format.js'
import { classOverlaps, completionTrend, courseWindowWarnings, leafTasks, parseOutput, sentenceCase, taskHours, taskStatus } from './model.js?v=76'
import { accent, banner, dateBox, dot, empty, esc, field, icon, initials, logo, opts, pill, progress, swatch, wrapDate } from './html.js?v=76'

export function renderAuth(mode, auth, reset) {
  const hero = `<aside class="hero">
    <a class="brand" href="#/dang-nhap">${logo()}<span>Studyflow</span></a>
    <h1>Một lịch học cho mọi môn, do AI giúp xếp.</h1>
    <p>Khai báo môn và giờ rảnh. Studyflow chia việc vào đúng chỗ trống.</p>
    <div class="mini-week" aria-hidden="true">
      ${['T2', 'T3', 'T4', 'T5', 'T6'].map((day, index) => `<div><b>${day}</b><i class="${index % 2 ? 'study' : 'ghost'}"></i>${index === 2 ? '<i class="study"></i>' : ''}</div>`).join('')}
    </div>
  </aside>`
  let form = ''
  if (mode === 'register') form = registerForm(auth)
  else if (mode === 'forgot') form = forgotForm(reset)
  else form = loginForm(auth)
  return `<div class="auth">${hero}<main class="auth-main"><a class="brand mobile-brand" href="#/dang-nhap">${logo()}<span>Studyflow</span></a>${form}</main></div>`
}

function loginForm(auth) {
  const e = auth.errors || {}
  return `<form class="auth-form" data-act="login">
    <h1>Đăng nhập</h1>
    <p class="sub">Tiếp tục với lịch học của bạn.</p>
    ${field('Email', `<span class="input-ico">${icon('mail', 18)}<input class="input ${e.email ? 'bad' : ''}" name="email" type="email" value="${esc(auth.email || '')}" autocomplete="username"></span>`, e.email)}
    ${field('Mật khẩu', `<span class="input-ico">${icon('lock', 18)}<input class="input ${e.password ? 'bad' : ''}" name="password" type="password" autocomplete="current-password"><button class="eye" type="button" data-act="toggle-pass" aria-label="Hiện mật khẩu">${icon('eye', 18)}</button></span>`, e.password)}
    <div class="row-between">
      <label class="check"><input type="checkbox" name="remember" ${auth.remember ? 'checked' : ''}> Ghi nhớ đăng nhập</label>
      <a href="#/quen-mat-khau">Quên mật khẩu?</a>
    </div>
    <button class="btn btn-primary btn-block" type="submit">Đăng nhập</button>
    <div class="or">hoặc</div>
    <button class="btn btn-ghost btn-block" type="button" data-act="demo">Dùng tài khoản demo</button>
    <p class="fine center">Chưa có tài khoản? <a href="#/dang-ky">Đăng ký</a></p>
  </form>`
}

function registerForm(auth) {
  const e = auth.errors || {}
  return `<form class="auth-form" data-act="register">
    <h1>Đăng ký</h1>
    <p class="sub">Tạo lịch học cho tài khoản của bạn.</p>
    ${field('Họ và tên', `<input class="input ${e.name ? 'bad' : ''}" name="name" value="${esc(auth.name || '')}">`, e.name)}
    ${field('Email', `<input class="input ${e.email ? 'bad' : ''}" name="email" type="email" value="${esc(auth.email || '')}">`, e.email)}
    ${field('Mật khẩu', `<input class="input ${e.password ? 'bad' : ''}" name="password" type="password">`, e.password || 'Ít nhất 6 ký tự')}
    ${field('Nhập lại mật khẩu', `<input class="input ${e.again ? 'bad' : ''}" name="again" type="password">`, e.again)}
    <button class="btn btn-primary btn-block" type="submit">Tạo tài khoản</button>
    <p class="fine center">Đã có tài khoản? <a href="#/dang-nhap">Đăng nhập</a></p>
  </form>`
}

function forgotForm(reset) {
  const step = reset.step || 1
  const e = reset.errors || {}
  const bar = `<div class="steps">${[1, 2, 3].map((n) => `<i class="${n <= step ? 'on' : ''}"></i>`).join('')}</div>`
  if (step === 3) {
    return `<div class="auth-form success">${bar}<span class="ok-badge">${icon('check', 28)}</span><h1>Đặt lại mật khẩu thành công</h1><p class="sub">Bạn có thể đăng nhập bằng mật khẩu mới.</p><a class="btn btn-primary btn-block" href="#/dang-nhap">Về đăng nhập</a></div>`
  }
  if (step === 2) {
    return `<form class="auth-form" data-act="reset-confirm">${bar}
      <h1>Đặt lại mật khẩu</h1>
      <p class="note">Mã xác nhận của bản thử: <b class="num">${esc(reset.code || '')}</b></p>
      ${field('Mã 6 số', `<input class="input ${e.code ? 'bad' : ''}" name="code" inputmode="numeric" maxlength="6" value="${esc(reset.typed || '')}">`, e.code)}
      ${field('Mật khẩu mới', `<input class="input ${e.password ? 'bad' : ''}" name="password" type="password">`, e.password)}
      ${field('Nhập lại mật khẩu', `<input class="input ${e.again ? 'bad' : ''}" name="again" type="password">`, e.again)}
      <button class="btn btn-primary btn-block" type="submit">Đặt lại mật khẩu</button>
      <button class="btn btn-ghost btn-block" type="button" data-act="resend">Gửi lại mã</button>
    </form>`
  }
  return `<form class="auth-form" data-act="reset-email">${bar}
    <h1>Quên mật khẩu</h1>
    <p class="sub">Nhập email để nhận mã xác nhận.</p>
    ${field('Email', `<input class="input ${e.email ? 'bad' : ''}" name="email" type="email" value="${esc(reset.email || '')}">`, e.email)}
    <button class="btn btn-primary btn-block" type="submit">Gửi mã xác nhận</button>
    <p class="fine center"><a href="#/dang-nhap">Về đăng nhập</a></p>
  </form>`
}

export function renderHome(ctx) {
  const { view, now } = ctx
  if (!view.courses.length) {
    return { title: `Chào buổi ${ctx.part}, ${ctx.given}`, sub: formatSpokenDate(now), html: empty('Bắt đầu bằng môn học của bạn', 'Thêm môn đầu tiên để lập kế hoạch và xếp lịch.', '<a class="btn btn-primary" href="#/mon-hoc/moi">Thêm môn học</a>') }
  }
  const alerts = []
  for (const course of view.unplanned) {
    alerts.push(banner('warn', `${course.name} chưa có kế hoạch`, '', `<a class="btn btn-primary" href="#/ke-hoach/ai?mon=${course.id}">Tạo bằng AI</a>`))
  }
  if (view.overdue.length) {
    alerts.push(banner('bad', `${view.overdue.length} nhiệm vụ quá hạn`, '', `<a class="btn btn-primary" href="#/nhiem-vu/${view.overdue[0].id}">Xem</a>`))
  }
  const max = Math.max(1, ...view.byCourse.map((item) => item.done + item.open))
  const points = completionTrend(view.plans, now, ctx.query.range === 'week' || ctx.query.range === 'month' ? ctx.query.range : 'day')
  return {
    title: `Chào buổi ${ctx.part}, ${ctx.given}`,
    sub: formatSpokenDate(now),
    html: `${alerts.join('')}
    <section class="kpis">
      ${kpi('Tổng nhiệm vụ', view.kpis.total, '', 'list', 'blue')}
      ${kpi('Đã hoàn thành', view.kpis.done, '', 'check', 'green', 'good')}
      ${kpi('Chưa hoàn thành', view.kpis.open, view.kpis.overdue ? `${view.kpis.overdue} quá hạn` : '', 'hourglass', 'amber', 'warn')}
      <article class="card kpi"><span class="kpi-ico mute">${icon('trend', 18)}</span><span class="k">Tỷ lệ hoàn thành</span><b class="num">${Math.round(view.kpis.ratio * 100)}%</b><span class="progress"><i style="width:${Math.round(view.kpis.ratio * 100)}%"></i></span></article>
    </section>
    <div class="split">
      <section class="card pad">
        <h2>Nhiệm vụ theo môn học</h2>
        <div class="bars">${view.byCourse.map((item) => {
          const total = item.done + item.open
          const pct = total ? Math.round((item.done / total) * 100) : 0
          return `<div class="bar-col" tabindex="0"><div class="bar" style="height:${Math.max(8, (total / max) * 100)}%"><i class="open" style="flex:${item.open || 0.001}"></i><i class="done" style="flex:${item.done || 0.001}"></i></div><span>${esc(shortCourse(item.name))}</span><span class="tip"><b>${pct}%</b><span>${esc(item.name)}</span><span>${item.done} đã hoàn thành, ${item.open} chưa hoàn thành</span></span></div>`
        }).join('')}</div>
        <p class="legend"><i class="swatch done"></i> Đã hoàn thành <i class="swatch open"></i> Chưa hoàn thành</p>
      </section>
      <section class="card pad">
        <div class="block-head"><h2>Xu hướng hoàn thành</h2><div class="seg">${seg('day', 'Ngày', ctx)}${seg('week', 'Tuần', ctx)}${seg('month', 'Tháng', ctx)}</div></div>
        ${lineChart(points)}
      </section>
    </div>
    <div class="split">
      <section class="card pad">
        <div class="block-head"><h2>Hôm nay</h2><a href="#/lich?view=ngay">Mở lịch</a></div>
        ${view.today.length ? timeline(view.today) : '<p class="muted">Hôm nay không có lịch</p>'}
      </section>
      <section class="card pad">
        <div class="block-head"><h2>Kế hoạch sắp đến hạn</h2><a href="#/ke-hoach">Tất cả</a></div>
        ${view.upcoming.map((plan) => soonPlan(plan, `${dot(plan.course?.color)} Hạn ${formatDMY(plan.deadline)}`)).join('') || '<p class="muted">Chưa có kế hoạch</p>'}
      </section>
    </div>`,
  }
}

function soonPlan(plan, meta) {
  return `<a class="soon" href="#/ke-hoach/${plan.id}"><span class="soon-main"><strong>${esc(plan.name)}</strong><span class="sub">${meta}</span></span><span class="soon-foot">${progress(plan.stats.ratio, plan.stats.status === 'overdue')}${pill(plan.stats.status)}</span></a>`
}
function coursePlan(plan, now) {
  const leaves = leafTasks(plan.tasks)
  return `<a class="plan-name" href="#/ke-hoach/${plan.id}">${esc(plan.name)}</a><div class="task-items">${leaves.map((task) => taskItem(task, now)).join('')}</div>`
}
function taskItem(task, now) {
  const when = task.start && task.end
    ? `<span class="task-facts"><span><span class="k">Bắt đầu</span><b class="num">${formatDMY(task.start)}</b><span class="num">${clock(task.start)}</span></span><span><span class="k">Kết thúc</span><b class="num">${formatDMY(task.end)}</b><span class="num">${clock(task.end)}</span></span><span><span class="k">Số giờ</span><b class="num">${formatHours(taskHours(task))} giờ</b></span></span>`
    : '<span class="sub">Chưa xếp giờ</span>'
  return `<a class="task-item" href="#/nhiem-vu/${task.id}"><span class="task-item-top"><strong>${esc(task.name)}</strong>${pill(taskStatus(task, now))}</span>${when}</a>`
}
function shortCourse(name) {
  if (name.includes('Web')) return 'Web'
  if (name.includes('Marketing')) return 'Marketing'
  if (name.includes('thuyết')) return 'Thuyết trình'
  if (name.includes('dữ liệu')) return 'CSDL'
  if (name.includes('thiết kế')) return 'PTK'
  return name.split(/\s+/).slice(-1)[0]
}
function kpi(label, value, sub, name, tone, num) {
  return `<article class="card kpi"><span class="kpi-ico ${tone}">${icon(name, 18)}</span><span class="k">${label}</span><b class="num ${num || ''}">${value}</b>${sub ? `<span class="sub">${sub}</span>` : ''}</article>`
}
function seg(value, label, ctx) {
  const on = (ctx.query.range || 'day') === value
  return `<button type="button" data-act="range" data-value="${value}" aria-pressed="${on}">${label}</button>`
}
function lineChart(points) {
  const w = 360
  const h = 150
  const max = Math.max(1, ...points.map((point) => point.value))
  const step = points.length > 1 ? w / (points.length - 1) : w
  const coords = points.map((point, index) => [index * step, h - 16 - (point.value / max) * (h - 28)])
  const line = coords.map((pair, index) => `${index ? 'L' : 'M'}${pair[0].toFixed(1)},${pair[1].toFixed(1)}`).join(' ')
  return `<svg class="line-chart" viewBox="0 0 ${w} ${h}" role="img"><defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--info)" stop-opacity="0.22"/><stop offset="100%" stop-color="var(--info)" stop-opacity="0"/></linearGradient></defs><path class="area" d="${line} L${w},${h} L0,${h} Z"/><path class="stroke" d="${line}"/>${coords.map((pair) => `<circle cx="${pair[0]}" cy="${pair[1]}" r="4"/>`).join('')}</svg><div class="xlabels">${points.map((point) => `<span>${esc(point.label)}</span>`).join('')}</div>`
}
function timeline(events) {
  return `<div class="timeline">${events.map((event) => {
    const study = event.kind === 'task'
    const inner = `<span class="tl-time num">${clockPair(event)}</span><i class="tl-bar ${study ? '' : 'dashed'}" style="--accent:${accent(event.color || 0)}"></i><span class="tl-main"><strong>${esc(event.name)}</strong>${study && event.course?.name ? `<span class="sub">${esc(event.course.name)}</span>` : ''}</span>${study ? pill(event.view) : ''}`
    return study ? `<a class="tl-row" href="#/nhiem-vu/${event.id}">${inner}</a>` : `<div class="tl-row">${inner}</div>`
  }).join('')}</div>`
}
function clockPair(event) {
  const p = (ts) => `${String(new Date(ts).getHours()).padStart(2, '0')}:${String(new Date(ts).getMinutes()).padStart(2, '0')}`
  return `${p(event.start)}<br>${p(event.end)}`
}

export function renderCourses(ctx) {
  const tab = ctx.query.tab === 'tailieu' ? 'tailieu' : 'mon'
  const tabs = `<div class="tabs line">
    <a href="#/mon-hoc" ${tab === 'mon' ? 'aria-current="page"' : ''}>Môn học</a>
    <a href="#/mon-hoc?tab=tailieu" ${tab === 'tailieu' ? 'aria-current="page"' : ''}>Tài liệu học tập</a>
  </div>`
  const head = { title: 'Môn học', actions: '<a class="btn btn-primary" href="#/mon-hoc/moi">Thêm môn học</a>' }
  if (tab === 'tailieu') return { ...head, html: `${tabs}${docIndex(ctx)}` }
  return { ...head, html: `${tabs}${courseGrid(ctx)}` }
}

function courseGrid(ctx) {
  const q = foldSafe(ctx.query.q)
  const status = ctx.query.status || 'all'
  const sort = ctx.query.sort === 'za' ? 'za' : 'az'
  let items = ctx.view.courses.filter((course) => (status === 'all' || course.status === status) && (!q || foldSafe(course.name).includes(q)))
  items.sort((a, b) => sort === 'za' ? b.name.localeCompare(a.name, 'vi') : a.name.localeCompare(b.name, 'vi'))
  return `<div class="tools-row">
      <label class="search">${icon('search', 18)}<input class="input" data-live="query" data-key="q" placeholder="Tìm môn học" value="${esc(ctx.query.q || '')}"></label>
      <select class="select" data-live="query" data-key="status">${opts([['all', 'Tất cả'], ['studying', 'Đang thực hiện'], ['ended', 'Kết thúc']], status)}</select>
      <select class="select" data-live="query" data-key="sort">${opts([['az', 'Tên A–Z'], ['za', 'Tên Z–A']], sort)}</select>
    </div>
    ${items.length ? `<div class="cards">${items.map((course) => `<a class="card course" href="#/mon/${course.id}" style="--accent:${accent(course.color)}">
      <div class="course-head">
        <span class="course-badge" aria-hidden="true">${esc(initials(course.name))}</span>
        <span class="course-title"><strong>${esc(course.name)}</strong><span class="course-dates num">${icon('calendar', 14)} ${formatISO(course.start)} – ${formatISO(course.end)}</span></span>
        ${pill(course.status)}
      </div>
      <div class="course-foot">
        ${(course.schedule || []).map((slot) => `<span class="slot-chip num">${icon('clock', 13)} ${weekdayLabel(slot.weekday)} · ${esc(slot.start)}–${esc(slot.end)}</span>`).join('') || '<span class="muted">Chưa có lịch học</span>'}
        ${course.status === 'studying' && !course.planCount ? '<span class="pill amber">Chưa có kế hoạch</span>' : ''}
      </div>
    </a>`).join('')}</div>` : empty('Chưa có môn học', 'Thêm môn để bắt đầu kế hoạch.', '<a class="btn btn-primary" href="#/mon-hoc/moi">Thêm môn học</a>')}`
}

function foldSafe(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function docIndex(ctx) {
  const q = foldSafe(ctx.query.q)
  const items = ctx.view.courses.filter((course) => !q || foldSafe(course.name).includes(q))
  return `<div class="tools-row"><label class="search">${icon('search', 18)}<input class="input" data-live="query" data-key="q" placeholder="Tìm tên môn học để tải tài liệu" value="${esc(ctx.query.q || '')}"></label></div>
    <div class="card list">${items.map((course) => `<div class="list-row">
      <a class="doc-main" href="#/tai-lieu/${course.id}"><span class="doc-title">${dot(course.color)} <strong>${esc(course.name)}</strong></span><span class="sub">${course.docCount} tài liệu${course.updatedAt ? ` · cập nhật ${formatAgo(course.updatedAt, ctx.now)}` : ''}</span></a>
      <label class="btn btn-soft file-btn">Chọn tệp<input type="file" hidden multiple data-act="upload" data-id="${course.id}" accept=".pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg,.txt,.md"></label>
    </div>`).join('') || '<p class="muted pad">Không có môn phù hợp</p>'}</div>`
}

export function renderDocs(ctx) {
  const course = ctx.view.courses.find((item) => item.id === ctx.route.id)
  if (!course) return { title: 'Tài liệu', html: empty('Không thấy môn học', 'Môn này đã bị xóa.') }
  const q = foldSafe(ctx.query.q)
  const old = ctx.query.sort === 'old'
  let docs = ctx.data.documents.filter((doc) => doc.courseId === course.id && (!q || foldSafe(doc.name).includes(q)))
  docs.sort((a, b) => old ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt)
  return {
    title: course.name,
    crumb: '<a href="#/mon-hoc?tab=tailieu">Môn học</a> · Tài liệu học tập',
    back: '#/mon-hoc?tab=tailieu',
    html: `<label class="dropzone" data-drop="${course.id}"><input type="file" hidden multiple data-act="upload" data-id="${course.id}"><strong>Kéo thả tệp vào đây hoặc bấm để chọn</strong><span>PDF, slide, Word, ảnh, ghi chú. AI dùng các tệp này khi gợi ý cách làm.</span></label>
      <div class="tools-row">
        <label class="search">${icon('search', 18)}<input class="input" data-live="query" data-key="q" placeholder="Tìm tên tài liệu" value="${esc(ctx.query.q || '')}"></label>
        <select class="select" data-live="query" data-key="sort">${opts([['new', 'Mới nhất → cũ nhất'], ['old', 'Cũ nhất → mới nhất']], old ? 'old' : 'new')}</select>
      </div>
      <div class="card list">${docs.map((doc) => `<div class="list-row"><button class="doc-open" type="button" data-act="view-doc" data-id="${doc.id}"><span class="doc-title">${icon(doc.type === 'Ảnh' ? 'image' : doc.type === 'Slide' ? 'slides' : doc.type === 'Ghi chú' ? 'note' : 'file', 18)} <strong>${esc(doc.name)}</strong></span><span class="sub">${esc(doc.type)} · ${formatBytes(doc.size)} · ${formatAgo(doc.updatedAt, ctx.now)} · Xem</span></button><button class="icon-btn" type="button" data-act="del-doc" data-id="${doc.id}" aria-label="Xóa">${icon('trash', 18)}</button></div>`).join('') || '<p class="muted pad">Chưa có tài liệu</p>'}</div>`,
  }
}

export function renderCourseDetail(ctx) {
  const course = ctx.view.courses.find((item) => item.id === ctx.route.id)
  if (!course) return { title: 'Môn học', html: empty('Không thấy môn học', 'Môn này đã bị xóa.') }
  const plans = ctx.view.plans.filter((plan) => plan.courseId === course.id)
  return {
    title: course.name,
    crumb: '<a href="#/mon-hoc">Môn học</a>',
    back: '#/mon-hoc',
    actions: `<a class="btn btn-ghost" href="#/mon/${course.id}/sua">Sửa</a>`,
    html: `<div class="detail">
      <div class="stack">
        <section class="card course-hero" style="--accent:${accent(course.color)}">${pill(course.status)}<h2>${esc(course.name)}</h2><p class="sub num">${formatISO(course.start)} – ${formatISO(course.end)}</p></section>
        <section class="card pad"><h2>Yêu cầu đầu ra</h2>${outlineHtml(course.output)}${course.notes ? `<h2>Ghi chú</h2><p>${esc(course.notes)}</p>` : ''}</section>
        <section class="card pad">
          <div class="block-head"><h2>Kế hoạch của môn</h2>${plans.length ? '' : `<a class="btn btn-primary" href="#/ke-hoach/ai?mon=${course.id}">${icon('sparkles', 16)} Tạo bằng AI</a>`}</div>
          ${impactBanners(plans, course, ctx)}
          ${plans.length ? plans.map((plan) => coursePlan(plan, ctx.now)).join('') : '<p class="muted">Chưa có kế hoạch</p>'}
        </section>
      </div>
      <aside class="stack">
        <section class="card pad"><div class="block-head"><h2>Lịch học cố định</h2><a href="#/mon/${course.id}/sua">Sửa</a></div>${scheduleClashNote(ctx, course)}${(course.schedule || []).map((slot) => `<p class="num">${weekdayLabel(slot.weekday, true)} · ${esc(slot.start)}–${esc(slot.end)}${slotPeriod(slot)}${slot.room ? ` · ${esc(slot.room)}` : ''}</p>`).join('') || '<p class="muted">Chưa khai báo buổi học</p>'}</section>
        <section class="card pad"><div class="block-head"><h2>Tài liệu học tập</h2><a href="#/tai-lieu/${course.id}">Quản lý</a></div><p class="sub">${course.docCount} tài liệu</p></section>
        <button class="link-danger" type="button" data-act="del-course" data-id="${course.id}">Xóa môn học</button>
      </aside>
    </div>`,
  }
}

function slotPeriod(slot) {
  if (slot.repeat === 'biweek') return slot.from ? ` · cách tuần từ ${formatISO(slot.from)}` : ' · cách tuần'
  if (slot.repeat === 'once') return slot.from ? ` · ${formatISO(slot.from)}` : ' · một buổi'
  if (slot.from && slot.until) return ` · ${formatISO(slot.from)} – ${formatISO(slot.until)}`
  if (slot.from) return ` · từ ${formatISO(slot.from)}`
  if (slot.until) return ` · đến ${formatISO(slot.until)}`
  return ''
}

function scheduleClashNote(ctx, course) {
  const notes = classOverlaps(ctx.data.courses).filter((item) => item.aId === course.id || item.bId === course.id)
  if (!notes.length) return ''
  return banner('bad', 'Lịch học cố định đang trùng giờ', esc(notes.map((item) => item.text).join(' ')), `<a class="btn btn-primary" href="#/mon/${course.id}/sua">Sửa lịch</a>`)
}

function impactBanners(plans, course, ctx) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(course?.start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(course?.end || '')) return ''
  return plans.map((plan) => {
    const reasons = courseWindowWarnings(plan, course, ctx.data, ctx.now)
    if (!reasons.length) return ''
    return banner('warn', 'Kế hoạch bị ảnh hưởng', reasons.join(' '), `<a class="btn btn-primary" href="#/ke-hoach/ai?sua=${plan.id}">Chỉnh sửa kế hoạch</a>`)
  }).join('')
}
function outlineHtml(text) {
  const sections = parseOutput(text)
  if (!sections.length) return '<p class="muted">Chưa có yêu cầu đầu ra</p>'
  return `<div class="outline">${sections.map((section) => `${section.title ? `<h3>${esc(sentenceCase(section.title))}</h3>` : ''}<ul>${section.items.map((item) => `<li><strong>${esc(sentenceCase(item.name))}</strong>${item.detail ? `<span class="sub">${esc(item.detail)}</span>` : ''}</li>`).join('')}</ul>`).join('')}</div>`
}
export function renderCourseForm(ctx) {
  const form = ctx.form
  const editing = !!form.id
  const e = form.errors || {}
  return {
    title: editing ? 'Sửa môn học' : 'Thêm môn học',
    back: editing ? `#/mon/${form.id}` : '#/mon-hoc',
    html: `<form class="narrow stack" data-act="save-course" data-key="${form.id ? `c:${form.id}` : 'course-new'}">
      <section class="card pad stack">
        <h2>Thông tin môn học</h2>
        ${field('Tên môn học', `<input class="input ${e.name ? 'bad' : ''}" name="name" value="${esc(form.name || '')}">`, e.name, true)}
        <div class="two">${field('Ngày bắt đầu', dateBox('start', form.start, !!e.start), e.start, true)}${field('Ngày kết thúc', dateBox('end', form.end, !!e.end), e.end, true)}</div>
        ${field('Yêu cầu đầu ra', `<textarea class="input" name="output" rows="12" placeholder="Ví dụ: Viết báo cáo 15 trang và thiết kế 20 slide thuyết trình.\nMỗi đầu mục một dòng nếu muốn nhóm.\n\nPHẦN 1 — PROBLEM SPACE\nProblem Space: Bối cảnh và phạm vi đề tài.">${esc(form.output || '')}</textarea>`)}
        ${editing ? impactBanners(ctx.data.plans.filter((plan) => plan.courseId === form.id), form, ctx) : ''}
        ${field('Ghi chú', `<textarea class="input" name="notes" rows="2">${esc(form.notes || '')}</textarea>`)}
        <p>Màu hiển thị</p>
        <div class="color-row">
          <label class="color-wheel" title="Chọn màu tùy chỉnh"><input type="color" value="${esc(swatch(form.color))}" data-act="pick-custom" aria-label="Chọn màu tùy chỉnh"><span class="color-wheel-plus" aria-hidden="true">${icon('plus', 14)}</span></label>
          <span class="color-now"><i style="--accent:${accent(form.color)}"></i><span class="num">${esc(swatch(form.color).toUpperCase())}</span></span>
        </div>
      </section>
      <section class="card pad">
        <div class="block-head"><h2>Lịch học cố định trên trường</h2><button class="btn btn-ghost" type="button" data-act="add-sch">+ Thêm buổi</button></div>
        <p class="fine">Cùng thứ, cùng giờ thì chọn <strong>Cách tuần</strong>: hệ thống tự xếp lệch tuần (tuần này UX/UI, tuần sau BA). Trùng lịch hàng tuần hoặc một buổi mới bị chặn.</p>
        ${(form.schedule || []).map((row, index) => `<div class="slot-form">
          <select class="select" data-field="sch-day" data-id="${index}">${opts(WEEKDAYS.map((day) => [day.id, day.short]), row.weekday)}</select>
          <input class="input" type="time" data-field="sch-start" data-id="${index}" value="${esc(row.start || '07:00')}">
          <input class="input" type="time" data-field="sch-end" data-id="${index}" value="${esc(row.end || '09:30')}">
          <input class="input" data-field="sch-room" data-id="${index}" placeholder="Phòng/hình thức" value="${esc(row.room || '')}">
          <button class="icon-btn" type="button" data-act="del-sch" data-id="${index}" aria-label="Xóa buổi">${icon('x', 16)}</button>
          <div class="slot-span">
            <select class="select" data-field="sch-repeat" data-id="${index}">${opts([['week', 'Mỗi tuần'], ['biweek', 'Cách tuần'], ['once', 'Chỉ một buổi']], row.repeat || 'week')}</select>
            ${wrapDate(`<input class="input" data-field="sch-from" data-id="${index}" placeholder="Buổi đầu tiên" inputmode="numeric" value="${row.from ? showDate(row.from) : ''}">`, row.from || '')}
            ${wrapDate(`<input class="input" data-field="sch-until" data-id="${index}" placeholder="Đến ngày · hết môn" inputmode="numeric" value="${row.until ? showDate(row.until) : ''}">`, row.until || '')}
          </div>
        </div>`).join('') || '<p class="muted">Chưa có buổi học</p>'}
        ${form.scheduleHint ? `<p class="fine">${esc(form.scheduleHint)}</p>` : ''}
        ${e.schedule ? `<p class="err">${esc(e.schedule)}</p>` : ''}
      </section>
      <div class="form-foot"><a class="btn btn-ghost" href="${editing ? `#/mon/${form.id}` : '#/mon-hoc'}">Hủy</a><button class="btn btn-primary" type="submit">${editing ? 'Lưu thay đổi' : 'Thêm môn học'}</button></div>
    </form>`,
  }
}

export { formatHours, formatSpan }
