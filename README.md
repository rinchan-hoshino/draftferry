# Folio

把 Markdown、本地图片和 Mermaid 图表一键导入八个内容平台编辑页的油猴脚本。不会自动保存或发布。

## 支持平台

| 平台 | 编辑页路由 | 导入通路 |
| :--- | :--- | :--- |
| 知乎专栏 | `zhuanlan.zhihu.com/write*` | 原生 Markdown 粘贴解析 + 图片直传 |
| 微信公众号 | `mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2` | 行内样式 HTML + 代码语法高亮 + JSAPI 写入 |
| 开源中国 | `my.oschina.net/*/blog/ai-write*` | 原生 Markdown 写入 |
| 百家号 | `baijiahao.baidu.com/builder/rc/edit*` | 富文本 HTML 写入（UEditor） |
| 今日头条 | `mp.toutiao.com/profile_v4/graphic/publish*` | 富文本 HTML 写入（ProseMirror） |
| 搜狐号 | `mp.sohu.com/mpfe/v4/contentManagement/news/addarticle*` | 富文本 HTML 写入（Quill + Delta 回滚） |
| 阿里云市场 | `msp.aliyun.com/msp/commodity/list/~/publish/basic*` | 富文本 HTML 写入（CKEditor + 上传监控/回滚） |
| 腾讯云市场 | `console.cloud.tencent.com/serviceprovider/products/createNew*` | 富文本 HTML 写入（wangEditor + Fiber 发现/图片去重上传） |

## 架构亮点

- **TypeScript + Vite + `vite-plugin-monkey`**：严格类型检查，单文件产物 `dist/folio.user.js` 体积 **< 280 KB**（较旧版瘦身 14 倍）。
- **unified 双路 AST 转换**：基于 `remark-parse` + `remark-gfm` 构建 `mdast`，通路 A 由 `remark-stringify` 无损输出 Markdown，通路 B 由 `remark-rehype`（`allowDangerousHtml: false`）+ `rehype-sanitize` 严格防 XSS 后输出 HTML，彻底杜绝代码块误伤。
- **Mermaid 真正按需懒加载**：未包含 `mermaid` 代码块时 0 字节加载；仅在需要时通过 `GM_xmlhttpRequest` 拉取外置 `mermaid.min.js` 渲染为 2x 白底 PNG 并做源码哈希缓存。
- **Preact Shadow DOM 悬浮面板**：明暗自适应、可拖拽胶囊与导入卡片、支持多次追加与同名图片去重、错误时导出脱敏诊断 JSON。

## 开发与验证

```bash
npm install
npm run build   # 生成 dist/folio.user.js 与 dist/vendor/mermaid.min.js
npm run check   # 依次执行 typecheck + eslint + vitest + build + Chrome 黑盒 E2E
```
