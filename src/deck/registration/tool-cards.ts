/**
 * src/deck/registration/tool-cards.ts —— 九个 deck_* 工具在手机 App 里的原生工具卡（地图 #3 · 票 #4）
 *
 * 这个文件只做一件事：把一次工具调用回来的回执，画成一张卡片。九张卡的区别只在 tool 是哪个，
 * 版面、标题、状态块按地图 #3「Decisions so far」第 5 条（讨论票 #11）的定稿来。
 * 共用的取值、文案小件在 tool-cards-words.ts，版面小件在 tool-cards-blocks.ts。
 *
 * 四条最要紧的规矩，改这个文件之前先读：
 *   1. 这里绝不能抛错、也绝不能回 undefined。框架那边（dsh-tools 的 snapshotProjection）拿到
 *      异常或非无损 JSON，会把整次工具调用判成失败——一条画砸的卡片不该毁掉一次本来成功的调用。
 *      所以下面的出口包在 try 里，画不出来就回 {}，也就是「这次不出卡，照旧看文字」。
 *   2. 工具卡没有数据模型：节点里只写当时的真值，不写 {$:…} 绑定（绑了只会绑到空处）。
 *   3. 第 0 期的工具卡不能点：卡里不写 action，也不放按钮。
 *   4. 一张卡至少要有一块内容：桥接那侧把「子节点为空」判成坏视图，整卡打不开。
 *      所以骨架在兜底时会补一句灰字，别把这条兜底删掉。
 *
 * 还有一条不是规矩、是经验：不完整必须一眼可辨。status 是 partial 或 unsupported 时，标题就要
 * 说出「没做全」这件事，并且标题下第一块是 callout（partial 用 warn，unsupported 用 bad）。
 * 卡片是给人确认结果的，不是给模型的操作手册——所以写类卡不写「下一步」，只写「还差什么」。
 *
 * 尺寸口径来自桥接那一侧：一张工具卡不超过 8 KiB、40 个组件、6 层，标题不超过 40 字。
 * 超了不会报错，桥接会安静地少画几块，所以这里自己也量一遍，超了就干脆不出卡。
 */

import {
  rec,
  str,
  num,
  isRecord,
  listOf,
  isPartial,
  isUnsupported,
  titleOf,
  zhState,
  zhStateFilter,
  zhSource,
  zhStep,
  zhEdgeOp,
  monthDay,
  failureText,
  clip,
  excerptOf,
  TITLE_MAX,
  EXCERPT_MAX,
  LIST_MAX,
  LIST_MAX_SHORT,
  CARD_KEY,
  CARD_MAX_BYTES,
  CARD_MAX_COMPONENTS,
  CARD_MAX_DEPTH,
} from "./tool-cards-words.js"
import {
  footnote,
  callout,
  keyValue,
  listNode,
  rowOf,
  progressBar,
  statusBlock,
  skeleton,
  permissionLabel,
  bodyTextOf,
} from "./tool-cards-blocks.js"
import type { CardBuilder, CardNode, UnknownRecord } from "./tool-cards-words.js"


/* ── 九张卡 ─────────────────────────────────────────────────────────────── */

/** deck_context：这个工作区连的是哪个后端、哪个仓库、能不能写、有几张地图。 */
function cardDeckContext(value: UnknownRecord): CardNode | null {
  const backend = rec(value.backend)
  const repo = rec(value.repo)
  const workspace = rec(value.workspace)
  const backendId = str(backend.id) || str(value.backendId)
  const repoName = str(repo.name) || str(repo.refId)
  const maps = listOf(value.maps)
  const partial = isPartial(value)
  const title = titleOf(
    value,
    backendId ? '后端 ' + backendId + ' · 仓库 ' + (clip(repoName, 18) || '还没定') : '这个工作区还没选后端',
    '读了后端，但没读全',
    '这次没读到后端',
  )
  const rows: [string, string][] = []
  if (backendId) rows.push(['后端', backendId + '（' + zhSource(backend.source) + '）'])
  if (repoName) rows.push(['仓库', repoName])
  if (workspace.key) rows.push(['工作区', clip(str(workspace.key), 16)])
  if (repoName) rows.push(['写权限', permissionLabel(repo.permissions)])
  if (!partial) rows.push(['地图', maps.length ? maps.length + ' 张' : '还没有'])
  const readonly = repoName && permissionLabel(repo.permissions) === '只读'
  return skeleton(title, [
    statusBlock(value, '后端连上了，但地图清单这次没读回来。', '过一会儿再调一次就能读到。'),
    keyValue(rows),
    readonly ? footnote('这个仓库只读：标签与写操作不可用，要长期协作建议先 fork 到自己名下。') : null,
  ])
}

