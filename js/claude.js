// Studyflow AI client — talks to /api/tutor, which calls Google Gemini.
const GEMINI_KEY = 'sf-gemini-key'

// Claude was removed; drop any old Anthropic key left in the browser.
try { localStorage.removeItem('sf-claude-key') } catch { /* ignore */ }

export function geminiKey() {
  try { return localStorage.getItem(GEMINI_KEY) || '' } catch { return '' }
}

export function setGeminiKey(value) {
  const key = String(value || '').trim()
  try {
    if (key) localStorage.setItem(GEMINI_KEY, key)
    else localStorage.removeItem(GEMINI_KEY)
  } catch { /* ignore */ }
}

function headers() {
  const out = { 'content-type': 'application/json' }
  const key = geminiKey()
  if (key) out['x-gemini-key'] = key
  return out
}

export function tutorUrl() {
  const host = location.hostname
  if (host === '127.0.0.1' || host === 'localhost') return 'https://lam-truoc.vercel.app/api/tutor'
  return '/api/tutor'
}

export async function probeAi() {
  try {
    const res = await fetch(tutorUrl(), { method: 'GET' })
    const json = await res.json()
    return !!json.live
  } catch {
    return false
  }
}

export function aiReady(serverLive) {
  return Boolean(serverLive || geminiKey())
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let raw = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    raw += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(raw)
}

export async function blobToJpeg(blob) {
  try {
    const bitmap = await createImageBitmap(blob)
    const max = 1280
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
    return { media_type: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) }
  } catch {
    if ((blob.size || 0) > 900000) return null
    return { media_type: blob.type || 'image/jpeg', data: await blobToBase64(blob) }
  }
}

export async function blobToPdf(blob) {
  if ((blob.size || 0) > 1800000) return null
  return { data: await blobToBase64(blob) }
}

function compactContext(data, found) {
  if (!data) return ''
  const lines = []
  const courses = (data.courses || []).slice(0, 8)
  if (courses.length) lines.push(`Các môn: ${courses.map((course) => course.name).join(', ')}`)
  const plans = (data.plans || []).slice(0, 8)
  if (plans.length) lines.push(`Kế hoạch: ${plans.map((plan) => plan.name).join(', ')}`)
  if (found) lines.push(`Đang hỏi về nhiệm vụ “${found.name}” thuộc ${found.plan?.name || ''}`)
  return lines.join('\n')
}

export function buildTutorPayload({ question, data, found, corpus, history }) {
  const docs = (corpus?.docs || [])
    .filter((doc) => String(doc.text || '').trim())
    .slice(0, 6)
    .map((doc) => ({ name: doc.name, text: doc.text }))
  const files = (corpus?.files || [])
    .filter((file) => String(file.text || '').trim() || file.kind === 'image' || file.kind === 'pdf')
    .slice(0, 6)
    .map((file) => ({ name: file.name, text: file.text || '' }))
  const images = (corpus?.files || []).concat(corpus?.docs || [])
    .filter((item) => item.image?.data)
    .slice(0, 4)
    .map((item) => item.image)
  const pdfs = (corpus?.files || []).concat(corpus?.docs || [])
    .filter((item) => item.pdf?.data)
    .slice(0, 1)
    .map((item) => item.pdf)
  const course = found?.plan?.course
  return {
    question,
    task: found ? { name: found.name, description: found.description || '', hours: found.hours || '' } : null,
    course: course ? { name: course.name, output: course.output || '', notes: course.notes || '' } : null,
    plan: found?.plan?.name || '',
    context: compactContext(data, found),
    docs,
    files,
    images,
    pdfs,
    history: (history || []).slice(-10).map((row) => ({
      role: row.role,
      text: row.role === 'user' ? row.text : row.suggestion,
    })),
  }
}

export async function askAi(payload) {
  const res = await fetch(tutorUrl(), { method: 'POST', headers: headers(), body: JSON.stringify(payload) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: json.error || 'gemini', text: json.text || `Không gọi được Gemini (lỗi ${res.status}).` }
  if (!json.text) return { ok: false, error: 'empty', text: 'Gemini chưa trả lời được.' }
  return { ok: true, text: json.text, searched: !!json.searched, sources: json.sources || [] }
}

// Checks the saved key with a tiny request. Returns { ok, text }.
export async function testGeminiKey() {
  try {
    const res = await fetch(tutorUrl(), { method: 'POST', headers: headers(), body: JSON.stringify({ mode: 'ping' }) })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.ok) return { ok: true, text: `Khóa Gemini dùng được (model ${json.model}).` }
    return { ok: false, text: json.text || `Gemini lỗi ${res.status}.` }
  } catch {
    return { ok: false, text: 'Không kết nối được máy chủ để kiểm tra khóa.' }
  }
}

// Asks Gemini to split an output requirement into task groups.
// On failure the caller falls back to the built-in estimator.
export async function askPlan(payload, signal) {
  try {
    const res = await fetch(tutorUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ...payload, mode: 'plan' }),
      signal,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !Array.isArray(json.groups) || !json.groups.length) {
      return { ok: false, text: json.text || 'Gemini chưa chia được nhiệm vụ.' }
    }
    return { ok: true, groups: json.groups, note: json.note || '', provider: 'Gemini' }
  } catch (error) {
    return { ok: false, text: error?.name === 'AbortError' ? 'Gemini trả lời quá lâu.' : 'Mất kết nối tới Gemini.' }
  }
}
