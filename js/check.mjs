import { atTime } from './format.js'
import { auditDemo, buildView, createDemo, proposeSchedule, weekChart } from './model.js'

const now = atTime('2026-10-30', '11:15')
const data = createDemo(now)
const problems = auditDemo(data, now)
const view = buildView(data, now)
const chart = weekChart(view.plans, now)
console.log('weekday', new Date(now).getDay())
console.log('audit', problems)
console.log('plans', view.plans.map((plan) => [plan.assignment.name, plan.status, Math.round(plan.progress.ratio * 100)]))
console.log('adjust', view.adjustPlans.map((plan) => plan.assignment.name))
console.log('unplanned', view.unplanned.map((item) => item.name))
console.log('chart', chart.tasksDone, chart.tasksAll, chart.backlog, chart.days.map((day) => [day.planned, day.done]))
console.log('stats', view.stats)
console.log('notices', data.notices.map((item) => item.type + ' ' + item.title))

const tight = proposeSchedule({
  tasks: [
    { id: 'a', name: 'A', hours: 4, milestone: '2026-11-01', status: 'todo', actual: 0, sessions: [] },
    { id: 'b', name: 'B', hours: 2, milestone: '2026-11-01', status: 'todo', actual: 0, sessions: [] },
  ],
  freeSlots: data.freeSlots,
  courses: data.courses,
  otherSessions: [],
  deadline: atTime('2026-11-15', '23:59'),
  fromTs: now,
})
console.log('tight feasible', tight.feasible, tight.risks)
