# Folio Feature Map

| 模块 | 职责 |
| :--- | :--- |
| [src/userscript.ts](src/userscript.ts) | 油猴入口、SPA 路由监听、显式图表告警聚合与 Shadow DOM 面板挂载 |
| [src/markdown.ts](src/markdown.ts) | `unified` / `remark` / `rehype` 双路 AST 转换（H1 拆标题、本地配图转 Data URL、标准与无标签 Mermaid 识别替换、Path A 无损 Markdown、Path B 严格 XSS 净化 + `rehype-highlight` 18 种语言高亮 HTML） |
| [src/themes/wechat.css](src/themes/wechat.css) | 微信公众号「纸本编辑部」高定排版主题与 WCAG AA 达标 `.hljs-*` 语法高亮表（由 `stylis` 解析并按特异性行内化） |
| [src/mermaid.ts](src/mermaid.ts) | 免 `eval` / 免 CSP 阻断的 `@require` Mermaid 真渲染引擎、脏输入归一化（破折号箭头、单行粘连、斜杠节点引号、`<br/>` 换行）、清爽编辑部默认配色、`16px` 留白 2x PNG 导出与缓存 |
| [src/mermaid-vendor.ts](src/mermaid-vendor.ts) | 构建期 Tampermonkey 闭包安全补丁（生成 `dist/vendor/mermaid-${version}-tm.min.js`，保证 `globalThis.mermaid` 与 `window.mermaid` 稳定挂载） |
| [src/panel.tsx](src/panel.tsx) | `Preact` 声明式 Shadow DOM 悬浮胶囊与导入卡片（拖拽追加/去重、粘贴、进度、多行错误告警、诊断复制） |
| [src/position.ts](src/position.ts) | 面板坐标拖拽、键盘微调与 `localStorage` 按站点持久化 |
| [src/route.ts](src/route.ts) | Navigation API、`onurlchange` 与可见态兜底路由监听 |
| [src/dom.ts](src/dom.ts) | 共用 DOM 查找、标题写入、正文回读校验 `assertReadBack`、Vue/React 实例图扫描 |
| [src/import.ts](src/import.ts) | 导入编排（路由识别 -> 读取文稿 -> 编辑器定位 -> AST 解析 -> 正文/标题写入） |
| [src/diagnostic.ts](src/diagnostic.ts) | 脱敏 URL 参数与结构化错误诊断 JSON |
| [src/platforms/](src/platforms/index.ts) | 8 大内容平台适配器（知乎、公众号、开源中国、百家号、今日头条、搜狐号、阿里云市场、腾讯云市场） |
