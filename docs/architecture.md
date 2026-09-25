# 维护与验证

- `core.js` 负责 Markdown、清理、平台通用 HTML 和便携 Markdown 转换。
- `mermaid-png.js` 负责延迟渲染、PNG 和有界缓存。
- `panel.js` 只管理 Shadow DOM 界面及自身监听器；`userscript.js` 管理文件、任务和页面生命周期。
- `platforms.js` 保留八个平台的识别与分发；搜狐和腾讯的专用适配放在各自模块。
- `editor-lock.js` 管理目标范围内的输入保护和同步写入时的焦点/选区保存。腾讯还临时关闭目标 contenteditable，完成后恢复原属性。
- `framework-diagnostics.js` 沿有界的 Vue/React 引用查找实例；诊断文件不包含实例引用或正文。腾讯只接受根元素与目标完全一致的唯一 legacy wangEditor。

## 腾讯事务边界

选择“商品详情”的唯一可用编辑器，确认覆盖并锁定；用该实例配置的 `customUploadImg` 回调或标准上传端点准备远程图片地址。原文在此期间保留，重复图片仅上传一次。

所有图片成功后重新检查页面、目标节点及原文是否发生变化，再调用 `txt.html` 一次替换。对文本、图片顺序和主要块结构做语义校验；失败只恢复一次。解锁后不保留自动回滚监听器，也不替换全局 fetch、XHR 或系统剪贴板。

上传接口根据 [wangEditor v4 自定义上传文档](https://www.wangeditor.com/v4/pages/07-%E4%B8%8A%E4%BC%A0%E5%9B%BE%E7%89%87/11-%E8%87%AA%E5%B7%B1%E5%AE%9E%E7%8E%B0%E4%B8%8A%E4%BC%A0%E5%8A%9F%E8%83%BD.html) 和固定的 `wangeditor@4.7.15` 源码实现。该编辑器在内部临时创建 UploadImg，并不在实例上暴露 uploadImg 对象；不能以模拟对象证明该字段存在。

## 已验证的兼容边界

- 搜狐继续使用已经在真实页面确认的 Observer-backed Vue `_data.quill` 路线，并校验 Quill root。保持 0.4.16 的表格空白清理和 Mermaid 块级包裹；不得重新加入已经失败的 synthetic paste、execCommand 或直接 DOM fallback。
- 腾讯的真实账号页尚未验证 0.5.0。无法取得唯一且关联正确的接口时直接报错，不能退回全局粘贴。
- 测试不会调用真实平台上传服务。Chrome 测试运行真正的 wangEditor 4.7.15，用受控上传回调与 HTTP 响应验证行为；它不等同于腾讯线上接口验收。

## 执行检查

```sh
npm ci
npm run check
```

`check` 包含 ESLint、Node 单元/页面夹具、构建与元数据检查、面板挂载和独立 Chrome 浏览器验证。需要本机安装 Chrome/Chromium；可通过 `DRAFTFERRY_CHROME_PATH` 指定可执行文件。浏览器使用临时用户目录，不接管日常浏览器；wangEditor 和 Playwright 仅为开发依赖，不进入用户脚本。

发布前提高 package 与 lockfile 的版本，运行完整检查并保存源代码提交。发布仅替换既有 `tools/draftferry.user.js`，在站点目录外备份旧文件；通过原 URL 获取完整文件核对版本和 SHA-256。不要把本地构建成功当作发布成功。
