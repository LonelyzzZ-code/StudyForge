# StudyForge 系统架构设计

> 状态：定稿（v1.1，2026-10-19 增补 assistant 环节与技术热点/学习问答模块）
> 日期：2026-10-19
> 依据：`01-product-concept-design.md`（产品概念设计）、`02-system-functional-design.md`（系统功能设计）
> 范围：运行形态、进程模型、模块划分、数据模型、接口设计、关键机制规则、技术选型、打包分发

## 一、架构总览

产品形态：**桌面应用**（Electron 壳 + Python sidecar 后端）。三层架构：

```
┌─ Electron 桌面壳（JS，职责极薄）────────────────┐
│  窗口/生命周期 · 启动并守护 Python sidecar       │
├─ L3 前端 web（React + Vite SPA，本地静态资源）──┤
│  React Flow DAG · 测验交互 · SSE 订阅生成进度   │
├─ L2 引擎 server（FastAPI，PyInstaller 打包）───┤
│  E1 路线生成 · E2 预生成流水线 · E3 判分错题     │
│  E4 模板包 · 后台队列/调度 · 质检 · 记账        │
│  SQLite（WAL）· fastembed 本地 embedding        │
├─ L1 模型接入层 llm/ ───────────────────────────┤
│  OpenAI 兼容客户端 · 三环节路由 · 降级链         │
│  上下文预算裁剪 · 429 退避 · token 记账         │
└── 用户 BYOK（OpenAI 兼容 API，仅 3 处调用）─────┘
```

关键不变量：**引擎流水线只有 planner / generator / grader 三处 LLM 调用**；v1.1 增补第四环节 **assistant**（学习问答，用户主动触发、流式、带节点上下文，非流水线调用），其余全部是进程内确定性代码。

## 二、进程与运行模型

```
Electron 主进程 (JS)
  ├─ 单实例锁（防止双开抢 SQLite 写锁）
  ├─ spawn sidecar：studyforge-server（PyInstaller 单文件, uvicorn）
  │    监听 127.0.0.1:<随机端口>，数据目录经 STUDYFORGE_DATA_DIR 传入
  ├─ 轮询 GET /api/health 直到就绪
  ├─ 渲染进程加载内置前端 dist，端口经 preload 注入，API 走 localhost
  └─ 退出时终止 sidecar

数据目录（STUDYFORGE_DATA_DIR，默认取 Electron userData）：
  macOS: ~/Library/Application Support/StudyForge
  Win:   %APPDATA%\StudyForge
  └── studyforge.db（SQLite WAL）· config.json · logs/
```

- 后台任务与 API **同进程**：asyncio 事件循环内的 worker 协程，无独立 worker 进程、无 Redis/Celery。
- 崩溃恢复靠任务表：启动时扫描 `gen_task`，把 `running` 重置为 `pending`（生成是覆盖写新版本，幂等重入安全）。
- 开发模式：`vite dev server` + `uvicorn --reload` 并行，前端 proxy 转发 API；打包模式才是 sidecar。
- **保留 Web 部署能力**：server 是标准 FastAPI 应用，docker compose 单容器 + 前端静态文件同源即可跑 Web 版。MVP 只发布桌面版，Dockerfile 为 P1 低成本顺手项。

## 三、后端模块划分（server/）

```
server/
├── app/
│   ├── main.py            # FastAPI 入口 · /api/health · SSE 端点 · 静态托管(Web 版)
│   ├── api/               # REST 路由（薄层，只做参数校验和转发）
│   ├── engine/
│   │   ├── roadmap/       # E1: 生成 + 校验循环（环检测/ID/覆盖度, 重试≤3）
│   │   ├── content/       # E2: 预生成流水线 · 质检编排 · 重生成循环
│   │   ├── assessment/    # E3: 规则判分 · 错题两级流程 · 变式题调度 · 薄弱点统计
│   │   ├── scheduler/     # 就绪窗口调度 · 拓扑排序 · 与路线调整联动
│   │   └── queue/         # asyncio 任务队列：优先级(前台>后台) · 暂停/恢复 · 持久化
│   ├── qc/                # 质检器：知识点覆盖率 · 结构完整性 · embedding 重复度
│   ├── llm/               # E5-L1: client(OpenAI兼容) · 三环节路由 · 降级链
│   │                      #      · 上下文预算裁剪 · 并发/退避 · 记账
│   ├── domain/            # E4: 模板包加载与校验 · 领域枚举与拒绝
│   │   └── profiles/code.json   # MVP 唯一模板包（结构/题型配比/阈值）
│   └── models/            # SQLModel 表定义
├── prompts/               # planner / generator / grader 提示词模板（独立版本化）
└── tests/
```

