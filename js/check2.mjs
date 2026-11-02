import { atTime, roundUp30 } from './format.js'
import { buildAiTasks, classIntervals, collectSlots, confirmedSessions, createDemo } from './model.js'

const now = atTime('2026-10-30', '11:15')
const data = createDemo(now)
const others = confirmedSessions(data.plans)
const deadline = atTime('2026-11-06', '23:59')
const blocked = classIntervals(data.courses, now, deadline).map((item) => [item.start, item.end]).concat(others.map((s) => [s.start, s.end]))
const early = collectSlots(roundUp30(now), deadline, data.freeSlots, blocked)
console.log('free slots before deadline', early.length, early.slice(0, 12).map((t) => new Date(t).toString().slice(0, 21)))
const built = buildAiTasks({
  text: 'Bài lab 4 REST API',
  output: 'Mã nguồn',
  docs: data.documents.filter((doc) => doc.courseId === 'c-web'),
  totalHours: '',
  startTs: now,
  deadline: atTime('2026-11-06', '23:59'),
  freeSlots: data.freeSlots,
  courses: data.courses,
  otherSessions: others,
})
const { proposeSchedule } = await import('./model.js')
const check = proposeSchedule({
  tasks: built.tasks,
  freeSlots: data.freeSlots,
  courses: data.courses,
  otherSessions: others,
  deadline: atTime('2026-11-06', '23:59'),
  fromTs: now,
})
for (const task of check.tasks) {
  console.log(task.name, task.milestone, task.shortfall)
  for (const session of task.sessions) {
    console.log(' ', new Date(session.start).toString(), new Date(session.end).toString())
  }
}
console.log('risks', check.risks)
const classes = []
for (const task of check.tasks) {
  for (const session of task.sessions) {
    for (const other of others) {
      if (session.start < other.end && other.start < session.end) console.log('OVERLAP', task.name, new Date(session.start).toString(), other.taskName)
    }
  }
}
