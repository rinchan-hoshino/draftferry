export const MERMAID_HEADER = '"use strict";var __esbuild_esm_mermaid_nm;'
export const MERMAID_PATCHED_HEADER =
  '"use strict";var __esbuild_esm_mermaid_nm=(globalThis.__esbuild_esm_mermaid_nm||={});'
export const MERMAID_FOOTER =
  '\nif(typeof window!=="undefined")window["mermaid"]=globalThis["mermaid"];\n'

export function patchMermaidForTampermonkey(raw: string): string {
  if (!raw.startsWith(MERMAID_HEADER)) {
    throw new Error(
      `Unexpected mermaid.min.js header; expected prefix ${JSON.stringify(MERMAID_HEADER)}`,
    )
  }
  return MERMAID_PATCHED_HEADER + raw.slice(MERMAID_HEADER.length) + MERMAID_FOOTER
}