`prompts/` 独立成目录：提示词是本项目核心资产，需单独演进与评审。

## 四、数据模型（SQLModel → SQLite）

```
settings(id, planner_cfg, generator_cfg, grader_cfg)     # JSON: base_url+key+model

roadmap(id, goal, base, outcome, time_budget, domain,
        outline_json,        # 全局大纲：各节点摘要级描述（E1 产出，此后静态）
        status, created_at)

node(id, roadmap_id, ext_key,        # ext_key = planner 输出的稳定 ID(n1,n2..)
     title, kp_list_json, est_minutes,
     status,               # locked/pending/learning/passed/mastered/deleted/generating
     order_index)          # 拓扑序号，调度用

edge(id, roadmap_id, from_node_id, to_node_id)   # 独立边表：删除重连操作直接改边

node_package(id, node_id, version, status,   # generating/ready/suspect
             lecture_json, summary_text,     # summary ≤300字，供后继节点做上下文
             practice_json, qc_report_json, created_at)

question(id, package_id, node_id, tier,      # concept / basic
         type,                               # choice / blank / short
         stem, options_json, answer,
         kp_tags_json, skill_json, difficulty,
         std_answer, key_points_json,        # 简答题专用
         is_variant, variant_of_id)

attempt(id, node_id, tier, passed, accuracy, started_at, finished_at)
answer(id, attempt_id, question_id, user_answer, correct,
       graded_by,            # rule / llm
       grade_detail_json,    # 命中关键点 + 引用答案原文的理由
       created_at)

wrong_stat(node_id, tag, wrong_count)        # 写 answer 时同步物化更新

gen_task(id, task_type,      # roadmap / package / variant
         payload_json, priority, status,     # pending/running/done/void
         attempt_no, error, updated_at)      # 崩溃恢复 + 重试计数

llm_call(id, ts, role, purpose, model, prompt_tokens,
         completion_tokens, latency_ms, status)   # F8 记账
```

要点：
- **edge 独立表**：删除节点自动重连（功能设计决策 #2 方案 a）就是一次边表改写，影响面预览由图查询得出。
- **node_package 带版本**：重生成写新 version；question 挂 package，旧 attempt 保留历史不丢。
- **wrong_stat 物化**：答题路径上直接 `UPDATE ... +1`，薄弱点判定（≥2 次）零查询成本。

## 五、API 设计（REST + SSE，前缀 /api）

| 资源 | 说明 |
|---|---|
| `GET /api/health` | 健康检查（Electron 主进程就绪探测） |
| `GET/PUT /api/settings`、`POST /api/settings/test` | F1 模型配置；test 按 role 发最小调用，可无限次 |
| `POST /api/roadmaps` → 202 | F2 创建，触发 E1，前端跳详情页 |
| `GET /api/roadmaps[/{id}]`、`DELETE` | 列表/详情（含 DAG、节点状态、进度） |
| `GET /api/roadmaps/{id}/nodes/{nid}/impact` | 删除影响面预览（重连结果） |
| `DELETE .../nodes/{nid}`、`POST .../master`、`POST .../regenerate-branch` | F3 手动调整三操作 |
| `GET /api/nodes/{nid}/package` | F4 讲义 + 实践任务（含状态徽标） |
| `GET /api/nodes/{nid}/questions?tier=`、`POST /api/nodes/{nid}/attempts` | F5 取题/开测 |
| `POST /api/attempts/{aid}/answers`、`POST /api/attempts/{aid}/finish` | 作答/结算（85% 门槛判定、解锁后继） |
| `GET /api/roadmaps/{id}/cost` | F8 记账汇总 |
| `GET /api/tech/radar` | F9 技术热点榜单（内置数据） |
| `POST /api/assistant/chat` | F10 学习问答（**SSE 流式**输出；body 含节点上下文 id + 会话历史） |
| `POST /api/queue/pause·resume` | 队列控制 |
| `GET /api/stream` | **SSE** 事件流 |

