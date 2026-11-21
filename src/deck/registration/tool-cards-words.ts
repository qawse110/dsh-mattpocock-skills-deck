/**
 * src/deck/registration/tool-cards-words.ts —— 工具卡共用的取值、状态与文案小件（地图 #3 · 票 #4）
 *
 * 这个文件只放「一段回执拆成几格」和「英文枚举翻成中文」这两类小函数，九张卡的版面不在这里。
 * 拆出来的原因是文件粒度门禁：一个源码文件不超过 350 有效行，卡片本体已经占满一份。
 *
 * 两条不能改的约定：
 *   1. 取值小件一律「取不到就当没有」，不猜、不抛错——回执来自各工具实现，字段是可缺的。
 *   2. 中文文案只有这一份。卡片拿不到界面语言（桥接不给），所以这里是硬中文，不要加英文分支。
 */

/** 未知形状的对象：回执来自工具实现，只按字段逐个取，不假设一定有。 */
export type UnknownRecord = Record<string, unknown>
/** 视图节点：一个组件就是一个对象，type 决定它是哪种。 */
export type CardNode = Record<string, unknown>
/**
 * 卡片构建函数：摊平后的回执与调用参数进，一张卡出。
 * 「摊平」是 deckToolCard 那一步做的：回执的正文在 data 里，步骤清单在 items 里，
 * 卡片不关心这个分层，所以先把它们合成一层再交给各张卡。
 */
export type CardBuilder = (value: UnknownRecord, args: UnknownRecord) => CardNode | null

/** 工具卡在桥接那边的协议键名，与 dsh-go-plugin 技能里的写法一致。 */
export const CARD_KEY = 'dsh-go/view'

/** 一张工具卡的上限（桥接侧的 BUDGETS.toolCard）。 */
export const CARD_MAX_BYTES = 8192
export const CARD_MAX_COMPONENTS = 40
export const CARD_MAX_DEPTH = 6
/** 标题上限：#11 裁决 5②，窄屏也要放得下，超过就截。 */
export const TITLE_MAX = 40
/** 读类卡只放正文开头这么多字：#11 裁决 4。 */
export const EXCERPT_MAX = 280
/** 列表行数：卡面窄，清单类卡最多四行，地图计划建出来的票最多三行。 */
export const LIST_MAX = 4
export const LIST_MAX_SHORT = 3

/* ── 取值小件：回执里的每一格都可能是缺的，取不到就当没有，不猜 ───────────────── */

export function isRecord(v: unknown): v is UnknownRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
export function rec(v: unknown): UnknownRecord {
  return isRecord(v) ? v : {}
}
export function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
export function num(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null
}
export function listOf(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/* ── 状态三值：#11 裁决 2、3 ────────────────────────────────────────────── */

/** 这次没做全（部分结果）。 */
export function isPartial(value: UnknownRecord): boolean {
  return str(value.status) === 'partial'
}
/** 这次什么都没做。 */
export function isUnsupported(value: UnknownRecord): boolean {
  return str(value.status) === 'unsupported'
}

/**
 * 标题按状态挑一个。不完整必须一眼可辨（#11 裁决 3），所以 partial 与 unsupported 各有一句自己的话，
 * 不能沿用成功时那句——把「已上报」摆在一次没报上的卡上，比不画卡还糟。
 */
export function titleOf(value: UnknownRecord, ok: string, partial: string, bad: string): string {
  if (isUnsupported(value)) return bad
  if (isPartial(value)) return partial
  return ok
}

/* ── 文案小件：把回执里的英文枚举翻成中文，卡片只有中文（工具卡拿不到界面语言） ───────── */

/** 票的状态只有两种（src/tracker/contract/identity.ts 的 State）。 */
export function zhState(state: unknown): string {
  const s = str(state)
  if (s === 'open') return '未关闭'
  if (s === 'closed') return '已关闭'
  return s || '状态未知'
}

/** 清单类卡的括号里写「列的是哪一批」。参数没给时按 open 算，与工具默认值一致。 */
export function zhStateFilter(state: unknown): string {
  const s = str(state)
  if (s === 'closed') return '已关闭'
  if (s === 'all') return '全部'
  return '未关闭'
}

/** 后端是从哪认出来的（src/tracker/contract/results.ts 的 source）。 */
export function zhSource(source: unknown): string {
  const s = str(source)
  if (s === 'explicit') return '手动选择'
  if (s === 'matches') return '锚文件匹配'
  if (s === 'fallback') return '自动识别'
  return '来源未知'
}

/**
 * 没做成或没做全的原因（壳里那八个码，见 src/deck/shell/receipt-reason.ts）。
 * 这些码回答的是「下一步该做什么」而不是「错误叫什么」，所以翻成动作而不是名词。
 */
export function zhReason(reason: unknown): string {
  const r = str(reason)
  if (r === 'no-session-context') return '这次没有会话上下文，认不出在哪个工作区'
  if (r === 'ai-tool-refused') return '模型这一轮没走这一步'
  if (r === 'no-backend') return '这个工作区还没选后端'
  if (r === 'gate-defer') return '额度或闸门先把这次拦下了，没连后端'
  if (r === 'backend-timeout') return '后端这次没在时限内答话'
  if (r === 'backend-unsupported') return '后端不支持这一步'
  if (r === 'bad-args') return '参数不对，工具没往下走'
  if (r === 'backend-threw') return '后端那边出错了'
  return '这一步没走通'
}

/** 改票时每一步叫什么（items 里的 step，取值见 src/deck/tools/issue-patch.ts）。 */
export function zhStep(step: unknown): string {
  const s = str(step)
  if (s === 'comment') return '写评论'
  if (s === 'labels') return '改标签'
  if (s === 'assignees') return '改认领人'
  if (s === 'text') return '改正文'
  if (s === 'close') return '关闭'
  if (s === 'reopen') return '重开'
  if (s === 'stateStep') return '改状态'
  if (s === 'edge') return '补边'
  if (s === 'progress') return '写进度'
  return s || '一步'
}

/** 补边那一步是父子边还是阻塞边。 */
export function zhEdgeOp(op: unknown): string {
  return str(op) === 'parent' ? '父票' : '阻塞'
}

/** ISO 时间只留月-日（清单与地图行都用这个格式，与面板一致）。 */
export function monthDay(iso: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(iso))
  return m ? m[2] + '-' + m[3] : ''
}

/**
 * 一步没成的原因原话。回执里这一格有两种写法：一句字符串，或 {kind,message} 那样的对象；
 * 补边的那种还会把「写后读回：…」放在 evidence.text 里。取不到就回空串，卡面就只写「没成」。
 */
export function failureText(item: UnknownRecord): string {
  const reason = item.reason
  if (typeof reason === 'string') return reason
  const r = rec(reason)
  const t = str(r.text) || str(r.message) || str(r.reason)
  if (t) return t
  return str(rec(item.evidence).text)
}

/** 长文本截到 n 个字，中英混排都按字符算（卡片不追求像素级对齐）。 */
export function clip(text: string, n: number): string {
  if (text.length <= n) return text
  return text.slice(0, n - 1) + '…'
}

/**
 * 正文开头那一段。票的正文是 Markdown，最前面几行是给机器看的注释（DSH-FORMAT、幂等键、创建时间），
 * 摆到卡面上只会把真正的开头挤掉，所以先按行去掉注释行与空行再截。
 */
export function excerptOf(text: string, n: number): string {
  const lines = text.split('\n')
  const kept: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (t.indexOf('<!--') === 0) continue
    kept.push(line.replace(/\s+$/, ''))
  }
  return clip(kept.join('\n').trim(), n)
}
