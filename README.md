# 稿渡（DraftFerry）

把本地 Markdown 文章、配图和 Mermaid 图表直接导入八个内容平台的编辑页。脚本只负责填充标题和正文，不会自动保存或发布。

[安装或更新脚本](https://acv.k-neco.com/tools/draftferry.user.js) · [更新记录](CHANGELOG.md)

## 支持的平台

| 平台 | 编辑页 | 标题 | 说明 |
| --- | --- | --- | --- |
| 知乎专栏 | `zhuanlan.zhihu.com/write` | 自动填入 | 自动上传本地图，触发知乎 Markdown 解析 |
| 微信公众号 | `mp.weixin.qq.com/cgi-bin/appmsg` | 自动填入 | 套用金色竖线标题排版，文末保留可编辑空行 |
| 开源中国 | `my.oschina.net/*/blog/ai-write` | 自动填入 | 需先切到 MD 编辑器 |
| 百家号 | `baijiahao.baidu.com/builder/rc/edit` | 自动填入 | 自动定位当前活动的 UEditor 实例 |
| 今日头条 | `mp.toutiao.com/profile_v4/graphic/publish` | 自动填入 | 写入 ProseMirror 正文 |
| 搜狐号 | `mp.sohu.com/mpfe/v4/contentManagement/news/addarticle` | 自动填入 | 兼容表格与标题层级，写入失败自动恢复原稿 |
| 阿里云市场 | `msp.aliyun.com/msp/commodity/list/~/publish/basic` | 无标题框 | 写入产品详情 CKEditor，等待平台传图，失败恢复原稿 |
| 腾讯云市场 | `console.cloud.tencent.com/serviceprovider/products/createNew` | 无标题框 | 写入商品详情 wangEditor，先传图再替换正文，失败不改原稿 |

## 安装

1. 在浏览器安装 Tampermonkey，并在扩展设置里允许运行用户脚本。
2. 打开顶部的安装链接，确认安装即可。

## 使用

1. 登录目标平台并进入编辑页，页面右侧中部会出现「DraftFerry」悬浮胶囊（离开编辑页自动隐藏）。
2. 点开面板，把 `.md` 文件和文章里用到的本地图片拖进去，或点击虚线区选择。支持分多次追加，新 `.md` 会替换旧 `.md`，同名图片自动去重；也可以直接展开下方粘贴区，或在面板里按 `Cmd/Ctrl+V` 粘贴 Markdown。
3. 点击「导入到 <平台名>」。导入完成后自动收起并清空队列，可以直接继续导下一篇。

规则说明：
- 标题默认取文章第一处顶层一级标题（`# 标题`），正文里不再重复。没有一级标题时用 `.md` 文件名。
- 悬浮胶囊可按住左侧手柄拖动，也支持键盘方向键微调，位置按站点记住。

## 常见问题

- **提示缺图**：正文对应位置会留下 `[缺图：文件名]`，把漏掉的图片补拖进面板重新导入即可。
- **Mermaid 图渲染失败**：失败的图表会保留为原始代码块，并在面板提示原因。
- **其它报错**：出错后面板底部会出现「复制诊断信息」按钮，复制 JSON 发给维护者排查（不含文章正文和 Cookie）。

## 本地开发

```sh
npm ci
npm run check
npm run test:browser
```

打包产物位于 `dist/draftferry.user.js`。源码在 `src/`，单元测试与浏览器验证在 `test/`。

## 回退旧版（v0.7.2）

如果新版在某个平台后台遇到兼容问题，可以点击 Release 中的 [draftferry-0.7.2-rollback.user.js](dist/draftferry-0.7.2-rollback.user.js) 一键覆盖降级回 `0.7.2`。该回滚包保留相同的脚本名称与命名空间，不会与新版双开冲突，且已移除自动更新地址，降级后不会被自动升回新版。

