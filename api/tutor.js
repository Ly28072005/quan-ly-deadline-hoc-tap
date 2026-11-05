// Studyflow AI endpoint — Google Gemini only.
// The browser sends the user's own key in the x-gemini-key header (or set GEMINI_API_KEY on Vercel).

const API = 'https://generativelanguage.googleapis.com/v1beta'

// Used when Google's model list cannot be read. The "-latest" aliases always point at a current model.
const PREFERRED = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]
const MAX_MODELS = 6
const HEDGE_MS = 10000 // start the next model if this one is silent this long
const TOTAL_BUDGET = 54000 // Vercel stops the function at 60 s
// Model that last answered for a key, tried first next time (kept while the function stays warm).
const lastGood = new Map()

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-gemini-key')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

function clip(value, max) {
  const text = String(value || '').trim()
  return text.length > max ? `${text.slice(0, max)}\n…` : text
}

function systemPrompt() {
  return `Bạn là trợ lý AI trong ứng dụng Studyflow, trợ lý học tập cho sinh viên Việt Nam. Trả lời tiếng Việt, cụ thể, giống khi sinh viên hỏi trên ChatGPT hay Gemini. Nếu câu hỏi không liên quan bài học, cứ trả lời tự nhiên như một trợ lý trò chuyện bình thường.

Cách làm:
- Đọc kỹ câu hỏi, đề bài, ảnh/PDF đính kèm, và tài liệu môn nếu có.
- Ưu tiên tài liệu môn khi nó đủ để trả lời đúng.
- Nếu tài liệu thiếu, không có, hoặc không khớp đề: hãy tìm trên web để tìm giáo trình, ví dụ, công thức, bài giải mẫu, rồi trả lời đầy đủ từ kiến thức của bạn và nguồn vừa tìm. Không dừng lại chỉ vì “không có trong tài liệu”.
- Khi giải bài: nêu hiểu đề, kiến thức cần dùng, các bước, bài làm/đáp án, giải thích vì sao đúng. Có thể viết đoạn mẫu để sinh viên viết lại.
- Khi đọc ảnh đề: đọc chữ trong ảnh rồi giải.
- Dẫn nguồn (tên tài liệu môn hoặc URL) khi dùng. Không bịa nguồn.
- Giọng văn rõ, thân thiện, đi thẳng vào cách làm.`
}

function userText(body) {
  const parts = []
  if (body.task) {
    parts.push(`Nhiệm vụ: ${body.task.name || ''}`)
    if (body.task.description) parts.push(`Yêu cầu đầu mục: ${body.task.description}`)
    if (body.task.hours) parts.push(`Thời lượng phiên: ${body.task.hours} giờ`)
  }
  if (body.course) {
    parts.push(`Môn: ${body.course.name || ''}`)
    if (body.course.output) parts.push(`Yêu cầu đầu ra môn: ${body.course.output}`)
    if (body.course.notes) parts.push(`Ghi chú môn: ${clip(body.course.notes, 1200)}`)
  }
  if (body.plan) parts.push(`Kế hoạch: ${body.plan}`)
  if (body.context) parts.push(clip(body.context, 4000))
  const docs = Array.isArray(body.docs) ? body.docs : []
  if (docs.length) {
    parts.push('Tài liệu môn đã đọc:')
    docs.forEach((doc) => {
      parts.push(`--- ${doc.name || 'tài liệu'} ---\n${clip(doc.text, 8000) || '(không trích được chữ)'}`)
    })
  } else {
    parts.push('Chưa có chữ từ tài liệu môn (tệp chưa tải hoặc chưa trích được).')
  }
  const files = Array.isArray(body.files) ? body.files : []
  if (files.length) {
    parts.push('Đề / bài sinh viên đẩy lên:')
    files.forEach((file) => {
      parts.push(`--- ${file.name || 'tệp'} ---\n${clip(file.text, 8000) || '(ảnh hoặc chưa trích được chữ — xem khối ảnh/PDF nếu có)'}`)
    })
  }
  parts.push(`Câu hỏi của sinh viên:\n${clip(body.question, 8000)}`)
  parts.push('Hãy trả lời đầy đủ. Tìm web nếu cần thông tin mới hoặc tài liệu môn chưa đủ.')
  return parts.filter(Boolean).join('\n\n')
}

