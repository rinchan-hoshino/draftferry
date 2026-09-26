import { queryFirst, confirmTextEditorOverwrite, writeBodyValue, writeControl } from './common.js'

export async function injectMarkdownTextEditor(
  document,
  article,
  config,
  windowObject = document.defaultView,
) {
  if (config.preflight) {
    config.preflight(document)
  }
  const titleControl = queryFirst(document, config.titleSelectors)
  const bodyEditor = queryFirst(document, config.bodySelectors)
  if (!titleControl) {
    throw new Error(`${config.name}：未找到标题输入框`)
  }
  if (!bodyEditor) {
    throw new Error(`${config.name}：未找到 Markdown 编辑器`)
  }
  confirmTextEditorOverwrite(windowObject, titleControl, bodyEditor)

  writeBodyValue(windowObject, bodyEditor, article.portableMarkdown)
  writeControl(windowObject, titleControl, article.title)

  return {
    platformId: config.id,
    titleFilled: Boolean(article.title),
    bodyFilled: true,
    mode: 'markdown',
  }
}

