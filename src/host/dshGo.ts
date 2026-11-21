/**
 * src/host/dshGo.ts —— dsh-go 手机原生界面的宿主侧注册（地图 #3 的落地骨架，票 #7）。
 *
 * 这个文件干什么：在 dsh-go 桥接提供的 ctx.dshGo 上，把本插件的四块面板与一条状态条的注册点占好。
 * 首版只交骨架画面（与 package/dsh-go/views/*.json 同一份内容），真实数据由后续的票接进来：
 * 面板取本机快照缓存是 #5，工具结果卡是 #4。
 *
 * 为什么单独一个文件：插件入口 src/host/index.ts 只剩一行行数余量，而且入口不许加静态 import（D7），
 * 所以注册代码住在这里，由入口在启动阶段动态 import 进来调用一次。
 *
 * 五条不能改的约定（改之前先看地图 #3 与票 #7）：
 * 1. 只在有桥接的主机上生效：本文件把注册写进 ctx.inject(['dshGo'], …) 的回调里。纯网页版主机没有这个服务，
 *    回调永远不会执行，所以网页界面一行都不变——这正是本票验收里「网页版界面没有变化」那条的成立方式。
 * 2. 这里出现的每个 id 都必须与 package/package.json 的 dshGo.contributes 里声明的 id 逐字一致。
 *    对不上时 dsh-go 桥接只记一条 warn 然后忽略这次注册（判定见 dsh-go-bridge 的 lib/native/core.js，#add 的 declared 分支）。
 * 3. 注册必须在 ctx.inject 回调拿到的那个子上下文上做：桥接靠调用方 fiber 的父链认出包名，
 *    换一个 ctx 调用会抛「dshGo: call ctx.dshGo.* as a method from a plugin context」。
 * 4. 面板的注册视图优先于清单里的静态 JSON 文件。这里两处给出同一份内容，是为了让面板在宿主注册失败时
 *    也能靠静态文件打开（桥上「有没有文件」与「有没有注册」任一条成立就算可用）。
 * 5. 一次点按的处理要在 3 秒内返回、最多给 4 个效果。这里全是同步的静态值，不发起任何异步取数。
 */

// 本域 tsconfig 有意不加载 Node 类型包（types 为空），运行时一定是 Node，这个内建模块必然存在。
// @ts-expect-error
import { readFileSync } from 'node:fs'

/** 四块面板的 id（与 package/package.json 的 dshGo.contributes.panels 逐字一致）。 */
const PANEL_IDS = ['map-list', 'session-work', 'ticket-detail', 'settings'] as const

/** 状态条 id（与 contributes['composer.strip'] 里那一条逐字一致）。 */
const STRIP_ID = 'deck-strip'

/** 状态条文案：清单里也写了同一份，双写是为了没注册时也有字可显示；数据接入后再换成真实进度。 */
const STRIP_TEXT = { zh: '技能票台', en: 'Tracker Deck' }

/** 占位视图所在目录：构建后本文件在 package/lib/ 下，视图在 package/dsh-go/views/ 下。 */
const VIEW_DIR = new URL('../dsh-go/views/', import.meta.url)

/**
 * 读不到视图文件时的兜底画面。
 *
 * 什么时候会用到：在源码树里跑测试与自检时，本文件旁边的 ../dsh-go 并不存在（那份视图只住在发布包里），
 * 这时给一份最小画面，保证注册路径照样跑通，而不是让整个模块抛错。
 */
const FALLBACK_VIEW = { type: 'stack', children: [{ type: 'text', text: '技能票台', tone: 'muted' }] }

/** 视图只读不写：读一次就缓存，桥接每次打开面板都会问一次，别每次都碰磁盘。 */
const viewCache = new Map<string, any>()

/** 取一块面板的画面：优先读包内的静态视图，读不到就用兜底画面。 */
function panelView(id: string): any {
  const cached = viewCache.get(id)
  if (cached !== undefined) return cached
  let view: any = FALLBACK_VIEW
  try {
    view = JSON.parse(readFileSync(new URL(id + '.json', VIEW_DIR), 'utf8'))
  } catch (eRead) {
    view = FALLBACK_VIEW
  }
  viewCache.set(id, view)
  return view
}

/**
 * 状态条的数据函数：桥接每次需要显示都会调它，emit 一个对象就是这一行的内容。
 *
 * 现在给的是常量（与清单里的静态文案相同）；#5 接上本机快照缓存后，这里换成「已决 3/8 · 下一张：某张票」。
 * 文案上限 24 字，超了桥接会截断，所以以后拼字符串时要自己先算长度。
 */
function stripData(scope: any, emit: any, caps: any): void {
  const locale = typeof caps?.locale === 'string' ? caps.locale.toLowerCase() : ''
  emit({ text: locale.startsWith('zh') ? STRIP_TEXT.zh : STRIP_TEXT.en })
}

/**
 * 在有 dsh-go 桥接的宿主上占好这个插件的注册点：四块面板的视图、一条状态条的实时数据。
 *
 * 由插件入口在启动阶段调用一次。没有桥接的主机上，ctx.inject 的回调永远不会执行，这个函数等于没做事。
 * 每一项单独 try/catch：某一项写错只丢那一项，不会连带其它项，也不会让宿主开机失败。
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
    for (const id of PANEL_IDS) guard('面板 ' + id, () => go.panel(id, { view: () => panelView(id) }))
    guard('状态条 ' + STRIP_ID, () => go.strip(STRIP_ID, stripData))
  })
}
