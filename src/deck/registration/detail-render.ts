/**
 * src/deck/registration/detail-render.ts —— 工具结果交给模型的那一份「摘要 + 提示 + 明细」（#809）
 *
 * 这段逻辑原先住在 register-options.ts 里。搬出来是因为文件粒度门禁（一个源码文件不超过 350 有效行），
 * 而它与注册那一步没有关系：注册只决定「交什么形状出去」，这里决定「内容怎么交给模型」。
 *
 * 三件不能改的事：
 *   1. 提示（notes）排在明细前面。它是工具对「这次拿到的不一定全」的如实警告，丢了才最危险。
 *   2. 压掉的地方一律原地写明（截了多少、丢了几项、哪些字段没带回），不让人误以为拿全了。
 *   3. 明细取不出来（循环引用等）时回一句说明，不回空串——回空串会让模型以为这次没有明细。
 */

/** 未知形状的对象：回执来自各工具实现，只按字段逐个取，不假设一定有。 */
type UnknownRecord = Record<string, unknown>

// 明细交给模型时要守的两个上限（#809）。各工具自己的参数（comments / limit / frontierOnly）
// 才是日常旋钮，这两个是兜底：单个长段最多给多少字符、整份明细最多给多少字符。
// 8000 按「一段票正文或一条评论正文」的常见长度取；60000 约两万 token 量级，够放满一屏明细，
// 又不至于把对话历史冲爆。压掉的地方一律原地写明，不让人误以为拿全了。
export const DETAIL_STRING_CAP = 8000
export const DETAIL_TOTAL_CAP = 60000

// 往下传余量的投影：字符串超了按余量截；数组装不下时整项不送并说清丢了几项；对象装不下时把
// 装不下的字段名列出来。输出的形状始终是合法 JSON，模型能直接解析，不必从半截 JSON 里猜。
// 嵌套深到 12 层就停并说明，不再往里钻——回包里不会有比这更深的结构，钻下去只会栈溢出。
//
// 余量必须放在一个共享对象里往下传，不能按值传：按值传的话，子级花掉的额度不会归还给父级，
// 父级仍拿原额度去量子级，于是「正好填满预算」的子级会被误判成超了而整块丢掉——
// 一张带五十条评论的票就会只得到一句「comments 未带回」。
// 括号、逗号、引号、键名这些结构开销是估算着扣的，不是精确值；单个字符串还有 8000 的上限
// 兜着，误差有界。
export function projectDetail(v: unknown, budget: { left: number }, depth: number): unknown {
  if (depth > 12) return '（这里嵌套太深，没有展开）'
  if (typeof v === 'string') {
    const cap = Math.min(budget.left, DETAIL_STRING_CAP)
    const s = v.length <= cap ? v : v.slice(0, cap) + '……（本段已截断，原长 ' + v.length + ' 字符）'
    budget.left -= s.length
    return s
  }
  if (Array.isArray(v)) {
    budget.left -= 2
    const out: unknown[] = []
    let cut = 0
    for (let i = 0; i < v.length; i++) {
      if (out.length) budget.left -= 1
      if (budget.left <= 0) { cut += v.length - i; break }
      out.push(projectDetail(v[i], budget, depth + 1))
    }
    if (cut) out.push('……（此处还有 ' + cut + ' 项未带回）')
    return out
  }
  if (v !== null && typeof v === 'object') {
    budget.left -= 2
    const out: UnknownRecord = {}
    const cut: string[] = []
    for (const k of Object.keys(v)) {
      if (Object.keys(out).length) budget.left -= 1
      budget.left -= k.length + 3
      if (budget.left <= 0) { cut.push(k); continue }
      out[k] = projectDetail((v as UnknownRecord)[k], budget, depth + 1)
    }
    if (cut.length) out.__未带回 = '未带回的字段：' + cut.join('、') + '（超出总量上限）'
    return out
  }
  return v
}

