/**
 * src/host/dshGoData.ts —— 技能票台面板的数据模型（地图 #3 · 票 #5）。
 *
 * 这个文件把一个会话的 scope 变成面板要摆的四份模型：地图列表、本会话的活、票详情、设置。
 * 它做三件事：认出这个会话的工作区根、读本机快照库与在办表、把两者按票号对齐。
 *
 * 为什么要有内存缓存：桥接取面板数据时只等 1 秒（firstDataWaitMs），而认工作区要问文件系统
 * （canonicalWorkspaceKey 会逐层向上找 docs/agents/workspace.yaml）。这里按会话记住上一次的读数，
 * 点按引起的重画（展开地图、打开票详情）直接用上一次的读数，不必重新读库。
 *
 * 四条不能改的约定：
 * 1. 空态与故障态分开：没选工作区、没有库、库坏了、还没动过票各有各的说法，
 *    不许拿「没有数据」一句盖住四种情况——用户看到「你没有票」和「缓存还没读出来」要做的事完全不同。
 * 2. 在办表没有状态字段：票的当前状态一律来自快照库，两边按票号对齐；快照里查不到就不编状态。
 * 3. 展开哪张地图、开着哪张票是「这个会话刚点过什么」，只活在内存里、不落盘：
 *    面板重启回概览（讨论票 #9 定的口径），宿主重启也不需要恢复它。
 * 4. 一次读数只读一份库：本机可能有多个后端的库文件，认准 docs/agents/workspace.yaml 声明的那个后端。
 */

import { canonicalWorkspaceKey } from './workspaceKey.js'
import { resolveSessionCwd } from '../shared/session-cwd.js'
import { readSnapshot, readDetail } from './dshGoCache.js'
import type { DeckIssue, DeckMap, DeckSnapshot } from './dshGoCache.js'
import { readWork } from './dshGoWork.js'
import type { WorkEntry } from './dshGoWork.js'
import type { MapViewRow, WorkViewRow, DetailView, SettingsView } from './dshGoViews.js'

/** 地图列表一页多少张（讨论票 #9 定的数）。 */
const PAGE_SIZE = 20

/** 票详情里正文最多摆多少字；超出部分提示去桌面端看。 */
const BODY_CHARS = 1900

/** 票详情里子票最多列几行。 */
const CHILD_ROWS = 8

/** 评论正文最多摆多少字。 */
const COMMENT_CHARS = 120

/** 一个会话刚点过什么。只在内存里，进程重启就忘掉。 */
export interface UiState {
  /** 面板里展开的那张地图的票号。 */
  expandedMap: string
  /** 票详情面板正在看的那张票。 */
  openTicket: string
  /** 地图列表翻到第几页（0 起）。 */
  page: number
}

/** 一次读数的全部结果：面板的 view 与 data 都从这里取。 */
export interface DeckModel {
  /** '' 表示读到了；否则是没读到的原因。 */
  reason: string
  rootKey: string
  cwd: string
  backend: string
  snapshot: DeckSnapshot
  /** 本会话在办表里的那些票（按最近动作倒序）。 */
  work: WorkEntry[]
  /** 这份读数是什么时候算出来的。 */
  at: number
}

const models = new Map<string, DeckModel>()
const uiStates = new Map<string, UiState>()

/** 取这个会话的界面状态（第一次访问时建一份空的）。 */
export function uiOf(sessionId: string): UiState {
  const key = String(sessionId || '')
  const found = uiStates.get(key)
  if (found !== undefined) return found
  const created: UiState = { expandedMap: '', openTicket: '', page: 0 }
  uiStates.set(key, created)
  return created
}

/** 记下这个会话刚点开了哪张地图 / 哪张票 / 翻到第几页，供下一次重画时读。 */
export function rememberUi(sessionId: string, patch: Partial<UiState>): void {
  const state = uiOf(sessionId)
  if (patch.expandedMap !== undefined) state.expandedMap = patch.expandedMap
  if (patch.openTicket !== undefined) state.openTicket = patch.openTicket
  if (patch.page !== undefined) state.page = Math.max(0, patch.page)
}

