import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMermaidRenderer,
  defaultLoadMermaid,
  normalizeMermaidSource,
  type MermaidApi,
} from '../src/mermaid.ts'
import { patchMermaidForTampermonkey } from '../src/mermaid-vendor.ts'

describe('mermaid Tampermonkey vendor wrapper', () => {
  it('mounts mermaid on globalThis and window inside a strict function closure while raw mermaid.min.js fails', async () => {
    const raw = await readFile(
      resolve(process.cwd(), 'node_modules/mermaid/dist/mermaid.min.js'),
      'utf8',
    )
    const patched = patchMermaidForTampermonkey(raw)

    const createSandbox = () => {
      const dom = new JSDOM('<!doctype html><html><body></body></html>')
      const sandbox: Record<string, unknown> = {
        window: dom.window,
        document: dom.window.document,
        navigator: dom.window.navigator,
        DOMParser: dom.window.DOMParser,
        XMLSerializer: dom.window.XMLSerializer,
        Element: dom.window.Element,
        HTMLElement: dom.window.HTMLElement,
        SVGElement: dom.window.SVGElement,
        Node: dom.window.Node,
        MutationObserver: dom.window.MutationObserver,
        CustomEvent: dom.window.CustomEvent,
        Event: dom.window.Event,
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        console,
        setTimeout,
        clearTimeout,
        performance,
        queueMicrotask,
        structuredClone,
      }
      sandbox.self = sandbox.window
      return { dom, sandbox }
    }

    // Raw mermaid.min.js fails in a Tampermonkey-like function closure because `var __esbuild_esm_mermaid_nm`
    // stays closure-local and is missing from `globalThis`.
    const rawEnv = createSandbox()
    rawEnv.sandbox.__code = raw
    expect(() =>
      vm.runInNewContext('new Function("window", __code)(window)', rawEnv.sandbox),
    ).toThrow(/Cannot read properties of undefined \(reading 'mermaid'\)/)

    // Patched vendor attaches `__esbuild_esm_mermaid_nm` onto `globalThis` and mirrors `window.mermaid`.
    const patchedEnv = createSandbox()
    patchedEnv.sandbox.__code = patched
    vm.runInNewContext('new Function("window", __code)(window)', patchedEnv.sandbox)

    const fromGlobal = patchedEnv.sandbox.mermaid as MermaidApi | undefined
    const fromWindow = (patchedEnv.dom.window as unknown as Record<string, unknown>).mermaid as
      | MermaidApi
      | undefined
    expect(typeof fromGlobal?.render).toBe('function')
    expect(typeof fromGlobal?.initialize).toBe('function')
    expect(fromWindow).toBe(fromGlobal)
  })

  it('throws at build time if upstream mermaid.min.js header changes unexpectedly', () => {
    expect(() => patchMermaidForTampermonkey('"use strict";var other_name;')).toThrow(
      /Unexpected mermaid\.min\.js header/,
    )
  })
})

describe('defaultLoadMermaid & createMermaidRenderer', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).mermaid
    vi.restoreAllMocks()
  })

  it('loads pre-attached @require mermaid from globalThis and throws actionable message when missing', async () => {
    await expect(defaultLoadMermaid()).rejects.toThrow(/篡改猴.*@require/)

    const mockApi: MermaidApi = {
      initialize: vi.fn(),
      render: vi.fn(async () => ({ svg: '<svg viewBox="0 0 10 10"></svg>' })),
    }
    ;(globalThis as Record<string, unknown>).mermaid = mockApi
    expect(await defaultLoadMermaid()).toBe(mockApi)
  })

  it('initializes editorial base theme, normalizes source, and wraps syntax errors clearly', async () => {
    const initialize = vi.fn()
    const render = vi.fn(async (_id: string, src: string) => {
      if (src.includes('BROKEN')) throw new Error('Parse error on line 2')
      return { svg: '<svg viewBox="0 0 100 40"></svg>' }
    })

    const renderer = createMermaidRenderer({
      loadMermaid: async () => ({ initialize, render }),
    })

    await expect(renderer('flowchart LR\n  A —> BROKEN')).rejects.toThrow(
      /Mermaid 语法错误：Parse error on line 2/,
    )
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        suppressErrorRendering: true,
      }),
    )
    expect(render).toHaveBeenCalledWith('rin-folio-1', 'flowchart LR\n  A --> BROKEN')
  })
})

describe('normalizeMermaidSource', () => {
  it('normalizes Chinese/Unicode dash arrows outside quotes while preserving dashes inside double quotes', () => {
    const input = [
      'flowchart LR',
      '  A["备注 —> 说明"] —>|"同步"| B["成集云"]',
      '  B ——>|"创建"| C["金蝶"]',
      '  C –> D －> E',
    ].join('\n')

    const out = normalizeMermaidSource(input)
    expect(out).toBe(
      [
        'flowchart LR',
        '  A["备注 —> 说明"] -->|"同步"| B["成集云"]',
        '  B -->|"创建"| C["金蝶"]',
        '  C --> D --> E',
      ].join('\n'),
    )
  })

  it('splits single-line glued style/classDef/linkStyle/subgraph directives in flowcharts without touching quotes or indentation', () => {
    const input = [
      'flowchart LR',
      '    A["style X fill:#000"] --> B["成集云"] style A fill:#F2994A,stroke:#333,color:#fff style B fill:#4A5699 classDef hot fill:#f00 linkStyle 0 stroke:#333',
      '    B --> C subgraph S1',
      '    style C fill:#27AE60',
    ].join('\n')

    const out = normalizeMermaidSource(input)
    expect(out).toBe(
      [
        'flowchart LR',
        '    A["style X fill:#000"] --> B["成集云"]',
        'style A fill:#F2994A,stroke:#333,color:#fff',
        'style B fill:#4A5699',
        'classDef hot fill:#f00',
        'linkStyle 0 stroke:#333',
        '    B --> C',
        'subgraph S1',
        '    style C fill:#27AE60',
      ].join('\n'),
    )
  })

  it('quotes unquoted square-bracket node labels containing slash without altering quoted or parallelogram shapes', () => {
    const input = [
      'flowchart LR',
      '  A[客户/银行账户] --> B["已加引号/保持原样"]',
      '  B --> C[/平行四边形输入/]',
    ].join('\n')

    const out = normalizeMermaidSource(input)
    expect(out).toBe(
      [
        'flowchart LR',
        '  A["客户/银行账户"] --> B["已加引号/保持原样"]',
        '  B --> C[/平行四边形输入/]',
      ].join('\n'),
    )
  })

  it('converts <br/> and <br> in flowchart labels to native \\n line breaks while leaving sequenceDiagram <br/> intact', () => {
    const flow = normalizeMermaidSource(
      'flowchart LR\n  A["GoCardless<br/>客户/银行账户/授权"] --> B[第一行<br>第二行]\n  B --> C[客户<br />银行/账户]',
    )
    expect(flow).toBe(
      'flowchart LR\n  A["GoCardless\\n客户/银行账户/授权"] --> B[第一行\\n第二行]\n  B --> C["客户\\n银行/账户"]',
    )
    expect(flow).not.toMatch(/<br\s*\/?>/i)

    const seq = normalizeMermaidSource('sequenceDiagram\n  Alice->>Bob: Line1<br/>Line2')
    expect(seq).toBe('sequenceDiagram\n  Alice->>Bob: Line1<br/>Line2')
  })
})
