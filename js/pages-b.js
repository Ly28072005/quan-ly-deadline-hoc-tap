import { atTime, clock, dateISO, formatDMY, formatHours, formatSession, formatSpan, formatWhen, isoOf, parseStamp, showDate, showStamp } from './format.js'
import { STATUS, courseWindowWarnings, isParent, leafTasks, openHours, parseOutput, planStats, proposeFix, recommendedHoursForTask, reviewTasks, scheduleLoad, sentenceCase, taskHours, taskStatus } from './model.js?v=71'
import { accent, banner, dateBox, dot, empty, esc, field, icon, opts, pill, progress, timeBox, wrapDate } from './html.js?v=71'

const ORDER = { overdue: 0, doing: 1, todo: 2, done: 3 }

export function renderPlans(ctx) {
  const q = fold(ctx.query.q)
  const courseId = ctx.query.mon || 'all'
  const status = ctx.query.trang || 'all'
  let items = ctx.view.plans.filter((plan) => {
    const blob = fold(`${plan.name} ${plan.tasks.map((task) => task.name).join(' ')}`)
    return (!q || blob.includes(q)) && (courseId === 'all' || plan.courseId === courseId) && (status === 'all' || plan.stats.status === status)
  })
  items.sort((a, b) => ORDER[a.stats.status] - ORDER[b.stats.status] || a.deadline - b.deadline)
  return {
    title: 'Kế hoạch',
    actions: `<a class="btn btn-ghost" href="#/ke-hoach/tao">+ Tạo kế hoạch</a><a class="btn btn-primary" href="#/ke-hoach/ai">${icon('sparkles', 16)} Tạo bằng AI</a>`,
    html: `<section class="card pad">
      <div class="block-head"><h2>Danh sách kế hoạch</h2></div>
      <div class="tools-row">
        <label class="search">${icon('search', 18)}<input class="input" data-live="query" data-key="q" placeholder="Tìm kế hoạch, nhiệm vụ" value="${esc(ctx.query.q || '')}"></label>
        <select class="select" data-live="query" data-key="mon">${opts([['all', 'Tất cả môn học'], ...ctx.view.courses.map((course) => [course.id, course.name])], courseId)}</select>
        <select class="select" data-live="query" data-key="trang">${opts([['all', 'Tất cả trạng thái'], ['todo', 'Chưa thực hiện'], ['doing', 'Đang thực hiện'], ['done', 'Hoàn thành'], ['overdue', 'Quá hạn']], status)}</select>
      </div>
      <div class="plan-list">${items.map((plan) => planRow(plan)).join('') || '<p class="muted">Không có kế hoạch phù hợp</p>'}</div>
    </section>`,
  }
}

function planRow(plan) {
  return `<article class="plan-row">
    <span class="status-orb ${plan.stats.status}">${orb(plan.stats.status)}</span>
    <a class="plan-main" href="#/ke-hoach/${plan.id}">
      <strong>${esc(plan.name)}</strong>
      <span class="meta">${plan.course ? `<span class="course-label" style="--accent:${accent(plan.course.color)}">${esc(plan.course.name)}</span>` : '<em>Không gắn môn</em>'} <span class="num">Hạn ${formatWhen(plan.deadline)}</span></span>
    </a>
    <span class="plan-meter">${progress(plan.stats.ratio, plan.stats.status === 'overdue')}</span>
    ${pill(plan.stats.status)}
    <button class="icon-btn" type="button" data-act="del-plan" data-id="${plan.id}" aria-label="Xóa kế hoạch">${icon('trash', 18)}</button>
  </article>`
}

function orb(status) {
  if (status === 'done') return icon('check', 16)
  if (status === 'doing') return icon('clock', 16)
  if (status === 'overdue') return icon('alert', 16)
  return ''
}