/** deck_issue_list：列了哪些票，每行票号 + 标题 + 最后改动。 */
function cardIssueList(value: UnknownRecord, args: UnknownRecord): CardNode | null {
  const issues = listOf(value.issues)
  const returned = num(value.returned) ?? issues.length
  const total = num(value.total)
  const title = titleOf(
    value,
    '列了 ' + returned + ' 张票（' + zhStateFilter(args.state) + '）',
    '名单没读全（这次没读完）',
    '名单没读回来',
  )
  const rows: CardNode[] = []
  for (const item of issues.slice(0, LIST_MAX)) {
    const issue = rec(item)
    const key = str(issue.key)
    rows.push(rowOf('#' + (key || '?') + ' ' + clip(str(issue.title), 28), monthDay(issue.updatedAt), ''))
  }
  const truncated = value.truncated === true || value.backendTruncated === true
  const missing = str(value.incomplete) === 'budget' ? '要的多，这次只答应了一部分。' : '这次读超时了，名单是空的。'
  return skeleton(title, [
    statusBlock(value, missing, '过一会儿缩小范围再调一次就能读到。'),
    listNode(rows),
    !rows.length && !isPartial(value) && !isUnsupported(value) ? footnote('一张也没列到。') : null,
    truncated && total !== null ? footnote('显示 ' + returned + ' / 共 ' + total + ' 张。') : null,
  ])
}

/** deck_issue_get：一张票的关键关系，加正文开头一段。 */
function cardIssueGet(value: UnknownRecord): CardNode | null {
  const ticket = rec(value.ticket)
  const relations = rec(value.relations)
  const body = rec(value.body)
  const key = str(ticket.key) || str(value.key)
  const label = key ? '#' + key : '#?'
  const title = titleOf(
    value,
    label + ' ' + clip(str(ticket.title), 30),
    label + ' 没读全',
    label + ' 没读回来',
  )
  const rows: [string, string][] = []
  if (key) rows.push(['票号', '#' + key])
  if (ticket.state) rows.push(['状态', zhState(ticket.state)])
  // 关系这三行只在真读到 relations 时才写：一次没读回来的调用如果照样写「没有」，
  // 会让人以为这张票真的既没父票也没人挡着，比不写更糟。
  if (isRecord(value.relations)) {
    rows.push(['父票', str(relations.parentKey) ? '#' + str(relations.parentKey) : '没有'])
    const blockedBy = listOf(relations.blockedBy)
    const blocking = listOf(relations.blocking)
    rows.push(['被阻塞', blockedBy.length ? blockedBy.length + ' 条' : '没有'])
    rows.push(['阻塞别人', blocking.length ? blocking.length + ' 条' : '没有'])
  }
  const blocks: (CardNode | null)[] = [
    statusBlock(value, '票的外壳读到了，正文这次没读回来。', '过一会儿再调一次就能读到。'),
    keyValue(rows),
  ]
  const excerpt = excerptOf(bodyTextOf(body), EXCERPT_MAX)
  if (excerpt) blocks.push({ type: 'text', text: excerpt })
  const length = num(body.length)
  const mode = str(body.mode)
  if (length !== null && length > EXCERPT_MAX) blocks.push(footnote('正文共 ' + length + ' 字，这里只放开头。'))
  else if (mode && mode !== 'excerpt') blocks.push(footnote('这一档拿回来的不是全文。'))
  return skeleton(title, blocks)
}

