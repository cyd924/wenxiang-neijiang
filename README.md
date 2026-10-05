# 文享内江

面向内江市文化馆的课程浏览、预约、候补和智能找课原型，重点照顾老年用户。项目同时提供本地 Node.js + SQLite 版本，以及可直接部署的 Cloudflare Workers + D1 版本。

> 本项目使用演示数据，不代表内江市文化馆官方报名入口，也不包含真实居民信息。

## 在线演示

- 居民端：<https://wenxiang-neijiang.wenxiang-neijiang.workers.dev>
- 健康检查：<https://wenxiang-neijiang.wenxiang-neijiang.workers.dev/api/health>
- 管理员入口：打开居民端后点击“管理员”

当前线上 AI 未配置密钥，智能找课显示“规则模式”。课程筛选、冲突检查、名额和候补由 Worker 本地逻辑完成。

## 本地运行

需要 Node.js 24 或更高版本：

```bash
npm install
npm start
```

浏览器打开 <http://localhost:3000>。也可以双击 `start-demo.bat`。

## 项目结构

- `web/`：浏览器居民端和管理员端页面
- `server/`：本地 Node.js 服务和 SQLite 数据库逻辑
- `miniprogram/`：原生微信小程序目录，可导入微信开发者工具
- `cloudflare/worker.js`：Cloudflare Worker 入口，内嵌浏览器页面并绑定 D1
- `cloudflare/migrations/0001_init.sql`：D1 表结构和 12 门演示课程
- `docs/sample-courses.csv`：管理员批量导入示例
- `tests/api.test.js`：本地接口测试

## Cloudflare 部署

本项目线上 Worker 使用 D1 数据库 `wenxiang-neijiang-db`。重新部署时可使用 Wrangler：

```bash
npx wrangler deploy
```

D1 初始化：

```bash
npx wrangler d1 execute wenxiang-neijiang-db --remote --file=cloudflare/migrations/0001_init.sql
```

AI 模型使用 OpenAI 兼容接口时，只把配置保存为 Worker Secret，不要写入前端或 Git：

```bash
npx wrangler secret put AI_BASE_URL
npx wrangler secret put AI_MODEL
npx wrangler secret put AI_API_KEY
```

不配置这些 Secret 时仍可使用规则模式。模型只提取兴趣、时间和难度，课程过滤、报名冲突和名额判断由本地代码完成，并对模型输出做字段白名单校验。

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
