/**
 * src/host/dshGoViews.ts —— 技能票台四块面板的画面（地图 #3 · 票 #5）。
 *
 * 这个文件只做一件事：把「已经算好的行与字符串」摆成 dsh-go 的视图节点树。
 * 它不读磁盘、不读数据库、不认工作区，也不认识快照库的行类型——
 * 数据那一侧（dshGoData.ts）负责把库里的行折成这里的行形状，两边靠这张窄接口对接。
 *
 * 为什么把画面单独放一个文件：面板的注册代码要短（一次注册失败只该丢那一项），
 * 而拼节点的代码又必须能一眼看完（节点写错不会报错，只会让面板显示空白，最难查）。
 * 拆开以后，改画面的人只看这一个文件，改取数的人只看另一个。
 *
 * 三条不能改的约定（改之前先读 dsh-go 的 view.schema.json）：
 * 1. 只用这里出现过的节点类型。桥接不校验「数据展开后的节点」，写错了 App 只会静默画不出来；
 *    所以宁可用 text + list 摆版面，也不要为了好看引入没在这里验证过的组件。
 * 2. list 的每一行只许写 {title, subtitle, trailing, icon, tone, action} 这六个键（schema 是
 *    additionalProperties: false，多一个键整块面板打不开）。想把票号与标题拼在一起就拼进 title。
 * 3. 面板上限 120 个组件、32 KiB。地图列表一页 20 张、每张最多展开十几行子票，够用；
 *    票详情只取正文前 1900 字、评论前 3 条，也是为了守住这条上限。
 */

/** 列表行：桥接只认这六个键，多一个都不行。 */
interface ListRow {
  title: string
  subtitle?: string
  trailing?: string
  icon?: string
  tone?: string
  action?: any
}

/** 地图列表里的一行地图。展开时它的子票紧跟在后面。 */
export interface MapViewRow {
  key: string
  title: string
  /** 已决定的票数（不含地图自己）。 */
  decided: number
  total: number
  /** 下一张能接的票；没有能接的票时两格都是空串。 */
  nextKey: string
  nextTitle: string
  /** 最后活动的日期，形如 11-21；没有任何时间信息时是空串。 */
  trailing: string
  /** 用户刚点开过这张地图，子票要列在它下面。 */
  expanded: boolean
  /** 这张地图的未关闭子票（展开时才用）。 */
  tickets: { key: string; title: string; state: string; claimed: boolean; blocked: boolean }[]
  /** 已关闭的票数，展开时在末尾用一行文字说明。 */
  closedCount: number
}

/** 一张子票在「本会话的活」里的一行。 */
export interface WorkViewRow {
  key: string
  title: string
  state: string
  /** 最近一次动作的中文说法与时刻。 */
  action: string
  at: string
}

/** 票详情要摆的全部内容。 */
export interface DetailView {
  key: string
  title: string
  state: string
  assignees: string
  labels: string
  body: string
  bodyNote: string
  children: { key: string; title: string; state: string }[]
  childrenNote: string
  blockedBy: string
  blocking: string
  comments: { author: string; text: string; at: string }[]
  commentsNote: string
}

/** 设置页要摆的几格。 */
export interface SettingsView {
  backend: string
  workspace: string
  snapshot: string
  version: string
  note: string
}

function text(value: any, muted?: boolean): any {
  return muted === true ? { type: 'text', text: value, tone: 'muted' } : { type: 'text', text: value }
}

/** 空态：dsh-go 专门有一个组件表达「这里本来就没有东西」，比一行灰字清楚。 */
function emptyState(title: string, message: string, icon: string): any {
  return { type: 'emptyState', title, message, icon }
}

function rowOf(row: MapViewRow): ListRow {
  const decided = '已决 ' + row.decided + '/' + row.total
  const next = row.nextKey ? ' · 下一张 #' + row.nextKey + ' ' + row.nextTitle : ' · 没有能接的票'
  return { title: '#' + row.key + ' ' + row.title, subtitle: decided + next, trailing: row.trailing, action: { id: 'expand', args: { key: row.key } } }
}

function subRowOf(ticket: MapViewRow['tickets'][number]): ListRow {
  const tail = ticket.state === 'closed' ? '已关闭' : ticket.claimed ? '在做' : ticket.blocked ? '被挡着' : '能接'
  return { title: '· #' + ticket.key + ' ' + ticket.title, subtitle: tail, action: { id: 'open-ticket', args: { key: ticket.key } } }
}

/**
 * 地图列表：一页 20 张，点一张展开它的子票，点子票打开票详情。
 * 没有地图时给空态，而不是一串空行——空行会让人以为面板坏了。
 */
