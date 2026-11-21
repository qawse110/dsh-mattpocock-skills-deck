/**
 * tests/verify-5-dshgo-panels.ts —— 技能票台四块面板与状态条的门禁（地图 #3 · 票 #5）。
 *
 * 守什么：手机 App 里的原生面板有一类失败是**静默**的——视图里写了个不认识的节点、列表行多带了一个键、
 * 按钮指了一个没注册的动作名，App 不会报错，只会把那一块画成空白或者点不动。这类错误类型检查看不见
 * （节点树是 any），只能靠一条真的跑一遍的门禁拦。所以这里拿**真快照库**（临时目录里的 SQLite，用
 * openWorkspaceSnapshot 写进去）跑一遍四块面板的取数与版面，再逐项检查：
 *
 *   A 清单与注册：package.json 的 dshGo 段与运行时注册的 id 逐字一致（写错不报错，只是不显示）；
 *   B 视图骨架：四块面板都是 v2 的 stack，正文整段绑到 data.blocks（否则画面停在打开那一刻）；
 *   C 数据帧：首帧同步发出、第二帧带内容；节点类型只用验过的几种；列表行只有 schema 允许的六个键；
 *     视图里出现的动作名必须在 actions 里真的注册过（这一条是本门禁最要紧的）；
 *   D 点按：展开/收起、打开票详情、翻页各自改对内存状态，返回的效果都在白名单内且不超过四个；
 *   E 状态条：五种读数都给出 24 字以内的文案（桥接按 24 字截断）；
 *   F 在办表：文件名是两级散列（先 8 位工作区键、再 16 位文件名），只认本会话那一格；
 *   G 空态与故障态分开：没库 / 库坏了 / 没工作区三种说法互不相同；
 *   H 票详情：正文与评论读得出来，缺正文、查不到票各有各的提示；
 *   I 取数入口：认根、地图列表、状态条读数、设置页四格都对得上。
 *
 * 为什么不用 dsh-go 的 kit 假宿主：它能替身桥接，但它住在用户主目录的技能包下（~/.dsh/skills/…），
 * 门禁不能依赖仓库以外的路径。这里用一个二十行的假 ctx，只做「把注册收下来」这一件事。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-5-dshgo-panels.ts
 */
// 门禁归属: src/host/dshGo.ts
// 门禁归属: src/host/dshGoData.ts
// 门禁归属: src/host/dshGoViews.ts
// 门禁归属: src/host/dshGoCache.ts
// 门禁归属: src/host/dshGoWork.ts

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { installDshGo } from '../src/host/dshGo.ts'
import { mapRows, recentMaps, detailOf, settingsOf, stripOf, loadModel, uiOf } from '../src/host/dshGoData.ts'
import { stripText, ticketDetailView } from '../src/host/dshGoViews.ts'
import { readSnapshot, readDetail } from '../src/host/dshGoCache.ts'
import { readWork, workFilePath } from '../src/host/dshGoWork.ts'
import { workspaceKeyOf } from '../src/refresh/contract/workspace-keys.ts'
import { chainRootHash } from '../src/refresh/kernel/refresh-chain.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'

const GATE = 'verify-5-dshgo-panels'
const CLOCK = 1762310000000
const ROOT = path.resolve(import.meta.dirname, '..')
const PANEL_IDS = ['map-list', 'session-work', 'ticket-detail', 'settings']
let total = 0
let failed = 0

function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) {
    console.log('PASS ' + message)
    return
  }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

/** 视图里允许出现的节点类型：都是 dshGoViews.ts 用过的；divider 与 emptyState 是第二版节点。 */
const NODE_TYPES = ['stack', 'row', 'text', 'list', 'actions', 'keyValue', 'divider', 'emptyState']

/** 列表行允许的键（schema 是 additionalProperties: false，多一个键整块面板打不开）。 */
const ROW_KEYS = ['title', 'subtitle', 'trailing', 'icon', 'tone', 'action']

