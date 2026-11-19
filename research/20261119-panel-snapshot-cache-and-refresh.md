# 原生面板能不能秒开：快照库与刷新层现在到底替我们存了什么

> 委派调研（只读，不改生产代码、不碰 GitHub、不动任何票）· 落盘日期 2026-11-19 · 基线 d22e0b67（1.9.0-beta.34，分支 main）
> 数据来源：本仓 src/workspace-snapshot/**、src/refresh/**、src/host/**、src/deck/shell/**、config/intervals.yaml、config/ttl.yaml 的当前源码（逐条注到行）；已安装的 dsh-plugin-update 0.18.39 的 dist/；本机 /root/.dsh/skills/dsh-go-plugin 的插件协议说明；以及 2026-11-19 在本机实际列目录的结果。
> 复用了哪几篇既有笔记：research/20261104-snapshot-consensus.md（把「本地 SQLite 文件是唯一根基」讲清楚的那篇）、research/20261106-snapshot-lease-first-principles.md（写锁与租约）、research/20261103-capsule-cached-state-first-paint.md（在办表为什么没有票的状态）。research/1436-capsule-workroute-first-open-latency.md 里「客户端三级缓存：内存 → IndexedDB → 网络」那一段已经过时，IndexedDB 那一层在 #1863 退役、#1870 把空壳也删了（src/refresh/rooms/client/snapshot-cache-store.ts:8-10），本文不再沿用。

## 一、结论

**一句话：宿主进程里已经有一份「一份自洽、可离线、毫秒级读」的工作区快照（SQLite 库 + 同步读口），四类数据里只有「地图与子票」中的已关闭容器和「当前会话对应的票」需要额外一处存储，另外两类（工作区与后端、版本与更新状态）今天都只能异步现算，没有落盘结论可以同步读；所以原生面板能做到「打开即画」的部分是票与地图，做不到的部分是「这是哪个后端」和「有没有新版本」。**

| 问题 | 一句话答案 | 一手位置 |
|---|---|---|
| 有哪些缓存文件 | 一处 SQLite 快照库（十三张表，含墓碑表）+ 三处小 JSON（在办表、后端选择、更新状态）+ 两个工作区内的附带文件 | src/workspace-snapshot/persistence/schema.ts；src/host/choiceStore.ts:147-154；src/deck/shell/work-path-store.ts:68-75；dsh-plugin-update dist/core/disk.js:28-31 |
| 多久刷新一次 | 库本身没有过期时间，只有版本号；内容由探针驱动，活跃时 5 秒一次，黄档 2 分钟，降级 60 秒，整池重建 10 分钟 | config/intervals.yaml:17、:19、:25、:52；src/refresh/kernel/host-budget.ts:368-396 |
| 读到的是不是自洽快照 | 是。一次投影 = 一个读事务，版本与数据同一时刻；304 只认库版本 | src/workspace-snapshot/persistence/read-transaction.ts:1-33；src/refresh/rooms/host/snapshot-reply-version.ts:31-40 |
| 能不能同步读 | 底层可以（node:sqlite 同步 API、八个同步读方法），但开库接口没有只读开关、身份三格算错会重建别人的库 | src/workspace-snapshot/runtime/open.ts:88；src/workspace-snapshot/runtime/read-ports.ts:57-92；src/workspace-snapshot/runtime/open-schema.ts:312-317 |

## 二、逐条回答

### Q1. 现在有哪些缓存文件，各自装什么，多久刷新，谁写谁读

**【已确认】** 真正承担「秒开」的只有一份文件：工作区根下的 SQLite 快照库。其余都是小状态的落地，不足以单独撑起一屏。

| 文件（本机真实路径形态） | 装什么 | 谁写 | 谁读 | 刷新节奏 |
|---|---|---|---|---|
| `<工作区根>/.dsh-mattskillsdeck-cache/snapshot/<backend>.sqlite` | 该工作区该后端全部票、正文、标签、指派、父子与阻塞边、里程碑、评论、评审、取数游标、meta（租约、`merge_version`、同步簿记） | 三个写点：`src/host/index.ts:104`（issue 列表回包）、`src/refresh/rooms/host/session-refresh-schedule.ts:151-152`（刷新调度）、`src/refresh/rooms/host/snapshot-library-first-screen.ts:198`（首屏重建后整批提交） | `readSnapshotReplay` / `readSnapshotCounts` / `readContainerProjection` / `readIssueDetail` / `readChangeSet` / `readStorageStats`，统一经 `src/refresh/rooms/host/snapshot-library.ts` | 库自身不设过期时间（#1922 明确不淘汰、不设上限）；内容随探针更新，活跃 5 秒、黄档 120 秒、降级 60 秒、整池重建 600 秒 |
| `<家目录>/.dsh/mattskillsdeck/choices.json` | 用户亲手选过的后端，键是工作区键的散列，值形如 `{backendId, rev, pickedAt, source:'user'}` | `src/host/choiceStore.ts`（原子写：临时文件 + 改名） | 同上；以及 `wf.selection` / `wf.bindings` | 只在人点选时写；读是每次现读异步 |
| `<家目录>/.dsh/mattskillsdeck/work-path/<工作区根散列>.json` | 在办表：票号、标题、动作、动作时刻、是否当前会话 —— **没有票的状态** | `src/deck/shell/work-path-store.ts`（读盘 → 合并 → 裁 30 天外 → 超 2MB 从旧到新裁 → 隐私自检 → 原子写 → 读回核对） | `wf.workRoute` 与快照回包最后一步 `attachWorkRouteTable` | 每次有工具动作就写一次；读时按「保留 30 天 / 在办 24 小时 / 撞单 30 分钟」三个窗口投影 |
| `<家目录>/updates/dsh-mattpocock-skills-deck/<profileDir 短散列>/state.json` | 更新状态：`latestVersion` / `checkedAt` / `expiresAt` / `checkAgeMs` | 外部包 `dsh-plugin-update` 0.18.39，全部 `node:fs/promises` 异步 | 同一个包；插件侧只有 `wf.updateStatus` 这条异步电话 | 面板打开时按 1000 毫秒轮询同进程内存，不是每秒读盘 |
| `<工作区根>/.dsh-mattskillsdeck-cache/deck-plans/` | 计划游标（人上次读到哪） | `src/deck/shell/plan-cursor.ts:83-94` | 同上 | 按 `PLAN_CURSOR_TTL_MS` 判过期；写不了就退化成内存 |
| `<工作区根>/.dsh-mattskillsdeck-cache/naming-guardian.json` 与 `notification-events__<owner>__<name>.json` | 命名守护状态、通知去重 | `src/host/namingGuardian.ts:63`、`src/refresh/rooms/host/notification-store.ts:5` | 同上 | 事件驱动，与面板首屏无关 |

**【已确认】** 另有几处**只存在进程内存**的「缓存」，重启就没了，原生面板不能把它们当成离线数据：宿主在线组装器自己的 5 秒快照缓存（`src/host/tracker/snapshot.ts:191-194`、`:275`，取 `config/ttl.yaml:54` 的 `snapshotTtlMs`）、库句柄缓存最多 4 个（`src/refresh/rooms/host/snapshot-library-handles.ts:48`）、探测结论 30 秒内存表（`src/tracker/detection/workspaceStore.ts`，有效期取 `config/ttl.yaml:49` 的 `workspaceStoreTtlMs: 30000`）、客户端内存 LRU 20 份（`src/refresh/rooms/client/snapshot-cache-store.ts:130-132`）、客户端地图票 60 秒缓存（`src/client/kernel/api-io.ts:447-461`）、「本机库落后」标记（`src/refresh/rooms/host/snapshot-library-behind.ts`，文件头第 3 条明确不做持久队列）。

**【已确认】** 本机 2026-11-19 实测：`/root/workspace/code/matt/dsh-mattpocock-skills-deck/.dsh-mattskillsdeck-cache/` 下只有空的 `deck-plans/`，**没有 `snapshot/`**；`/root/.dsh/mattskillsdeck/` 下只有 `choices.json`（486 字节，三条工作区记录，`layouts` 为空）与 `settings.yaml`，**没有 `work-path/`**；`/root/.dsh/updates` 不存在。也就是说这台机器上三类缓存都还没被写过，任何「打开就有东西」的验证都得先跑一次真实取数。

### Q2. 面板要的四类数据，各自能从哪一层直接取到

**【已确认】** 四类数据的落点完全不同，没有一处能一次全给。

**第一类：工作区与后端（哪个目录、哪个后端、哪个仓库）**

- 今天没有「已经算好的结论」可以同步读。能读的只有 `choices.json`，而它只记「人亲手选过的」，不记自动探测出来的结论（`src/host/choiceStore.ts:133`、`:147-154`；`src/host/workspaceCwd.ts:206-226` 的 `handleBindings` 也明说只回 `source:'explicit'`）。
- 自动探测走 `src/host/workspaceCwd.ts:237-283` 的 `handleSelection`：`normCwd` → `migrateChoiceToFile` → `getDecisionFn().decideBackend(...)` → `selectionFromOutlet`；三级联是 `explicit(file) > matches(registry.select 并行) > fallback(null)`，匹配档有 30 秒兜底超时（`src/tracker/detection/detectionService.ts:7`），结论只在内存放 30 秒，进程重启全丢。
- 目录本身要问 `wf.cwd`（`src/host/sessionLifecycle.ts:136-157`），它用 sessionId 换 `header.cwd`，失败分 `no-sid` / `no-service` / `not-found` / `no-cwd` 四种。
- 结论：这一类**必须异步拿**，而且第一次可能要等探测。原生面板要么接受首帧先不显示后端名，要么先画票、后端名后到。

**第二类：地图与子票**

- 能直接读库：`wf.containerProjection`（`src/refresh/rooms/host/snapshot-read-channels.ts:264-290`）给一张容器的 `{container, tickets, stats}`，内部就是 `handle.readContainerProjection`（`src/refresh/rooms/host/snapshot-library.ts:381-400`，同步方法）。
- 也能整份读：`wf.snapshot` 的库回放路径直接交付 `snapshotOfProjection` 的 `maps` / `issues` / `thinTickets`（`src/host/tracker/snapshotAssemble.ts:126`、`:132`、`:170`）。
- 另有一条**每次现取后端**的路：`wf.mapTickets`（`src/host/mapTickets.ts:174-217`），每次都 `selectEarly` + `listSubIssues`，只放行 github 或 composer 选择，别的后端直接回「这个后端不能按需取一张地图的子票」。
- 结论：这一类是四类里**最适合离线**的，两条路都在，选「读库」那条就完全不碰网络。

**第三类：当前会话对应的票**

- 来自 `wf.workRoute`（`src/host/snapshotEnvelope.ts:235` 造电话，`:292` 回 `{ok:true, workRouteTable}`），也就是读 `work-path/<散列>.json`。
- 也可以从整份快照回包里顺手拿到：`src/refresh/rooms/host/session-snapshot-cache.ts:153` 在回包最后一步 `attachWorkRouteTable`。
- 注意它只有票号、标题、动作、时刻与「是不是当前会话」，**没有开/闭状态**（`src/deck/shell/work-path-readout.ts:39-50`，与 research/20261103 那篇一致）。要状态得回库或回快照里查。
- 结论：能离线、能同步读的只有「哪些票跟我这个会话有关」；「这些票现在什么状态」必须配一次库读。

**第四类：版本与更新状态**

- 「版本」在快照这层只有一个含义：库的 `merge_version`。`wf.snapshotVersion` 只回三格 `{version, workspaceKey, backend}`，注释写明「信号不带真相」（`src/refresh/rooms/host/snapshot-read-channels.ts:176`）；读不到就回 `library-corrupt`，**不编 0**（0 是合法版本）。
- 插件自身的版本与「有没有新版」不在快照库里：`src/host/index.ts:366-369` 只注册了 `wf.updateStatus` / `wf.updateCheck` / `wf.updateInstall` / `wf.updateChangelog` 四条异步电话，实现全在外部包 `dsh-plugin-update`（`src/host/updateFromPackage.ts` 只做薄接线，包缺失直接抛错、不降级）。
- 那个包的状态文件是 `<homeDir>/updates/<pluginId>/<profileDir 短散列>/state.json`（`dist/core/disk.js:28-31`，`dist/core/reader.js:135-140` 定 home 为 `DSH_HOME` 或 `~/.dsh`），字段有 `latestVersion`、`checkedAt`、`expiresAt=checkedAt+confirmationTtlMs`、`checkAgeMs`，版本判定还可能是 `unknown` 且 `unknownCause='no-latest'`（`dist/core/service.js:317`）。
- 结论：这一类**没有同步读出口**，面板只能调异步电话；离线时只能显示「上次检查于 …」或「—」。

### Q3. 缓存缺失、过期、工作区未绑定的时候应该拿到什么

**【已确认】** 现有代码对每一种空态都给了独立表示，没有拿 0 或空数组冒充「真的没有」。原生面板照抄这套语义即可。

| 情形 | 现在返回什么 | 位置 |
|---|---|---|
| 还不知道是哪个目录 | `{ok:true, selection:{backendId:null, source:'unknown', origin:'unknown-workspace', canWrite:false, reason:'workspace-not-ready'}, repository:null}` | `src/host/workspaceCwd.ts:237-244` |
| 知道目录、没选后端 | 快照电话回「这个工作区还没选后端，读不到本地快照库的版本。」 | `src/refresh/rooms/host/snapshot-read-channels.ts:129` |
| 快照电话的 cwd 为空 | `{ok:false, error:'这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。'}` | `src/refresh/rooms/host/session-snapshot-cache.ts:159` |
| 库文件还不存在（只读打开要求文件已存在） | 开库抛错 → 句柄门面回 `null` → 首屏降级 `libraryEmpty` | `src/workspace-snapshot/persistence/database.ts:9`；`src/refresh/rooms/host/snapshot-library-handles.ts:87-124`；`snapshot-library-first-screen.ts:273-287` |
| 库存在但读坏了 / 被重建过 | `libraryCorrupt`（重建诊断码 `corrupt-rebuilt` / `schema-reset` / `identity-mismatch-rebuilt`） | `src/refresh/rooms/host/snapshot-degradation.ts:10-35` |
| 库开着，但这一张容器还没进库 | `reason:'container-not-in-library'`，不拿空数组冒充 | `src/refresh/rooms/host/snapshot-read-channels.ts:287` |
| 版本读不到 | `{ok:false, errorKind:'library', reason:'library-corrupt'}`，不编 0 | `src/refresh/rooms/host/snapshot-read-channels.ts` 版本分支 |
| 在办表没有读口 / 没工作区 / 读失败 | `host.work-route.no-binding` / `host.work-route.no-workspace` / `read-failed` | `src/refresh/rooms/host/work-route-readout.ts:95-108`；`src/host/snapshotEnvelope.ts:274-292` |
| 库比后端落后（写回执没落进去） | `{behind:true, reason, sinceMs}`，只在本进程内存里，重启后回到 `{behind:false, reason:'', sinceMs:0}` | `src/refresh/rooms/host/snapshot-library-behind.ts` 文件头；`snapshot-library.ts:260` |
| 更新状态没查过 | `verdict.kind='unknown'`、`unknownCause='no-latest'` | dsh-plugin-update `dist/core/service.js:317` |

**【已确认】** 「过期」在这套系统里**不是删数据，是调低可信度**：库里的行带着各组的 `lastQueriedMs`，回放时取八组最大值当「上次已知时刻」，没有就用投影的 `generatedAtMs`（`src/refresh/rooms/host/snapshot-library.ts:133-147`）；界面按 `freshnessLevel(ageMs)` 分三档——超过 5 分钟发黄、超过 30 分钟发红（`src/refresh/kernel/host-budget.ts:368-372`，数值在 `config/ttl.yaml:43`、`:45`）。所以面板的正确画法是「旧数据照画 + 角标说上次更新于几点」，不是「过期就当没有」。

### Q4. 在插件进程里同步读这些缓存可行吗

**【已确认】** 底层完全同步，而且原生插件与 deck 插件确实在同一个 Node 进程里。

- 驱动是 Node 内置的 `node:sqlite`，不是 better-sqlite3：`src/workspace-snapshot/persistence/database.ts:6` 的 `import { DatabaseSync } from 'node:sqlite'`，`:10-12` 直接 `new DatabaseSync(dbPath, { readOnly })`。
- 读口八个方法全是同步的：`getMergeVersion` / `readSyncBookkeeping` / `readCounts` / `readStorageStats` / `readList` / `readIssueDetail` / `readContainerProjection` / `readChangeSet`（`src/workspace-snapshot/runtime/read-ports.ts`）。`src/workspace-snapshot/runtime/open.ts:88` 的注释原文就是「返回的 handle 是同步 API」，`contract/types.ts:340-341` 还专门解释「ingest 是同步的：SQLite 在本机是同步 IO，包成 Promise 只会让调用方误以为可以并发压进来」。
- 原生插件跑在 DSH 引擎的 Node 进程里：`/root/.dsh/skills/dsh-go-plugin/template/lib/index.js` 开头原文是「Runs inside the DSH engine (Node); the dsh-go app draws what package.json "dshGo" declares and calls these handlers when tapped.」
- view 有 3 秒硬超时（插件协议 `kit/lib/bridge/limits.js` 的 `viewTimeoutMs 3000`），同步读一次库是毫秒级，两者不冲突；但不能在 view 里联网。

**【已确认】** 但直接 `openWorkspaceSnapshot()` 有三个坑，都会让「同步读」变成「写别人的库」：

1. **开库接口没有只读开关**。`OpenWorkspaceSnapshotOptions` 只有 `workspaceRoot` / `backend` / `repoIdentity` / `dbPath` / `now` / `leaseOwner` / `storageKind` / `logEvent` / `onReadStep`（`contract/types.ts:302-332`），一律先按可写开。可写开意味着 `mkdirSync`（`open.ts:123`）、必要时建表 / 迁移 / 整库重建（`open-schema.ts:251-309`）。只有文件系统明确拒绝写（`EACCES`/`EPERM`/`EROFS` 或 message 命中只读字样）才退只读（`open.ts:372-415`）。
2. **身份三格必须准**。`identityMatches` 要求 `backend`、`repoIdentity`、`workspaceRoot` 三格全等（`open-schema.ts:312-317`），任何一格不符就触发 `identity-mismatch` 整库重建。面板若猜错仓库身份，等于把别人的库清空重来。
3. **包没有把这一层做成公开入口**。`package/package.json` 的 `exports` 只有 `.` / `./client` / `./tools` / `./cordis.patch.yml` / `./package.json` 五条，`workspace-snapshot` 只在 `files` 里，外部得按深层路径够。仓内依赖规则也限定：非快照层代码只许从 `src/workspace-snapshot/contract/index.js` 引，不许深引（`.dependency-cruiser.ts:343`）。

**【推测】** 所以可行的组合不是「面板里直接同步开库」，而是两层：

- **首帧**：面板挂载时发一次异步请求（`wf.cwd` + `wf.snapshot`，或直接 `wf.containerProjection`），拿到库投影后放进面板自己的内存；此后 view/data 只读这份内存，纯同步、零等待。这条路的代价是首帧仍要一次进程内 RPC（毫秒到几十毫秒，不碰网络）。
- **要真的同步开库**：需要先补一个「只读打开」的入口（或在原生插件里缓存身份三格 + 用 `DatabaseSync(..., {readOnly:true})` 自己开），并且只读路径也要跑 `PRAGMA quick_check`——`open.ts:409-415` 的注释写明「只读连接也要跑 quick_check，否则会把坏库伪装成全空的只读句柄」。

## 三、可选修法方向

1. **给快照层补一个明确的只读入口**（例如 `openWorkspaceSnapshotReadOnly`）：只读连接 + quick_check + 身份不符返回「不是这个库」而不是重建。这是让原生面板能真正同步读、且不误伤数据的唯一干净做法。
2. **把「工作区与后端」的探测结论也落一份盘**（现在只有 30 秒内存 + `choices.json` 的显式选择），否则面板每次冷启动都要等一次探测级联，秒开就断在第一格。
3. **在办表补一个「上次已知状态」字段**（或让面板用票号回库查一次状态再合并）：现状是只有票号没有状态，纯离线下画不出开/闭。
4. **更新状态单独处理**：它是外部包的异步领域，面板只应显示「上次检查于 …」，不要试图让它进快照库。

## 四、这次没查清的部分

- 原生面板的 view 回调里到底能不能直接 `import` 到宿主包内的 `workspace-snapshot`（取决于 dsh-go 引擎对插件包的解析方式，仓内没有实现可参照，本机 `/root/.dsh/dsh-go/` 是空目录）。
- `libraryBehind` 这类「只存内存」的状态，在原生插件这种可能被反复挂载/卸载的宿主里，生命周期是否与 deck 面板一致。
- markdown 后端今天在快照库这条路上的实际覆盖度（本文只确认了 `snapshotOfProjection` 与容器投影不区分后端，没有逐后端跑一遍）。
