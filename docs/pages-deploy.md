# 主要演示入口：Cloudflare Pages

地址：https://wenxiang-neijiang.pages.dev

## 为什么增加这个入口

2026-10-06 用户反馈：原 Workers 地址在手机 Wi-Fi、移动流量、微信内和手机浏览器中都无法显示。远程浏览器可以访问，无法直接判断用户网络中的具体失败环节。增加 Pages 地址后，用户回复“微信可以打开”，现将 Pages 作为主要演示入口。这个结果来自该用户实测，不保证所有地区和设备都可访问。

## 实现

- Pages 项目：wenxiang-neijiang，生产分支 main。
- 与原 Worker 共用 D1 数据库 wenxiang-neijiang-db，DB binding。
- 构建脚本 cloudflare/build-pages.cjs 使用现有 worker.js、booking.js 和 web/ 生成单文件 _worker.js。
- HTML、JavaScript 和 CSS 嵌入生成文件，由同一入口返回。API 在 Pages 上直接运行，不跳转或代理到 workers.dev。
- 构建结果位于被 Git 忽略的 work/pages/；没有密钥或本地数据库。
- 原 Worker 与本地 Node.js 版本继续保留。

## 再次发布

已通过 Cloudflare API 完成首次直接上传。后续用自己的 Cloudflare 网页登录和 Wrangler 也可发布：

```powershell
node cloudflare/build-pages.cjs
npx wrangler pages deploy --config wrangler.pages.jsonc --branch main
```

Pages 和原 Worker 的密钥配置分别管理；本次两者均未配置 AI 密钥，使用规则模式。

## 本次检查

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

上述远程检查不是实际微信客户端或用户所在网络的测试。用户随后确认微信可打开；尚未反馈手机端报名、取消等完整交互流程的结果。报名核心沿用此前通过并发测试的同一份代码，本次没有重新执行所有报名场景。