/** 每块面板注册过的动作名（与 dshGo.ts 的 panelActions 一致；门禁按它判「视图里的动作存不存在」）。 */
const ACTIONS_OF = {
  'map-list': ['expand', 'more', 'open-ticket'],
  'session-work': ['open-ticket', 'expand', 'maps', 'settings'],
  'ticket-detail': ['open-ticket', 'maps'],
  settings: ['maps'],
}

/** 一次点按允许返回的效果类型（桥接白名单的子集：本插件只用这四种）。 */
const EFFECT_KINDS = ['open', 'refresh', 'toast', 'insert']

/** 深度遍历节点树，把每个对象交给 visit。 */
function walk(node: unknown, visit: (value: any) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  if (node === null || typeof node !== 'object') return
  visit(node as any)
  for (const value of Object.values(node as any)) walk(value, visit)
}

/** 节点树里所有的列表行。 */
function rowsOf(blocks: any[]): any[] {
  const out: any[] = []
  walk(blocks, (node) => {
    if (node.type !== 'list' || !Array.isArray(node.items)) return
    for (const item of node.items) out.push(item)
  })
  return out
}

/** 等条件成立（面板的 data 函数先同步发一帧、再异步补一帧）。 */
async function waitFor(probe: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (probe()) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return probe()
}

/**
 * 假文件服务：只回答「这条路径在不在」。
 * 形状按宿主文件服务的契约来（lstat 收路径，stat/listDir 收 resolve 出来的 target），
 * canonicalWorkspaceKey 靠它逐层向上找 docs/agents/workspace.yaml。
 */
function makeFs(): any {
  const exists = (p: string): boolean => {
    try {
      statSync(p)
      return true
    } catch (e) {
      try {
        readdirSync(p)
        return true
      } catch (e2) {
        return false
      }
    }
  }
  return {
    lstat: async (p: string) => (exists(p) ? { path: p } : null),
    resolve: async (p: string) => ({ path: p }),
    stat: async (target: any) => ({ path: String(target?.path ?? target) }),
    listDir: async (target: any) => ({ items: [], path: String(target?.path ?? target) }),
    exists: async (p: string) => exists(p),
  }
}

/** 假平台：门禁在 Linux 上跑，只用 posix 的那几个成员。 */
function makePlatform(home: string): any {
  return {
    os: 'linux',
    path: {
      normalize: (p: string) => path.posix.normalize(p),
      isAbsolute: (p: string) => path.posix.isAbsolute(p),
      join: (...parts: string[]) => path.posix.join(...parts),
      sep: '/',
    },
    getHome: () => home,
  }
}

/** 假 ctx：把 installDshGo 的注册原样收下来。withBridge=false 模拟没有桥接的桌面端。 */
function makeHost(services: any, withBridge = true): any {
  const seen = { panels: [] as any[], strips: [] as any[], warns: [] as any[] }
  const go = {
    panel(id: string, def: any) {
      seen.panels.push({ id, def })
      return () => {}
    },
    strip(id: string, def: any) {
      seen.strips.push({ id, def })
      return () => {}
    },
  }
  const child: any = { get: (name: string) => services[name], logger: { warn: (...args: any[]) => seen.warns.push(args) } }
  if (withBridge) child.dshGo = go
  const ctx: any = {
    get: (name: string) => (name === 'dshGo' ? (withBridge ? go : undefined) : services[name]),
    inject: (_deps: string[], callback: any) => callback(child),
  }
  installDshGo(ctx)
  return { seen, child }
}

function rowValue(key: string, type: string, title: string, state: string): any {
  return { type, title, state, url: 'https://example.test/' + key, updatedAtMs: CLOCK }
}

function rowGroup(value: any): any {
  return { completeness: 'complete', value, source: 'gate', operation: 'list' }
}

function edgeGroup(keys: string[]): any {
  return { completeness: 'complete', value: keys, reason: null, source: 'gate', operation: 'list' }
}

