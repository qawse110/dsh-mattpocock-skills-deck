/**
 * src/host/dshGo.ts —— 技能票台在 dsh-go 手机 App 里的四块面板、状态条与两个胶囊（地图 #3 · 票 #5 / #7）。
 *
 * 五条不能改的约定：
 * 1. 只在有桥接主机时生效：没有 ctx.dshGo 的环境（桌面端、网页版）整段注册不执行，界面一点不变。
 * 2. id 必须与 package/package.json 的 dshGo.contributes 逐字一致，写错不会报错，只会静默不显示。
 * 3. 注册必须用 ctx.inject(['dshGo'], child => …) 回调里的子 ctx：桥接按这个上下文认插件身份。
 * 4. 视图以注册的 view 函数优先，清单里的静态 JSON 只在没有注册时当兜底（所以这里失败不影响打开面板）。
 * 5. 一次点按 3 秒内返回，最多 4 个效果；慢活一律交回 { refresh: true } 让 App 重新取一遍。
 *
 * 这个文件只管注册与「点按之后怎么改内存状态」，取数与摆版面分别在 dshGoData.ts 与 dshGoViews.ts：
 * 注册代码要短（一项失败只该丢那一项），取数要能单独验，摆版面要能一眼看完。
 */

// @ts-expect-error 本域 tsconfig 有意不加载 Node 类型包（types 为空），运行时一定是 Node。
import { readFileSync } from 'node:fs'
import { mapRows, workRows, recentMaps, detailOf, settingsOf, stripOf, loadModel, lastModel, rememberUi, uiOf, watchUi } from './dshGoData.js'
import type { DeckModel } from './dshGoData.js'
import { mapListView, sessionWorkView, ticketDetailView, settingsView, stripText } from './dshGoViews.js'

/** 四块面板的 id（与清单逐字一致）。 */
const PANEL_IDS = ['map-list', 'session-work', 'ticket-detail', 'settings'] as const

/** 状态条的 id。 */
const STRIP_ID = 'deck-strip'

/** 兜底文案（与清单里的静态文案相同），算不出读数时先显示它。 */
const STRIP_TEXT = { zh: '技能票台', en: 'Tracker Deck' }

/** 连节点都摆不出来时的兜底：至少让人看见这是哪块面板，而不是一片空白。 */
const FALLBACK_BLOCKS = [{ type: 'text', text: '技能票台', tone: 'muted' }]

/** 面板标题（与清单一致）。 */
const TITLES = {
  'map-list': { zh: '地图', en: 'Maps' },
  'session-work': { zh: '本会话的活', en: 'This session' },
  'ticket-detail': { zh: '票详情', en: 'Ticket' },
  settings: { zh: '设置', en: 'Settings' },
} as const

function isZh(caps: any): boolean {
  const locale = typeof caps?.locale === 'string' ? caps.locale.toLowerCase() : ''
  return locale.startsWith('zh')
}

/**
 * 一份读数没读成时的那句话。四种缺数据的情形各说各的：
 * 「还没选工作区」要人去选，「本机没有缓存」要桌面端同步一次，「缓存读不出来」等一会儿就好，
 * 拿一句「没有数据」盖住这四种，用户就不知道该做什么。
 */
function reasonText(reason: string, zh: boolean): string {
  if (reason === 'no-workspace') return zh ? '还没选工作区。先在某个项目里打开过一次，再去设置里选后端。' : 'No workspace selected yet.'
  if (reason === 'no-library') return zh ? '本机还没有这个工作区的缓存。等桌面端同步一次再看。' : 'No local cache for this workspace yet.'
  if (reason === 'library-broken') return zh ? '本机缓存读不出来，可能正在被重写，过一会儿再看。' : 'The local cache could not be read.'
  if (reason === 'no-session') return zh ? '这个面板还没有会话信息。' : 'This panel has no session yet.'
  return ''
}

