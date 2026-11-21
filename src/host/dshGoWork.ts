/**
 * src/host/dshGoWork.ts —— 技能票台「本会话的活」要读的在办表（地图 #3 · 票 #5）。
 *
 * 在办表是 ~/.dsh/mattskillsdeck/work-path/<16 位散列>.json，写者是 src/deck/shell/work-path-store.ts：
 * 它记「哪个会话动过哪张票、最近一次是什么动作、什么时候」。这张表**没有状态字段**，
 * 所以面板要显示状态时必须另行读快照库（dshGoCache.ts），两者按票号对齐。
 *
 * 文件名是两级散列，顺序不能反：先 workspaceKeyOf（8 位工作区键），再 chainRootHash（16 位文件名）。
 * 在办表的写者收到的 rootKey 已经是 8 位那份，它只做第二步；直接对工作区根做 chainRootHash
 * 会得到另一个文件名（本机实测对不上），读不到东西。
 *
 * 两条不能改的约定：
 * 1. 只认当前会话那一格：别的会话动过的票不拿来凑数，否则面板会显示不属于这个对话的活。
 * 2. 文件不存在是正常状态（新会话、新工作区都会没有），回 ok=true 配 no-file，不报错。
 */

import { workspaceKeyOf } from '../refresh/contract/workspace-keys.js'
import { chainRootHash } from '../refresh/kernel/refresh-chain.js'

// 本域 tsconfig 有意不加载 Node 类型包（types 为空），运行时一定是 Node。
declare const process: { getBuiltinModule(id: string): any }

/** 在办表所在的目录（相对用户主目录）。 */
const WORK_PATH_REL = '.dsh/mattskillsdeck/work-path'

/** 在办表里的一条：这个会话动过哪张票、最近一次是什么动作、什么时候。 */
export interface WorkEntry {
  key: string
  title: string
  /** 'edit' | 'report'，原样来自在办表，面板只拿它区分「改过」与「上报过」。 */
  action: string
  at: number
}

/** 在办表读出来的结果。 */
export interface DeckWork {
  ok: boolean
  /** '' | 'no-workspace' | 'no-session' | 'no-file'（还没动过票）| 'no-session-entry'（文件里有别的会话）| 'read-failed'。 */
  reason: string
  entries: WorkEntry[]
  /** 这份在办表最后写入的时刻；0 表示没有文件。 */
  at: number
}

function nodeFs(): any {
  return process.getBuiltinModule('node:fs')
}

function nodePath(): any {
  return process.getBuiltinModule('node:path')
}

function nodeOs(): any {
  return process.getBuiltinModule('node:os')
}

/** 在办表文件的绝对路径（两级散列；顺序见文件头）。 */
export function workFilePath(rootKey: string, homeDir?: string): string {
  const home = String(homeDir || '').trim() || String(nodeOs().homedir())
  const name = String(chainRootHash(workspaceKeyOf(rootKey))) + '.json'
  return nodePath().join(home, WORK_PATH_REL, name)
}

/** 读这个会话在在办表里的那些票，最近的排在前面。 */
export function readWork(rootKey: string, sessionId: string, homeDir?: string): DeckWork {
  const out: DeckWork = { ok: false, reason: '', entries: [], at: 0 }
  if (!String(rootKey || '').trim()) {
    out.reason = 'no-workspace'
    return out
  }
  if (!String(sessionId || '').trim()) {
    out.reason = 'no-session'
    return out
  }
  const sid = String(sessionId)
  try {
    const doc: any = JSON.parse(String(nodeFs().readFileSync(workFilePath(rootKey, homeDir), 'utf8')))
    const workers: any[] = Array.isArray(doc && doc.workers) ? doc.workers : []
    const mine = workers.filter((worker) => String((worker && worker.session) || '') === sid)[0]
    out.ok = true
    out.at = Number(doc && doc.at) || 0
    if (mine === undefined) {
      out.reason = 'no-session-entry'
      return out
    }
    out.entries = (Array.isArray(mine.entries) ? mine.entries : [])
      .map((entry: any) => ({
        key: String((entry && entry.ticketKey) || ''),
        title: String((entry && entry.title) || ''),
        action: String((entry && entry.action) || ''),
        at: Number(entry && entry.actionAt) || 0,
      }))
      .filter((entry: WorkEntry) => entry.key !== '')
      .sort((l: WorkEntry, r: WorkEntry) => r.at - l.at)
    return out
  } catch (e) {
    const code = String((e && (e as any).code) || '')
    if (code === 'ENOENT') {
      out.ok = true
      out.reason = 'no-file'
      return out
    }
    out.reason = 'read-failed'
    return out
  }
}
