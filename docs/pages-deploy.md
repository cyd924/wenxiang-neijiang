# 主要演示入口：Cloudflare Pages

地址：https://wenxiang-neijiang.pages.dev

## 为什么增加这个入口

2026-10-06 用户反馈：原 Workers 地址在手机 Wi-Fi、移动流量、微信内和手机浏览器中都无法显示。远程浏览器可以访问，无法直接判断用户网络中的具体失败环节。增加 Pages 地址后，用户回复“微信可以打开”，现将 Pages 作为主要演示入口。这个结果来自该用户实测，不保证所有地区和设备都可访问。

## 实现

- Pages 项目：wenxiang-neijiang，生产分支 main。
- 与原 Worker 共用 D1 数据库 wenxiang-neijiang-db，DB binding。
- 构建脚本 cloudflare/build-pages.cjs 使用现有 worker.js、booking.js、assistant.mjs 和 web/ 生成单文件 _worker.js。
- HTML、JavaScript 和 CSS 嵌入生成文件，由同一入口返回。API 在 Pages 上直接运行，不跳转或代理到 workers.dev。
- 构建结果位于被 Git 忽略的 work/pages/；没有密钥或本地数据库。
- 原 Worker 与本地 Node.js 版本继续保留。

## 再次发布

已通过 Cloudflare API 完成首次直接上传。后续用自己的 Cloudflare 网页登录和 Wrangler 也可发布：

```powershell
npx wrangler deploy --config wrangler.ai.jsonc
node cloudflare/build-pages.cjs
npx wrangler pages deploy --config wrangler.pages.jsonc --branch main
```

先发布私有 AI Worker，再发布 Pages。`wrangler.ai.jsonc` 中 `workers_dev=false`，模型服务仅由服务绑定调用。Pages 的 `AI_SERVICE` 绑定指向 `wenxiang-neijiang-ai`；DB 绑定仍指向已有 D1 数据库。

2026-10-07 的主要 Pages 入口已接入真实 Cloudflare Workers AI（Qwen3）。无须新增前端密钥。原 Workers 入口本次没有同步部署新版本，演示请使用 Pages。

若改用兼容模型接口，应在 Pages 后端秘密配置中保存 `AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY`，不要写入源码。接口配置优先于 Workers AI。模型超时或格式错误时返回规则模式。

当前为直接上传发布，不是 GitHub 自动构建。仅推送 GitHub 不会更新网站；修改页面后需要重新构建并发布 Pages。不要重新初始化已有数据库，否则可能影响演示报名。

## 首次入口检查（历史记录）

部署编号：42dfcb10-0373-45f7-8f0a-91957b5c5a55。

Cloudflare 返回部署成功。远程浏览器使用移动视口和带微信标识的 User-Agent 请求备用地址：

| 检查 | 实际结果 |
| --- | --- |
| 首页 | 标题存在、12 张课程卡片 |
| /api/health | 200，规则模式 |
| /api/courses | 200，12 门课程 |
| /app.js、/styles.css | 200，正确内容类型 |
| /api/ai/search | 200，规则模式，书法输入返回 2 条推荐 |
| /api/enrollments，userId 为 0 | 400，明确提示编号必须为正整数；未写入报名 |

上述远程检查不是实际微信客户端或用户所在网络的测试。用户随后确认微信可打开，并确认预约、我的课程和取消可用。

## AI 增强版（2026-10-07）

首次新版部署编号：a9dec082-f98d-4d38-938a-c51ca1d1cd7b。交付构建部署编号：d9dc2d88-58ff-42b8-a79c-5cf0d689e7f4。

新增真实模型需求解析、课程简明介绍、推荐过程与内江牛肉面风格。远程移动视口检查 12 门课程、真实模型需求解析和简明介绍均成功；用户微信反馈新版页面及 AI 推荐正常。详情见 `ai-v2-test-report.md`。
