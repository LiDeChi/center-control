# Center Control

Center Control 是一个跨项目动态监控与展示数据中台：

- 扫描 `/Users/lidechi/Documents/Github` 下一级项目目录（容器内挂载为 `/data/github`）
- 自动识别 tracked / external 项目
- 聚合本地 Git 动态 + GitHub 远程指标
- 生成项目关联（规则引擎 + LiteLLM 可选解释）
- 每天定时生成日报（默认 09:00）
- 提供个人网站可消费的项目 JSON 数据

## 核心能力

- **自动分类**
  - tracked: `origin` owner 为 `LiDeChi` 或无 `origin` 的本地仓库
  - external: 有 `origin` 且 owner 非 `LiDeChi`
- **动态指标**
  - 提交频次（7/30 天）
  - 最近提交时间
  - 活跃度评分
  - GitHub stars/issues/PR/release（有 token 时）
- **关联发现**
  - `theme_similarity`
  - `tech_overlap`
  - `workflow_dependency`
  - `timeline_cluster`
- **输出**
  - 日报 Markdown：`data/reports/YYYY-MM-DD.md`
  - 网站 JSON：`data/exports/projects.json`
  - 项目盘点 JSON：`data/exports/project-inventory.json`
  - 项目盘点 Markdown：`data/exports/project-inventory.md`
  - API：`/api/portfolio/projects.json`
- **项目操作中枢**
  - 卡片 / 列表双视图（`/projects?view=card|list`）
  - 一键动作：IDE 打开、文件夹打开、本地启动、进入生产
  - 每项目 Codex Chatbox（支持文本附件）
  - 自动采集 README + AGENTS/CLAUDE 类指令文件摘要

## 目录结构

```text
apps/
  web/          # Next.js UI + API
  worker/       # 调度器 + 同步任务
packages/
  core/         # 采集/评分/关联/报告核心逻辑
  db/           # SQLite schema + repository
data/
  reports/
  exports/
```

## 环境变量

复制 `.env.example` 到 `.env` 并按需修改：

- `DATABASE_URL=file:/app/data/db/center-control.db`
- `GITHUB_ROOT=/data/github`
- `REPORT_TIME=09:00`
- `OWNER_LOGIN=LiDeChi`
- `TZ=America/New_York`
- `GITHUB_TOKEN=`（可选，启用 GitHub 远程指标）
- `LLM_BASE_URL=http://host.docker.internal:41400`
- `LLM_API_KEY=`
- `LLM_MODEL=gpt-5.2-codex`

> LLM 默认按 `litellm-local-gateway` 约定走本地网关；不可用时自动降级为规则解释。

## 本地开发

```bash
npm install
npm run db:prepare
npm run dev
```

- Web: `http://localhost:3000`
- Worker: 启动即执行一次同步，然后每天固定时间执行

手动触发一次同步：

```bash
npm run sync
# 或
curl -X POST http://localhost:3000/api/jobs/sync
```

## 付费用户一键安装（Deploy Ticket）

当用户在 `wordm.us` 完成付费后，前端会生成一次性部署票据（deploy ticket），并提供如下命令：

```bash
curl -fsSL https://raw.githubusercontent.com/LiDeChi/center-control/main/scripts/install-center-control.sh \
| bash -s -- \
  --ticket '<deploy-ticket>' \
  --resolve-endpoint 'https://<supabase-project>.supabase.co/functions/v1/resolve-deploy-ticket' \
  --port 3000
```

安装脚本会：

- 验证 deploy ticket（一次性）
- 拉取/更新 `center-control` 仓库
- 启动 `docker compose`
- 输出可访问地址（默认 `http://localhost:3000`）

远程服务器可直接通过 SSH 执行同一安装脚本：

```bash
ssh root@your-server "curl -fsSL https://raw.githubusercontent.com/LiDeChi/center-control/main/scripts/install-center-control.sh | bash -s -- --ticket '<deploy-ticket>' --resolve-endpoint 'https://<supabase-project>.supabase.co/functions/v1/resolve-deploy-ticket' --port 3000"
```

## Docker 运行

```bash
docker compose up -d --build
```

如本机 `3000` 端口被占用，可改用：

```bash
WEB_PORT=3100 docker compose up -d --build
```

服务：

- `web`: Next.js (3000)
- `worker`: 调度与同步
- `db`: SQLite 卷保活服务

验证：

```bash
./scripts/docker-acceptance.sh
```

## API

- `GET /api/projects?scope=tracked|external|all&sort=activity|updatedAt|relationScore`
- `GET /api/projects/:id`
- `GET /api/relations?projectId=:id`
- `GET /api/reports?limit=30`
- `GET /api/reports/:date`
- `POST /api/jobs/sync`
- `POST /api/project-actions`
- `POST /api/codex`
- `GET /api/portfolio/projects.json`
- `GET /api/portfolio/project-inventory.json`

## 测试

```bash
npm test
```

包含：

- 单元：分类规则、活跃度评分、关联计算、AI 降级
- 集成：fixture 仓库跑全量同步并验证 DB/报告/导出
