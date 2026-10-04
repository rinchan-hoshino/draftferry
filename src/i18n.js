import entries from './copy-catalog.js'

export function localeFor(document) {
  const language = document?.documentElement?.lang || document?.defaultView?.navigator?.languages?.[0] || ''
  return /^en(?:[-_]|$)/i.test(language) ? 'en' : 'zh'
}

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const catalog = entries.map(entry => ({
  ...entry,
  pattern: new RegExp(`^${entry.source.map(escape).join('([\\s\\S]*?)')}$`),
})).sort((a, b) => b.source.join('').length - a.source.join('').length)

export function localize(value, locale = 'zh', depth = 0) {
  const text = String(value ?? '')
  for (const entry of catalog) {
    const match = entry.pattern.exec(text)
    if (!match) continue
    const parts = entry[locale] || entry.zh
    return parts.reduce((result, part, index) => {
      if (!index) return part
      let parameter = match[index]
      if (entry.trusted[index - 1] && depth < 4) parameter = localize(parameter, locale, depth + 1)
      if (locale === 'en' && entry.id === 'copy_010') parameter = parameter.replace(/^：/, ': ').replace(/^（HTTP (.*)）$/, ' (HTTP $1)')
      return result + parameter + part
    }, '')
  }
  return text
}