/** 地图列表这一屏要摆的节点。 */
function mapBlocks(model: DeckModel, sessionId: string, caps: any): any[] {
  const zh = isZh(caps)
  const page = mapRows(model, sessionId)
  if (page.total === 0) {
    const message = model.reason ? reasonText(model.reason, zh) : zh ? '这个工作区还没有地图。' : 'No maps in this workspace yet.'
    return mapListView('', [], '', zh ? '还没有地图' : 'No maps yet', message)
  }
  const more = page.more > 0 ? (zh ? '还有 ' + page.more + ' 张' : page.more + ' more') : ''
  const status = zh ? '共 ' + page.total + ' 张地图' + (more ? '，' + more : '') : page.total + ' maps'
  return mapListView(status, page.rows, page.more > 0 ? (zh ? '再看 20 张' : 'Next 20') : '', '', '')
}

/** 本会话的活这一屏要摆的节点（三种状态：没选工作区 / 没动过票 / 正在做票）。 */
function workBlocks(model: DeckModel, caps: any): any[] {
  const zh = isZh(caps)
  if (model.reason === 'no-workspace' || model.reason === 'no-session') {
    return sessionWorkView('no-workspace', zh ? '还没选工作区' : 'No workspace', reasonText(model.reason, zh), [], [])
  }
  const rows = workRows(model)
  if (rows.length === 0) {
    const title = zh ? '这个会话还没动过票' : 'No tickets yet in this session'
    const message = model.reason ? reasonText(model.reason, zh) : zh ? '下面是最近动过的三张地图。' : 'The three most recent maps are below.'
    return sessionWorkView('no-work', title, message, [], recentMaps(model))
  }
  return sessionWorkView('work', zh ? '本会话动过 ' + rows.length + ' 张票' : rows.length + ' tickets', '', rows, [])
}

/** 票详情这一屏要摆的节点（五段的顺序由 dshGoViews 里的 ticketDetailView 定）。 */
function detailBlocks(model: DeckModel, sessionId: string, caps: any): any[] {
  const zh = isZh(caps)
  if (model.reason === 'no-workspace' || model.reason === 'no-session') {
    return [{ type: 'emptyState', title: zh ? '还没选工作区' : 'No workspace', message: reasonText(model.reason, zh), icon: 'folder' }]
  }
  const ui = uiOf(sessionId)
  const detail = detailOf(model, sessionId, ui.openTicket)
  if (!detail.key) {
    return [
      {
        type: 'emptyState',
        title: zh ? '还没选票' : 'No ticket picked',
        message: zh ? '在地图面板里点一张子票，这里就会显示它的详情。' : 'Pick a ticket in the maps panel.',
        icon: 'document',
      },
    ]
  }
  return ticketDetailView(detail)
}

/** 设置这一屏要摆的节点。 */
function settingsBlocks(model: DeckModel, caps: any): any[] {
  const blocks = settingsView(settingsOf(model, packageVersion() || '—'))
  if (model.reason && model.reason !== 'no-session') blocks.unshift({ type: 'callout', text: reasonText(model.reason, isZh(caps)), tone: 'warn' })
  return blocks
}

/** 插件版本（设置页显示用）。读不到就说不知道，不编一个版本号出来。 */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(String(readFileSync(new URL('../package.json', import.meta.url), 'utf8')))
    return String(pkg.version || '')
  } catch (e) {
    return ''
  }
}

/** 按面板 id 摆出这一屏的节点；四块面板共用同一份读数。 */
function blocksOf(id: string, model: DeckModel, sessionId: string, caps: any): any[] {
  try {
    if (id === 'map-list') return mapBlocks(model, sessionId, caps)
    if (id === 'session-work') return workBlocks(model, caps)
    if (id === 'ticket-detail') return detailBlocks(model, sessionId, caps)
    return settingsBlocks(model, caps)
  } catch (e) {
    return FALLBACK_BLOCKS
  }
}