/** deck_issue_create：建成了哪张票，挂在哪、带什么标签、被谁挡着。 */
function cardIssueCreate(value: UnknownRecord): CardNode | null {
  const ticket = rec(value.ticket)
  const key = str(ticket.key)
  const parentKey = str(ticket.parentKey)
  const labels = listOf(ticket.labels)
  const blockedBy = listOf(ticket.blockedBy)
  const rows: [string, string][] = []
  if (key) rows.push(['票号', '#' + key])
  if (str(ticket.title)) rows.push(['标题', clip(str(ticket.title), 30)])
  rows.push(['父票', parentKey ? '#' + parentKey : '没有'])
  rows.push(['标签', labels.length ? labels.map(function (l) { return str(l) }).join('、') : '没有'])
  if (blockedBy.length) rows.push(['被阻塞', blockedBy.map(function (b) { return '#' + str(b) }).join('、')])
  const title = titleOf(
    value,
    key ? '建了 #' + key + ' 一张票' : '这次没建成票',
    '票建好了，但没做全',
    '这次没建成票',
  )
  return skeleton(title, [
    statusBlock(value, '票建好了，但有的附加步骤没做完。', '照着下面逐条看哪一步没成。'),
    keyValue(rows),
  ])
}

/** deck_issue_patch：点了哪几步、哪一步没成。没成的那一行标红，标题也说清楚成了几步。 */
function cardIssuePatch(value: UnknownRecord): CardNode | null {
  const ticket = rec(value.ticket)
  const items = listOf(value.items)
  const key = str(ticket.key) || (items.length ? str(rec(items[0]).key) : '')
  let done = 0
  const rows: CardNode[] = []
  for (const item of items) {
    const step = rec(item)
    const ok = str(step.status) === 'ok'
    if (ok) done += 1
    const skipped = step.skipped === true
    const trailing = skipped ? '跳过' : ok ? '成了' : '没成'
    rows.push(rowOf(zhStep(step.step), trailing, ok || skipped ? '' : 'bad'))
  }
  const head = key ? '#' + key + ' ' : '改票：'
  const okTitle = head + '点了 ' + items.length + ' 步，成了 ' + done + ' 步'
  const title = titleOf(value, okTitle, okTitle + '（没做全）', head + '这次没改成')
  return skeleton(title, [
    statusBlock(value, '有的步骤没成，票上只有一部分改动落了地。', '逐条看下面哪一步没成，别把没成的那步当成已改好。'),
    listNode(rows),
    items.length && done < items.length ? footnote('返回值是写后读回的真状态。') : null,
  ])
}

/** deck_issue_report：上报在办／办完这件事做成了没有。 */
function cardIssueReport(value: UnknownRecord): CardNode | null {
  const key = str(value.key)
  const state = str(value.state)
  const rows: [string, string][] = []
  if (key) rows.push(['票号', '#' + key])
  if (state) rows.push(['状态', zhState(state)])
  const title = titleOf(value, key ? '#' + key + ' 已上报' : '已上报', key ? '#' + key + ' 没报全' : '这次没报全', '这次没报上')
  return skeleton(title, [
    statusBlock(value, '这次没报上。', '票面没动过，过一会儿再调一次。'),
    keyValue(rows),
  ])
}

