# 更新记录

## 1.0.0（Folio）

按现代前端工程栈彻底白纸重做并正式定名为 **Folio**：

- **工程与构建**：全仓迁移为严格 `TypeScript` + `Vite` + `vite-plugin-monkey`，移除手搓构建脚本与油猴自动更新头；单文件产物 `dist/folio.user.js` 约 410 KB（gzip 138 KB），外置 `mermaid-11.17.2.min.js` 按需加载。
- **unified 双路 AST 引擎**：基于 `remark-parse` + `remark-gfm` 构建语法树，知乎/OSChina 走 `remark-stringify` 无损输出 Markdown，富文本平台走 `remark-rehype` + `rehype-sanitize` 严格净化防 XSS 后输出 HTML。
- **公众号语法高亮与主题**：接入 `rehype-highlight`（18 种主力语言），使用 `stylis` 按标准 CSS 特异性将 `wechat.css` 排版主题与 GitHub Light 代码配色内联至标签。
- **Mermaid 按需懒加载与验签**：仅在文稿含 `mermaid` 代码块时从 `acv.k-neco.com` 按需拉取，并通过 WebCrypto 强制校验编译期锁死的 SHA-256 完整性哈希。
- **Preact Shadow DOM 面板**：使用 `Preact` JSX 重构可拖拽悬浮胶囊与导入卡片，支持多次追加、同名图片去重、粘贴导入与脱敏诊断导出。

## 0.7.2（旧版 DraftFerry 归档基线）

- 早期 JS/esbuild 归档版本。