/**
 * 面板的 view：只给骨架，内容全部走 data.blocks。
 * 为什么内容不能在这里算：view 每个请求只调一次，而 data 会随点按与刷新反复推送；
 * 把行算在 view 里，画面就停在打开那一刻，点「展开」也不会变。
 *
 * v 必须是 2：空态（emptyState）与分隔线（divider）都是第二版才有的节点，
 * 根节点写 v: 1 时 App 只认第一版那十六个组件，用到这两个的面板会整块画不出来。
 */
function panelSkeleton(id: string, caps: any): any {
  const title = TITLES[id as keyof typeof TITLES] || TITLES.settings
  return { v: 2, type: 'stack', title: isZh(caps) ? title.zh : title.en, children: { $: 'data.blocks' } }
}

/**
 * 面板的 data：先发一帧（有上一次读数就直接用，没有就说「正在读取」），再异步读一次并补发。
 * 返回的函数是取消句柄：面板关掉之后不再往已停掉的 feed 里写。
 */
function panelData(ctx: any, id: string) {
  return (scope: any, emit: any, caps: any) => {
    let live = true
    const sessionId = String(scope?.sessionId || '')
    const cached = lastModel(sessionId)
    emit({ blocks: cached === undefined ? loadingBlocks(caps) : blocksOf(id, cached, sessionId, caps) })
    void loadModel(ctx, sessionId)
      .then((model) => {
        if (live) emit({ blocks: blocksOf(id, model, sessionId, caps) })
      })
      .catch(() => {})
    // 点按只改内存里的界面状态（展开哪张地图、翻到第几页、在看哪张票），这里订阅它：
    // 改完立刻把同一份读数重新摆一帧发出去。少了这一步，点按返回 refresh 之后 App 取回的
    // 还是旧帧（桥接的 /views 只回 feed 里的当前值，不会重跑 data），画面就一直不动。
    // 读数（DeckModel）跟着面板的会话走；界面状态（展开了哪张地图、第几页）按点按写进的那个会话来读。
    // 平常两者是同一个会话；点按不带 sessionId 时会写进空会话那一格，所以下面连带订阅空会话并用它读界面状态，
    // 这样「面板有会话、点按没有」也不会变成点了没反应。
    const redraw = (uiSessionId: string) => () => {
      if (!live) return
      const model = lastModel(sessionId)
      if (model === undefined) return
      emit({ blocks: blocksOf(id, model, uiSessionId, caps) })
    }
    const stops = [watchUi(sessionId, redraw(sessionId))]
    if (sessionId !== '') stops.push(watchUi('', redraw('')))
    return () => {
      live = false
      for (const stop of stops) stop()
    }
  }
}

function loadingBlocks(caps: any): any[] {
  return [{ type: 'text', text: isZh(caps) ? '正在读取本机缓存…' : 'Reading local cache…', tone: 'muted' }]
}

/**
 * 面板的 actions。三件事：把「刚点开了哪张地图 / 哪张票 / 翻到第几页」记进这个会话的内存状态，
 * 然后要么让 App 重新取一遍（refresh），要么打开另一块面板（open）。
 * 为什么不用 patch 自己拼数据：整屏节点很容易超过 patch 的 16 KiB 上限，而重取一遍既简单又不会显示半截。
 */
