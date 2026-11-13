import baijiahao from './baijiahao.js'
import toutiao from './toutiao.js'
import wechat from './wechat.js'
import sohu from './sohu.js'
import oschina from './oschina.js'
import zhihu from './zhihu.js'
import aliyun from './aliyun.js'
import tencent from './tencent.js'

export const PLATFORMS = [zhihu, wechat, oschina, baijiahao, toutiao, sohu, aliyun, tencent]

// 只按网址（域名 + 编辑页路径）选平台，选不到就返回 null。
export function detectPlatform(url) {
  const parsed = url instanceof URL ? url : new URL(url)
  return PLATFORMS.find(platform => platform.match(parsed)) ?? null
}

