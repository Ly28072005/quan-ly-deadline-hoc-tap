import { fold, formatHours } from './format.js'

const STOP = new Set([
  'cua', 'va', 'la', 'cho', 'mot', 'cac', 'nay', 'voi', 'den', 'trong', 'khi', 'nhu', 'de',
  'tu', 'tren', 'duoi', 'nhung', 'thi', 'hay', 'ban', 'minh', 'bai', 'tap', 'yeu', 'cau',
  'mon', 'hoc', 'tai', 'lieu', 'theo', 'duoc', 'khong', 'co', 'se', 'da', 'dang', 'can',
  'phai', 'len', 'sau', 'truoc', 'hoac', 'rat', 'hon', 'nua', 'that', 'qua', 'het', 'moi',
  'cung', 'du', 've', 'vao', 'bang', 'vi', 'do', 'ay', 'kia', 'the', 'nhe', 'giup', 'giai',
  'thich', 'buoc', 'cach', 'lam', 'goi', 'y', 'doc', 'nao', 'kiem', 'tra', 'xem', 'hoi',
])

function clip(text, max) {
  const value = cleanLine(text)
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(', '))
  return `${(at > max * 0.5 ? cut.slice(0, at + 1) : cut).trim()}…`
}

function cleanLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function tokens(text) {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP.has(word))
}

function score(queryTokens, text) {
  if (!queryTokens.length) return 0
  const bag = new Set(tokens(text))
  let hit = 0
  for (const word of queryTokens) if (bag.has(word)) hit += 1
  return hit
}

function passagesOf(name, text) {
  const blocks = String(text || '').split(/\n{2,}/)
  const out = []
  for (const block of blocks) {
    const piece = block.trim()
    if (piece.length < 40) continue
    if (piece.length <= 520) {
      out.push({ name, text: cleanLine(piece) })
      continue
    }
    const sentences = piece.split(/(?<=[\.!?…])\s+/)
    let buf = ''
    for (const sentence of sentences) {
      const next = buf ? `${buf} ${sentence}` : sentence
      if (next.length > 420) {
        if (buf.trim()) out.push({ name, text: cleanLine(buf) })
        buf = sentence
      } else buf = next
    }
    if (buf.trim()) out.push({ name, text: cleanLine(buf) })
  }
  return out
}

function retrieve(query, passages, n = 6) {
  const q = tokens(query)
  const ranked = passages
    .map((item) => ({ ...item, score: score(q, item.text) }))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)
  const hits = ranked.filter((item) => item.score > 0).slice(0, n)
  if (hits.length) return hits
  const seen = new Set()
  const fallback = []
  for (const item of passages) {
    if (seen.has(item.name)) continue
    seen.add(item.name)
    fallback.push(item)
    if (fallback.length >= Math.min(n, 4)) break
  }
  return fallback
}

function questionsOf(text) {
  const raw = String(text || '').trim()
  if (!raw) return []
  const lines = raw.split(/\n/).map((line) => line.trim()).filter(Boolean)
  const found = []
  for (const line of lines) {
    if (/^(câu|cau|bài|bai|question|phần|phan|ý|yêu cầu|yeu cau)\s*\d/i.test(line)) found.push(line)
    else if (/^\d+[\.\)]\s+\S/.test(line)) found.push(line)
    else if (/^[a-e][\.\)]\s+\S/i.test(line) && line.length > 12) found.push(line)
    else if (/[?？]/.test(line) && line.length > 10) found.push(line)
  }
  if (found.length) return found.slice(0, 10)
  const parts = raw.split(/(?=(?:Câu|Cau|Bài|Bai)\s*\d+)/i).map((part) => part.trim()).filter((part) => part.length > 24)
  if (parts.length > 1) return parts.slice(0, 8)
  return [clip(raw, 420)]
}

function intentOf(text) {
  const ask = fold(text)
  if (/kiem tra|bai lam|cham diem|xem bai|nhan xet/.test(ask)) return 'check'
  if (/tai lieu|nen doc|doc gi/.test(ask)) return 'docs'
  if (/giai thich|hieu de|yeu cau bai|de bai/.test(ask)) return 'explain'
  if (/buoc|cach lam|goi y|huong dan|lam sao|lam bai|giai bai/.test(ask)) return 'steps'
  return 'solve'
}

