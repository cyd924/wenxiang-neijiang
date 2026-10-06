# Cloudflare 部署说明

- GitHub：https://github.com/cyd924/wenxiang-neijiang
- 公网：https://wenxiang-neijiang.wenxiang-neijiang.workers.dev
- 健康检查：上述地址加 `/api/health`
- Worker：`wenxiang-neijiang`
- D1：`wenxiang-neijiang-db`
- D1 ID：`6536d6ca-b728-47ce-b308-366e24d7d027`
- Cloudflare 账户 ID：`e21cb5df086a65fc8dabc9c083f1b9de`

居民端、管理端由 Workers Assets 托管，API 由同一个 Worker 处理并绑定 D1。`/api/*` 始终先交给 Worker，避免单页回退把 API 错误变成首页。

## 重新部署

已有 Node.js 和 Wrangler 授权后，在项目根目录执行：

```bash
npx wrangler d1 migrations apply wenxiang-neijiang-db --remote
node cloudflare/build-assets.cjs
npx wrangler deploy
```

先应用数据库迁移再部署 Worker。`0001_init.sql` 建表并写入 12 门示例课程，`0002_booking_guards.sql` 增加报名检查、唯一候补和自动递补触发器。迁移不会重置已有报名。示例课程插入和上课时间具有唯一约束，避免重复导入。

`build-assets.cjs` 更新 API 部署所用的内嵌备用页面；Wrangler 正常部署时实际使用 `web/` 下的 Workers Assets。

## AI 配置

目前不配置模型密钥，使用规则模式。以后需要模型时设置 Worker Secret：

```bash
npx wrangler secret put AI_BASE_URL
npx wrangler secret put AI_MODEL
npx wrangler secret put AI_API_KEY
```

模型只提取需求，返回值经过 JSON 和字段白名单校验。请求超过 5 秒、接口出错或格式不正确时回到规则模式。名额与冲突判定使用数据库原值。

## 演示与验收

打开公网地址即可浏览课程、查看详情、报名及查看个人课表。页面顶部有管理员入口和大字模式。验收数据和步骤记录见 `cloudflare-test-report.md`。

小程序使用同一套公网 API。尚未接入 AppID、微信登录、订阅消息和正式审核。本版使用演示 userId，仅做原型演示。

公网域名已在 Cloudflare 远程网络实测。若某个本地网络打不开，可先检查该网络是否能访问 workers.dev；本项目没有绑定自定义域名。