SSE 事件：`roadmap.created / roadmap.failed`、`node.status_changed`（生成中→就绪/存疑、解锁）、`queue.paused / resumed`。

判分取舍：v1 走同步 REST——客观题规则判分零延迟；简答同步等 grader（30s 超时可重试），不占用 SSE。

## 六、关键机制规则

**1. 摘要链防失真**（对应 01 风险表"前序摘要链失真"）
- 全局大纲只在 E1 产出一次，此后**静态不变**，不对大纲做再摘要。
- 节点摘要由 generator 从讲义原文一次生成（≤300 字），**不递归压缩**。
- 节点生成上下文 = 领域模板 + 本节点定义（取自全局大纲）+ **全部直接前驱**的摘要。不存在"摘要的摘要"，失真链不存在。

**2. 就绪窗口调度**
- `node.order_index` = DAG 拓扑序。调度目标：学习进度节点的拓扑后继中维持 ≥4 个节点就绪（3~5 取 4 为默认值，模板包可调）。
- 触发时机：路线创建、节点通过、任务完成、路线手动调整。
- 路线调整联动：删除/重生成分支时，队列中受影响任务置 `void`；**已就绪内容保留不重生成**（知识点未变，仅依赖图重连）；前驱集合发生变化的未生成节点重新入队。

**3. 结构化输出降级链**（对每个 base_url 探测一次并缓存结论）
`native structured output → JSON mode → prompt 内嵌 schema + 解析失败重试(≤2)`。解析重试携带报错原因回传模型。

**4. 上下文预算裁剪**（优先级同 02 E5）
节点定义 > 模板 > 前序摘要 > 全局大纲。按当前环节模型配置的窗口大小逐级截断，记录裁剪日志。

**5. 错题两级流程的零等待设计**
- 答错 → 同标签基础题**直接从已有题库筛选**（每节点 8~12 题存量），零 LLM 调用、零延迟。
- 答对 → 变式题需 generator 即时生成：判分判"对"的瞬间即后台启动生成，前端展示答题反馈的 1~2 秒与生成重叠；超时 15s 允许重试。
- 相似度校验：变式题与原题 embedding 余弦相似度须落在 `[lower, upper]` 区间（模板包参数，demo 阶段调参）；太低 = 考点漂移弃用重生成，太高 = 变式不足弃用重生成。

**6. 并发与优先级**
全局信号量按环节限并发（generator 以串行为主，并发 1~2）；队列两级优先：`variant/grader`（前台，用户在等）> `package/roadmap`（后台）。429 指数退避。

**7. API key 存储**
v1：`config.json` 存数据目录（0600 权限），不写日志、不进 SSE/错误响应；P1 升级 OS keychain（keyring）。README 明示风险。

**8. embedding**
fastembed + `bge-small-zh-v1.5` int8（约 30MB，随安装包内置，离线可用）。仅两处使用：质检重复度、变式题相似度。CPU 毫秒级，无 GPU 依赖。

## 七、前端架构

- React 18 + Vite SPA，TypeScript；桌面与（未来）Web 版同一产物。
- DAG 画布：**React Flow**（节点状态着色、锁定态、分层布局）。
- 服务端状态：TanStack Query + SSE 推送刷新缓存，轮询兜底。
- Electron 侧：主进程（窗口/sidecar/单实例锁）+ preload（注入 API 端口）；`contextIsolation` 开启，渲染进程无 Node 权限。
- 路由对应 02 的五页：`/create`（首页）、`/roadmaps/:id`、`/roadmaps/:id/nodes/:nid`（讲义|测验|实践三 tab）、`/roadmaps`、`/settings`。

## 八、技术选型汇总（2026-10-19 定稿）

