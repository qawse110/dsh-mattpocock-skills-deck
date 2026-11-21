/**
 * src/host/dshGoCache.ts —— 技能票台面板要读的本机快照库（地图 #3 · 票 #5）。
 *
 * 这个文件干什么：把 <工作区根>/.dsh-mattskillsdeck-cache/snapshot/<后端>.sqlite 只读读成
 * 面板要的地图、子票、正文与评论。这份库是刷新房每轮刷新落下来的，桌面端首屏也读它。
 *
 * 为什么自己读、不走宿主电话：宿主电话（wf.snapshot 等）住在 src/host/index.ts 的 bootBody 闭包里，
 * 而面板注册发生在 bootBody 第一次调用之前，那时闭包里那张电话表还不存在；入口又贴着 400 行上限、
 * 电话条数还有硬断言（tests/verify-settings-phones.ts），本轮不加电话。node:sqlite 是 Node 内建模块，
 * 只读打开一份已经存在的库不需要任何许可，也不产生写副作用。
 *
 * 为什么不走 openWorkspaceSnapshot：写库是刷新房的职责（建库、按身份三格重建、持租约），那条路
 * 没有只读开关，第一次开就会 mkdir 并按可写开。面板只要看，绝不能因为「打开面板」而改动刷新房的状态。
 *
 * 三条不能改的约定：
 * 1. 打不开不等于空库：异常一律收成 reason。空态（这个工作区一张票都没有）与故障态（库坏了、还没同步）
 *    必须分开，否则用户看到的是「你没有票」，而不是「缓存还没读出来」。
 * 2. 一次读要在一秒内完成：面板首帧只等 1 秒（桥接 firstDataWaitMs），这里只做同步读、只取要用的列。
 * 3. 统计口径不另写一份：层级与「可接 / 被挡 / 已认领」调 src/tracker/kernel/grouping.ts，
 *    只有一处定义（它与宿主那份 src/host/ticketGrouping.ts 是同一判定的两份副本，改动要同步）。
 */

import { WORKSPACE_YAML_REL } from '../shared/config-store/src/workspace.js'
import { groupTickets } from '../tracker/kernel/grouping.js'

// 本域 tsconfig 有意不加载 Node 类型包（types 为空），运行时一定是 Node（22.3 起有 getBuiltinModule）。
declare const process: { getBuiltinModule(id: string): any }

/** 快照库所在的缓存目录名（与 src/workspace-snapshot/runtime/paths.ts 的 SNAPSHOT_CACHE_DIR 同一个值）。 */
const CACHE_DIR_REL = '.dsh-mattskillsdeck-cache'
/** 快照库文件所在的子目录名。 */
const SNAPSHOT_DIR_NAME = 'snapshot'

/** 一张票。字段是面板要用的最小集合，不是快照行的全量。 */
export interface DeckIssue {
  key: string
  title: string
  /** 快照里的类型：map / spec / issue 等，原样保留，只用来分容器与票。 */
  type: string
  /** 统一成小写（快照库里存的就是小写，宿主送给客户端时才升成大写）。 */
  state: string
  updatedAtMs: number
  commentCount: number
  labels: string[]
  assignees: string[]
  /** 父票的票号（靠 issue_edge 的 parent 边算出来），没有父票就是空串。 */
  parentKey: string
  /** 挡着这张票的票号（要等它们关掉才能接）。 */
  blockedBy: string[]
  /** 这张票挡着的票号。 */
  blocking: string[]
}

/** 一张地图连同它的子票与统计。 */
export interface DeckMap {
  issue: DeckIssue
  /** 地图底下真正要干的票（规格与嵌套地图只是容器，穿过去继续找）。 */
  tickets: DeckIssue[]
  total: number
  closed: number
  /** 下一张能接的票；没有就是 null（全被认领、被挡或已做完）。 */
  frontier: DeckIssue | null
  /** 这张地图自己与所有子票里最新的那次动静。 */
  updatedAtMs: number
}

/** 一份快照读出来的全部东西。ok=false 时 reason 说明为什么没有数据。 */
export interface DeckSnapshot {
  ok: boolean
  /** '' | 'no-workspace'（还没认出工作区）| 'no-library'（本机没有这个工作区的库）| 'library-broken'（库读不出来）。 */
  reason: string
  backend: string
  maps: DeckMap[]
  issues: DeckIssue[]
  byKey: Map<string, DeckIssue>
  /** 库最后一次写入的时刻。 */
  generatedAtMs: number
}

