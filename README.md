# Markdown 八平台一键排版（0.2.0 Preview）

给夫人测试的 Tampermonkey 用户脚本：在目标平台的空白文章编辑页选择 Markdown，统一处理排版、本地图片和 Mermaid PNG，再通过该平台可回滚的编辑器边界填入内容。

脚本**不会**自动保存、发布，也不会读取或导出登录凭据。

## 当前状态

- `0.2.0` 是本地候选，尚未替换 ACV 上的搜狐单平台 `0.1.0`。
- 自动化 fixture 验证：可回滚接口的平台才允许填入；其余平台在改动页面前明确报“待真实页面”。
- 真实平台的登录后 DOM、图片接收和保存预览仍需夫人现场验收。

## 平台范围

| 平台 | 当前实验边界 |
| --- | --- |
| 博客园 | 向空白 Markdown textarea 填入可移植 Markdown |
| CSDN | 识别页面；当前 contenteditable 没有可验证状态 API，明确报错等待现场证据 |
| 知乎 | 识别页面；没有可验证回滚 API 时明确报错，等待现场证据 |
| 微信公众号 | 使用 `mp_editor_set_content` 编辑器接口填入富文本并回滚 |
| 开源中国 | 夫人先手动切到 MD 编辑器，再填入可移植 Markdown |
| 百家号 | 识别页面；正文有 UEditor，但标题缺少可验证状态 API，明确报错等待现场证据 |
| 今日头条 | 识别页面；没有可验证回滚 API 时明确报错，等待现场证据 |
| 搜狐号 | 使用 Quill `getContents/setContents` 原子填入并回滚 |

阿里云、腾讯云已按夫人最新反馈排除。

## 安装候选

1. 安装 Tampermonkey 5.3 或更高版本。
2. Chrome 138+：在 Tampermonkey 扩展详情中启用“允许用户脚本”；若没有该开关，则在扩展管理页启用“开发者模式”。
3. 在 Tampermonkey 中导入 [`dist/multiplatform-markdown.user.js`](dist/multiplatform-markdown.user.js)。
4. 核对安装页只申请 README 所列八个平台，没有 `<all_urls>`。

## 使用

1. 登录目标平台并进入一篇全新的空白文章。
2. 开源中国需要先手动切换到 MD 编辑器；其他平台不要预先填写标题或正文。
3. 点击右下角“导入 Markdown”。
4. 选择一个 `.md`/`.markdown` 文件；若正文引用本地图片，同时选中对应图片文件。
5. 等脚本填入或显示明确错误。
6. 人工检查标题、图片、表格、代码块和 Mermaid，然后由夫人手动保存、预览或发布。

标题或正文已有内容时，脚本会拒绝导入。任何平台报错后都不要保存；保留错误文字和页面截图，用于下一轮适配。

## 转换规则

- 第一处一级标题作为平台标题，不重复放进正文；
- Mermaid 代码块统一转换成白底 PNG；
- 富文本平台接收带内联样式的 HTML；
- Markdown 平台接收“可移植 Markdown”，其中 Mermaid 与本地图片替换成 PNG data URL；平台是否接受 data URL 必须现场验证；
- 原始 Markdown 内嵌 HTML先经过 DOMPurify 清理，再进入富文本编辑器。

## 开发与验证

```bash
npm install
npm test
npm run check
```

构建产物：`dist/multiplatform-markdown.user.js`。