export function renderPlanDetail(ctx) {
  const plan = ctx.view.plans.find((item) => item.id === ctx.route.id)
  if (!plan) return { title: 'Kế hoạch', html: empty('Không thấy kế hoạch', 'Kế hoạch này đã bị xóa.') }
  return {
    title: plan.name,
    crumb: '<a href="#/ke-hoach">Kế hoạch</a>',
    back: '#/ke-hoach',
    planHead: true,
    ask: plan.id,
    html: `<div class="detail plan-detail">
      <div class="stack">
        ${impactBanner(plan, ctx, `<a class="btn btn-primary" href="#/ke-hoach/ai?sua=${plan.id}">Chỉnh sửa kế hoạch</a>`)}
        <section class="card pad plan-progress">
          <div class="plan-tags">${pill(plan.stats.status)}</div>
          <div class="plan-hero">
            <b class="huge num">${Math.round(plan.stats.ratio * 100)}%</b>
            <div class="plan-meter-copy">
              ${progress(plan.stats.ratio, plan.stats.status === 'overdue', false)}
              <p class="sub">${plan.stats.done}/${plan.stats.total} nhiệm vụ</p>
            </div>
          </div>
        </section>
        <section class="card pad"><h2>Nhiệm vụ</h2>${taskTree(plan, ctx.now)}</section>
      </div>
      <aside class="stack">
        <section class="card pad">
          <h2>Thông tin</h2>
          <div class="facts">
            <div><span class="k">Môn học</span><b>${esc(plan.course?.name || 'Không gắn')}</b></div>
            <div><span class="k">Hạn nộp</span><b class="num">${formatWhen(plan.deadline)}</b></div>
            <div><span class="k">Tổng thời lượng</span><b class="num">${formatHours(plan.stats.hours)} giờ</b></div>
            <div><span class="k">Ngày tạo</span><b class="num">${formatWhen(plan.createdAt)}</b></div>
          </div>
          <h2 class="plan-next">Yêu cầu đầu ra</h2>
          ${outlineBlock(plan.course?.output)}
        </section>
        <a class="btn btn-ghost" href="${plan.source === 'manual' ? `#/ke-hoach/${plan.id}/sua` : `#/ke-hoach/ai?sua=${plan.id}`}">Chỉnh sửa kế hoạch</a>
        <button class="link-danger" type="button" data-act="del-plan" data-id="${plan.id}">Xóa kế hoạch</button>
      </aside>
    </div>`,
  }
}

function taskTree(plan, now) {
  const roots = plan.tasks.filter((task) => !task.parentId)
  return `<div class="tree">${roots.map((task) => {
    const kids = plan.tasks.filter((item) => item.parentId === task.id)
    if (!kids.length) return leafRow(task, now, false)
    const done = kids.length && kids.every((item) => item.status === 'done')
    return `<div class="tree-parent">
      <label class="check dash"><input type="checkbox" disabled ${done ? 'checked' : ''}><span></span></label>
      <div class="parent-copy"><strong>${esc(task.name)}</strong></div>
    </div>
    <div class="tree-kids">${kids.map((kid) => leafRow(kid, now, true)).join('')}</div>`
  }).join('')}</div>`
}

function leafRow(task, now, nested) {
  const view = taskStatus(task, now)
  const tone = view === 'overdue' ? 'overdue' : task.status
  return `<div class="tree-leaf ${nested ? 'nested' : ''}">
    <a href="#/nhiem-vu/${task.id}"><strong>${esc(task.name)}</strong>${task.start ? `<span class="task-facts"><span><span class="k">Bắt đầu</span><b class="num">${formatDMY(task.start)}</b><span class="num">${clock(task.start)}</span></span><span><span class="k">Kết thúc</span><b class="num">${formatDMY(task.end)}</b><span class="num">${clock(task.end)}</span></span><span><span class="k">Số giờ</span><b class="num">${formatHours(taskHours(task))} giờ</b></span></span>` : '<span class="sub">Chưa xếp giờ</span>'}</a>
    <div class="leaf-status"><select class="select status-select ${tone}" data-act="task-status" data-id="${task.id}" aria-label="Cập nhật trạng thái">${['todo', 'doing', 'done'].map((key) => `<option value="${key}" ${task.status === key ? 'selected' : ''}>${STATUS[key].label}</option>`).join('')}</select></div>
  </div>`
}

export function renderAi(ctx) {
  const ai = ctx.ai
  if (!ai) return { title: 'Tạo kế hoạch bằng AI', html: '' }
  if (ai.step === 2) {
    return {
      title: 'Tạo kế hoạch bằng AI',
      back: '#/ke-hoach',
      html: `<section class="card pad center-card"><span class="spin"></span><h2>AI đang chia nhiệm vụ</h2><p>AI đang viết kế hoạch… (${ai.chars || 0} ký tự)</p><button class="btn btn-ghost" type="button" data-act="ai-stop">${icon('stop', 14)} Dừng</button></section>`,
    }
  }
  if (ai.step === 3) return aiReview(ctx)
  const studying = ctx.view.courses.filter((course) => course.status === 'studying')
  const course = studying.find((item) => item.id === ai.courseId) || null
  const docs = ctx.data.documents.filter((doc) => doc.courseId === course?.id)
  const rangeErr = dateOrderError(ai.start, ai.date)
  const e = { ...(ai.errors || {}), ...(rangeErr ? { start: rangeErr, date: rangeErr } : {}) }
  const full = freeTimeGone(ctx.data, isoOf(ai.start), isoOf(ai.date), ai.time, ctx.now, ai.planId)
  return {
    title: ai.planId ? 'Chỉnh sửa kế hoạch' : 'Tạo kế hoạch bằng AI',
    back: '#/ke-hoach',
    html: `<form class="card pad stack narrow" data-act="ai-go">
        <h2>Thông tin kế hoạch</h2>
        <div class="two">
          ${field('Môn học', `<select class="select ${e.courseId ? 'bad' : ''}" name="courseId" data-act="ai-course">${opts([['', 'Chọn môn học'], ...studying.map((item) => [item.id, item.name])], course?.id || '')}</select>`, e.courseId, true)}
          ${field('Tên kế hoạch', `<input class="input ${e.name ? 'bad' : ''}" name="name" value="${esc(ai.name || '')}">`, e.name, true)}
        </div>
        <div class="three">
          ${field('Ngày bắt đầu', dateBox('start', ai.start, !!e.start), e.start, true)}
          ${field('Ngày kết thúc', dateBox('date', ai.date, !!e.date), e.date, true)}
          ${field('Giờ kết thúc', timeBox('time', ai.time, !!e.time), e.time, true)}
        </div>
        ${field('Yêu cầu đầu ra của môn đã chọn', `<textarea class="input ${e.output ? 'bad' : ''}" name="output" rows="8" placeholder="Ví dụ: Viết báo cáo 15 trang và thiết kế 20 slide thuyết trình.">${esc(ai.output || '')}</textarea>`, e.output)}
        <p class="fine">Mỗi phần được chia thành buổi 1–2 giờ. Mục nặng (báo cáo, persona, sơ đồ) nhận 2 giờ; mục vừa nhận 1 giờ. Các mục quá nhỏ trong cùng phần được gộp nếu không đủ 1 giờ/mục. Định mức: 45 phút/trang, 20 phút/slide, 30 phút/sơ đồ, 60–90 phút/chức năng.</p>
        ${full ? banner('bad', 'Không còn giờ rảnh', 'Các khung giờ rảnh đến hạn kế hoạch đã được xếp hết nhiệm vụ. Hãy bổ sung thời gian rảnh trước khi tạo kế hoạch.', `<a class="btn btn-primary" href="#/lich/ranh">Thêm giờ rảnh</a>`) : ''}
        ${e.free ? `<p class="err">${esc(e.free)} <a href="#/lich/ranh">Khai báo giờ rảnh</a></p>` : ''}
        ${e.schedule ? `<p class="err">${esc(e.schedule)}</p>` : ''}
        <p>Tài liệu cho AI tham khảo</p>
        ${docs.map((doc) => `<label class="check"><input type="checkbox" name="doc" value="${doc.id}" ${(ai.docIds || []).includes(doc.id) ? 'checked' : ''}> ${esc(doc.name)}</label>`).join('') || '<p class="muted">Môn này chưa có tài liệu</p>'}
        ${ai.planId ? impactBanner(aiPlan(ctx), ctx, `<button class="btn btn-primary" type="button" data-act="ai-rebuild">${icon('sparkles', 16)} Tạo lại bằng AI</button>`) : ''}
        <div class="form-foot"><a class="btn btn-ghost" href="#/ke-hoach">Hủy</a><button class="btn btn-primary" type="submit" ${full ? 'disabled' : ''}>${icon('sparkles', 16)} Tạo gợi ý kế hoạch</button></div>
      </form>`,
  }
}

function aiReview(ctx) {
  const ai = ctx.ai
  ctx = { ...ctx, data: { ...ctx.data, displaceAfter: ai.deadline || 0 } }
  const review = reviewTasks(ai.tasks, ctx.data, ai.deadline, ai.planId)
  const ghost = aiPlan(ctx)
  const load = scheduleLoad({
    ...ctx.data,
    plans: [...ctx.data.plans.filter((plan) => plan.id !== ai.planId), ghost].filter(Boolean),
  }, ctx.now)
  const locked = review.bad > 0
  const ok = review.tone === 'ok' && !load.short && !review.short
  const tone = review.tone === 'bad' ? 'bad' : 'warn'
  const extraCodes = review.rows.flatMap((row) => row.warnings.map((item) => item.code)).filter((code) => !['hours', 'free', 'missing', 'past'].includes(code))
  const onlyHoursFree = !extraCodes.length && review.rows.some((row) => row.warnings.length)
  const addFree = `<a class="btn btn-ghost" href="#/lich/ranh">Thêm giờ rảnh</a>`
  return {
    title: ai.planId ? 'Chỉnh sửa kế hoạch' : 'Kế hoạch đề xuất',
    back: '#/ke-hoach',
    foot: `<a class="btn btn-ghost" href="#/ke-hoach">Hủy</a><button class="btn btn-primary" type="button" data-act="ai-confirm" ${locked ? 'disabled' : ''}>${icon('check', 16)} Xác nhận kế hoạch</button>`,
    html: `${impactBanner(ghost, ctx, `<button class="btn btn-primary" type="button" data-act="ai-rebuild">${icon('sparkles', 16)} Tạo lại bằng AI</button>`)}
      ${ok ? `<p class="placed-note">Đã xếp ${formatHours(review.placed)} giờ.</p>` : ''}
      ${Number(ai.displaced) > 0 ? '<p class="fine">Khi xác nhận, lịch các môn hạn xa hơn sẽ được xếp lại để xen kẽ với môn hạn sớm.</p>' : ''}
      ${load.short ? banner('bad', `Thiếu ${formatHours(load.delta)} giờ rảnh`, `Cần ${formatHours(load.need)} giờ, quỹ rảnh còn ${formatHours(load.open)} giờ. Hãy thêm giờ rảnh, hệ thống sẽ xếp vào khung trống còn lại.`, addFree) : ''}
      ${review.short && !load.short ? banner('warn', 'Tổng thời gian học vượt quá thời gian rảnh', `Cần thêm ${formatHours(review.need - review.open)} giờ rảnh hoặc bớt nhiệm vụ.`, addFree) : ''}
      ${!ok && review.tone !== 'ok' && !load.short && !review.short && !onlyHoursFree ? banner(tone, review.title, `${leafTasks(ai.tasks).length} nhiệm vụ · đã xếp ${formatHours(review.placed)} giờ / cần ${formatHours(review.need)} giờ · hạn ${formatWhen(ai.deadline)} ${clock(ai.deadline)}`, addFree) : ''}
      <section class="card pad">
        <div class="task-table">
          <div class="tr head"><span>#</span><span>Nhiệm vụ</span><span>Cần (giờ)</span><span>Ngày</span><span>Bắt đầu</span><span>Kết thúc</span><span></span></div>
          ${reviewRows(ai.tasks, { ...ctx, planShort: load.short, warnMap: new Map(review.rows.map((row) => [row.task.id, row.warnings])) })}
        </div>
        <button class="btn btn-ghost" type="button" data-act="ai-add">+ Thêm nhiệm vụ</button>
      </section>`,
  }
}

function outlineBlock(text) {
  const sections = parseOutput(text)
  if (!sections.length) return '<p class="muted">Chưa có yêu cầu đầu ra</p>'
  return `<div class="outline">${sections.map((section) => `${section.title ? `<h3>${esc(sentenceCase(section.title))}</h3>` : ''}<ul>${section.items.map((item) => `<li><strong>${esc(sentenceCase(item.name))}</strong>${item.detail ? `<span class="sub">${esc(item.detail)}</span>` : ''}</li>`).join('')}</ul>`).join('')}</div>`
}
function reviewRows(tasks, ctx) {
  const leaves = tasks.filter((task) => !isParent(task, tasks))
  const parents = tasks.filter((task) => isParent(task, tasks))
  const planShort = !!ctx.planShort
  const pendingId = ctx.ai?.pendingHours?.id || ''
  const warnMap = ctx.warnMap || null
  const typingHours = ctx.ai?.typingHours || null
  const course = (ctx.data.courses || []).find((item) => item.id === ctx.ai?.courseId)
  const floor = course?.start ? atTime(course.start, '00:00') : 0
  if (floor) ctx = { ...ctx, data: { ...ctx.data, floor } }
  if (!parents.length) return leaves.map((task, index) => taskEditor(task, index, tasks, ctx.data, ctx.ai.deadline, ctx.ai.planId, planShort, pendingId, warnMap, typingHours)).join('')
  let index = 0
  const seen = new Set()
  const chunks = []
  for (const parent of parents) {
    chunks.push(`<p class="k">${esc(parent.name)}</p>`)
    for (const task of leaves.filter((item) => item.parentId === parent.id)) {
      seen.add(task.id)
      chunks.push(taskEditor(task, index, tasks, ctx.data, ctx.ai.deadline, ctx.ai.planId, planShort, pendingId, warnMap, typingHours))
      index += 1
    }
  }
  for (const task of leaves) {
    if (seen.has(task.id)) continue
    chunks.push(taskEditor(task, index, tasks, ctx.data, ctx.ai.deadline, ctx.ai.planId, planShort, pendingId, warnMap, typingHours))
    index += 1
  }
  return chunks.join('')
}
function fixAction(task, fix) {
  if (!fix) return ''
  if (fix.kind === 'free') return `<a class="btn btn-ghost" href="#/lich/ranh">Thêm giờ rảnh</a>`
  const stamp = fix.start ? ` data-start="${fix.start}" data-end="${fix.end}"` : ''
  return `<button type="button" data-act="ai-fix" data-id="${task.id}"${stamp}>${esc(fix.label)}</button>`
}

function freeNeedText(task, hours) {
  const need = Number(task.needFree) > 0 ? Number(task.needFree) : hours
  return `Quỹ thời gian rảnh không đủ ${formatHours(hours)} giờ cho nhiệm vụ này (thiếu ${formatHours(need)} giờ rảnh). Hãy bổ sung thêm thời gian rảnh.`
}

function taskEditor(task, index, tasks, data, deadline, ignorePlanId, planShort = false, pendingId = '', warnMap = null, typingHours = null) {
  const warnings = warnMap ? (warnMap.get(task.id) || []) : taskWarningsOf(task, tasks, data, deadline, ignorePlanId)
  const fix = warnings.length ? ctxFix(task, tasks, data, deadline, ignorePlanId) : null
  const rawHours = task.hours !== undefined && task.hours !== null && task.hours !== '' ? Number(task.hours) : 1
  const hours = Number.isFinite(rawHours) ? rawHours : 0
  const rec = recommendedHoursForTask(task)
  const zeroHours = !(hours > 0)
  const overlapForeign = warnings.find((item) => item.code === 'overlap-foreign' || item.code === 'class')
  const overlapSame = warnings.find((item) => item.code === 'overlap')
  const needFree = fix?.kind === 'free' || Number(task.needFree) > 0 || warnings.some((item) => item.code === 'free')
  const alertList = []

  if (zeroHours) {
    alertList.push(`<div class="alert-strip bad">Thời lượng nhiệm vụ phải lớn hơn 0 giờ (tối thiểu 0,5 giờ).<button type="button" data-act="ai-set-hours" data-id="${task.id}" data-hours="${rec}">Đặt lại ${formatHours(rec)}h</button></div>`)
  } else if (overlapForeign) {
    if (fix && fix.kind === 'move' && !(Number(task.needFree) > 0)) {
      alertList.push(`<div class="alert-strip bad">${esc(overlapForeign.text)}${fixAction(task, fix)}</div>`)
    } else {
      alertList.push(`<div class="alert-strip bad">${esc(overlapForeign.text)} Quỹ thời gian rảnh không còn khung trống ${formatHours(hours)}h.<a class="btn btn-ghost" href="#/lich/ranh">Thêm giờ rảnh</a></div>`)
    }
  } else if (needFree) {
    if (fix && fix.kind === 'move' && !(Number(task.needFree) > 0)) {
      const freeWarn = warnings.find((item) => item.code === 'free')?.text || `Khung hiện tại không đủ ${formatHours(hours)} giờ rảnh.`
      alertList.push(`<div class="alert-strip bad">${esc(freeWarn)}${fixAction(task, fix)}</div>`)
    } else {
      alertList.push(`<div class="alert-strip bad">${esc(freeNeedText(task, hours))}<a class="btn btn-ghost" href="#/lich/ranh">Thêm giờ rảnh</a></div>`)
    }
  } else if (overlapSame) {
    alertList.push(`<div class="alert-strip bad">${esc(overlapSame.text)}${fix ? fixAction(task, fix) : ''}</div>`)
  } else if (warnings.length) {
    const visible = planShort && pendingId !== task.id
      ? warnings.filter((item) => item.code !== 'missing')
      : warnings
    visible.forEach((item, n) => {
      alertList.push(`<div class="alert-strip ${item.level}">${esc(item.text)}${n === 0 && fix ? fixAction(task, fix) : ''}</div>`)
    })
  }

  if (!zeroHours && task.userAdjustedHours && hours > rec + 0.05) {
    alertList.push(`<div class="alert-strip info">🤖 Gợi ý AI: Nhiệm vụ “${esc(task.name)}” theo độ khó chỉ cần khoảng ${formatHours(rec)} giờ làm.<button type="button" data-act="ai-set-hours" data-id="${task.id}" data-hours="${rec}">Đặt ${formatHours(rec)} giờ</button></div>`)
  }

  const strips = alertList.join('')
  const badBox = zeroHours || warnings.some((item) => item.level === 'bad') ? ' bad' : ''
  const shownHours = typingHours?.id === task.id ? typingHours.raw : formatHours(hours)
  const hoursInput = `<div class="hours-stepper${badBox}">
    <button class="step-btn" type="button" data-act="hours-step" data-id="${task.id}" data-dir="-1" title="Giảm 0,5 giờ" aria-label="Giảm 0.5h">−</button>
    <input class="input hours-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-act="ai-field" data-id="${task.id}" data-key="hours" value="${esc(shownHours)}" aria-label="Số giờ">
    <button class="step-btn" type="button" data-act="hours-step" data-id="${task.id}" data-dir="1" title="Tăng 0,5 giờ" aria-label="Tăng 0.5h">+</button>
  </div>`
  return `<div class="tr">
    <span class="num">${index + 1}</span>
    <input class="input" data-act="ai-field" data-id="${task.id}" data-key="name" value="${esc(task.name)}">
    ${hoursInput}
    ${wrapDate(`<input class="input" data-act="ai-field" data-id="${task.id}" data-key="date" placeholder="dd/mm/yyyy" inputmode="numeric" value="${task.start ? showDate(dateISO(task.start)) : ''}">`, task.start ? dateISO(task.start) : '')}
    <input class="input" type="time" data-act="ai-field" data-id="${task.id}" data-key="start" value="${task.start ? clock(task.start) : ''}">
    <input class="input" type="time" data-act="ai-field" data-id="${task.id}" data-key="end" value="${task.end ? clock(task.end) : ''}">
    <button class="icon-btn" type="button" data-act="ai-del" data-id="${task.id}" aria-label="Xóa">${icon('x', 16)}</button>
  </div>${strips}`
}

function taskWarningsOf(task, tasks, data, deadline, ignorePlanId) {
  return reviewTasks(tasks, data, deadline, ignorePlanId).rows.find((row) => row.task.id === task.id)?.warnings || []
}

function ctxFix(task, tasks, data, deadline, ignorePlanId) {
  return proposeFix(task, tasks, data, deadline, ignorePlanId)
}

export function renderManual(ctx) {
  const form = ctx.manual
  if (!form) return { title: 'Tạo kế hoạch', html: '' }
  const editing = !!form.id
  const e = form.errors || {}
  const review = reviewManual(form, ctx)
  const full = !editing && freeTimeGone(ctx.data, '', form.date, form.time, ctx.now, form.id)
  const notes = review.rows.flatMap((row) => row.warnings).filter((item) => item.code !== 'missing')
  const badNotes = notes.filter((item) => item.level === 'bad')
  const warnNotes = notes.filter((item) => item.level === 'warn')
  return {
    title: editing ? 'Chỉnh sửa kế hoạch' : 'Tạo kế hoạch',
    back: editing ? `#/ke-hoach/${form.id}` : '#/ke-hoach',
    foot: `<a class="btn btn-ghost" href="${editing ? `#/ke-hoach/${form.id}` : '#/ke-hoach'}">Hủy</a><button class="btn btn-primary" type="button" data-act="manual-save" ${full ? 'disabled' : ''}>${icon('check', 16)} ${editing ? 'Lưu kế hoạch' : 'Tạo kế hoạch'}</button>`,
    html: `<form class="stack" data-act="manual-save" data-key="${form.id ? `e:${form.id}` : 'new'}">
      ${editing ? impactBanner(ctx.data.plans.find((item) => item.id === form.id), ctx, `<a class="btn btn-primary" href="#/ke-hoach/ai?sua=${form.id}">Tạo lại bằng AI</a>`) : ''}
      ${full ? banner('bad', 'Không còn giờ rảnh', 'Các khung giờ rảnh đến hạn kế hoạch đã được xếp hết nhiệm vụ. Hãy bổ sung thời gian rảnh trước khi tạo kế hoạch.', `<a class="btn btn-primary" href="#/lich/ranh">Thêm giờ rảnh</a>`) : ''}
      ${review.short ? banner('warn', 'Tổng thời gian học vượt quá thời gian rảnh', 'Vui lòng thêm giờ rảnh hoặc bớt nhiệm vụ.', `<a class="btn btn-ghost" href="#/lich/ranh">Thêm giờ rảnh</a>`) : ''}
      <section class="card pad stack">
        <h2>Thông tin kế hoạch</h2>
        <div class="two">
          ${field('Tên kế hoạch', `<input class="input ${e.name ? 'bad' : ''}" name="name" value="${esc(form.name || '')}">`, e.name, true)}
          ${field('Môn học', `<select class="select" name="courseId">${opts([['', 'Không gắn môn học'], ...ctx.view.courses.map((course) => [course.id, course.name])], form.courseId || '')}</select>`)}
        </div>
        <div class="two">
          ${field('Deadline', dateBox('date', form.date, !!e.date), e.date, true)}
          ${field('Giờ nộp', timeBox('time', form.time, !!e.time), e.time, true)}
        </div>
        ${e.free ? `<p class="err">${esc(e.free)} <a href="#/lich/ranh">Thêm giờ rảnh</a></p>` : ''}
      </section>
      <section class="card pad">
        <div class="block-head"><h2>Yêu cầu đầu ra</h2><span class="fine">Mỗi dòng có ngày bắt đầu và ngày kết thúc</span></div>
        ${e.tasks ? `<p class="err">${esc(e.tasks)}</p>` : ''}
        ${badNotes.length ? banner('bad', 'Giờ hoặc ngày chưa hợp lý', badNotes.map((item) => item.text).join(' ')) : ''}
        ${warnNotes.length ? banner('warn', 'Lưu ý về giờ và ngày', warnNotes.map((item) => item.text).join(' ')) : ''}
        ${(form.tasks || []).filter((task) => !task.parentId).map((parent) => parentBlock(parent, form, ctx, review)).join('')}
        <button class="symbol-add" type="button" data-act="add-parent" aria-label="Thêm dòng" title="Thêm dòng">+</button>
      </section>
    </form>`,
  }
}