function historyOf(body) {
  const rows = Array.isArray(body.history) ? body.history.slice(-10) : []
  const out = []
  for (const row of rows) {
    const text = clip(row.text || row.suggestion || '', 3000)
    if (!text) continue
    out.push({ role: row.role === 'ai' || row.role === 'assistant' ? 'model' : 'user', text })
  }
  return out
}

function chatContents(payload) {
  const contents = []
  const push = (role, part) => {
    const last = contents[contents.length - 1]
    if (last && last.role === role) last.parts.push(part)
    else contents.push({ role, parts: [part] })
  }
  for (const row of historyOf(payload)) push(row.role, { text: row.text })
  const images = Array.isArray(payload.images) ? payload.images.slice(0, 4) : []
  for (const image of images) {
    if (image?.data) push('user', { inline_data: { mime_type: image.media_type || 'image/jpeg', data: image.data } })
  }
  const pdfs = Array.isArray(payload.pdfs) ? payload.pdfs.slice(0, 1) : []
  for (const pdf of pdfs) {
    if (pdf?.data) push('user', { inline_data: { mime_type: 'application/pdf', data: pdf.data } })
  }
  push('user', { text: userText(payload) })
  while (contents.length && contents[0].role === 'model') contents.shift()
  return contents
}

function replyOf(json) {
  const candidate = json?.candidates?.[0]
  const parts = candidate?.content?.parts || []
  let text = parts.filter((part) => part.text && !part.thought).map((part) => part.text).join('').trim()
  const sources = []
  for (const chunk of candidate?.groundingMetadata?.groundingChunks || []) {
    const url = chunk.web?.uri
    if (url && !sources.some((item) => item.url === url)) sources.push({ title: chunk.web.title || url, url })
  }
  if (text && sources.length && !/https?:\/\//.test(text.slice(-800))) {
    text += `\n\n**Nguồn**\n${sources.slice(0, 6).map((item) => `- ${item.title}: ${item.url}`).join('\n')}`
  }
  return { text, sources, searched: sources.length > 0 }
}

// Turns a Google error into Vietnamese, always keeping Google's own message for diagnosis.
function errorText(status, json) {
  const msg = String(json?.error?.message || '').trim()
  const detail = msg ? `\n\nChi tiết từ Google: ${msg.slice(0, 400)}` : ''
  const all = `${msg} ${JSON.stringify(json?.error?.details || '')}`
  let vi = `Gemini trả lỗi ${status}.`
  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(all)) vi = 'Khóa Gemini không hợp lệ hoặc đã hết hạn. Tạo khóa mới tại aistudio.google.com/apikey rồi dán lại trong Cài đặt.'
  else if (/location is not supported/i.test(all)) vi = 'Google chưa hỗ trợ Gemini API ở khu vực máy chủ đang chạy.'
  else if (/SERVICE_DISABLED|has not been used|is disabled/i.test(all)) vi = 'Dự án Google của khóa này chưa bật Generative Language API. Tạo khóa ngay trong aistudio.google.com/apikey (chọn "Create API key in new project") là được bật sẵn.'
  else if (status === 429) vi = 'Gemini đã chạm giới hạn miễn phí (số lượt mỗi phút hoặc mỗi ngày). Đợi khoảng 1 phút rồi hỏi lại.'
  else if (status === 403) vi = 'Khóa Gemini không có quyền gọi API.'
  else if (status === 404) vi = 'Không tìm thấy model Gemini phù hợp cho khóa này.'
  else if (status >= 500) vi = 'Máy chủ Gemini đang bận. Thử lại sau ít phút.'
  return vi + detail
}

