import { editorTextLength, findLiveEditor, findTitleControl, fillTitle, writeBody } from './editor.js'

const MD_PATTERN = /\.(md|markdown)$/i

// 一次导入：读 Markdown → 转换 → 写标题和正文 → 读回校验。
// probe 记下找没找到编辑器和标题框，出错时给诊断用。
export async function runImport({ pageWindow, files, text, buildArticle, confirm, probe = {} }) {
  const mdFile = files.find(file => MD_PATTERN.test(file.name))
  let markdown
  let fallbackTitle = ''
  if (mdFile) {
    markdown = await mdFile.text()
    fallbackTitle = mdFile.name.replace(MD_PATTERN, '')
  } else if (text?.trim()) {
    markdown = text
  } else {
    throw new Error('先把 .md 文件拖进来，或把 Markdown 粘贴到输入框里')
  }

  const images = new Map(files.filter(file => file !== mdFile).map(file => [file.name, file]))
  const editor = findLiveEditor(pageWindow)
  const titleControl = findTitleControl(pageWindow.document)
  probe.ueditorFound = Boolean(editor)
  probe.titleFound = Boolean(titleControl)
  if (!editor) throw new Error('没找到正在编辑的正文，请确认页面是百家号图文编辑页')

  const article = await buildArticle(markdown, { fallbackTitle, files: images })

  const hasContent = editorTextLength(editor.getContent() ?? '') > 0 || Boolean(titleControl?.textContent.trim())
  if (hasContent && !confirm('编辑器里已有内容，导入会整篇覆盖。继续吗？')) return { cancelled: true }

  writeBody(editor, article.html)
  if (article.title && titleControl) fillTitle(pageWindow, titleControl, article.title)

  return {
    title: article.title,
    imageCount: article.imageCount,
    missing: article.missing,
    mermaidErrors: article.mermaidErrors,
    titleMissing: !titleControl,
  }
}
