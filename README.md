# 稿渡（DraftFerry）

**Markdown 一键排版 Preview**。稿渡为八个内容平台提供实际导入逻辑，将 Markdown、本地图片和 Mermaid PNG 转成目标编辑器可接收的格式，并在写入后检查标题、正文和关键结构。

稿渡**不会**自动保存或发布，也不会读取、导出登录凭据。

## 固定身份

- 产品名：稿渡
- 英文与技术标识：DraftFerry
- 油猴安装文件：`draftferry.user.js`
- 唯一安装链接：`https://acv.k-neco.com/tools/draftferry.user.js`

产品名和链接不再随平台数量变化。当前版本为 `0.3.1`；Tampermonkey 的更新与下载地址都固定到上述链接。

## 当前平台边界

| 平台 | 0.3.1 Preview 导入方式 |
| --- | --- |
| 博客园 | 向空白 Markdown textarea 填入可移植 Markdown |
| CSDN | 向空白 Markdown contenteditable 填入可移植 Markdown，并验证最终文本 |
| 知乎 | 粘贴可移植 Markdown，完成“确认并解析”和“确认”，再检查正文/图片/表格/代码块 |
| 微信公众号 | 使用 `mp_editor_set_content` 填入富文本并验证回滚 |
| 开源中国 | 用户先手动切到 MD 编辑器，再填入可移植 Markdown |
| 百家号 | 使用 UEditor 填入正文，通过 contenteditable 填入标题，并验证最终内容 |
| 今日头条 | 通过 ProseMirror `insertHTML` 填入富文本并验证结构与 undo 回滚 |
| 搜狐号 | 使用 Quill `getContents/setContents` 填入并验证回滚 |

表中八项均已有可执行适配器和本地页面夹具，不再把占位报错算作适配；真实登录页面兼容性和保存结果仍须逐站验收。

阿里云、腾讯云不在当前范围内。

## 安装

1. 安装 Tampermonkey 5.3 或更高版本。
2. Chrome 138+：在 Tampermonkey 扩展详情中启用“允许用户脚本”；若没有该开关，则在扩展管理页启用“开发者模式”。
3. 打开 `https://acv.k-neco.com/tools/draftferry.user.js`，由 Tampermonkey 接管并显示安装页。
4. 核对安装页名称为“稿渡 · Markdown 一键排版（Preview）”，且只申请上表八个平台对应的文章编辑页，没有 `<all_urls>`，然后点击安装。

## 使用

1. 登录目标平台，进入一篇全新的空白文章。
2. 开源中国需要先手动切到 MD 编辑器；其他平台不要预先填写标题或正文。
3. 点击右下角“导入 Markdown”。
4. 选择一个 `.md`/`.markdown` 文件；若正文引用本地图片，同时选中对应图片文件。
5. 等稿渡填入内容或显示明确错误。
6. 人工检查标题、图片、表格、代码块和 Mermaid，再手动保存、预览或发布。

标题或正文已有内容时，稿渡会拒绝导入。任何平台报错后都不要保存；请把错误文字和页面截图交给主理人，由主理人决定是否进入下一轮适配。

## 转换与安全边界

- 第一处一级标题作为平台标题，不重复放进正文；
- Mermaid 代码块转换成白底 PNG；
- 原始 Markdown 内嵌 HTML 先由 DOMPurify 清理；
- 富文本平台接收带内联样式的 HTML，并校验结构、样式、图片与有语义属性；
- Markdown 平台接收由清理后 HTML 重新生成的 GFM Markdown；
- Mermaid 与本地图片在 Markdown 中使用 PNG data URL，平台是否接受仍需现场验证；
- 写入失败时验证回滚结果；无法验证平台状态时不改动页面。

## 开发与验证

```bash
npm install
npm test
npm run check
```

构建产物：`dist/draftferry.user.js`。
