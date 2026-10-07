# 文享内江

面向内江市文化馆的课程浏览、预约、候补和智能找课原型，重点照顾老年用户。项目同时提供本地 Node.js + SQLite 版本，以及可直接部署的 Cloudflare Workers + D1 版本。

> 本项目使用演示数据，不代表内江市文化馆官方报名入口，也不包含真实居民信息。

## 在线演示

- 居民端（用户已确认微信可打开）：<https://wenxiang-neijiang.pages.dev>
- 健康检查：<https://wenxiang-neijiang.pages.dev/api/health>
- 管理员入口：打开居民端后点击“管理员”
- 原 Workers 入口（用户手机网络无法显示）：<https://wenxiang-neijiang.wenxiang-neijiang.workers.dev>

当前 Pages 线上版已接入 Cloudflare Workers AI 的 Qwen3 模型，实际成功调用后显示“AI+规则”。模型负责理解口语需求、改写简明介绍；课程筛选、冲突检查、名额和候补由程序完成。模型失败时显示“规则模式”，仍可找课和报名。

访问状态（2026-10-07）：用户确认微信内新版页面与 AI 推荐正常，此前已确认预约、我的课程、取消可用。电脑局域网访问可用，手机局域网仍待确认。新版测试见 `docs/ai-v2-test-report.md`，局域网操作见 `docs/lan-start.md`。

Pages 入口使用同一份 API 和 D1 数据库，页面与接口都位于 `pages.dev` 域名；没有把 API 转发到原来无法访问的 `workers.dev` 地址。小程序默认接口地址也已同步到 Pages。用户确认打开成功尚不等于所有手机交互流程已完成验收。构建和部署说明见 `docs/pages-deploy.md`。

## 本地运行

需要 Node.js 24 或更高版本：

```bash
npm install
npm start
```

浏览器打开 <http://localhost:3000>。也可以双击 `start-demo.bat`，保留窗口。服务默认监听 `0.0.0.0`，窗口会显示当前局域网地址；手机需与电脑同网且网络允许设备互访。公网与本地数据库独立。

## 项目结构

- `web/`：浏览器居民端和管理员端页面
- `server/`：本地 Node.js 服务和 SQLite 数据库逻辑
- `miniprogram/`：原生微信小程序目录，可导入微信开发者工具
- `cloudflare/worker.js`：Cloudflare Worker 入口，使用 Workers Assets 托管页面并绑定 D1
- `cloudflare/migrations/0001_init.sql`：D1 表结构和 12 门演示课程
- `docs/sample-courses.csv`：管理员批量导入示例
- `tests/api.test.js`：本地接口测试
- `cloudflare/assistant.mjs`：本地与线上共用的需求校验、规则回退和课程排序
- `cloudflare/ai-worker.js`：私有模型服务，通过 Pages 的服务绑定调用
- `tests/assistant.test.mjs`：否定条件、全部课次、模型异常和介绍改写测试

## Cloudflare 部署

本项目线上 Worker 使用 D1 数据库 `wenxiang-neijiang-db`。重新部署时可使用 Wrangler：

```bash
node cloudflare/build-assets.cjs
npx wrangler deploy
```

D1 初始化：

```bash
npx wrangler d1 migrations apply wenxiang-neijiang-db --remote
```

AI 模型使用 OpenAI 兼容接口时，只把配置保存为 Worker Secret，不要写入前端或 Git：

```bash
npx wrangler secret put AI_BASE_URL
npx wrangler secret put AI_MODEL
npx wrangler secret put AI_API_KEY
```

主要演示入口是 Pages；完整发布步骤见 `docs/pages-deploy.md`。当前 Pages 通过私有 AI 服务调用 Qwen3，无需把密钥交给浏览器。兼容接口配置是可选替代方案；没有可用模型时自动使用规则模式。

本地版默认通过 Pages 请求需求解析和介绍改写，只发送输入文字或课程介绍，不上传本地报名记录。需要完全离线时，在 `.env` 写入 `AI_REMOTE_URL=off` 并重启。本地网络无法连接在线 AI 时会回退规则模式。

## 新版界面与 AI 流程

首页加入原创牛肉面 SVG 插画，使用暖米色、汤红色和葱绿色；图案随页面提供，不依赖外部图片。移动端单列、大按钮和大字模式保留。

智能找课流程：自然语言 → 模型提取兴趣、否定条件、时间、预算和难度 → JSON 字段校验 → 逐门检查全部课次、课表和名额 → 规则排序 → 前三门及理由。无符合结果时提示调整条件，不自动忽略限制。课程详情可生成简明介绍，固定信息始终显示数据库原值。

## 主要流程

1. 浏览课程或输入“周末想学安静的传统文化”。
2. 查看时间、地点、教师、适合人群、费用和剩余名额。
3. 预约课程；满额后进入候补。
4. 在“我的课程”查看安排并取消自己的报名，空位按顺序递补。
5. 管理员可以发布/下架课程、导入 CSV、导出报名名单。
6. “大字模式”和浏览器朗读用于辅助银龄用户。

## 测试

```bash
npm test
```

本地测试覆盖重复报名、时间冲突、取消权限、候补、课程状态、输入校验和规则推荐回退等场景。

## 线上验收（2026-10-06）

上一版公网 17 项检查通过。新版本地 Node.js、Worker 与 AI 模块合计 18 项测试通过；线上真实需求解析与简明介绍均返回“AI+规则”。数据库触发器在写入时检查剩余名额、重复报名和所有上课时间，取消后按候补顺序选择没有冲突的用户递补。历史与新版记录分别见 `docs/cloudflare-test-report.md`、`docs/ai-v2-test-report.md`。

原生小程序默认连接上述公网地址。本地联调时将 `miniprogram/app.js` 中的 `apiBase` 改为本地服务地址。演示 userId 尚未接入微信登录。
