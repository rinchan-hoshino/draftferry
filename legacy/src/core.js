import { createDraft, renderDraft } from './draft.js'
import { AssetPool } from './assets.js'

// The interactive importer retains these objects across retries.
export async function renderMarkdownArticle(markdown, options = {}) {
  const draft = createDraft(markdown, { windowObject: options.windowObject ?? globalThis.window })
  const assets = new AssetPool(draft, options)
  return renderDraft(draft, await assets.prepare({ signal: options.signal }))
}
