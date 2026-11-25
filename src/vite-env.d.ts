/// <reference types="vite/client" />

declare const __MERMAID_VERSION__: string

declare module 'stylis' {
  export interface Element {
    type: string
    props: string | string[]
    children: string | Element[]
  }
  export function compile(css: string): Element[]
}
