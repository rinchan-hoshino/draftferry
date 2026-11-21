import { detectPlatform } from './platforms/index.js'

const MD_PATTERN = /\.(md|markdown)$/i

export async function runImport({ pageWindow, url, files, text, buildArticle, onProgress, probe = {} }) {
  probe.stage = 'detect'
  const platform = detectPlatform(url)
  probe.platformId = platform?.id ?? null
  if (!platform) throw new Error('当前页面不是稿渡支持的编辑页，请先进入文章编辑页')

  probe.stage = 'read'
  const mdFile = files.find(file => MD_PATTERN.test(file.name))
  let markdown
  let fallbackTitle = ''
  if (mdFile) {
    markdown = await mdFile.text()
    fallbackTitle = mdFile.name.replace(MD_PATTERN, '')
  } else if (text?.trim()) {
    markdown = text
  } else {
    throw new Error('请先拖入 .md 文件，或粘贴 Markdown 文本')
  }

  probe.stage = 'editor'
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

  probe.stage = 'parse'
  onProgress?.('解析 Markdown…')
  const images = new Map(files.filter(file => file !== mdFile).map(file => [file.name, file]))
  const article = await buildArticle(markdown, { fallbackTitle, files: images, onProgress })

  probe.stage = 'inject'
  await editor.setHTML(article.html, { markdown: article.markdown, onProgress })

  if (article.title && titleControl && platform.writeTitle) {
    probe.stage = 'title'
    platform.writeTitle(pageWindow, titleControl, article.title)
  }

  probe.stage = 'done'
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
