export function dataImageUrlToBlob(windowObject, source, platformName) {
  const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i)
  if (!match) throw new Error(`${platformName}：内嵌图片不是有效的 Base64 图片`)
  const binary = windowObject.atob(match[2])
  const bytes = windowObject.Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new windowObject.Blob([bytes], { type: match[1].toLowerCase() })
}

export function imageFileExtension(mimeType) {
  const subtype = mimeType.split('/')[1]?.toLowerCase() ?? 'png'
  if (subtype === 'jpeg') return 'jpg'
  return subtype.replace(/[^a-z0-9]/g, '') || 'png'
}