/** 造一份真快照库：一棵地图 + 四张子票（两张开着、一张被挡着、一张已关闭），其中一张带正文。 */
function seedLibrary(rootKey: string): void {
  const dbPath = path.join(rootKey, '.dsh-mattskillsdeck-cache', 'snapshot', 'github.sqlite')
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const opened = openWorkspaceSnapshot({ workspaceRoot: rootKey, backend: 'github', repoIdentity: 'acme/repo-a', dbPath, now: () => CLOCK, leaseOwner: 'gate-5' })
  const handle: any = opened.handle
  handle.ingest({
    startMergeVersion: handle.getMergeVersion(),
    writes: [
      { effortId: '', key: '3', groups: { row: rowGroup(rowValue('3', 'map', '地图：技能票台', 'open')) } },
      {
        effortId: '',
        key: '5',
        groups: {
          row: rowGroup(rowValue('5', 'issue', '落地：四个面板', 'open')),
          parents: edgeGroup(['3']),
          body: { completeness: 'complete', value: '正文第一段。', source: 'gate', operation: 'issue' },
        },
      },
      { effortId: '', key: '7', groups: { row: rowGroup(rowValue('7', 'issue', '接线：宿主电话', 'open')), parents: edgeGroup(['3']), blockedBy: edgeGroup(['10']) } },
      { effortId: '', key: '8', groups: { row: rowGroup(rowValue('8', 'issue', '已完成的一张', 'closed')), parents: edgeGroup(['3']) } },
      { effortId: '', key: '10', groups: { row: rowGroup(rowValue('10', 'issue', '挡着别人的一张', 'open')), parents: edgeGroup(['3']) } },
    ],
  })
  handle.close()
}

