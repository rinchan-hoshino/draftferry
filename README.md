# 稿渡（DraftFerry）

**Markdown 一键排版 Preview**。稿渡为八个内容平台提供实际导入逻辑，将 Markdown、本地图片和 Mermaid PNG 转成目标编辑器可接收的格式。平台接管内容后可能自行调整格式，稿渡不再做写入后二次校验。

稿渡**不会**自动保存或发布，也不会读取、导出登录凭据。

## 固定身份

- 产品名：稿渡
- 英文与技术标识：DraftFerry
- 油猴安装文件：`draftferry.user.js`
- 唯一安装链接：`https://acv.k-neco.com/tools/draftferry.user.js`

产品名和链接不再随平台数量变化。当前版本为 `0.4.12` 诊断版；Tampermonkey 的更新与下载地址都固定到上述链接。

## 当前平台边界

| 平台 | 0.4.12 Diagnostic Preview 导入方式 |
| --- | --- |
| 知乎 | 先上传 Mermaid/本地图片，再粘贴可移植 Markdown，完成“确认并解析”和“确认” |
| 微信公众号 | 清理列表空项与列表直属空白文本后，使用 `mp_editor_set_content` 填入富文本 |
| 开源中国 | 用户先手动切到 MD 编辑器，再填入可移植 Markdown |
| 百家号 | 使用 UEditor 填入正文，通过 contenteditable 填入标题 |
| 今日头条 | 通过 ProseMirror `insertHTML` 填入富文本，并将图片交给平台粘贴上传流程 |
| 搜狐号 | 保留 0.4.9 适配器行为；真实页未通过，暂勿使用 |
| 阿里云市场 | 只向“产品详情”CKEditor 粘贴富文本，并交给平台 `uploadimage` 流程上传内嵌图片 |
| 腾讯云市场 | 保留 0.4.9 适配器行为；仍会污染目标外页面元素，暂勿使用 |

表中八项均已有可执行适配器和本地页面夹具，不再把占位报错算作适配；本地夹具已覆盖百家号、今日头条和搜狐号从同站后台通过 SPA 进入上述编辑路由后的面板挂载。云市场适配器不会改商品名称或其他基础资料；图片上传失败会恢复原商品详情。`0.4.3` 增加“复制诊断”按钮，只复制固定结构分类、数量、可见性、几何和接口存在性，不复制正文、标题、URL 路径/查询或原始 ID/类名。根据三份真实诊断，`0.4.4` 增加三条待登录验收的候选兼容路径：阿里云识别实际出现的 `.next-form-item`；搜狐在 Quill 实例不可见时尝试该编辑器已注册的原生粘贴事件，再回退浏览器 `insertHTML`；腾讯云在开放 ShadowRoot 或同源 iframe 中继续查找唯一且标注为商品详情的编辑器。`0.4.8` 的图片专项校验来自对搜狐反馈截图的误读，`0.4.9` 已删除该专项逻辑与测试，保留通用写入失败撤销保护。`0.4.10` 尝试绕过搜狐原生粘贴并改用 `insertHTML`，但真实页只写入开头片段，已验收失败并从生产回滚；该路线不得继续补丁化。腾讯 `0.4.9` 虽修正了两个 WangEditor 通过公共 form-item 误关联的问题，真实页仍会把粘贴内容污染到目标编辑器外。`0.4.11` 仅增加 schema 3 框架实例诊断，导入行为与生产 `0.4.9` 对齐：扫描编辑器祖先上的 Vue/React 框架所有者，只沿固定对象引用边、跳过 getter 和 primitive、限制深度与对象数量，报告经过 API 形状验证的 Quill 或 WangEditor 候选及目标关系；不输出正文、标题、URL、原始属性名或组件值。真实 schema 3 结果在搜狐发现 4 个 Vue 2 所有者，在腾讯两个编辑器上各发现 7 个 React Fiber 和 7 个 React Props 所有者，但均未在原 6 层范围找到实例。`0.4.12` 根据搜狐实际主包的 `this.quill` 和 Vue 2 `$parent` 关系，以及 WangEditor 官方 React `useState` 示例和 React 17 Hook 链结构，仅补充 Vue `$parent`、React 父 Fiber `return`、Hook `memoizedState/next` 与固定 editor-ref 边；移除 `child`、`sibling`、`alternate` 等横向边，深度上限提高到 20，深度截断也会报告 `truncated=true`。正式修复必须等关联实例被真实诊断证明后改走编辑器实例 API，不再使用 synthetic paste、`insertHTML` 或直接 `innerHTML`。

## 安装

1. 安装 Tampermonkey 5.3 或更高版本。
2. Chrome 138+：在 Tampermonkey 扩展详情中启用“允许用户脚本”；若没有该开关，则在扩展管理页启用“开发者模式”。
3. 打开 `https://acv.k-neco.com/tools/draftferry.user.js`，由 Tampermonkey 接管并显示安装页。
4. 核对安装页名称为“稿渡 · Markdown 一键排版（Preview）”，且只申请上表八个平台对应的文章编辑页，没有 `<all_urls>`，然后点击安装。

## 使用

1. 登录目标平台并进入文章编辑页。
2. 开源中国需要先手动切到 MD 编辑器。
3. 点击右下角“导入 Markdown”。
4. 选择一个 `.md`/`.markdown` 文件；若正文引用本地图片，同时选中对应图片文件。
5. 若稿渡判断标题或正文已有内容，会询问是否继续；取消不会改动页面，确认后按当前平台的导入方式继续，可能覆盖或合并已有内容。
6. 等稿渡填入内容或显示明确错误。
7. 人工检查标题、图片、表格、代码块和 Mermaid，再手动保存、预览或发布。

任何平台报错后都不要保存；请把错误文字和页面截图交给主理人，由主理人决定是否进入下一轮适配。

## 转换与安全边界

- 第一处一级标题作为平台标题，不重复放进正文；
- Mermaid 代码块使用官方 Mermaid 延迟转换成白底 PNG；重复图表复用缓存，图片保留自然尺寸且宽度最多 1000px；
- 原始 Markdown 内嵌 HTML 先由 DOMPurify 清理；
- 富文本平台接收带内联样式的 HTML；
- Markdown 平台接收由清理后 HTML 重新生成的 GFM Markdown；
- Mermaid 与本地图片在 Markdown 中先生成 data URL；知乎会在粘贴前上传并替换为知乎图片地址；阿里云市场交给 CKEditor `uploadimage`，腾讯云市场则先逐图调用 wangEditor 原生粘贴上传；
- 平台写入接口返回后即视为导入完成，不比较平台最终生成的 HTML、样式或结构；
- 标题或正文非空时会先弹出原生确认框；取消不改动页面，确认后沿用平台现有写入语义；
- 稿渡仍不自动保存或发布。

## 开发与验证

```bash
npm install
npm test
npm run check
```

构建产物：`dist/draftferry.user.js`。
