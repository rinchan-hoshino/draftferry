export function hostMatches(url: URL, hosts: readonly string[]): boolean {
  return hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
}