/** deck_map_snapshot：地图做到哪一步了，现在能接哪几张。 */
function cardMapSnapshot(value: UnknownRecord): CardNode | null {
  const map = rec(value.map)
  const stats = rec(value.stats)
  const children = listOf(value.children)
  const key = str(map.key)
  const label = '地图 #' + (key || '?')
  const hasStats = value.stats !== null && value.stats !== undefined && Object.keys(stats).length > 0
  const closed = num(stats.closed) ?? 0
  const total = num(stats.total) ?? 0
  const open = num(stats.open) ?? 0
  const title = titleOf(
    value,
    hasStats ? label + '：已关闭 ' + closed + ' / 共 ' + total : label + '：子票没数出来',
    label + '：子票没数出来',
    label + ' 没读回来',
  )
  const blocks: (CardNode | null)[] = [
    statusBlock(value, '子票没数出来，进度先不写。', '过一会儿再调一次就能读到。'),
  ]
  // 一张子票都没有时不出进度条：0/0 画出来是一根空杠，比不画更让人以为坏了。
  if (hasStats && total > 0) blocks.push(progressBar(closed, total, '已关闭 / 共'))
  const rows: CardNode[] = []
  for (const item of children) {
    if (rows.length >= LIST_MAX) break
    const child = rec(item)
    if (str(child.state) !== 'open') continue
    if (listOf(child.blockedBy).length) continue
    if (listOf(child.assignees).length) continue
    rows.push(rowOf('#' + str(child.key) + ' ' + clip(str(child.title), 26), '能接', ''))
  }
  blocks.push(listNode(rows))
  if (rows.length) {
    blocks.push(footnote('能接的票只列前 ' + rows.length + ' 张。'))
  } else if (hasStats && total > 0) {
    blocks.push(footnote(open > 0 ? '现在没有能接的票：还开着的都被挡着或已经有人在做。' : '这张地图的子票都关了。'))
  } else if (hasStats) {
    blocks.push(footnote('这张地图还没有子票。'))
  }
  return skeleton(title, blocks)
}

/** deck_map_link：补了几条边，哪条没补上、为什么。 */
function cardMapLink(value: UnknownRecord): CardNode | null {
  const items = listOf(value.items)
  const done = num(value.done) ?? 0
  const failed: UnknownRecord[] = []
  const rows: CardNode[] = []
  for (const item of items) {
    const edge = rec(item)
    const ok = str(edge.status) === 'ok'
    if (!ok) failed.push(edge)
    const pair = '#' + str(edge.key) + ' → #' + str(edge.target)
    rows.push(rowOf(pair, zhEdgeOp(edge.op) + (ok ? '' : ' · 没成'), ok ? '' : 'bad'))
  }
  const okTitle = '接了 ' + done + ' 条边'
  const title = titleOf(
    value,
    failed.length ? okTitle + '，' + failed.length + ' 条失败' : okTitle,
    (failed.length ? okTitle + '，' + failed.length + ' 条失败' : okTitle) + '（没接全）',
    '这次没接成边',
  )
  const blocks: (CardNode | null)[] = []
  const status = statusBlock(value, '有的边没接上，图上只有一部分关系。', '逐条看下面哪条没成。')
  if (status) blocks.push(status)
  else if (failed.length) {
    const first = failed[0]
    const why = failureText(first)
    const pair = '「#' + str(first.key) + ' → #' + str(first.target) + '」'
    blocks.push(callout('最该先说的是 ' + pair + (why ? '：' + clip(why, 80) : '。'), 'warn'))
  }
  blocks.push(listNode(rows))
  return skeleton(title, blocks)
}

/** deck_map_plan_create：这一片建了几张子票，还剩多少没建。 */
function cardMapPlanCreate(value: UnknownRecord): CardNode | null {
  const builtKeys = listOf(value.builtKeys)
  const restKeys = listOf(value.restKeys)
  const counts = rec(value.counts)
  const planned = num(counts.planned) ?? builtKeys.length + restKeys.length
  const okTitle = '建了 ' + builtKeys.length + ' 张子票（计划 ' + planned + ' 张）'
  const title = titleOf(
    value,
    okTitle,
    restKeys.length ? '建了 ' + builtKeys.length + ' 张子票（计划 ' + planned + ' 张，没建全）' : okTitle,
    '这次没建成子票',
  )
  const blocks: (CardNode | null)[] = [statusBlock(value, '这一片没建全。', '')]
  if (planned > 0) blocks.push(progressBar(builtKeys.length, planned, '已建 / 计划'))
  const rows: CardNode[] = []
  for (const key of builtKeys.slice(0, LIST_MAX_SHORT)) rows.push(rowOf('#' + str(key), '', ''))
  blocks.push(listNode(rows))
  if (restKeys.length) {
    blocks.push(callout('还有 ' + restKeys.length + ' 张没建，带同一个 planId 再调一次接着建。', 'warn'))
  }
  return skeleton(title, blocks)
}