/** 这个会话上一次算出来的读数；没有就是 undefined。 */
export function lastModel(sessionId: string): DeckModel | undefined {
  return models.get(String(sessionId || ''))
}

function emptySnapshot(): DeckSnapshot {
  return { ok: false, reason: '', backend: '', maps: [], issues: [], byKey: new Map(), generatedAtMs: 0 }
}

/** 没读成时的空读数：把原因同时记在 reason 与 snapshot.reason 上，面板只看一处也能分辨。 */
function emptyModel(reason: string, rootKey: string, cwd: string): DeckModel {
  const snapshot = emptySnapshot()
  snapshot.reason = reason === 'no-session' ? '' : reason
  return { reason, rootKey, cwd, backend: '', snapshot, work: [], at: Date.now() }
}

/**
 * 会话 → 工作区根。认不出时给空串与原因，不拿进程目录冒充。
 * canonicalWorkspaceKey 先洗路径再逐层向上找 docs/agents/workspace.yaml，30 秒内重复调用只读缓存。
 */
async function rootOfSession(ctx: any, sessionId: string): Promise<{ rootKey: string; cwd: string; reason: string }> {
  if (!String(sessionId || '').trim()) return { rootKey: '', cwd: '', reason: 'no-session' }
  let cwd = ''
  try {
    const sessions = ctx.get('sessions')
    const session = sessions !== undefined && typeof sessions.get === 'function' ? sessions.get(String(sessionId)) : undefined
    cwd = resolveSessionCwd(session)
  } catch (e) {}
  if (!cwd) return { rootKey: '', cwd: '', reason: 'no-workspace' }
  try {
    const rootKey = await canonicalWorkspaceKey(cwd, { getPlatform: () => ctx.get('platform'), getFs: () => ctx.get('fs') })
    return { rootKey: String(rootKey || ''), cwd, reason: String(rootKey || '') ? '' : 'no-workspace' }
  } catch (e) {
    return { rootKey: '', cwd, reason: 'no-workspace' }
  }
}

/** 读一份读数（同步部分：读库 + 读在办表），并记进缓存。 */
function readModel(rootKey: string, cwd: string, sessionId: string): DeckModel {
  const snapshot = readSnapshot(rootKey)
  const work = readWork(rootKey, sessionId).entries
  const model: DeckModel = {
    reason: snapshot.ok ? '' : snapshot.reason,
    rootKey,
    cwd,
    backend: snapshot.backend,
    snapshot,
    work,
    at: Date.now(),
  }
  models.set(String(sessionId || ''), model)
  return model
}

/** 重新算一份读数（先认工作区，再读库与在办表）。认不出工作区时给带原因的空读数。 */
export async function loadModel(ctx: any, sessionId: string): Promise<DeckModel> {
  const where = await rootOfSession(ctx, sessionId)
  if (!where.rootKey) {
    const model = emptyModel(where.reason, '', where.cwd)
    models.set(String(sessionId || ''), model)
    return model
  }
  return readModel(where.rootKey, where.cwd, sessionId)
}

/** 读一份已经在手上的读数（不重新认工作区），用于点按后的刷新失败兜底。 */
export function reloadModel(model: DeckModel, sessionId: string): DeckModel {
  if (!model.rootKey) return model
  return readModel(model.rootKey, model.cwd, sessionId)
}

/** 毫秒时间摆成月-日；没有时间信息就给空串（列表里空着比写「未知」干净）。 */
export function dayText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const at = new Date(ms)
  const month = at.getMonth() + 1
  const day = at.getDate()
  return (month < 10 ? '0' + month : String(month)) + '-' + (day < 10 ? '0' + day : String(day))
}

/** 时分（在办表里显示「最近一次动作是什么时候」）。 */
function clockText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const at = new Date(ms)
  const hour = at.getHours()
  const minute = at.getMinutes()
  return (hour < 10 ? '0' + hour : String(hour)) + ':' + (minute < 10 ? '0' + minute : String(minute))
}

/** 挡着这张票的票里还有没关的吗；查不到那张票按「还挡着」算，与内核的安全侧一致。 */
function blockedOf(issue: DeckIssue, byKey: Map<string, DeckIssue>): boolean {
  for (const key of issue.blockedBy) {
    const blocker = byKey.get(key)
    if (blocker === undefined || blocker.state !== 'closed') return true
  }
  return false
}

