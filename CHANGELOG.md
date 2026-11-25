# 更新记录

## 1.1.0

- **免 CSP / 沙盒安全的 Mermaid 真渲染引擎**：彻底移除 `(0, eval)` 与运行时远程脚本求值；构建期生成 Tampermonkey 闭包安全包 `dist/vendor/mermaid-11.17.2-tm.min.js`，通过 `@require` 静态预载，并补充 `@updateURL` / `@downloadURL`。
- **脏输入容错与导图视觉升级**：支持无语言标记或 `plain`/`plaintext`/`text` 代码块自动识别 Mermaid 图头；渲染前自动归一化中文破折号箭头（`—>`/`——>`/`–>`/`－>`）、飞书粘贴单行粘连指令、未加引号的斜杠节点与 `<br/>` 换行；改用清爽编辑部默认 `base` 主题与 16px 白底画布留白；渲染失败时保留原代码块并在面板完成态明确展示具体第 N 张图表语法错误。
- **微信公众号「纸本编辑部」高定排版主题**：重做 `wechat.css` 与标题内联字号，收敛至清晰 3 档字阶、书卷琥珀强调色（`#b45309`）、中性行内代码底色与全量满足 WCAG AA（`>= 4.5:1`）的代码高亮配色。

## 1.0.0（Folio）

按现代前端工程栈彻底白纸重做并正式定名为 **Folio**：

- **工程与构建**：全仓迁移为严格 `TypeScript` + `Vite` + `vite-plugin-monkey`，移除手搓构建脚本与油猴自动更新头；单文件产物 `dist/folio.user.js` 约 410 KB（gzip 138 KB），外置 `mermaid-11.17.2.min.js` 按需加载。
- **unified 双路 AST 引擎**：基于 `remark-parse` + `remark-gfm` 构建语法树，知乎/OSChina 走 `remark-stringify` 无损输出 Markdown，富文本平台走 `remark-rehype` + `rehype-sanitize` 严格净化防 XSS 后输出 HTML。
- **公众号语法高亮与主题**：接入 `rehype-highlight`（18 种主力语言），使用 `stylis` 按标准 CSS 特异性将 `wechat.css` 排版主题与 GitHub Light 代码配色内联至标签。
- **Mermaid 按需懒加载与验签**：仅在文稿含 `mermaid` 代码块时从 `acv.k-neco.com` 按需拉取，并通过 WebCrypto 强制校验编译期锁死的 SHA-256 完整性哈希。
- **Preact Shadow DOM 面板**：使用 `Preact` JSX 重构可拖拽悬浮胶囊与导入卡片，支持多次追加、同名图片去重、粘贴导入与脱敏诊断导出。

## 0.7.2（旧版 DraftFerry 归档基线）

- 早期 JS/esbuild 归档版本。