/** 造一个临时工作区：带后端声明（认根与选后端都靠它）。 */
function makeWorkspace(tag: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-5-' + tag + '-'))
  mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'version: 2\nbackendId: github\nlayout: single\n')
  return root
}

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package', 'package.json'), 'utf8'))
  const dshGo = manifest.dshGo
  const tempRoots: string[] = []

  // ── A 清单与注册 ───────────────────────────────────────────────────────
  check(dshGo !== undefined && dshGo.v === 1, 'A1 清单里有 dshGo 段且协议版本是 1', dshGo && dshGo.v)
  const declaredPanels = ((dshGo?.contributes?.panels) ?? []).map((item: any) => item.id)
  check(JSON.stringify(declaredPanels) === JSON.stringify(PANEL_IDS), 'A2 清单声明的四块面板 id 与运行时那四个逐字一致', declaredPanels)
  const declaredStrip = ((dshGo?.contributes?.['composer.strip']) ?? [])[0]
  check(declaredStrip?.id === 'deck-strip', 'A3 清单声明的状态条 id 是 deck-strip', declaredStrip?.id)
  const newTicket = ((dshGo?.contributes?.['composer.actions']) ?? []).filter((item: any) => item.id === 'deck-new-ticket')[0]
  check(String(newTicket?.effect?.text || '').includes('（挂到哪张地图下你先问我）：'), 'A4 新建票胶囊的文案带「挂到哪张地图下你先问我」', newTicket?.effect?.text)
  for (const panel of (dshGo?.contributes?.panels) ?? []) {
    const file = path.join(ROOT, 'package', String(panel.view || ''))
    check(String(panel.view || '').length > 0, 'A5.1 面板 ' + panel.id + ' 在清单里写了 view 路径', panel.view)
    check((() => { try { JSON.parse(readFileSync(file, 'utf8')); return true } catch (e) { return false } })(), 'A5.2 面板 ' + panel.id + ' 的静态视图文件存在且是合法 JSON', panel.view)
  }

  const home = mkdtempSync(path.join(os.tmpdir(), 'verify-5-home-'))
  tempRoots.push(home)
  const services = (root: string) => ({ sessions: { get: () => ({ header: { cwd: root } }) }, platform: makePlatform(home), fs: makeFs() })

  const rootKey = makeWorkspace('main')
  tempRoots.push(rootKey)
  seedLibrary(rootKey)

  const host = makeHost(services(rootKey))
  check(host.seen.panels.length === 4, 'A6 四块面板都注册上了', host.seen.panels.map((item: any) => item.id))
  check(JSON.stringify(host.seen.panels.map((item: any) => item.id)) === JSON.stringify(PANEL_IDS), 'A7 注册的面板 id 与清单同序', host.seen.panels.map((item: any) => item.id))
  check(host.seen.strips.length === 1 && host.seen.strips[0].id === 'deck-strip', 'A8 状态条注册上了', host.seen.strips.map((item: any) => item.id))
  check(host.seen.warns.length === 0, 'A9 注册过程没有触发任何兜底告警', host.seen.warns)

  const noBridge = makeHost(services(rootKey), false)
  check(noBridge.seen.panels.length === 0 && noBridge.seen.strips.length === 0, 'A10 没有桥接主机时一个注册都不做（桌面端界面不变）')

  const panelOf = (id: string) => host.seen.panels.filter((item: any) => item.id === id)[0]

  // ── B 视图骨架 ─────────────────────────────────────────────────────────
  for (const id of PANEL_IDS) {
    const def = panelOf(id).def
    const view = typeof def.view === 'function' ? def.view({}, { locale: 'zh-CN' }) : def.view
    check(view?.v === 2, 'B1.' + id + ' 视图版本是 2（空态与分隔线都是第二版节点）', view?.v)
    check(view?.type === 'stack', 'B2.' + id + ' 根节点是 stack', view?.type)
    check(typeof view?.title === 'string' && view.title.length > 0, 'B3.' + id + ' 根节点带标题', view?.title)
    const bound = view?.children !== null && typeof view?.children === 'object' && !Array.isArray(view.children)
    check(bound && view.children.$ === 'data.blocks', 'B4.' + id + ' 正文整段绑到 data.blocks（否则点按之后画面不刷新）', view?.children)
  }

  // ── C 数据帧 ───────────────────────────────────────────────────────────
  async function frameOf(id: string, sessionId: string): Promise<any[]> {
    const emitted: any[] = []
    const cancel = panelOf(id).def.data({ sessionId }, (value: any) => emitted.push(value), { protocol: 1, locale: 'zh-CN' })
    const done = await waitFor(() => emitted.length >= 2 && Array.isArray(emitted[emitted.length - 1]?.blocks), 3000)
    if (typeof cancel === 'function') cancel()
    check(emitted.length > 0, 'C0.' + id + ' 首帧是同步发出的（桥接只等一秒）', emitted.length)
    check(done, 'C1.' + id + ' 第二帧带上了内容', emitted.length)
    return emitted[emitted.length - 1]?.blocks ?? []
  }

  const frames: any = {}
  for (const id of PANEL_IDS) frames[id] = await frameOf(id, 'sess-c-' + id)

  for (const id of PANEL_IDS) {
    const blocks = frames[id]
    const types: string[] = []
    walk(blocks, (node) => {
      if (typeof node.type === 'string') types.push(node.type)
    })
    const unknown = types.filter((type) => NODE_TYPES.indexOf(type) < 0)
    check(unknown.length === 0, 'C2.' + id + ' 只用了验过的节点类型', unknown)
    const badRows = rowsOf(blocks).filter((row) => Object.keys(row).some((key) => ROW_KEYS.indexOf(key) < 0))
    check(badRows.length === 0, 'C3.' + id + ' 列表行只带 schema 允许的六个键（多一个键整块画不出来）', badRows[0])
    const used: string[] = []
    walk(blocks, (node) => {
      if (typeof node.action === 'string') used.push(node.action)
      if (node.action !== null && typeof node.action === 'object' && typeof node.action.id === 'string') used.push(node.action.id)
    })
    const unregistered = used.filter((name) => ACTIONS_OF[id].indexOf(name) < 0)
    check(unregistered.length === 0, 'C4.' + id + ' 视图里的动作名都在 actions 里注册过（写错点不动，不报错）', unregistered)
  }

  const mapRowItems = rowsOf(frames['map-list'])
  check(mapRowItems.length > 0, 'C5 地图列表摆出了地图行', mapRowItems.length)
  check(String(mapRowItems[0]?.title || '').startsWith('#'), 'C6 地图行标题以票号开头', mapRowItems[0]?.title)
  check(String(mapRowItems[0]?.subtitle || '').includes('已决'), 'C7 地图行副标题带「已决 X/Y」', mapRowItems[0]?.subtitle)
  check(rowsOf(frames['session-work']).length > 0, 'C8 本会话的活在没有在办记录时给空态 + 最近地图', rowsOf(frames['session-work']).length)
  check(rowsOf(frames['settings']).length === 0, 'C9 设置页不摆列表行（四格都是 keyValue）', rowsOf(frames['settings']).length)

  // ── D 点按 ─────────────────────────────────────────────────────────────
  // 桥接的约定（kit/SKILL.md 的 event 一栏）：第一参是面板的 scope（里面有 sessionId），
  // 视图里 {id, args} 的 args 走 event.value。两处都不能省，否则动作改的是空会话、
  // 或者读不到点的是哪一张票。
  const tapSession = 'sess-d'
  function tap(id: string, name: string, args?: any): any {
    const action = panelOf(id).def.actions[name]
    check(typeof action === 'function', 'D0.' + id + '.' + name + ' 动作已注册', typeof action)
    if (typeof action !== 'function') return undefined
    const event = { surface: 'panels', id, locale: 'zh-CN', userGesture: true, value: args }
    return action({ sessionId: tapSession }, event)
  }

  const firstMapKey = String(mapRowItems[0]?.action?.args?.key || '')
  tap('map-list', 'expand', { key: firstMapKey })
  check(uiOf(tapSession).expandedMap === firstMapKey, 'D1 点地图行记下展开的那张', uiOf(tapSession).expandedMap)
  tap('map-list', 'expand', { key: firstMapKey })
  check(uiOf(tapSession).expandedMap === '', 'D2 同一张再点一次收起', uiOf(tapSession).expandedMap)
  const opened = tap('map-list', 'open-ticket', { key: '5' })
  check(uiOf(tapSession).openTicket === '5', 'D3 点子票记下正在看的票', uiOf(tapSession).openTicket)
  check(opened?.open === 'panel:ticket-detail', 'D4 点子票打开票详情面板', opened)
  const moreReturn = tap('map-list', 'more')
  check(uiOf(tapSession).page === 1, 'D5 翻页把页码往前推一格', uiOf(tapSession).page)
  check(moreReturn?.refresh === true, 'D6 翻页交回 refresh 让 App 重新取一遍', moreReturn)
  const refreshed = tap('ticket-detail', 'open-ticket', { key: '5' })
  check(refreshed?.refresh === true, 'D7 票详情里换一张票交回 refresh', refreshed)
  const toMaps = tap('settings', 'maps')
  check(toMaps?.open === 'panel:map-list', 'D8 设置页的「打开地图列表」指向地图面板', toMaps)
  const toSettings = tap('session-work', 'settings')
  check(toSettings?.open === 'panel:settings', 'D9 本会话的活的「去设置」指向设置面板', toSettings)
  for (const id of PANEL_IDS) {
    for (const name of ACTIONS_OF[id]) {
      const returned = tap(id, name, { key: '5' })
      const effects = returned === undefined ? [] : Object.keys(returned)
      check(effects.length <= 4 && effects.every((kind) => EFFECT_KINDS.indexOf(kind) >= 0), 'D10.' + id + '.' + name + ' 返回值是白名单内的效果且不超过四个', effects)
    }
  }

  // ── E 状态条 ───────────────────────────────────────────────────────────
  for (const kind of ['none', 'progress', 'done', 'many', 'stuck']) {
    const text = stripText(kind, 2, 8, '10', 3)
    check(typeof text === 'string' && text.length > 0 && text.length <= 24, 'E1 状态条「' + kind + '」的文案在 24 字以内（桥接按 24 字截断）', text)
  }
  check(stripText('progress', 2, 8, '10', 1).includes('#10'), 'E2 进度态带上下一张票号', stripText('progress', 2, 8, '10', 1))
  const stripData: any[] = []
  const stopStrip = host.seen.strips[0].def({ sessionId: 'sess-e' }, (value: any) => stripData.push(value), { protocol: 1, locale: 'zh-CN' })
  const stripDone = await waitFor(() => stripData.length >= 2 && typeof stripData[stripData.length - 1]?.text === 'string', 3000)
  if (typeof stopStrip === 'function') stopStrip()
  const stripValue = String(stripData[stripData.length - 1]?.text ?? '')
  check(stripDone && stripValue.length > 0 && stripValue.length <= 24, 'E3 真库下状态条给出了 24 字以内的文案', stripValue)
  check(stripValue !== '技能票台', 'E4 真库下状态条不再是兜底常量', stripValue)

  // ── F 在办表 ───────────────────────────────────────────────────────────
  const expectedWorkPath = path.join(home, '.dsh', 'mattskillsdeck', 'work-path', chainRootHash(workspaceKeyOf(rootKey)) + '.json')
  check(workFilePath(rootKey, home) === expectedWorkPath, 'F1 在办表文件名是两级散列（先 8 位工作区键、再 16 位文件名）', workFilePath(rootKey, home))
  check(String(workspaceKeyOf(rootKey)).length === 8, 'F2 工作区键是 8 位十六进制', workspaceKeyOf(rootKey))
  check(String(chainRootHash(workspaceKeyOf(rootKey))).length === 16, 'F3 文件名那一级是 16 位十六进制', chainRootHash(workspaceKeyOf(rootKey)))
  mkdirSync(path.dirname(expectedWorkPath), { recursive: true })
  writeFileSync(
    expectedWorkPath,
    JSON.stringify({
      at: CLOCK,
      workers: [
        { session: 'sess-f', entries: [{ ticketKey: '5', title: '落地：四个面板', action: 'edit', actionAt: CLOCK }, { ticketKey: '7', title: '接线', action: 'report', actionAt: CLOCK - 1000 }] },
        { session: 'other', entries: [{ ticketKey: '99', title: '别人的活', action: 'edit', actionAt: CLOCK }] },
      ],
    }),
  )
  const mine = readWork(rootKey, 'sess-f', home)
  check(mine.ok && mine.entries.length === 2, 'F4 只取本会话那一格（别人的活不凑进来）', mine.entries.map((entry: any) => entry.key))
  check(mine.entries[0].key === '5', 'F5 在办表按最近动作倒序', mine.entries.map((entry: any) => entry.key))
  const others = readWork(rootKey, 'nobody', home)
  check(others.ok && others.entries.length === 0 && others.reason === 'no-session-entry', 'F6 文件里没有这个会话时回 no-session-entry 而不是报错', others.reason)
  const missing = readWork(rootKey, 'sess-f', path.join(home, 'nowhere'))
  check(missing.ok && missing.reason === 'no-file', 'F7 文件不存在是正常状态（新会话都会没有）', missing.reason)
  const noSessionEntry = readWork('', 'sess-f', home)
  check(!noSessionEntry.ok && noSessionEntry.reason === 'no-workspace', 'F8 没有工作区时不读在办表', noSessionEntry.reason)

  // ── G 空态与故障态分开 ─────────────────────────────────────────────────
  const emptyRoot = makeWorkspace('empty')
  tempRoots.push(emptyRoot)
  const noLibrary = readSnapshot(emptyRoot)
  check(!noLibrary.ok && noLibrary.reason === 'no-library', 'G1 本机没有库时回 no-library', noLibrary.reason)

  const brokenRoot = makeWorkspace('broken')
  tempRoots.push(brokenRoot)
  const brokenDb = path.join(brokenRoot, '.dsh-mattskillsdeck-cache', 'snapshot', 'github.sqlite')
  mkdirSync(path.dirname(brokenDb), { recursive: true })
  writeFileSync(brokenDb, '这不是一个 SQLite 库')
  const broken = readSnapshot(brokenRoot)
  check(!broken.ok && broken.reason === 'library-broken', 'G2 库读不出来时回 library-broken（不当成空库）', broken.reason)

  const noWorkspace = readSnapshot('')
  check(!noWorkspace.ok && noWorkspace.reason === 'no-workspace', 'G3 没认出工作区时回 no-workspace', noWorkspace.reason)
  check(new Set([noLibrary.reason, broken.reason, noWorkspace.reason]).size === 3, 'G4 三种缺数据的原因互不相同（用户要做的事不同）', [noLibrary.reason, broken.reason, noWorkspace.reason])

  // ── H 票详情 ───────────────────────────────────────────────────────────
  const snapshot = readSnapshot(rootKey)
  check(snapshot.ok && snapshot.issues.length === 5, 'H1 真库读回五张票', snapshot.issues.length)
  check(snapshot.maps.length === 1, 'H2 认出一张在做地图', snapshot.maps.length)
  check(snapshot.maps[0].total === 4 && snapshot.maps[0].closed === 1, 'H3 地图统计只算子票（含已关闭那张）', { total: snapshot.maps[0].total, closed: snapshot.maps[0].closed })
  // 五张票里 #8 已关闭、#7 被 #10 挡着，#5 与 #10 都能接；能接的里面取票号最小的那张，
  // 所以是 #5 而不是 #10（#10 只是「挡着别人」，它自己没被挡）。
  check(snapshot.maps[0].frontier !== null && snapshot.maps[0].frontier.key === '5', 'H4 下一张能接的是没被挡、没被认领的最小票号', snapshot.maps[0].frontier?.key)

  const detail = readDetail(rootKey, 'github', '5')
  check(detail.ok && detail.body === '正文第一段。', 'H5 票详情读得出正文', detail.body)
  const model = { reason: '', rootKey, cwd: rootKey, backend: 'github', snapshot, work: [], at: CLOCK }
  const detailView = detailOf(model, 'sess-h', '5')
  // 票号是摆版面时拼上去的（'#' + key + ' ' + title），取数那一层只管标题本身。
  const detailBlocks = ticketDetailView(detailView)
  check(detailBlocks[0]?.text === '#5 落地：四个面板', 'H6 票详情第一行是「#票号 标题」', detailBlocks[0]?.text)
  check(detailView.bodyNote === '', 'H7 有正文时不加提示', detailView.bodyNote)
  check(detailView.comments.length === 0 && detailView.commentsNote === '', 'H8 本机还没同步评论时不摆空评论块', detailView.commentsNote)
  const noBody = detailOf(model, 'sess-h2', '7')
  check(noBody.bodyNote === '正文还没同步到本机', 'H9 没有正文时明说「还没同步到本机」', noBody.bodyNote)
  check(noBody.blockedBy.includes('#10'), 'H10 被挡着的票写出挡它的票号', noBody.blockedBy)
  const ghost = detailOf(model, 'sess-h3', '999')
  check(ghost.title === '这张票不在本机缓存里', 'H11 查不到的票给一句能看懂的话', ghost.title)
  const missingBody = readDetail(rootKey, 'github', '999')
  check(!missingBody.ok && missingBody.reason === 'no-issue', 'H12 读不存在的票回 no-issue', missingBody.reason)

  // ── I 取数入口 ─────────────────────────────────────────────────────────
  const loaded = await loadModel(host.child, 'sess-i')
  check(loaded.reason === '' && loaded.rootKey === rootKey, 'I1 取数入口认出的工作区根就是临时工作区', loaded.rootKey)
  check(mapRows(loaded, 'sess-i').total === 1, 'I2 地图列表一页给出这张地图', mapRows(loaded, 'sess-i').total)
  check(recentMaps(loaded).length === 1, 'I3 最近地图也读得出来', recentMaps(loaded).length)
  const stripFacts = stripOf(loaded, 'sess-i')
  check(stripFacts.kind === 'progress' && stripFacts.nextKey === '5', 'I4 状态条读数是「已决 X/Y · 下一张 #K」', stripFacts)
  const settings = settingsOf(loaded, '1.9.0')
  check(settings.backend === 'github' && settings.workspace === rootKey, 'I5 设置页写出后端与工作区', [settings.backend, settings.workspace])
  check(settings.version === '1.9.0', 'I6 设置页写出插件版本', settings.version)

  const noSession = await loadModel(host.child, '')
  check(noSession.reason === 'no-session', 'I7 没有会话信息时回 no-session（不当成没选工作区）', noSession.reason)

  for (const root of tempRoots) rmSync(root, { recursive: true, force: true })
  printGateResult(GATE, total, failed)
}

main()