const fatal = (status, json) => status === 401 || status === 403
  || /API_KEY_INVALID|API key not valid|location is not supported|SERVICE_DISABLED/i.test(`${json?.error?.message || ''} ${JSON.stringify(json?.error?.details || '')}`)

// Asks Google which models this key may call, keeps the useful text models, best first.
const modelCache = new Map()
async function modelsFor(apiKey) {
  const hit = modelCache.get(apiKey)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit
  let found = null
  try {
    const response = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) {
      if (fatal(response.status, json)) return { error: errorText(response.status, json), status: response.status }
    } else {
      found = (json.models || [])
        .filter((model) => (model.supportedGenerationMethods || []).includes('generateContent'))
        .map((model) => String(model.name || '').replace(/^models\//, ''))
    }
  } catch { /* fall back to the preferred list */ }
  let list = PREFERRED
  if (found && found.length) {
    // Stable numbered flash models (gemini-3.8-flash, gemini-3.5-flash-lite…), newest first.
    // Old ones such as gemini-2.5-flash may be listed but closed to new users, so they go last.
    const numbered = found
      .map((name) => ({ name, m: name.match(/^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/) }))
      .filter((row) => row.m)
      .map((row) => ({ name: row.name, version: Number(row.m[1]), lite: Boolean(row.m[2]) }))
    const pick = (lite) => numbered.filter((row) => row.lite === lite).sort((a, b) => b.version - a.version).map((row) => row.name)
    // Lite goes second: it is rarely overloaded, so an answer still comes fast when flash models are busy (503).
    const ordered = [
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      ...pick(false),
      ...pick(true),
    ]
    list = [...new Set(ordered)].filter((name) => found.includes(name))
    if (!list.length) list = PREFERRED
  }
  const entry = { list: list.slice(0, MAX_MODELS), at: Date.now() }
  modelCache.set(apiKey, entry)
  return entry
}

async function generate(apiKey, model, body, signal) {
  const response = await fetch(`${API}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const json = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, json }
}

// One model attempt. Retries once without Google Search if the search tool itself is refused.
async function attempt(apiKey, model, { build, read, search }, signal) {
  for (const useSearch of search ? [true, false] : [false]) {
    const result = await generate(apiKey, model, build(useSearch), signal)
    if (result.ok) {
      const value = read(result.json)
      if (value) return { ok: true, ...value, model }
      const blocked = result.json?.promptFeedback?.blockReason || result.json?.candidates?.[0]?.finishReason
      return { ok: false, status: 502, text: blocked ? `Gemini không trả lời được câu này (${blocked}).` : 'Gemini trả về kết quả rỗng.' }
    }
    const failure = { ok: false, status: result.status, text: errorText(result.status, result.json), fatal: fatal(result.status, result.json) }
    if (failure.fatal || !(useSearch && (result.status === 400 || result.status === 429))) return failure
  }
  return { ok: false, status: 502, text: 'Không gọi được Gemini.' }
}

// Tries models one after another. If a model is silent for HEDGE_MS, the next one starts in parallel
// and the first good answer wins, so a busy Google model cannot eat Vercel's 60 s limit.
async function runGemini(apiKey, job) {
  const started = Date.now()
  const models = await modelsFor(apiKey)
  if (models.error) return { ok: false, status: models.status, text: models.error }
  const good = lastGood.get(apiKey)
  const order = good && models.list.includes(good) ? [good, ...models.list.filter((name) => name !== good)] : models.list
  return new Promise((resolve) => {
    const controllers = []
    let next = 0
    let running = 0
    let done = false
    let last = { ok: false, status: 502, text: 'Không gọi được Gemini.' }
    const finish = (result) => {
      if (done) return
      done = true
      clearTimeout(budget)
      controllers.forEach((ctl) => ctl.abort())
      resolve(result)
    }
    const budget = setTimeout(() => finish({
      ok: false,
      status: 503,
      text: last.text === 'Không gọi được Gemini.'
        ? 'Gemini phản hồi quá chậm vì đang quá tải. Thử lại sau ít phút.'
        : `${last.text}\n\nThử lại sau ít phút.`,
    }), Math.max(1000, TOTAL_BUDGET - (Date.now() - started)))
    const launch = () => {
      if (done) return
      if (next >= order.length) {
        if (!running) finish(last)
        return
      }
      const model = order[next++]
      const ctl = new AbortController()
      controllers.push(ctl)
      running += 1
      let hedged = false
      const hedge = setTimeout(() => { hedged = true; launch() }, HEDGE_MS)
      attempt(apiKey, model, job, ctl.signal)
        .catch((error) => ({ ok: false, status: 502, text: `Không kết nối được Gemini: ${error.message || 'network'}`, aborted: error?.name === 'AbortError' }))
        .then((result) => {
          clearTimeout(hedge)
          running -= 1
          if (done) return
          if (result.ok) {
            lastGood.set(apiKey, model)
            finish(result)
            return
          }
          if (lastGood.get(apiKey) === model) lastGood.delete(apiKey)
          if (!result.aborted) last = result
          if (result.fatal) { finish(result); return }
          if (!hedged || !running) launch()
        })
    }
    launch()
  })
}

function askChat(apiKey, payload) {
  const contents = chatContents(payload)
  return runGemini(apiKey, {
    search: true,
    build: (useSearch) => ({
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents,
      generationConfig: { maxOutputTokens: 8192 },
      ...(useSearch ? { tools: [{ google_search: {} }] } : {}),
    }),
    read: (json) => {
      const reply = replyOf(json)
      return reply.text ? reply : null
    },
  })
}

function planPrompt() {
  return `Bạn là trợ lý lập kế hoạch học tập cho sinh viên Việt Nam. Đọc yêu cầu đầu ra của môn và tài liệu (nếu có), rồi chia thành các nhiệm vụ cụ thể để sinh viên làm dần đến hạn.

Quy tắc:
- Bám sát đề: giữ đúng các phần/mục mà yêu cầu nêu (nếu đề đánh số phần thì mỗi phần là một nhóm). Không bịa thêm phần đề không yêu cầu.
- Mỗi nhóm có "title" (tên phần) và "items" là các nhiệm vụ nhỏ theo thứ tự làm.
- Mỗi nhiệm vụ: "name" ngắn gọn, bắt đầu bằng động từ, tối đa 70 ký tự; "detail" 1–2 câu nói rõ cần làm gì, sản phẩm là gì; "hours" là số giờ thực tế cho sinh viên, bội số của 0.5, từ 0.5 đến 6.
- Việc nhẹ (đọc lại, kiểm tra, nộp bài) 0.5–1 giờ; viết/phân tích 1.5–3 giờ; lập trình, sơ đồ phức tạp, báo cáo dài 2–6 giờ.
- Nên có nhiệm vụ đầu là đọc đề/tài liệu, lập dàn ý; nhiệm vụ cuối là rà soát và nộp bài.
- Nếu có "Giờ rảnh còn lại", cố giữ tổng giờ không vượt quá con số đó, trừ khi đề thật sự cần nhiều hơn.
- Viết tiếng Việt. Chỉ trả về JSON đúng dạng:
{"groups":[{"title":"...","items":[{"name":"...","detail":"...","hours":1.5}]}],"note":"một câu nhận xét ngắn về khối lượng"}`
}

function planText(body) {
  const parts = []
  if (body.course) parts.push(`Môn: ${body.course}`)
  if (body.planName) parts.push(`Tên kế hoạch: ${body.planName}`)
  if (body.window) parts.push(`Thời gian: ${body.window}`)
  if (body.openHours) parts.push(`Giờ rảnh còn lại đến hạn: ${body.openHours} giờ`)
  parts.push(`Yêu cầu đầu ra:\n${clip(body.output, 6000)}`)
  const docs = Array.isArray(body.docs) ? body.docs.slice(0, 4) : []
  for (const doc of docs) {
    if (String(doc.text || '').trim()) parts.push(`--- Tài liệu: ${doc.name || 'tệp'} ---\n${clip(doc.text, 5000)}`)
  }
  return parts.join('\n\n')
}

function parsePlan(raw) {
  let text = String(raw || '').trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1]
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')
  if (from < 0 || to <= from) return null
  let json
  try { json = JSON.parse(text.slice(from, to + 1)) } catch { return null }
  const half = (value) => Math.min(6, Math.max(0.5, Math.round((Number(value) || 1) * 2) / 2))
  const groups = (Array.isArray(json.groups) ? json.groups : []).slice(0, 12).map((group) => ({
    title: String(group.title || '').trim().slice(0, 90),
    items: (Array.isArray(group.items) ? group.items : []).slice(0, 12)
      .map((item) => ({
        name: String(item.name || '').trim().slice(0, 90),
        detail: String(item.detail || '').trim().slice(0, 400),
        hours: half(item.hours),
      }))
      .filter((item) => item.name),
  })).filter((group) => group.items.length)
  if (!groups.length) return null
  return { groups, note: String(json.note || '').trim().slice(0, 300) }
}

function askPlan(apiKey, payload) {
  return runGemini(apiKey, {
    search: false,
    build: () => ({
      systemInstruction: { parts: [{ text: planPrompt() }] },
      contents: [{ role: 'user', parts: [{ text: planText(payload) }] }],
      generationConfig: { maxOutputTokens: 8192, responseMimeType: 'application/json', temperature: 0.4 },
    }),
    read: (json) => parsePlan(replyOf(json).text),
  })
}

// Quick key check used by the Settings "Lưu khóa" button.
function ping(apiKey) {
  return runGemini(apiKey, {
    search: false,
    build: () => ({
      contents: [{ role: 'user', parts: [{ text: 'Trả lời đúng một từ: OK' }] }],
      generationConfig: { maxOutputTokens: 256 },
    }),
    read: (json) => (replyOf(json).text ? { text: 'OK' } : null),
  })
}

module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  const envKey = process.env.GEMINI_API_KEY || ''
  if (req.method === 'GET') return res.status(200).json({ live: Boolean(envKey) })
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })

  const apiKey = envKey || String(req.headers['x-gemini-key'] || '').trim()
  if (!apiKey) {
    return res.status(501).json({
      error: 'no_key',
      text: 'Chưa có khóa Gemini. Lấy khóa miễn phí tại aistudio.google.com/apikey rồi dán vào Cài đặt, mục Trợ lý AI.',
    })
  }
  const payload = req.body && typeof req.body === 'object' ? req.body : {}
  const fail = (result) => res.status(result.status >= 400 ? result.status : 502).json({ error: 'gemini', text: result.text })

  if (payload.mode === 'ping') {
    const result = await ping(apiKey)
    return result.ok ? res.status(200).json({ ok: true, model: result.model }) : fail(result)
  }
  if (payload.mode === 'plan') {
    if (!String(payload.output || '').trim()) return res.status(400).json({ error: 'missing', text: 'Thiếu yêu cầu đầu ra.' })
    const result = await askPlan(apiKey, payload)
    return result.ok
      ? res.status(200).json({ ok: true, groups: result.groups, note: result.note, model: result.model, provider: 'gemini' })
      : fail(result)
  }
  if (!String(payload.question || '').trim()) {
    return res.status(400).json({ error: 'missing', text: 'Thiếu câu hỏi.' })
  }
  const result = await askChat(apiKey, payload)
  if (!result.ok) return fail(result)
  return res.status(200).json({
    text: result.text,
    sources: result.sources,
    searched: result.searched,
    model: result.model,
    provider: 'gemini',
  })
}

module.exports.config = { maxDuration: 60 }
