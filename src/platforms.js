import { findSohuEditor, injectSohuArticle } from './sohu.js'
import { findTencentDetailEditor, injectTencentMarket } from './tencent-market.js'
import { withEditorLock } from './editor-lock.js'
import { queryFirst } from './adapters/common.js'
import { injectMarkdownTextEditor } from './adapters/markdown.js'
import { pickWechatBodyEditor, injectWechat } from './adapters/wechat.js'
import { findBaijiahaoTitle, injectBaijiahao } from './adapters/baijiahao.js'
import { injectToutiao } from './adapters/toutiao.js'
import { injectZhihu } from './adapters/zhihu.js'
import { findAliyunDetailEditor, injectAliyunMarket } from './adapters/aliyun-market.js'

const PLATFORMS = [
  { id: 'zhihu', name: '知乎', hosts: ['zhihu.com'] },
  {
    id: 'wechat',
    name: '微信公众号',
    hosts: ['mp.weixin.qq.com'],
    editorUrl: (url) => (
      /^\/cgi-bin\/appmsg\/?$/.test(url.pathname)
      && url.searchParams.get('t') === 'media/appmsg_edit_v2'
    ),
  },
  { id: 'oschina', name: '开源中国', hosts: ['oschina.net'] },
  {
    id: 'baijiahao',
    name: '百家号',
    hosts: ['baijiahao.baidu.com'],
    editorPath: /^\/builder\/rc\/edit\/?$/,
  },
  {
    id: 'toutiao',
    name: '今日头条',
    hosts: ['toutiao.com'],
    editorPath: /^\/profile_v4\/graphic\/publish\/?$/,
  },
  {
    id: 'sohu',
    name: '搜狐号',
    hosts: ['mp.sohu.com'],
    editorPath: /^\/mpfe\/v4\/contentManagement\/news\/addarticle\/?$/,
  },
  {
    id: 'aliyun-market',
    name: '阿里云市场',
    hosts: ['msp.aliyun.com'],
    editorUrl: (url) => (
      /^\/msp\/commodity\/list\/~\/publish\/basic\/?$/.test(url.pathname)
      && Boolean(url.searchParams.get('commodityId'))
    ),
  },
  {
    id: 'tencent-market',
    name: '腾讯云市场',
    hosts: ['console.cloud.tencent.com'],
    editorUrl: (url) => (
      /^\/serviceprovider\/products\/createNew\/?$/.test(url.pathname)
      && url.searchParams.get('productType') === 'MARKET'
    ),
  },
]

export const PLATFORM_IDS = PLATFORMS.map((platform) => platform.id)

export function getPlatformById(id) {
  return PLATFORMS.find((platform) => platform.id === id) ?? null
}

function hostnameMatches(hostname, expected) {
  return hostname === expected || hostname.endsWith(`.${expected}`)
}

export function detectPlatform(url) {
  const normalizedUrl = url.searchParams ? url : new URL(url.href)
  return PLATFORMS.find((platform) => (
    platform.hosts.some((host) => hostnameMatches(normalizedUrl.hostname, host))
    && (!platform.editorPath || platform.editorPath.test(normalizedUrl.pathname))
    && (!platform.editorUrl || platform.editorUrl(normalizedUrl))
  )) ?? null
}

const MARKDOWN_CONFIGS = {
  oschina: {
    id: 'oschina',
    name: '开源中国',
    titleSelectors: ['input[placeholder*="标题"]'],
    bodySelectors: ['textarea'],
    preflight(document) {
      const switchText = document.querySelector('.editor-switch-text')
      if (switchText?.textContent?.includes('切换到MD编辑器')) {
        throw new Error('开源中国：请先手动切换到 MD 编辑器，再点导入')
      }
    },
  },
}