function kindOf(blob) {
  const f = fold(blob)
  if (/sql|truy van|select|join|chuan hoa/.test(f)) return 'sql'
  if (/usecase|use case|erd|dac ta|kien truc|thiet ke he thong/.test(f)) return 'diagram'
  if (/rest|api|endpoint|json|lab/.test(f)) return 'code'
  if (/chien dich|bao cao|marketing|brief/.test(f)) return 'report'
  if (/thuyet trinh|slide|thuyet minh/.test(f)) return 'talk'
  if (/cau \d|1\.|trac nghiem/.test(f)) return 'quiz'
  return 'general'
}

function scaffold(kind, taskName) {
  if (kind === 'diagram') {
    return [
      `Đọc lại đầu mục “${taskName}” và khoanh đúng phạm vi hệ thống (ai dùng, biên hệ thống).`,
      'Liệt kê actor và usecase; mỗi usecase ghi tên, actor, mô tả ngắn, luồng chính / luồng phụ.',
      'Vẽ sơ đồ usecase, rồi ERD: thực thể, thuộc tính, khóa, quan hệ, bản số.',
      'Viết kiến trúc 1 trang: client, server, CSDL, module chính và lý do chọn.',
    ]
  }
  if (kind === 'sql') {
    return [
      'Xác định bảng, khóa và quan hệ liên quan đến câu hỏi.',
      'Viết SELECT đủ cột, JOIN đúng, WHERE/GROUP BY/HAVING nếu đề yêu cầu.',
      'Chạy thử bằng dữ liệu mẫu trong giáo trình, đối chiếu kết quả với đề.',
      'Ghi chú 2–3 dòng giải thích vì sao câu lệnh đúng yêu cầu.',
    ]
  }
  if (kind === 'code') {
    return [
      'Chép đúng yêu cầu từng endpoint: method, path, input, output.',
      'Cài route/controller, trả JSON và mã lỗi như đề.',
      'Thử bằng Postman hoặc curl, chụp kết quả.',
      'Viết README: cách chạy, danh sách API, tài khoản mẫu nếu có.',
    ]
  }
  if (kind === 'report') {
    return [
      'Mở bằng brief: mục tiêu, đối tượng, thông điệp.',
      'Phân tích thị trường / insight từ tài liệu môn, dẫn nguồn slide hoặc brief.',
      'Đề xuất chiến dịch: kênh, nội dung, lịch, ngân sách, KPI.',
      'Kết luận và phụ lục (nếu đề yêu cầu số trang).',
    ]
  }
  if (kind === 'talk') {
    return [
      'Khung 3 phần: mở (30s), thân (các ý chính), kết (kêu gọi / tóm tắt).',
      'Mỗi slide một ý, hình hoặc số liệu lấy từ tài liệu môn.',
      'Viết lời nói theo phút, luyện sao cho khớp thời lượng.',
      'Chuẩn bị 3 câu hỏi giáo viên hay hỏi và câu trả lời ngắn.',
    ]
  }
  return [
    `Tách đề thành từng ý nhỏ của đầu mục “${taskName}”.`,
    'Với mỗi ý: lấy định nghĩa / công thức / ví dụ từ tài liệu môn.',
    'Viết thành lời của mình, dẫn tên tài liệu ngay sau ý chính.',
    'Đọc lại checklist nộp: đủ ý, đúng tên đầu mục, có dẫn nguồn.',
  ]
}

function readableFiles(items) {
  return (items || []).filter((item) => String(item.text || '').trim().length >= 20)
}

function draftFor(question, hits) {
  if (!hits.length) {
    return `Chưa khớp được đoạn nào trong tài liệu môn với ý này. Hãy trả lời theo đúng câu chữ của đề, rồi ghi rõ phần nào là suy luận của mình.`
  }
  const main = hits[0]
  const extra = hits[1]
  const bits = [`Có thể trả lời: ${clip(main.text, 360)}`]
  if (extra && extra.name !== main.name) bits.push(`Làm rõ thêm từ “${extra.name}”: ${clip(extra.text, 200)}`)
  bits.push(`Nguồn: “${main.name}”. Viết lại bằng lời của mình, bám đúng câu hỏi.`)
  return bits.join('\n')
}