/** 一张票在列表里的三态之一：已关闭 / 在做 / 被挡着 / 能接。 */
function stateWords(issue: DeckIssue, byKey: Map<string, DeckIssue>): { state: string; claimed: boolean; blocked: boolean } {
  if (issue.state === 'closed') return { state: '已关闭', claimed: false, blocked: false }
  const claimed = issue.assignees.length > 0
  const blocked = blockedOf(issue, byKey)
  return { state: claimed ? '在做' : blocked ? '被挡着' : '能接', claimed, blocked }
}

/** 把一张地图折成列表行（展开时带上未关闭的子票与已关闭张数）。 */
function mapRowOf(map: DeckMap, byKey: Map<string, DeckIssue>, expanded: boolean): MapViewRow {
  const tickets = map.tickets
    .filter((ticket) => ticket.state !== 'closed')
    .map((ticket) => {
      const words = stateWords(ticket, byKey)
      return { key: ticket.key, title: ticket.title, state: words.state, claimed: words.claimed, blocked: words.blocked }
    })
  let closedCount = 0
  for (const ticket of map.tickets) if (ticket.state === 'closed') closedCount += 1
  return {
    key: map.issue.key,
    title: map.issue.title,
    decided: map.closed,
    total: map.total,
    nextKey: map.frontier === null ? '' : map.frontier.key,
    nextTitle: map.frontier === null ? '' : map.frontier.title.slice(0, 12),
    trailing: dayText(map.updatedAtMs),
    expanded,
    tickets,
    closedCount,
  }
}

/**
 * 地图列表的一页：只摆当前这一页（默认 20 张），顺序沿用快照折出来的顺序
 * （能接票的在前 → 最后活动倒序 → 票号小在前），这里不再重排。
 */
export function mapRows(model: DeckModel, sessionId: string): { rows: MapViewRow[]; more: number; page: number; total: number } {
  const ui = uiOf(sessionId)
  const byKey = model.snapshot.byKey
  const all = model.snapshot.maps
  const start = ui.page * PAGE_SIZE
  const slice = all.slice(start, start + PAGE_SIZE)
  const rows = slice.map((map) => mapRowOf(map, byKey, ui.expandedMap === map.issue.key))
  return { rows, more: Math.max(all.length - start - slice.length, 0), page: ui.page, total: all.length }
}

/** 本会话的活：先看在办表有没有记录，再逐张把状态从快照里补齐。 */
export function workRows(model: DeckModel): WorkViewRow[] {
  const byKey = model.snapshot.byKey
  return model.work.map((entry) => {
    const issue = byKey.get(entry.key)
    const state = issue === undefined ? '本机还没有这张票' : stateWords(issue, byKey).state
    return {
      key: entry.key,
      title: entry.title || (issue === undefined ? '' : issue.title),
      state,
      action: entry.action === 'report' ? '上报' : '改动',
      at: clockText(entry.at),
    }
  })
}

/** 最近动过的三张地图（没动过票时用它们告诉用户「这里有什么」）。 */
export function recentMaps(model: DeckModel): MapViewRow[] {
  return model.snapshot.maps.slice(0, 3).map((map) => mapRowOf(map, model.snapshot.byKey, false))
}

