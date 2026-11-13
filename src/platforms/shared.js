export function hostMatches(url, hosts) {
  return hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
}
