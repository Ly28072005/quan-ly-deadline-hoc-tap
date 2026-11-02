const KEY = 'sf-claude-key'

export function claudeKey() {
  try { return localStorage.getItem(KEY) || '' } catch { return '' }
}

export function setClaudeKey(value) {
  const key = String(value || '').trim()
  try {
    if (key) localStorage.setItem(KEY, key)
    else localStorage.removeItem(KEY)
  } catch { /* ignore */ }
}

export function tutorUrl() {
  const host = location.hostname
  if (host === '127.0.0.1' || host === 'localhost') return 'https://lam-truoc.vercel.app/api/tutor'
  return '/api/tutor'
}

export async function probeClaude() {
  try {
    const res = await fetch(tutorUrl(), { method: 'GET' })
    const json = await res.json()
    return !!json.live
  } catch {
    return false
  }
}

export function claudeReady(serverLive) {
  return Boolean(serverLive || claudeKey())
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
    history: (history || []).slice(-8).map((row) => ({
      role: row.role,
      text: row.role === 'user' ? row.text : row.suggestion,
    })),
  }
}

export async function askClaude(payload) {
  const headers = { 'content-type': 'application/json' }
  const key = claudeKey()
  if (key) headers['x-anthropic-key'] = key
  const res = await fetch(tutorUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { ok: false, error: json.error || 'claude', text: json.text || 'Không gọi được Claude.' }
  }
  if (!json.text) return { ok: false, error: 'empty', text: 'Claude chưa trả lời được.' }
  return {
    ok: true,
    text: json.text,
    searched: !!json.searched,
    sources: json.sources || [],
  }
}