function aiPlan(ctx) {
  const ai = ctx.ai
  if (!ai?.courseId) return null
  return { id: ai.planId || 'draft', courseId: ai.courseId, deadline: ai.deadline, source: 'ai', tasks: ai.tasks || [] }
}
function impactBanner(plan, ctx, action) {
  if (!plan?.courseId) return ''
  const course = ctx.data.courses.find((item) => item.id === plan.courseId)
  if (!course) return ''
  const reasons = courseWindowWarnings(plan, course, ctx.data, ctx.now)
  if (!reasons.length) return ''
  return banner('warn', 'Kế hoạch bị ảnh hưởng', reasons.join(' '), action || '')
}
function freeTimeGone(data, start, end, time, now, ignorePlanId = '') {
  const endDay = isoOf(end)
  if (!endDay) return false
  const startDay = isoOf(start)
  const from = Math.max(now, startDay ? atTime(startDay, '00:00') : now)
  const until = atTime(endDay, time || '23:59')
  if (!(until > from)) return false
  return openHours(data, from, until, ignorePlanId || '', until) < 0.5
}

function reviewManual(form, ctx) {
  const tasks = materialize(form)
  const course = ctx.data.courses.find((item) => item.id === form.courseId) || null
  return reviewTasks(tasks, ctx.data, deadlineOf(form), form.id, course)
}

