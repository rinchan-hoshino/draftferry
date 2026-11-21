import type { PlatformAdapter } from '../types.ts'
import aliyun from './aliyun.ts'
import baijiahao from './baijiahao.ts'
import oschina from './oschina.ts'
import sohu from './sohu.ts'
import tencent from './tencent.ts'
import toutiao from './toutiao.ts'
import wechat from './wechat.ts'
import zhihu from './zhihu.ts'

export const PLATFORMS: readonly PlatformAdapter[] = [
  zhihu,
  wechat,
  oschina,
  baijiahao,
  toutiao,
  sohu,
  aliyun,
  tencent,
]

// Matches only by URL (hostname + editor pathname/query); returns null if unsupported.
export function detectPlatform(url: URL | string): PlatformAdapter | null {
  const parsed = url instanceof URL ? url : new URL(url)
  return PLATFORMS.find((platform) => platform.match(parsed)) ?? null
}