| 项 | 选择 | 理由 | 备选 |
|---|---|---|---|
| 桌面壳 | **Electron** | 全 JS 技术栈零新语言；生态成熟（VS Code 同款），打包/自动更新/问题排查资料最多 | Tauri（包小但需碰 Rust，弃） |
| 前端 | React + Vite + TS | 无 SEO 需求，SPA 足够；生态/招聘匹配 | Next.js（SSR 无用，弃） |
| 后端 | FastAPI + uvicorn | asyncio 原生契合同进程 worker；SSE 内置 | Flask（异步弱，弃） |
| ORM/库 | SQLModel | 与 Pydantic 一体，表即 schema | SQLAlchemy 裸写 |
| 数据库 | **SQLite（WAL 模式）** | 单机单用户零运维；aiosqlite 单写者够用 | PostgreSQL 仅 Web 多用户版需要 |
| 队列 | **asyncio + gen_task 表** | 单进程内闭环；持久化/恢复靠表；无中间件 | Celery+Redis（自托管负担，弃） |
| embedding | **fastembed(ONNX int8)** | 无 torch 依赖，包体可控，CPU 可跑 | sentence-transformers（重，弃） |
| 推送 | **SSE** | 单向事件足够，Chromium 原生 EventSource | WebSocket（双向无需求，弃） |
| 打包 | PyInstaller（后端）+ electron-builder（整机） | 三平台 matrix：dmg / msi | — |
| 协议 | MIT | 宽松双兼容 | Apache-2.0 |

原 7 项悬置选型随本表全部定稿。

## 九、仓库结构（monorepo，英文命名）

```
StudyForge/
├── apps/
│   └── desktop/        # Electron 壳：main/（主进程）· preload/ · electron-builder 配置
├── web/                # React SPA（桌面与 Web 共用）
│   └── src/
│       ├── pages/      # create-roadmap / roadmap-detail / node-study / roadmap-list / settings
│       ├── components/ # dag-canvas(React Flow) / quiz / lecture / ...
│       ├── api/        # REST client + SSE
│       └── stores/
├── server/             # FastAPI 后端（桌面 sidecar 与 Web 服务同体）
│   ├── app/            # 结构见第三章
│   ├── prompts/
│   ├── tests/
│   └── pyproject.toml
├── scripts/            # build-server.sh(PyInstaller) · build-desktop.sh(electron-builder)
└── README.md
```

## 十、打包与分发

1. `PyInstaller` 打包 server → 三平台单文件二进制（注意 onnxruntime 的 hidden imports）。
2. `electron-builder` 整机打包：sidecar 与 embedding 模型放 `extraResources`，三平台产物 dmg / msi。
3. CI：GitHub Actions matrix（macOS arm64 / Windows x64）。
4. 自动更新：P2（electron-updater），MVP 手动发版。

## 十一、性能与资源预算（验收线）

| 项 | 预算 |
|---|---|
| 路线生成（planner 1 次 + 校验） | ≤90s，失败重试≤3 |
| 单节点内容包（后台，含质检与≤3 次重生成） | ≤60s |
| 路线创建到首节点可学 | ≤2min |
| 简答判分（同步 REST） | ≤10s |
| 变式题生成 | ≤15s |
| 安装包下载体积 | ≤250MB（Electron 壳 + sidecar + embedding 模型） |
| 安装后占用 | ≤400MB |

## 十二、架构对 01 已知风险的回应

| 01 风险 | 架构对策 |
|---|---|
| 前序摘要链失真 | 第六章规则 1：大纲静态、摘要一次成型不递归（本条为架构层定稿规则） |
| 变式题变式度区间 | 规则 5：相似度区间为模板包参数，demo 阶段调参，越界自动弃用重生成 |
| 答案泄露 | 质检器增加答案泄露检查（题干与答案/讲义原文重合度），参数入模板包 |
| 选择题干扰项质量 | 生成后代码校验选项互异性；干扰项质量依赖 prompt 打磨，demo 阶段迭代 |
| 质检是弱保证 | 质检以代码客观度量为主（覆盖率/结构/重复度），存疑放行 + F4「这段没懂」反馈兜底（P1） |
| 语言类事实准确性 | MVP 仅 code 模板包，风险后置到 language 模板包阶段（P1） |