function platformLockTargets(document, platformId, windowObject) {
  const title = queryFirst(document, ['textarea[placeholder*="标题"]', 'input[placeholder*="标题"]'])
  let elements
  switch (platformId) {
    case 'tencent-market': elements = [findTencentDetailEditor(document)]; break
    case 'oschina': elements = [title, document.querySelector('textarea')]; break
    case 'wechat': elements = [document.querySelector('#title'), pickWechatBodyEditor(document)]; break
    case 'baijiahao': elements = [findBaijiahaoTitle(document), windowObject.UE_V2?.instants?.ueditorInstant0?.body]; break
    case 'zhihu': elements = [title, document.querySelector('.DraftEditor-root, .public-DraftEditor-content')]; break
    case 'toutiao': elements = [title, document.querySelector('.ProseMirror')]; break
    case 'sohu': elements = [title, findSohuEditor(document), document.querySelector('.ql-toolbar')]; break
    case 'aliyun-market': {
      const editor = findAliyunDetailEditor(document, windowObject)
      elements = [editor.container?.$, editor.editable?.()?.$]
      break
    }
    default: elements = []
  }
  return elements.filter(Boolean)
}

// The task holds a specific destination, not just a platform name. Retrying
// against a replacement editor never reuses upload results from its predecessor.
export function createPlatformTarget(document, options = {}) {
  const pageWindow = options.pageWindow ?? document.defaultView
  const runtimeDocument = pageWindow.document ?? document
  const platform = options.fixturePlatformId && pageWindow.location.protocol === 'file:'
    ? getPlatformById(options.fixturePlatformId) : detectPlatform(pageWindow.location)
  if (!platform) throw new Error('请先进入目标平台的文章编辑页面')
  const url = pageWindow.location.href
  const elements = platformLockTargets(runtimeDocument, platform.id, pageWindow)
  if (!elements.length) throw new Error(`${platform.name}：编辑器尚未准备好，请稍后继续`)
  return {
    platformId: platform.id, url, elements,
    capabilities: { retryUploadedImages: ['tencent-market', 'zhihu'].includes(platform.id) },
    sameAs(other) {
      return other.platformId === platform.id && other.url === url
        && elements.length === other.elements.length
        && elements.every((element, index) => element === other.elements[index])
    },
    commit(article, operation) {
      if (pageWindow.location.href !== url || elements.some(element => !element.isConnected)) {
        throw new Error('目标编辑器已切换，请在当前页面继续导入')
      }
      return injectPlatformArticle(runtimeDocument, article, { ...options, ...operation, pageWindow })
    },
  }
}

export async function injectPlatformArticle(document, article, options = {}) {
  const runtimeDocument = options.pageWindow?.document ?? document
  const runtimeWindow = options.pageWindow ?? runtimeDocument.defaultView
  const fixturePlatform = (
    runtimeWindow.location.protocol === 'file:'
    && options.fixturePlatformId
  ) ? getPlatformById(options.fixturePlatformId) : null
  const platform = fixturePlatform ?? detectPlatform(runtimeWindow.location)
  if (!platform) {
    throw new Error('当前页面不是已支持的文章平台')
  }
  if (!article?.html || !article?.portableMarkdown) {
    throw new Error('转换结果不完整，无法导入平台')
  }

  if (platform.id === 'tencent-market') {
    return injectTencentMarket(runtimeDocument, article, { ...options, pageWindow: runtimeWindow })
  }
  return withEditorLock(platformLockTargets(runtimeDocument, platform.id, runtimeWindow), async (assertCurrent, assertTargetCurrent) => {
    options = { ...options, assertCurrent, assertTargetCurrent }
    if (MARKDOWN_CONFIGS[platform.id]) {
      return injectMarkdownTextEditor(
        runtimeDocument,
        article,
        MARKDOWN_CONFIGS[platform.id],
        runtimeWindow,
      )
    }
    if (platform.id === 'wechat') {
      return injectWechat(runtimeDocument, article, runtimeWindow, assertCurrent)
    }
    if (platform.id === 'baijiahao') {
      return injectBaijiahao(runtimeDocument, article, runtimeWindow)
    }
    if (platform.id === 'zhihu') {
      return injectZhihu(runtimeDocument, article, options)
    }
    if (platform.id === 'toutiao') {
      return injectToutiao(runtimeDocument, article, runtimeWindow)
    }
    if (platform.id === 'sohu') {
      const result = await injectSohuArticle(runtimeDocument, article, options)
      return { platformId: 'sohu', ...result, mode: 'html-api' }
    }
    if (platform.id === 'aliyun-market') {
      return injectAliyunMarket(runtimeDocument, article, options)
    }
    throw new Error(`${platform.name}：尚未实现导入适配器`)
  }, { ...options, pageWindow: runtimeWindow })
}
