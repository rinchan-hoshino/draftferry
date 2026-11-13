import { detectPlatform } from './platforms/index.js'

const MD_PATTERN = /\.(md|markdown)$/i

// 一次导入：选平台 → 读 Markdown → 转换 → 写正文 → 写标题。
// 每次都重新找编辑器，所以连着导第二篇、第三篇不用刷新。
// probe 记下平台、编辑器和标题框找没找到，出错时给诊断用。
export async function runImport({ pageWindow, url, files, text, buildArticle, probe = {} }) {
  const platform = detectPlatform(url)
  probe.platformId = platform?.id ?? null
  if (!platform) throw new Error('当前页面不是稿渡支持的编辑页，请先进入文章编辑页')

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

  const doc = pageWindow.document
  const titleControl = platform.findTitle(doc)
  probe.titleFound = Boolean(titleControl)
  let editor
  try {
    editor = platform.findEditor(doc, pageWindow)
  } catch (error) {
    probe.editorFound = false
    throw error
  }
  probe.editorFound = true

  const images = new Map(files.filter(file => file !== mdFile).map(file => [file.name, file]))
  const article = await buildArticle(markdown, { fallbackTitle, files: images })
  await editor.setHTML(article.html, { markdown: article.markdown })
  if (article.title && titleControl && platform.writeTitle) {
    platform.writeTitle(pageWindow, titleControl, article.title)
  }

  return {
    platformName: platform.name,
    title: article.title,
    imageCount: article.imageCount,
    missing: article.missing,
    mermaidErrors: article.mermaidErrors,
    titleMissing: Boolean(platform.writeTitle) && !titleControl,
    titleUnsupported: !platform.writeTitle,
  }
}
