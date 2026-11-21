# Folio Feature Map

| 模块 | 职责 |
| :--- | :--- |
| [src/userscript.ts](src/userscript.ts) | 油猴入口、SPA 路由监听与 Shadow DOM 面板挂载 |
| [src/markdown.ts](src/markdown.ts) | `unified` / `remark` / `rehype` 双路 AST 转换（H1 拆标题、本地配图转 Data URL、Mermaid 替换、Path A 无损 Markdown、Path B 严格 XSS 净化 + `rehype-highlight` 18 种主力语言语法高亮 HTML） |
| [src/themes/wechat.css](src/themes/wechat.css) | 微信公众号排版样式与 GitHub Light `.hljs-*` 语法高亮主题表（由 `stylis` 解析并按特异性行内化） |
| [src/mermaid.ts](src/mermaid.ts) | 按需懒加载精确版本外置 `mermaid-${version}.min.js`（`GM_xmlhttpRequest` 优先 `acv.k-neco.com`，回退 `jsdelivr`），强制 SHA-256 完整性验签，2x 白底 PNG 渲染与源码哈希缓存 |
| [src/panel.tsx](src/panel.tsx) | `Preact` 声明式 Shadow DOM 悬浮胶囊与导入卡片（拖拽追加/去重、粘贴、进度、诊断复制） |
| [src/position.ts](src/position.ts) | 面板坐标拖拽、键盘微调与 `localStorage` 按站点持久化 |
| [src/route.ts](src/route.ts) | Navigation API、`onurlchange` 与可见态兜底路由监听 |
| [src/dom.ts](src/dom.ts) | 共用 DOM 查找、标题写入、正文回读校验 `assertReadBack`、Vue/React 实例图扫描 |
| [src/import.ts](src/import.ts) | 导入编排（路由识别 -> 读取文稿 -> 编辑器定位 -> AST 解析 -> 正文/标题写入） |
| [src/diagnostic.ts](src/diagnostic.ts) | 脱敏 URL 参数与结构化错误诊断 JSON |
| [src/platforms/](src/platforms/index.ts) | 8 大内容平台适配器（知乎、公众号、开源中国、百家号、今日头条、搜狐号、阿里云市场、腾讯云市场） |
