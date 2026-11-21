# 更新记录

## 2.0.0（更名为 Folio）

按现代前端工程栈彻底白纸重做并更名为 **Folio**：

- **工程与构建**：全仓迁移为严格 `TypeScript` + `Vite` + `vite-plugin-monkey`，移除旧版手搓 `scripts/build.js` 与油猴 `@updateURL` / `@downloadURL`；产物固定为 `dist/folio.user.js`（体积瘦身至 `< 280 KB`），并将外置 `mermaid.min.js` 同步输出至 `dist/vendor/mermaid.min.js`。
- **unified 双路 AST 引擎**：彻底废除 `marked` 脏标记字符串切片，改用 `unified` + `remark-parse` + `remark-gfm` + `remark-stringify` + `remark-rehype` + `rehype-sanitize` + `rehype-stringify`，保证代码块与嵌套排版 100% 无损，同时严格拦截 XSS 载荷。
- **公众号语法高亮与主题**：新增轻量多语言语法高亮器，为公众号代码块输出行内 token 配色，保留二级标题左金线与末尾保底空段。
- **Mermaid 按需懒加载**：日常打开编辑页 0 字节加载 Mermaid；仅当文稿含 `mermaid` 代码块时通过 `GM_xmlhttpRequest` 按需拉取外置脚本渲染 2x 白底 PNG。
- **Preact Shadow DOM 面板**：使用 `Preact` JSX 重构可拖拽胶囊与导入卡片，保留多次追加、同名去重、粘贴导入与脱敏诊断导出。
- **三道验证门禁**：`npm run check` 一键串联 `tsc --noEmit`、ESLint 零警告、`Vitest` 单元与 AST 属性轰炸测试、以及真实 Chrome 无头黑盒 E2E。

## 1.0.0（DraftFerry 稿渡）

- 早期 JS/esbuild 版本，完成 8 大内容平台编辑器适配、SPA 路由监听与 Shadow DOM 悬浮面板。
