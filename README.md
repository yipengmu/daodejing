# 道德经 · 一起读书

MVP-1 的可运行实现。业务规则以 `docs/mvp-1-readiness-baseline.md` 和产品 Spec 为准，原型用于结构与交互参考。实现与验收记录见 [开发记录](docs/development-progress.md)。

## 本地运行

需要 Node.js 22.12+ 与 npm。首次启动：

```sh
npm install
npm run dev
```

打开 http://127.0.0.1:4317 ，API 为 http://127.0.0.1:4318/api/health 。可用 `WEB_PORT`、`API_PORT` 改端口。首次启动自动导入用户提供的 81 章文本与 9 条杭州地点，不生成虚构分享。

未设置外部 `DATABASE_URL` 时使用 PGlite（PostgreSQL WASM），数据保存在忽略提交的 `.local/pglite/`，上传文件在 `.local/media/`；关闭后重启会保留。自动生成的开发密钥在 `.local/runtime.env`，仅供本地使用。PGlite 一个目录只允许一个进程打开；开发服务器运行时不要另开数据库 CLI。迁移自动应用并校验文件摘要，已应用的迁移不能原地修改。

本地账号需要显式创建。先停止开发服务器，执行后重新启动：

```sh
npm run dev:account
npm run dev
```

开发账号为 `reader@example.test` / `ReadTogether!2026`，只允许在本地数据库中创建。不会模拟短信、邮件或向页面返回测试验证码。注册与找回需要配置真实服务商；未配置时返回服务未开放。

`npm run dev` 同时启动 API 和 Vite；前端支持 HMR，后端修改后需重启。阅读字号、文字位置保存在本机，分享草稿按账号隔离，退出会清除草稿。

## 已实现

- 无需登录的 81 章目录、完整原文分页、跨章切换、字号与位置恢复、移动端注释/分享抽屉、版本来源说明。
- 章节频道与分享详情，按累计有效阅读/最新排序；连续可见 5 秒记阅读，同一访客/账号按上海自然日去重，曝光单独记录。
- 手机号/邮箱注册、密码登录、找回密码、恢复邮箱、登录回跳、内置头像与公开昵称。
- 单章节分享、匿名公开身份、文字评论、爱心、作者管理、服务端管理员权限与审计；删除为逻辑删除。
- 固定道场及临时地点、地图/列表、外部导航、可选 POI、拒绝定位回退、单章节共读记录与唯一领读人。
- 图片与音频上传，实际格式/大小/时长检查与元数据清理；私有媒体每次读取检查数据库，隐藏后后续读取及 Range 请求被拒绝。
- 游客及登录用户的产品建议持久化、限流与幂等提交。

站内报名属于 MVP-2。内容举报、账号删除、VOC 自动处置、Agent Harness 和产品 AI 功能不在本次范围。真实河上公古注原文未提供，页面明确标注待补；现有现代转述未冒充古注。

## 独立云环境

复制 `.env.example` 为 `.env`，为本项目单独配置资源。不要复制其他项目的数据库、密钥或媒体桶。所有变量名称见示例文件，浏览器只接收公开地图 JS key，不接收服务端密钥。

| 能力 | 配置与要求 |
| --- | --- |
| 数据库 | `DATABASE_URL` 为独立 Neon/PostgreSQL 连接，`DATABASE_URL_UNPOOLED` 为迁移直连；先确认目标环境再执行下方迁移 |
| 会话 | 随机、独立的 `JWT_SECRET`、`IDENTITY_HMAC_SECRET`；生产环境不生成默认密钥。身份 HMAC 密钥变更需要专项迁移，不能直接轮换 |
| 来源检查 | `APP_ORIGIN` 为完整站点 origin；默认只接受同源写操作 |
| 短信 | 阿里云 PNVS AccessKey、签名和模板；模板变量 `code=##code##`、`min=5`，服务商管理验证码 |
| 邮件 | 腾讯云 SES 凭据、发件人、模板 ID；模板变量 `code`、`purpose` |
| 媒体 | 腾讯云 COS 独立私有桶；CORS 允许本站 PUT/HEAD 及 Content-Type，禁止公共读。浏览器仅获取受限上传签名，读取经应用鉴权入口流式返回 |
| 地图 | 高德 JS key、REST key 与安全码；域名白名单包含运行环境。安全码由 `/api/amap/_AMapService/` 代理注入，前端不暴露 REST key/安全码 |

外部库首次初始化：

```sh
npm run db:generate
npm run db:migrate
npm run db:seed
```

这三个命令应在确认 `.env` 指向正确的独立数据库后手动执行。构建过程不执行迁移。种子导入幂等，不覆盖已有用户编辑。生产环境禁止启用 `LOCAL_DATABASE=true`。

管理员通过受控 CLI 显式授予已有账号，客户端不能自选角色。执行前停止本地开发服务器：

```sh
npm run account:role -- reader@example.test ADMIN
# 还原普通成员：将 ADMIN 改为 MEMBER
# 外部数据库必须显式追加 --external，并核对命令输出的目标主机
```

CLI 记录角色变更审计并撤销旧会话；重新登录后生效。不提供公开的提权接口。

Vercel 部署入口为 `api/index.ts`，静态产物为 `dist`，路由配置在 `vercel.json`。本轮没有创建云资源或发布部署。上线前还需在独立 Preview 验证真实验证码、COS CORS/私有读、地图安全代理与 POI、Neon 多连接并发、Vercel 路由和文件流。PGlite 的单进程序列化不能代替云端并发验证。

## 验证

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test` 使用独立临时 PostgreSQL WASM 数据目录，应用真实迁移与约束，并在完成后清理自己的目录；仅短信和邮件使用测试 provider，不连接云资源。覆盖权限、匿名身份、阅读去重/换日/并发、验证码消费/重置额度、POI 票据、媒体隐藏及持久化恢复。

浏览器测试自动启动隔离服务 4320，不复用开发数据库，包含桌面与手机两组旅程。本轮沙箱拒绝启动独立 Chrome，12 项 Playwright 测试未进入页面断言；内置浏览器已另行验证主要用户动线。GitHub Actions 提供 Linux Chromium 回归任务，尚未在远端执行。

## 维护

正式数据库设计在 [MVP-1 数据库设计](docs/mvp-1-database-design.md)，Prisma schema 与增量迁移在 `prisma/`。`docs/database-schema-spec.md` 保留为未批准的历史预研，不能作为实现依据。

源章节和地点来自 `prisma/seed/`；`npm run data:build` 校验 81 章并生成前端内容。来源状态必须随数据保留，不把用户提供、尚未校勘的文本标成已核定底本。地点原始私密地址和联系方式仅在内部来源数据中保留，不进入公开 DTO。

参考：[高德安全代理说明](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)。

## 章节频道 AgentBot 导入

频道中的共读助手支持游客提交飞书、钉钉公开链接或粘贴文字，整理后直接公开到所选章节；源链接不对外显示。服务端通过 `OPENAI_API_KEY` 调用 OpenAI，`OPENAI_IMPORT_MODEL` 可选，默认 `gpt-4.1-mini`；密钥只放服务端环境。公开页面如果无法直接提取正文，可粘贴导出的文字。游客使用发布设备上的凭证撤回；清除本地数据后需管理员协助。姓名遮盖依赖模型，不能保证完全匿名。运行环境须能连接 OpenAI；模型或抓取失败时不会发布内容。

部署前先为目标环境执行新增数据库迁移；不要在构建时自动迁移。详见 [频道导入 Spec](docs/channel-agent-import-spec.md) 和 [开发记录](docs/development-progress.md)。