function panelActions(id: string): any {
  const openTicket = (scope: any, event: any) => {
    rememberUi(String(scope?.sessionId || ''), { openTicket: String(event?.value?.key || '') })
  }
  if (id === 'map-list') {
    return {
      expand: (scope: any, event: any) => {
        const who = String(scope?.sessionId || '')
        const key = String(event?.value?.key || '')
        rememberUi(who, { expandedMap: uiOf(who).expandedMap === key ? '' : key })
        return { refresh: true }
      },
      more: (scope: any) => {
        const who = String(scope?.sessionId || '')
        rememberUi(who, { page: uiOf(who).page + 1 })
        return { refresh: true }
      },
      'open-ticket': (scope: any, event: any) => {
        openTicket(scope, event)
        return { open: 'panel:ticket-detail' }
      },
    }
  }
  if (id === 'session-work') {
    return {
      'open-ticket': (scope: any, event: any) => {
        openTicket(scope, event)
        return { open: 'panel:ticket-detail' }
      },
      // 这块面板下面的「最近地图」列表点一行要能进地图面板看到那张地图的明细。
      // 动作必须注册在这儿：点按只在本面板注册过的动作里找，没注册就是 409 no-handler。
      expand: (scope: any, event: any) => {
        rememberUi(String(scope?.sessionId || ''), { expandedMap: String(event?.value?.key || '') })
        return { open: 'panel:map-list' }
      },
      maps: () => ({ open: 'panel:map-list' }),
      settings: () => ({ open: 'panel:settings' }),
    }
  }
  if (id === 'ticket-detail') {
    return {
      'open-ticket': (scope: any, event: any) => {
        openTicket(scope, event)
        return { refresh: true }
      },
      maps: () => ({ open: 'panel:map-list' }),
    }
  }
  return { maps: () => ({ open: 'panel:map-list' }) }
}

/** 状态条的取数：先发手上有的，再异步补一帧更准的（状态条只认 text 一格）。 */
function stripReader(ctx: any) {
  return (scope: any, emit: any, caps: any) => {
    let live = true
    const sessionId = String(scope?.sessionId || '')
    const zh = isZh(caps)
    const say = (model: DeckModel) => {
      if (!live) return
      const facts = stripOf(model, sessionId)
      const text = facts.kind === 'none' ? (zh ? STRIP_TEXT.zh : STRIP_TEXT.en) : stripText(facts.kind, facts.decided, facts.total, facts.nextKey, facts.mapCount)
      emit({ text })
    }
    const cached = lastModel(sessionId)
    if (cached === undefined) emit({ text: zh ? STRIP_TEXT.zh : STRIP_TEXT.en })
    else say(cached)
    void loadModel(ctx, sessionId)
      .then((model) => say(model))
      .catch(() => {})
    // 状态条挑哪张地图看的是「刚展开了哪张」，所以界面状态一变也要重算一次文案。
    const redraw = (uiSessionId: string) => () => {
      const model = lastModel(sessionId)
      if (model === undefined) return
      if (!live) return
      const facts = stripOf(model, uiSessionId)
      const text = facts.kind === 'none' ? (zh ? STRIP_TEXT.zh : STRIP_TEXT.en) : stripText(facts.kind, facts.decided, facts.total, facts.nextKey, facts.mapCount)
      emit({ text })
    }
    const stops = [watchUi(sessionId, redraw(sessionId))]
    if (sessionId !== '') stops.push(watchUi('', redraw('')));
    return () => {
      live = false
      for (const stop of stops) stop()
    }
  }
}

/**
 * 把四块面板与状态条注册上去。只在这里注册，别的什么都不做
 * （取数在 dshGoData.ts，摆版面在 dshGoViews.ts）。
 * 每一项单独 try：一项注册失败只该丢那一项，不能连累其余。
 */
export function installDshGo(ctx: any): void {
  ctx.inject(['dshGo'], (child: any) => {
    const go = child?.dshGo
    if (go === undefined) return
    const guard = (what: string, run: () => void) => {
      try {
        run()
      } catch (e) {
        try {
          child?.logger?.warn?.('[dsh-mattpocock-skills-deck] dsh-go 注册失败：' + what, e)
        } catch (eLog) {}
      }
    }
    for (const id of PANEL_IDS) {
      guard('面板 ' + id, () => go.panel(id, { view: (scope: any, caps: any) => panelSkeleton(id, caps), data: panelData(child, id), actions: panelActions(id) }))
    }
    guard('状态条 ' + STRIP_ID, () => go.strip(STRIP_ID, stripReader(child)))
  })
}