/** 票详情：五段内容按优先级摆好，缺哪段就说明缺什么（顺序见讨论票 #9）。 */
export function detailOf(model: DeckModel, sessionId: string, key: string): DetailView {
  const ticket = String(key || uiOf(sessionId).openTicket || '')
  const byKey = model.snapshot.byKey
  const issue = byKey.get(ticket)
  if (issue === undefined) {
    return {
      key: ticket,
      title: '这张票不在本机缓存里',
      state: '',
      assignees: '',
      labels: '',
      body: '',
      bodyNote: '等本机缓存刷新后再看。',
      children: [],
      childrenNote: '',
      blockedBy: '',
      blocking: '',
      comments: [],
      commentsNote: '',
    }
  }
  const words = stateWords(issue, byKey)
  const detail = readDetail(model.rootKey, model.backend || model.snapshot.backend, ticket)
  const body = detail.body
  const children = model.snapshot.issues.filter((item) => item.parentKey === ticket && item.type !== 'map' && item.type !== 'spec')
  return {
    key: ticket,
    title: issue.title,
    state: words.state,
    assignees: issue.assignees.length ? '指派 ' + issue.assignees.join('、') : '未指派',
    labels: issue.labels.length ? issue.labels.join('、') : '无标签',
    body: body.length > BODY_CHARS ? body.slice(0, BODY_CHARS) : body,
    bodyNote: body.length > BODY_CHARS ? '正文共 ' + body.length + ' 字，完整内容请到桌面端看' : body ? '' : '正文还没同步到本机',
    children: children
      .slice(0, CHILD_ROWS)
      .map((child) => ({ key: child.key, title: child.title, state: stateWords(child, byKey).state })),
    childrenNote: children.length > CHILD_ROWS ? '还有 ' + (children.length - CHILD_ROWS) + ' 张子票' : '',
    blockedBy: issue.blockedBy.length ? '被挡着：#' + issue.blockedBy.join('、#') : '',
    blocking: issue.blocking.length ? '挡着：#' + issue.blocking.join('、#') : '',
    comments: detail.comments.map((comment) => ({
      author: comment.author || '某人',
      text: comment.text.slice(0, COMMENT_CHARS),
      at: dayText(comment.at),
    })),
    commentsNote: detail.commentTotal > detail.comments.length ? '共 ' + detail.commentTotal + ' 条评论' : '',
  }
}

/** 设置页的四格读数：后端、工作区、缓存最后写入时间、插件版本。 */
export function settingsOf(model: DeckModel, version: string): SettingsView {
  const at = model.snapshot.generatedAtMs
  return {
    backend: model.backend || model.snapshot.backend || '还没认出',
    workspace: model.rootKey || '还没选工作区',
    snapshot: model.snapshot.ok ? (at > 0 ? '同步于 ' + dayText(at) + ' ' + clockText(at) : '已读到') : '没有读到本机缓存',
    version,
    note: '这里只读本机缓存、不改票；改票请在对话里让技能票台去做。',
  }
}

/** 状态条要的那几个数：只有一张地图在办时给进度与下一张票，多张时只报张数。 */
export interface StripFacts {
  /** 'none'（没在做地图）| 'progress'（有下一张能接的）| 'stuck'（还有没关的票但都接不了）| 'done'（这张地图做完了）| 'many'（多张在办）。 */
  kind: string
  decided: number
  total: number
  nextKey: string
  mapCount: number
}

/**
 * 状态条取数：本会话正在做的那张地图优先，其次面板里展开的那张，再次唯一的那张；
 * 都没有就报张数（讨论票 #9 定的顺序）。
 */
export function stripOf(model: DeckModel, sessionId: string): StripFacts {
  const maps = model.snapshot.maps
  if (maps.length === 0) return { kind: 'none', decided: 0, total: 0, nextKey: '', mapCount: 0 }
  const ui = uiOf(sessionId)
  const working = workMapOf(model, maps)
  const expanded = ui.expandedMap ? maps.filter((map) => map.issue.key === ui.expandedMap)[0] : undefined
  const target = working || expanded || (maps.length === 1 ? maps[0] : undefined)
  if (target === undefined) return { kind: 'many', decided: 0, total: 0, nextKey: '', mapCount: maps.length }
  const facts: StripFacts = { kind: 'stuck', decided: target.closed, total: target.total, nextKey: '', mapCount: maps.length }
  if (target.frontier !== null) {
    facts.kind = 'progress'
    facts.nextKey = target.frontier.key
    return facts
  }
  let open = 0
  for (const ticket of target.tickets) if (ticket.state !== 'closed') open += 1
  if (open === 0) facts.kind = 'done'
  return facts
}

/** 本会话在办表里的票落在哪张地图上（用于状态条挑「正在做的那张」）。 */
function workMapOf(model: DeckModel, maps: DeckMap[]): DeckMap | undefined {
  for (const entry of model.work) {
    for (const map of maps) {
      if (map.issue.key === entry.key) return map
      for (const ticket of map.tickets) if (ticket.key === entry.key) return map
    }
  }
  return undefined
}