function dateIsoOf(value) {
  const text = String(value || '')
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  return isoOf(showStamp(text).split(' ')[0] || text)
}

function dateOrderError(start, end) {
  const from = isoOf(start)
  const until = isoOf(end)
  if (from && until && until < from) return 'Ngày bắt đầu phải trước ngày kết thúc.'
  return ''
}

function parentBlock(parent, form, ctx, review) {
  const kids = (form.tasks || []).filter((task) => task.parentId === parent.id)
  const startTs = stampTime(parent.start)
  const endTs = stampTime(parent.end)
  const inverted = startTs && endTs && endTs <= startTs
  return `<div class="parent-block">
    <div class="parent-head">
      <input class="input" data-act="man-field" data-id="${parent.id}" data-key="name" value="${esc(parent.name || '')}" placeholder="Nhập tên">
      ${wrapDate(`<input class="input${inverted ? ' bad' : ''}" data-act="man-field" data-id="${parent.id}" data-key="start" placeholder="dd/mm/yyyy hh:mm" value="${esc(showStamp(parent.start))}" aria-label="Bắt đầu">`, dateIsoOf(parent.start))}
      ${wrapDate(`<input class="input${inverted ? ' bad' : ''}" data-act="man-field" data-id="${parent.id}" data-key="end" placeholder="dd/mm/yyyy hh:mm" value="${esc(showStamp(parent.end))}" aria-label="Kết thúc">`, dateIsoOf(parent.end))}
      <button class="icon-btn" type="button" data-act="del-node" data-id="${parent.id}" aria-label="Xóa mục">${icon('trash', 16)}</button>
    </div>
    ${inverted ? '<p class="err">Ngày bắt đầu phải trước ngày kết thúc.</p>' : kids.length ? '' : kidWarn(parent, form, ctx, review)}
    ${kids.map((kid) => `<div class="child-row"><span class="elbow"></span>
      <input class="input" data-act="man-field" data-id="${kid.id}" data-key="name" value="${esc(kid.name || '')}" placeholder="Nhập tên">
      ${wrapDate(`<input class="input" data-act="man-field" data-id="${kid.id}" data-key="date" placeholder="dd/mm/yyyy" inputmode="numeric" value="${esc(showDate(kid.date))}" aria-label="Ngày">`, isoOf(kid.date))}
      <input class="input" type="time" data-act="man-field" data-id="${kid.id}" data-key="start" value="${esc(kid.start || '')}">
      <input class="input" type="time" data-act="man-field" data-id="${kid.id}" data-key="end" value="${esc(kid.end || '')}">
      <button class="icon-btn" type="button" data-act="del-node" data-id="${kid.id}" aria-label="Xóa mục con">${icon('x', 16)}</button>
      ${kidWarn(kid, form, ctx, review)}
    </div>`).join('')}
    <button class="symbol-add tiny" type="button" data-act="add-child" data-id="${parent.id}" aria-label="Thêm dòng con" title="Thêm dòng con">+</button>
  </div>`
}

