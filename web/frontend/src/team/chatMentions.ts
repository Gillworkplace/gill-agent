export interface Mention { id: string; start: number; end: number }
interface Query { start: number; end: number; search: string }

const word = /^[^\s@＠,!?;，。！？；、]{0,40}/u

export function mentionQuery(text: string, caret: number, mentions: Mention[]): Query | undefined {
 const match = /[@＠]([^\s@＠,!?;，。！？；、]{0,40})$/u.exec(text.slice(0, caret))
 if (!match || /[a-z\d_.+-]/i.test(text.charAt(match.index - 1))) return
 if (mentions.some(item => item.start <= match.index && match.index < item.end)) return
 const tail = word.exec(text.slice(caret))?.[0] || ''
 return { start: match.index, end: caret + tail.length, search: match[1] }
}

function replaceRange(mentions: Mention[], start: number, end: number, length: number): Mention[] {
 const offset = length - (end - start)
 return mentions.flatMap(item => {
  if (item.end <= start) return [item]
  if (item.start >= end) return [{ ...item, start: item.start + offset, end: item.end + offset }]
  return []
 })
}

export function updateMentions(previous: string, next: string, caret: number, mentions: Mention[]): Mention[] {
 if (!mentions.length || previous === next) return mentions
 let start = 0
 while (start < Math.min(caret, previous.length, next.length) && previous[start] === next[start]) start++
 let oldEnd = previous.length, newEnd = next.length
 while (oldEnd > start && newEnd > Math.max(caret, start) && previous[oldEnd - 1] === next[newEnd - 1]) {
  oldEnd--
  newEnd--
 }
 return replaceRange(mentions, start, oldEnd, newEnd - start)
}

export function insertMention(text: string, query: Query, mentions: Mention[], employee: { id: string; name: string }) {
 const token = '@' + employee.name
 const suffix = text.slice(query.end)
 const separator = /^\s/u.test(suffix) ? '' : ' '
 const next = replaceRange(mentions, query.start, query.end, token.length + separator.length)
 const end = query.start + token.length
 next.push({ id: employee.id, start: query.start, end })
 next.sort((a, b) => a.start - b.start)
 return {
  text: text.slice(0, query.start) + token + separator + suffix,
  caret: end + (separator || /^[ \t]/u.test(suffix) ? 1 : 0),
  mentions: next,
 }
}