/**
 * 工具名到卡片。注意 deck_work_route 不在这里：#11 定稿只画了九张，它照旧只有文字。
 * suggest_next_steps 也走同一个输出形状，同样不在名单里。
 */
const BUILDERS: Record<string, CardBuilder> = {
  deck_context: function (v) { return cardDeckContext(v) },
  deck_issue_list: function (v, a) { return cardIssueList(v, a) },
  deck_issue_get: function (v) { return cardIssueGet(v) },
  deck_issue_create: function (v) { return cardIssueCreate(v) },
  deck_issue_patch: function (v) { return cardIssuePatch(v) },
  deck_issue_report: function (v) { return cardIssueReport(v) },
  deck_map_snapshot: function (v) { return cardMapSnapshot(v) },
  deck_map_link: function (v) { return cardMapLink(v) },
  deck_map_plan_create: function (v) { return cardMapPlanCreate(v) },
}

/* ── 尺寸自量：超了就干脆不出卡，别让桥接安静地少画几块 ───────────────────── */

/** UTF-8 字节数。本域没有 Node 类型，用 DOM 里的 TextEncoder（运行时两边都有）。 */
function byteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length
  } catch (e) {
    return text.length * 3
  }
}

/** 数一遍组件数与层数。只数带 type 的节点，纯值对象不算。 */
function measure(node: unknown, depth: number, acc: { nodes: number; depth: number }): void {
  if (Array.isArray(node)) {
    for (const item of node) measure(item, depth, acc)
    return
  }
  if (!isRecord(node)) return
  let next = depth
  if (typeof node.type === 'string') {
    acc.nodes += 1
    if (depth > acc.depth) acc.depth = depth
    next = depth + 1
  }
  for (const key of Object.keys(node)) measure(node[key], next, acc)
}

/* ── 出口 ───────────────────────────────────────────────────────────────── */

/**
 * 把回执摊平一层给各张卡用。回执分三层（壳的 status/reason、data 里的正事、items 里的逐条步骤），
 * 而卡片只关心「这次成了什么、哪些没成」，所以合成一层：data 的格先铺开，再由外层覆盖
 * status / reason / items / readBack —— 外层是权威，data 里即便有同名格也不该盖掉它。
 */
function receiptView(v: UnknownRecord): UnknownRecord {
  const flat: UnknownRecord = Object.assign({}, rec(v.data))
  flat.status = v.status
  flat.reason = v.reason
  if (Array.isArray(v.items)) flat.items = v.items
  if (v.readBack !== undefined && v.readBack !== null) flat.readBack = v.readBack
  return flat
}

/**
 * 一次工具调用的原生卡片。挂到输出形状的 presentationMeta 上（两处工厂各挂一次）。
 *
 * 认身份只靠回执自己的 tool 字段：presentationMeta 拿不到工具名，而同一个输出形状
 * 也被 suggest_next_steps 用着——它不在九张卡的名单里，直接回 {} 不出卡。
 *
 * 任何情况下都回一个对象：画不出来回 {}（不出卡，照旧看文字），绝不抛错、绝不回 undefined。
 */
export function deckToolCard(_args: unknown, value: unknown): UnknownRecord {
  try {
    const v = rec(value)
    const tool = str(v.tool)
    if (!tool) return {}
    const build = BUILDERS[tool]
    if (!build) return {}
    const view = build(receiptView(v), rec(_args))
    if (!view) return {}
    const text = JSON.stringify(view)
    if (!text) return {}
    if (byteLength(text) > CARD_MAX_BYTES) return {}
    const acc = { nodes: 0, depth: 0 }
    measure(view, 1, acc)
    if (acc.nodes > CARD_MAX_COMPONENTS) return {}
    if (acc.depth > CARD_MAX_DEPTH) return {}
    return { [CARD_KEY]: JSON.parse(text) as unknown }
  } catch (e) {
    return {}
  }
}