function sourceLine(docs, files) {
  const readDocs = readableFiles(docs)
  const unread = (docs || []).filter((doc) => !String(doc.text || '').trim())
  const images = (files || []).filter((file) => file.kind === 'image')
  const readFiles = readableFiles(files)
  const parts = []
  if (readDocs.length) parts.push(`đã đọc ${readDocs.length} tài liệu môn`)
  if (unread.length) parts.push(`${unread.length} tài liệu chưa có nội dung trên máy`)
  if (readFiles.length) parts.push(`đã đọc đề/bài ${readFiles.map((file) => file.name).join(', ')}`)
  if (images.length) parts.push(`có ảnh ${images.map((file) => file.name).join(', ')} — gõ thêm đề vào ô chat nếu cần`)
  return parts.join('; ') || 'chưa đọc được nội dung tệp'
}

export function composeTutor({ found, data, text, corpus }) {
  const course = found.plan.course || {}
  const courseName = course.name || 'môn này'
  const docsMeta = (data.documents || []).filter((doc) => doc.courseId === found.plan.courseId)
  const docs = corpus?.docs || []
  const files = corpus?.files || []
  const hours = Number(found.hours) > 0
    ? Number(found.hours)
    : (found.start && found.end && found.end > found.start ? (found.end - found.start) / 3600000 : 0)
  const hourLine = hours ? formatHours(hours) : ''
  const intent = intentOf(text)
  const typed = String(text || '').trim()
  const chipLike = typed.length < 72
  const assignment = [
    chipLike ? '' : typed,
    ...readableFiles(files).map((file) => file.text),
    found.description || '',
    course.output || '',
    course.notes || '',
  ].filter(Boolean).join('\n\n')
  const materialPassages = [
    ...docs.flatMap((doc) => passagesOf(doc.name, doc.text)),
    ...(course.notes ? passagesOf('Ghi chú môn', course.notes) : []),
    ...(course.output ? passagesOf('Yêu cầu đầu ra', course.output) : []),
  ]
  const workPassages = files.flatMap((file) => passagesOf(file.name, file.text))
  const contextQuery = [found.name, found.description || '', course.output || '', course.notes || '', typed].join(' ')
  const kind = kindOf(`${courseName} ${found.name} ${assignment}`)
  const steps = scaffold(kind, found.name)
  const actions = docsMeta.length && found.plan.courseId
    ? [{ label: 'Mở tài liệu môn', hash: `#/tai-lieu/${found.plan.courseId}` }]
    : [{ label: 'Xem kế hoạch', hash: `#/ke-hoach/${found.plan.id}` }]
  const from = `${found.name} · ${courseName}. ${sourceLine(docs, files)}.`

  if (!docsMeta.length && !readableFiles(files).length && chipLike && !course.notes && !found.description) {
    return {
      from,
      suggestion: [
        `**Để mình giải được “${found.name}” như khi bạn gửi đề cho Gemini**`,
        `1. Vào Tài liệu học tập của ${courseName}, tải slide / giáo trình / đề cương.`,
        '2. Đẩy đề bài dạng PDF, Word hoặc txt ở khung bên trái.',
        '3. Hỏi lại “Giải bài tập này” hoặc dán nguyên đề vào ô chat.',
      ].join('\n'),
      actions: found.plan.courseId ? [{ label: 'Tải tài liệu môn', hash: `#/tai-lieu/${found.plan.courseId}` }] : actions,
    }
  }

  if (intent === 'docs') {
    const ranked = (docsMeta.length ? docsMeta : docs).map((doc) => {
      const body = docs.find((item) => item.id === doc.id || item.name === doc.name)?.text || ''
      return { name: doc.name, score: score(tokens(contextQuery), `${doc.name} ${body}`), preview: clip(body, 180) }
    }).sort((a, b) => b.score - a.score)
    const lines = ['**Nên đọc tài liệu nào**']
    if (!ranked.length) {
      lines.push(`${courseName} chưa có tài liệu. Hãy tải slide hoặc giáo trình rồi hỏi lại.`)
    } else {
      ranked.slice(0, 5).forEach((doc, index) => {
        lines.push(`${index + 1}. “${doc.name}”${doc.preview ? ` — ${doc.preview}` : ' — khớp với tên đầu mục, hãy mở tệp này trước.'}`)
      })
      lines.push(`Ưu tiên tệp trên cùng, lấy đúng phần nói về “${found.name}”.`)
    }
    return { from, suggestion: lines.join('\n'), actions }
  }

  if (intent === 'check') {
    const work = readableFiles(files)
    const need = [found.name, found.description || '', course.output || ''].filter(Boolean).join(' · ')
    const lines = ['**Nhận xét bài làm**']
    if (!work.length) {
      lines.push('Chưa đọc được chữ bài làm. Đẩy file PDF/Word/txt (hoặc dán bài vào ô chat) rồi hỏi lại “Kiểm tra bài làm của mình”.')
    } else {
      const cover = retrieve(need, workPassages, 4)
      const missing = tokens(need).filter((word) => !work.some((file) => fold(file.text).includes(word))).slice(0, 8)
      lines.push(`Đã đọc: ${work.map((file) => file.name).join(', ')}.`)
      lines.push(`Đối chiếu với đầu mục “${found.name}”: ${found.description || course.output || 'làm đúng yêu cầu đầu ra của môn.'}`)
      if (cover.length) {
        lines.push('**Ý đã thấy trong bài**')
        cover.forEach((item) => lines.push(`- ${clip(item.text, 200)}`))
      }
      if (missing.length) lines.push(`**Nên bổ sung các ý còn mỏng:** ${missing.join(', ')}.`)
      const hints = retrieve(need, materialPassages, 3)
      if (hints.length) {
        lines.push('**Gợi ý lấy thêm từ tài liệu môn**')
        hints.forEach((item) => lines.push(`- “${item.name}”: ${clip(item.text, 200)}`))
      }
      lines.push('Trước khi nộp: đủ ý đầu mục, có dẫn tên tài liệu, và tự viết lại cho khỏi trùng văn.')
    }
    return { from, suggestion: lines.join('\n'), actions }
  }

  const qs = questionsOf(assignment || found.name)
  const used = retrieve(contextQuery, materialPassages, 5)
  const lines = []

  lines.push('**Đề mình đang giải**')
  if (readableFiles(files).length) {
    lines.push(clip(readableFiles(files).map((file) => file.text).join('\n'), 520))
  } else if (!chipLike) {
    lines.push(clip(typed, 420))
  } else {
    lines.push(`Đầu mục “${found.name}” của ${courseName}${found.description ? `: ${found.description}` : '.'}`)
    if (course.output) lines.push(`Yêu cầu đầu ra môn: ${course.output}`)
  }

  if (intent === 'explain') {
    lines.push('**Giải thích yêu cầu**')
    lines.push(`Giáo viên chấm đúng phần “${found.name}”. Cần ra được sản phẩm khớp yêu cầu đầu ra${course.output ? `: ${course.output}` : ' của môn'}.`)
    if (qs.length > 1) {
      lines.push('Các ý trong đề:')
      qs.forEach((item, index) => lines.push(`${index + 1}. ${clip(item, 180)}`))
    }
  }

  lines.push('**Căn cứ từ tài liệu môn**')
  if (used.length) {
    used.forEach((item) => lines.push(`- “${item.name}”: ${clip(item.text, 260)}`))
  } else if (docsMeta.length) {
    lines.push(`Môn có ${docsMeta.map((doc) => doc.name).join(', ')} nhưng chưa đọc được chữ trong tệp (chưa tải nội dung, hoặc file ảnh/slide chưa trích được). Hãy tải lại bản PDF/Word/txt.`)
    if (course.notes) lines.push(`Ghi chú môn: ${clip(course.notes, 240)}`)
  } else {
    lines.push(`Chưa có tài liệu môn. Mình vẫn phác cách làm theo tên đầu mục và yêu cầu đầu ra. Tải slide/giáo trình để lần sau có dẫn chứng.`)
  }

  lines.push('**Các bước làm**')
  steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`))
  if (hourLine) lines.push(`Dành khoảng ${hourLine} giờ cho phiên này.`)

  lines.push('**Bài làm gợi ý**')
  qs.slice(0, 6).forEach((question, index) => {
    const hits = retrieve(`${question} ${found.name} ${course.output || ''}`, materialPassages, 3)
    const title = qs.length > 1 ? `Ý ${index + 1}. ${clip(question, 140)}` : clip(question, 160)
    lines.push(title)
    lines.push(draftFor(question, hits))
  })

  lines.push('**Trước khi nộp**')
  lines.push(`- Bài đúng đầu mục “${found.name}”, không lẫn sang đầu mục khác.`)
  lines.push('- Mỗi ý chính có dẫn một tài liệu môn.')
  lines.push('- Tự viết lại lời; dùng gợi ý trên như dàn ý chứ đừng chép nguyên.')

  return { from, suggestion: lines.join('\n'), actions }
}
