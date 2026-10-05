# Cloudflare 部署记录

- Worker：`wenxiang-neijiang`
- D1：`wenxiang-neijiang-db`
- D1 ID：`6536d6ca-b728-47ce-b308-366e24d7d027`
- 账户 ID：`e21cb5df086a65fc8dabc9c083f1b9de`
- 公网地址：<https://wenxiang-neijiang.wenxiang-neijiang.workers.dev>
- 健康检查：`/api/health`

本次线上 Worker 使用 D1，浏览器页面在 Worker 内嵌发布，因此居民端、管理端和 API 使用同一个公网地址。线上数据库只初始化 12 门演示课程、3 个演示用户，报名和候补为空。

## 重新部署

安装 Wrangler 后，在项目根目录执行：

```bash
npx wrangler deploy
npx wrangler d1 execute wenxiang-neijiang-db --remote --file=cloudflare/migrations/0001_init.sql
```

模型配置只能使用 Worker Secret：

```bash
npx wrangler secret put AI_BASE_URL
npx wrangler secret put AI_MODEL
npx wrangler secret put AI_API_KEY
```

没有这些 Secret 时，智能找课自动使用规则模式。