export function mapListView(status: string, rows: MapViewRow[], moreLabel: string, emptyTitle: string, emptyMessage: string): any[] {
  const out: any[] = []
  if (rows.length === 0) {
    out.push(emptyState(emptyTitle, emptyMessage, 'folder'))
    if (status) out.push(text(status, true))
    return out
  }
  out.push(text(status, true))
  const items: ListRow[] = []
  for (const row of rows) {
    items.push(rowOf(row))
    if (!row.expanded) continue
    for (const ticket of row.tickets) items.push(subRowOf(ticket))
    if (row.closedCount > 0) items.push({ title: '已关闭 ' + row.closedCount + ' 张', subtitle: '', tone: 'muted' })
  }
  out.push({ type: 'list', items })
  if (moreLabel) out.push({ type: 'actions', items: [{ label: moreLabel, action: 'more', icon: 'plus' }] })
  return out
}

/**
 * 本会话的活：三种状态各摆一套（还没选工作区 / 还没动过票 / 正在做票）。
 * 「正在做票」只列本会话动过的那些票，别的会话的活不往这里凑。
 */
export function sessionWorkView(kind: string, title: string, message: string, rows: WorkViewRow[], recent: MapViewRow[]): any[] {
  const out: any[] = []
  if (kind === 'no-workspace') {
    out.push(emptyState(title, message, 'folder'))
    out.push({ type: 'actions', items: [{ label: '去设置', action: 'settings', icon: 'settings' }] })
    return out
  }
  if (kind === 'no-work') {
    out.push(emptyState(title, message, 'todo'))
    if (recent.length > 0) out.push({ type: 'list', items: recent.map(rowOf) })
    return out
  }
  out.push(text(title))
  const items: ListRow[] = rows.map((row) => ({
    title: '#' + row.key + ' ' + row.title,
    subtitle: row.state + ' · 最近' + row.action + ' ' + row.at,
    action: { id: 'open-ticket', args: { key: row.key } },
  }))
  out.push({ type: 'list', items })
  out.push({ type: 'actions', items: [{ label: '打开地图列表', action: 'maps', icon: 'list' }] })
  return out
}

/**
 * 票详情：五段按优先级排（状态 → 正文 → 子票 → 阻塞 → 评论），放不下时从后往前砍。
 * 这是会话页签里的弹层，宽度有限，所以每段都尽量用一行文字而不是表格。
 */
export function ticketDetailView(detail: DetailView): any[] {
  const out: any[] = []
  out.push(text('#' + detail.key + ' ' + detail.title))
  out.push(text(detail.state + ' · ' + detail.assignees + ' · ' + detail.labels, true))
  out.push({ type: 'divider' })
  out.push(text(detail.body))
  if (detail.bodyNote) out.push(text(detail.bodyNote, true))
  if (detail.children.length > 0) {
    out.push({ type: 'divider' })
    out.push({ type: 'list', items: detail.children.map((child) => ({ title: '#' + child.key + ' ' + child.title, subtitle: child.state, action: { id: 'open-ticket', args: { key: child.key } } })) })
    if (detail.childrenNote) out.push(text(detail.childrenNote, true))
  }
  if (detail.blockedBy || detail.blocking) {
    out.push({ type: 'divider' })
    if (detail.blockedBy) out.push(text(detail.blockedBy))
    if (detail.blocking) out.push(text(detail.blocking))
  }
  out.push({ type: 'divider' })
  if (detail.comments.length > 0) {
    out.push({ type: 'list', items: detail.comments.map((comment) => ({ title: comment.author + ' · ' + comment.at, subtitle: comment.text })) })
  }
  if (detail.commentsNote) out.push(text(detail.commentsNote, true))
  return out
}

/** 设置页：四格读数 + 一句说明，够回答「我在看哪本库」。 */
export function settingsView(model: SettingsView): any[] {
  return [
    {
      type: 'keyValue',
      items: [
        ['后端', model.backend],
        ['工作区', model.workspace],
        ['本机缓存', model.snapshot],
        ['插件版本', model.version],
      ],
    },
    text(model.note, true),
    { type: 'actions', items: [{ label: '打开地图列表', action: 'maps', icon: 'list' }] },
  ]
}

/**
 * 状态条文案（上限 24 字，桥接会截断，所以这里自己先收短）。
 * 只有一张地图在做时显示进度与下一张票；多张时退回「N 张地图在办」。
 */
export function stripText(kind: string, decided: number, total: number, nextKey: string, mapCount: number): string {
  if (kind === 'none') return '技能票台'
  if (kind === 'progress') return '已决 ' + decided + '/' + total + ' · 下一张 #' + nextKey
  if (kind === 'done') return '已决 ' + decided + '/' + total + ' · 都做完了'
  return mapCount + ' 张地图在办'
}
