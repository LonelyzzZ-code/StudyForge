<p align="center">
  <img src="apps/desktop/build/icon.png" width="120" alt="StudyForge logo" />
</p>

# StudyForge

一款开源的 AI 学习内容引擎：输入学习目标，AI根据用户需求生成学习路线（DAG），学习内容，测试内容，实践任务，帮助用户学会一项新技能～. 
边学边测、错题补题、变式检验，学到「掌握基础」。

## 下载安装（macOS）

桌面安装包（含 Python 后端 sidecar，无需配置任何环境）：

👉 **[StudyForge-1.0.0.dmg — 从 Releases 下载](https://github.com/LonelyzzZ-code/StudyForge/releases/latest)**

- macOS 10.15+（Intel）
- 应用未签名，首次打开需在「系统设置 → 隐私与安全性」允许
- 启动后在「模型设置」页填入任意 OpenAI 兼容 API（如 DeepSeek）即可使用；
  不填则以内置演示数据运行（完整体验流程，不调用任何 API）

## 功能总览

| 模块 | 说明 |
|---|---|
| 创建路线 | 四字段学习请求 → planner 生成知识点 DAG（React Flow 可视化） |
| 技术热点 | 内置分类榜单（AI/语言/前端/云/数据/安全），「去学习」一键预填创建路线 |
| 节点学习 | 讲义（markdown+代码）· 两档测验 · 实践任务；「这段没懂」段落重写 |
| 测验闭环 | 选择/填空规则判分（零延迟）· 简答 AI 判分 · 85% 门槛 · 错题→补题→变式题两级检验 · 薄弱点标记 |
| 问 AI | 学习页悬浮窗呼出对话，流式回答（自动携带当前节点上下文） |
| 路线管理 | 右键节点：标记已掌握 / 重生成分支 / 删除（自动重连依赖 + 影响面预览） |
| 模型设置 | 四环节（planner/generator/grader/assistant）分别配模型，连通性测试，BYOK |
| 成本记账 | 每次调用记账，路线维度汇总展示 |
| 工程化 | 后台生成任务持久化 + 崩溃恢复 · 结构化输出降级链 · 429 退避 · 上下文预算裁剪 · embedding 质检（重复度/变式相似度） |

不配置任何 API key 时自动运行**演示模式**（内置 Python 入门数据，完整体验全流程）。

## 运行（Web 形态，开发/演示）

```bash
cd server
python3 -m venv ~/.venvs/studyforge-server          # venv 请放本地盘（见下方注意事项）
~/.venvs/studyforge-server/bin/pip install -r requirements.txt
~/.venvs/studyforge-server/bin/uvicorn app.main:app --port 8765
# 浏览器打开 http://127.0.0.1:8765
```

前端开发：`cd web && npm install && npm run dev`（端口 5173，需代理 /api 到 8765）。

## 运行（桌面应用）

```bash
scripts/build-web.sh        # 前端构建（本地盘）
scripts/build-desktop.sh    # PyInstaller sidecar + electron-builder -> apps/desktop/release
# 开发模式跑壳（直连已启动的 8765 后端）：
cd apps/desktop && npm install && STUDYFORGE_DEV=1 npx electron .
```

桌面壳职责（03 架构 §二）：窗口管理、spawn/守护 Python sidecar（随机端口 + 健康检查）、
单实例锁（防 SQLite 双开）、数据写入系统用户目录（userData/data）。

## 接入真实模型

设置页为四环节分别填写任意 OpenAI 兼容 API（DeepSeek / GLM / OpenAI / Ollama…）：

| 环节 | 职责 | 建议 |
|---|---|---|
| planner | 学习请求 → DAG（每路线 1 次） | 强模型 |
| generator | 讲义+题库+实践+变式题（高频） | 性价比模型 |
| grader | 简答关键点核对 | 最便宜小模型 |
| assistant | 学习问答（流式） | 留空继承 generator |

## 目录结构

```
server/            FastAPI 后端（桌面 sidecar 与 Web 服务同体）
  app/engine/      roadmap(校验循环) · content(队列/质检/变式/段落重写) · assessment(判分/错题)
  app/llm/         OpenAI 兼容接入：降级链/退避/裁剪/记账/流式
  app/qc/          fastembed embedding（重复度 + 变式相似度区间）
  app/tech/        技术热点内置榜单
  prompts/         planner/generator/grader/variant/section 提示词（核心资产）
web/               React19 + Vite SPA（清新绿主题）
apps/desktop/      Electron 壳（main.js/preload.js/electron-builder 配置）
scripts/           build-web.sh · build-desktop.sh
```

## 与设计的对应

- 产品概念 / 系统功能 / 系统架构设计见 [`docs/`](docs/)（01~03，当前 v1.1）
- 已知简化（相对正式版规划）：语言/考试模板包、Docker/Web 多用户版、自动更新、
  OS keychain 存储 API key、embedding 模型内置安装包（首次联网下载）、Windows 打包