/** 票详情要用的正文与评论（这两样本机今天可能还没同步下来，缺就是缺，不编）。 */
export interface DeckDetail {
  ok: boolean
  reason: string
  body: string
  comments: { author: string; text: string; at: number }[]
  commentTotal: number
}

function nodeFs(): any {
  return process.getBuiltinModule('node:fs')
}

function nodePath(): any {
  return process.getBuiltinModule('node:path')
}

/** 把库里读出来的整数列收成 number；null / 字符串 / 非法值一律当 0。 */
export function num(value: any): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 票号排序：能当数字就按数字，否则按字符串（避免 #10 排到 #9 前面）。 */
export function compareTicketKey(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  const fa = Number.isFinite(na)
  const fb = Number.isFinite(nb)
  if (fa && fb) return na - nb
  if (fa !== fb) return fa ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** 工作区里声明过的后端 id（docs/agents/workspace.yaml 的 backendId）；读不到就是空串。 */
export function declaredBackend(rootKey: string): string {
  try {
    const file = nodePath().join(String(rootKey || ''), WORKSPACE_YAML_REL)
    const text = String(nodeFs().readFileSync(file, 'utf8'))
    const hit = /^\s*backendId\s*:\s*([A-Za-z0-9_.-]+)/m.exec(text)
    return hit === null ? '' : String(hit[1])
  } catch (e) {
    return ''
  }
}

/**
 * 本机有哪几份快照库：缓存目录里 <后端>.sqlite 的文件名就是后端 id。
 * 声明过的后端排最前（它就是这个工作区该读的那份），其余按目录顺序。
 */
export function snapshotBackends(rootKey: string): string[] {
  try {
    const dir = nodePath().join(String(rootKey || ''), CACHE_DIR_REL, SNAPSHOT_DIR_NAME)
    const list: string[] = (nodeFs().readdirSync(dir) as any[])
      .map((name: any) => String(name))
      .filter((name: string) => name.endsWith('.sqlite'))
      .map((name: string) => name.slice(0, -'.sqlite'.length))
      .sort()
    const declared = declaredBackend(rootKey)
    if (declared && list.indexOf(declared) >= 0) return [declared].concat(list.filter((name) => name !== declared))
    return list
  } catch (e) {
    return []
  }
}

const SQL_ISSUES = 'select i.issue_id, i.key, i.type, i.title, i.state, i.updated_at_ms, i.comment_count from issue i left join issue_tombstone t on t.issue_id = i.issue_id where t.issue_id is null'
const SQL_EDGES = 'select subject_id, object_id, kind from issue_edge'
const SQL_LABELS = 'select issue_id, label_name from issue_label order by issue_id, position'
const SQL_ASSIGNEES = 'select g.issue_id, a.login from issue_assignee g join actor a on a.actor_id = g.actor_id order by g.issue_id, g.position'

/** 把几张表读成票与它们的边。表结构变了这里会抛，由 readSnapshot 收成 library-broken。 */
function assemble(db: any): { issues: DeckIssue[]; byKey: Map<string, DeckIssue>; at: number; backend: string } {
  const byId = new Map<number, DeckIssue>()
  const byKey = new Map<string, DeckIssue>()
  let at = 0
  let backend = ''
  try {
    const meta = db.prepare('select backend, last_write_ms from meta limit 1').get()
    if (meta !== undefined && meta !== null) {
      backend = String(meta.backend || '')
      at = num(meta.last_write_ms)
    }
  } catch (e) {}
  for (const row of db.prepare(SQL_ISSUES).all() as any[]) {
    const key = String(row.key || '')
    if (!key) continue
    const issue: DeckIssue = {
      key,
      title: String(row.title || ''),
      type: String(row.type || ''),
      state: String(row.state || '').toLowerCase(),
      updatedAtMs: num(row.updated_at_ms),
      commentCount: num(row.comment_count),
      labels: [],
      assignees: [],
      parentKey: '',
      blockedBy: [],
      blocking: [],
    }
    byId.set(num(row.issue_id), issue)
    byKey.set(key, issue)
  }
  for (const row of db.prepare(SQL_LABELS).all() as any[]) {
    const issue = byId.get(num(row.issue_id))
    if (issue !== undefined) issue.labels.push(String(row.label_name))
  }
  for (const row of db.prepare(SQL_ASSIGNEES).all() as any[]) {
    const issue = byId.get(num(row.issue_id))
    if (issue !== undefined) issue.assignees.push(String(row.login))
  }
  for (const row of db.prepare(SQL_EDGES).all() as any[]) {
    const subject = byId.get(num(row.subject_id))
    const object = byId.get(num(row.object_id))
    if (subject === undefined || object === undefined) continue
    const kind = String(row.kind || '')
    if (kind === 'parent') subject.parentKey = object.key
    else if (kind === 'blocks') {
      // 方向不能反：边表里 kind='blocks' 的一行读作「subject 被 object 挡着」。
      // 证据是读写两头的口径——写侧 applyIssueEdges(issueId, …, 'blocks', blockedBy) 把
      // 这张票自己写进 subject 列；读侧 projection/edges.ts 的 readIssueDetailEdges 也是
      // 「subject 的出边进 blockedBy、object 的入边进 blocking」。反过来会让「被挡着」与
      // 「挡着」两张票互换，实测过：本机快照里 5→7 表示票 5 被票 7 挡着。
      subject.blockedBy.push(object.key)
      object.blocking.push(subject.key)
    }
  }
  return { issues: [...byKey.values()], byKey, at, backend }
}

/** 一张票的分层判定输入（口径与宿主、与快照里的 m.stats 是同一套纯函数）。 */
function toGrouping(issue: DeckIssue): any {
  return {
    number: Number(issue.key) || 0,
    state: issue.state === 'closed' ? 'CLOSED' : 'OPEN',
    claimedBy: issue.assignees.length ? issue.assignees[0] : undefined,
    blockedBy: issue.blockedBy,
  }
}

/** 挡着这张票的票里还有没关的吗；查不到那张票按「还挡着」算，与内核的安全侧一致。 */
function hasOpenBlocker(issue: DeckIssue, byKey: Map<string, DeckIssue>): boolean {
  for (const key of issue.blockedBy) {
    const blocker = byKey.get(key)
    if (blocker === undefined || blocker.state !== 'closed') return true
  }
  return false
}

/** 从一张容器往下走，收集真正要干的票：规格与嵌套地图穿过去继续找。 */
function collectTickets(rootKey: string, childrenOf: Map<string, string[]>, byKey: Map<string, DeckIssue>): DeckIssue[] {
  const out: DeckIssue[] = []
  const queue: string[] = (childrenOf.get(rootKey) || []).slice()
  const seen = new Set<string>()
  while (queue.length) {
    const key = String(queue.shift())
    if (seen.has(key)) continue
    seen.add(key)
    const issue = byKey.get(key)
    if (issue === undefined) continue
    for (const child of childrenOf.get(key) || []) queue.push(child)
    if (issue.type === 'map' || issue.type === 'spec') continue
    out.push(issue)
  }
  return out
}

/** 把票折成地图列表：能接票的排前面，然后按最后活动倒序，最后按票号。 */
export function buildMaps(issues: DeckIssue[], byKey: Map<string, DeckIssue>): DeckMap[] {
  const childrenOf = new Map<string, string[]>()
  for (const issue of issues) {
    if (!issue.parentKey) continue
    const list = childrenOf.get(issue.parentKey) || []
    list.push(issue.key)
    childrenOf.set(issue.parentKey, list)
  }
  const maps: DeckMap[] = []
  for (const issue of issues) {
    if (issue.type !== 'map' || issue.state === 'closed') continue
    const tickets = collectTickets(issue.key, childrenOf, byKey)
    const groups = groupTickets(tickets.map(toGrouping))
    const open = tickets.filter((ticket) => ticket.state !== 'closed')
    const frontier = open
      .filter((ticket) => ticket.assignees.length === 0 && !hasOpenBlocker(ticket, byKey))
      .sort((l, r) => compareTicketKey(l.key, r.key))[0]
    let updatedAtMs = issue.updatedAtMs
    for (const ticket of tickets) if (ticket.updatedAtMs > updatedAtMs) updatedAtMs = ticket.updatedAtMs
    maps.push({
      issue,
      tickets,
      total: groups.total,
      closed: groups.closed,
      frontier: frontier === undefined ? null : frontier,
      updatedAtMs,
    })
  }
  return maps.sort((l, r) => {
    const dl = l.frontier === null ? 1 : 0
    const dr = r.frontier === null ? 1 : 0
    if (dl !== dr) return dl - dr
    if (l.updatedAtMs !== r.updatedAtMs) return r.updatedAtMs - l.updatedAtMs
    return compareTicketKey(l.issue.key, r.issue.key)
  })
}

/** 只读打开一份快照库；打不开回 null（调用方把 null 当「没有数据」，不当「空库」）。 */
function openReadOnly(rootKey: string, backend: string): any {
  try {
    const dbPath = nodePath().join(String(rootKey), CACHE_DIR_REL, SNAPSHOT_DIR_NAME, backend + '.sqlite')
    const sqlite = process.getBuiltinModule('node:sqlite')
    return new sqlite.DatabaseSync(dbPath, { readOnly: true, timeout: 2000 })
  } catch (e) {
    return null
  }
}

function closeQuiet(db: any): void {
  try {
    db.close()
  } catch (e) {}
}

/**
 * 读这个工作区的快照。
 * 读不出来不影响下一次：面板每轮重画都会再读，刷新房写完库之后自然就看见了。
 */
export function readSnapshot(rootKey: string): DeckSnapshot {
  const out: DeckSnapshot = { ok: false, reason: '', backend: '', maps: [], issues: [], byKey: new Map(), generatedAtMs: 0 }
  if (!String(rootKey || '').trim()) {
    out.reason = 'no-workspace'
    return out
  }
  const backend = snapshotBackends(rootKey)[0]
  if (!backend) {
    out.reason = 'no-library'
    return out
  }
  out.backend = backend
  const db = openReadOnly(rootKey, backend)
  if (db === null) {
    out.reason = 'library-broken'
    return out
  }
  try {
    const data = assemble(db)
    out.ok = true
    out.issues = data.issues
    out.byKey = data.byKey
    out.generatedAtMs = data.at
    out.backend = data.backend || backend
    out.maps = buildMaps(data.issues, data.byKey)
    return out
  } catch (e) {
    out.reason = 'library-broken'
    return out
  } finally {
    closeQuiet(db)
  }
}

/**
 * 读一张票的正文与最近三条评论。
 * 快照库里这两样今天可能还没同步下来（本机实测两张表都是空的），缺就回空并说明，不编内容。
 */
export function readDetail(rootKey: string, backend: string, key: string): DeckDetail {
  const out: DeckDetail = { ok: false, reason: '', body: '', comments: [], commentTotal: 0 }
  if (!String(rootKey || '').trim() || !String(key || '').trim()) {
    out.reason = 'no-issue'
    return out
  }
  const db = openReadOnly(rootKey, String(backend || snapshotBackends(rootKey)[0] || ''))
  if (db === null) {
    out.reason = 'library-broken'
    return out
  }
  try {
    const row = db.prepare('select issue_id, comment_count from issue where key = ? limit 1').get(String(key))
    if (row === undefined || row === null) {
      out.reason = 'no-issue'
      return out
    }
    const issueId = num(row.issue_id)
    out.commentTotal = num(row.comment_count)
    try {
      const body = db.prepare('select body from issue_body where issue_id = ? limit 1').get(issueId)
      if (body !== undefined && body !== null) out.body = String(body.body || '')
    } catch (e) {}
    try {
      const rows = db.prepare('select c.body, c.created_at_ms, a.login from comment c left join actor a on a.actor_id = c.author_id where c.issue_id = ? order by c.position desc limit 3').all(issueId) as any[]
      const total = db.prepare('select count(*) as n from comment where issue_id = ?').get(issueId)
      if (total !== undefined && total !== null) out.commentTotal = Math.max(num(total.n), out.commentTotal)
      out.comments = rows.map((item: any) => ({ author: String(item.login || ''), text: String(item.body || ''), at: num(item.created_at_ms) }))
    } catch (e) {}
    out.ok = true
    return out
  } catch (e) {
    out.reason = 'library-broken'
    return out
  } finally {
    closeQuiet(db)
  }
}