function kidWarn(kid, form, ctx, review) {
  if (!review) return ''
  const tasks = materialize(form)
  const row = review.rows.find((item) => item.task.id === kid.id)
  const shown = (row?.warnings || []).filter((item) => item.code !== 'missing')
  if (!shown.length) return ''
  const fix = proposeFix(row.task, tasks, ctx.data, deadlineOf(form), form.id)
  return `<div class="child-warn">${shown.map((item, index) => `<div class="alert-strip ${item.level}">${esc(item.text)}${index === 0 && fix ? `<button type="button" data-act="man-fix" data-id="${kid.id}">${esc(fix.label)}</button>` : ''}</div>`).join('')}</div>`
}

function stampOf(value) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.slice(0, 16)
  return parseStamp(value)
}
function stampTime(value) {
  const stamp = stampOf(value)
  if (!stamp) return 0
  return atTime(stamp.slice(0, 10), stamp.slice(11, 16))
}

export function manualIssues(form) {
  const errors = {}
  for (const task of form.tasks || []) {
    if (!String(task.name || '').trim()) {
      errors.tasks = 'Nhập tên cho từng đầu mục.'
      break
    }
    if (!task.parentId) {
      const start = stampTime(task.start)
      const end = stampTime(task.end)
      if (!start || !end) { errors.tasks = 'Nhập đủ ngày bắt đầu và ngày kết thúc của từng đầu mục.'; break }
      if (end <= start) { errors.tasks = 'Ngày kết thúc phải sau ngày bắt đầu.'; break }
    } else {
      const day = isoOf(task.date)
      if (!day || !task.start || !task.end) { errors.tasks = 'Nhập đủ ngày và giờ của từng đầu mục.'; break }
      if (atTime(day, task.end) <= atTime(day, task.start)) { errors.tasks = 'Giờ kết thúc phải sau giờ bắt đầu.'; break }
    }
  }
  return errors
}

export function materialize(form) {
  return (form.tasks || []).map((task) => {
    if (!task.parentId) {
      const start = stampTime(task.start)
      const end = stampTime(task.end)
      return { ...task, start, end, hours: start && end ? (end - start) / 3600000 : 1, status: task.status || 'todo', files: task.files || [] }
    }
    const day = isoOf(task.date)
    const start = day && task.start ? atTime(day, task.start) : 0
    const end = day && task.end ? atTime(day, task.end) : 0
    return { ...task, start, end, hours: task.hours || (start && end ? (end - start) / 3600000 : 1), status: task.status || 'todo', files: task.files || [] }
  })
}

export function deadlineOf(form) {
  const day = isoOf(form.date)
  if (!day) return 0
  return atTime(day, form.time || '23:59')
}

function fold(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export { leafTasks, planStats, formatSpan }