// 挑出值得交给模型的那几格：data 是各工具的明细；items 装着建票与补边逐条的落点证据
// （deck_map_link 的说明承诺「如实回报这条边落在哪一列」就靠它）；readBack 是写后回读核对。
// deck_issue_patch 曾经把同一份整票同时放进 data.ticket 与 readBack（#1273 已改成顶层只放
// 核对摘要 {key, state, updatedAt}），这里仍按内容认一次重：别的工具直连时两格仍可能是同一个对象，
// 将来别的工具再把同一份放进两格也不会白吃两遍预算。顶层的 cost / touched 是运行元数据
// （touched 恒为空数组）不送；deck_context 的 data 里那几格 workspace / backend / repo /
// quota / howto 本来就是它要给 AI 看的内容，照送不误。
/**
 * 认「同一份内容」：先比引用（直连时就是同一个对象），再比逐字序列化。
 * 为什么不能只比引用（#1303）：生产路径上 deck 工具由宿主代执行，结果过了一次 RPC 的
 * 结构化克隆，data.ticket 与 readBack 由同一个对象变成两份内容相同的副本，引用永远不等；
 * 只比引用会把同一张票面投影两遍（实测一份 2,474 字符）。序列化失败（循环引用等）就当不同。
 * #1273 已把源头收口（顶层 readBack 只放核对摘要），这一层仍留作护栏：直连时两格同引用、
 * 以后别的工具把同一份放两格，都不会重复投影。代价是每个候选一次序列化（实测 1000 次约 8ms）。
 */
export function sameRenderedValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  try { return JSON.stringify(a) === JSON.stringify(b) } catch (e) { return false }
}
export function detailBlock(v: unknown): string {
  const source = v as UnknownRecord;
  const pick: UnknownRecord = {}
  if (source.data !== undefined && source.data !== null) pick.data = source.data
  if (Array.isArray(source.items) && source.items.length) pick.items = source.items
  const d = pick.data as UnknownRecord | null | undefined;
  const sameTicket = d !== null && typeof d === 'object' && !Array.isArray(d) && d !== undefined && sameRenderedValue(d.ticket, source.readBack)
  if (source.readBack !== undefined && source.readBack !== null && !sameTicket) pick.readBack = source.readBack
  if (typeof source.reason === 'string' && source.reason) pick.reason = source.reason
  if (!Object.keys(pick).length) return ''
  let s = ''
  try { s = JSON.stringify(projectDetail(pick, { left: DETAIL_TOTAL_CAP }, 0)) || '' } catch (e) {
    return '明细（取不出来）：里面有循环引用或不可序列化的值，本次只给了上面那一句摘要。'
  }
  return '明细（JSON）：\n' + s
}

// 交给模型的全部内容：一句摘要 + 工具的如实提示 + 明细。#809 之前只回那一句摘要，正文、评论、
// 标签、子票清单、地图五区块、逐条边的落点证据，连同 notes 里的降级警告全被丢掉——工具说明
// 与代理文档都承诺这些明细，模型却一样拿不到，还会把残缺结果当完整结果用。
export function deckAgentRender(args: unknown, value: unknown): { type: string; text: string }[] {
  const v = (value && typeof value === 'object' ? value : {}) as UnknownRecord;
  const out: { type: string; text: string }[] = []
  const text = typeof v.text === 'string' ? v.text : ''
  if (text) out.push({ type: 'text', text: text })
  // 提示排在明细前面：它是工具对「这次拿到的不一定全」的如实警告，丢了才最危险。
  if (Array.isArray(v.notes) && v.notes.length) {
    out.push({ type: 'text', text: '本次调用的提示：\n' + (v.notes as unknown[]).map(function (n: unknown) { return '- ' + String(n) }).join('\n') })
  }
  const detail = detailBlock(v)
  if (detail) out.push({ type: 'text', text: detail })
  return out.length ? out : [{ type: 'text', text: text || '' }]
}
