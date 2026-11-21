// Lightweight zero-bloat syntax highlighter outputting inline-styled <span> tokens
// for WeChat / rich-text editors. Supports js, ts, jsx, tsx, py, rust, go, java,
// c, cpp, csharp, bash, json, yaml, toml, sql, html, css, markdown.

const PALETTE = {
  comment: '#6e7781',
  string: '#0a3069',
  number: '#0550ae',
  keyword: '#cf222e',
  type: '#953800',
  fn: '#8250df',
  tag: '#116329',
  attr: '#0550ae',
  operator: '#cf222e',
  heading: '#0550ae',
} as const

type TokenKind = keyof typeof PALETTE

interface LangRule {
  comment: RegExp | null
  keywords: Set<string>
  types: Set<string>
  stringDelims: string
  hashComment?: boolean
  sqlComment?: boolean
  markup?: boolean
  markdown?: boolean
}

const C_LIKE_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue',
  'return', 'try', 'catch', 'finally', 'throw', 'new', 'delete', 'typeof', 'instanceof',
  'in', 'of', 'void', 'const', 'let', 'var', 'function', 'async', 'await', 'yield',
  'class', 'extends', 'implements', 'interface', 'type', 'enum', 'struct', 'union',
  'import', 'export', 'from', 'as', 'package', 'use', 'mod', 'pub', 'fn', 'func',
  'match', 'impl', 'trait', 'where', 'mut', 'ref', 'move', 'unsafe', 'static', 'final',
  'public', 'private', 'protected', 'abstract', 'override', 'virtual', 'namespace',
  'using', 'true', 'false', 'null', 'nil', 'undefined', 'this', 'self', 'super',
  'sizeof', 'typedef', 'extern', 'inline', 'constexpr', 'template', 'typename',
])

const C_LIKE_TYPES = new Set([
  'string', 'number', 'boolean', 'any', 'unknown', 'never', 'object', 'symbol', 'bigint',
  'int', 'long', 'short', 'byte', 'char', 'float', 'double', 'bool', 'void',
  'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'u8', 'u16', 'u32', 'u64', 'u128', 'usize',
  'f32', 'f64', 'str', 'String', 'Vec', 'Option', 'Result', 'Box', 'Arc', 'Rc',
  'Promise', 'Array', 'Map', 'Set', 'Record', 'Partial', 'Required', 'Readonly',
  'List', 'Dict', 'Error', 'err', 'rune', 'uintptr', 'int64', 'uint64',
])

const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
  'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from',
  'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
  'raise', 'return', 'try', 'while', 'with', 'yield', 'match', 'case',
])

const PY_TYPES = new Set([
  'int', 'float', 'str', 'bool', 'list', 'dict', 'set', 'tuple', 'bytes', 'object',
  'Any', 'Optional', 'Union', 'List', 'Dict', 'Tuple', 'Set', 'Callable', 'self', 'cls',
])

const BASH_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'select', 'while', 'until',
  'do', 'done', 'in', 'function', 'time', 'coproc', 'local', 'export', 'readonly',
  'declare', 'unset', 'return', 'exit', 'break', 'continue', 'source', 'true', 'false',
])

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'AS', 'ON',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'FULL', 'CROSS', 'GROUP', 'BY', 'HAVING',
  'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'INSERT', 'INTO', 'VALUES', 'UPDATE',
  'SET', 'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'VIEW', 'PRIMARY',
  'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'DEFAULT', 'CHECK', 'CONSTRAINT',
  'UNION', 'ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS',
  'LIKE', 'ILIKE', 'BETWEEN', 'TRUE', 'FALSE', 'WITH', 'RECURSIVE', 'RETURNING',
])

const SQL_TYPES = new Set([
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TEXT', 'VARCHAR', 'CHAR', 'BOOLEAN',
  'BOOL', 'DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'NUMERIC', 'DECIMAL', 'FLOAT', 'DOUBLE',
  'JSON', 'JSONB', 'UUID', 'BLOB', 'SERIAL', 'BIGSERIAL',
])

const CSS_KEYWORDS = new Set([
  'important', 'from', 'to', 'and', 'or', 'not', 'only', 'screen', 'print',
  'inherit', 'initial', 'unset', 'none', 'auto', 'block', 'inline', 'flex', 'grid',
  'relative', 'absolute', 'fixed', 'sticky', 'solid', 'dashed', 'dotted',
])

const RULES: Record<string, LangRule> = {
  js: { comment: /\/\/.*|\/\*[\s\S]*?\*\//, keywords: C_LIKE_KEYWORDS, types: C_LIKE_TYPES, stringDelims: `"'` + '`' },
  ts: { comment: /\/\/.*|\/\*[\s\S]*?\*\//, keywords: C_LIKE_KEYWORDS, types: C_LIKE_TYPES, stringDelims: `"'` + '`' },
  jsx: { comment: /\/\/.*|\/\*[\s\S]*?\*\//, keywords: C_LIKE_KEYWORDS, types: C_LIKE_TYPES, stringDelims: `"'` + '`', markup: true },
  tsx: { comment: /\/\/.*|\/\*[\s\S]*?\*\//, keywords: C_LIKE_KEYWORDS, types: C_LIKE_TYPES, stringDelims: `"'` + '`', markup: true },
  rust: { comment: /\/\/.*|\/\*[\s\S]*?\*\//, keywords: C_LIKE_KEYWORDS, types: C_LIKE_TYPES, stringDelims: `"` },
  go: { comment: /\/\/.*|\/\*[\s\S]*?\*\//, keywords: C_LIKE_KEYWORDS, types: C_LIKE_TYPES, stringDelims: `"'` + '`' },
  java: { comment: /\/\/.*|\/\*[\s\S]*?\*\//, keywords: C_LIKE_KEYWORDS, types: C_LIKE_TYPES, stringDelims: `"'` },
  c: { comment: /\/\/.*|\/\*[\s\S]*?\*\//, keywords: C_LIKE_KEYWORDS, types: C_LIKE_TYPES, stringDelims: `"'` },
  cpp: { comment: /\/\/.*|\/\*[\s\S]*?\*\//, keywords: C_LIKE_KEYWORDS, types: C_LIKE_TYPES, stringDelims: `"'` },
  csharp: { comment: /\/\/.*|\/\*[\s\S]*?\*\//, keywords: C_LIKE_KEYWORDS, types: C_LIKE_TYPES, stringDelims: `"'` },
  py: { comment: null, hashComment: true, keywords: PY_KEYWORDS, types: PY_TYPES, stringDelims: `"'` },
  bash: { comment: null, hashComment: true, keywords: BASH_KEYWORDS, types: new Set(), stringDelims: `"'` + '`' },
  json: { comment: null, keywords: new Set(['true', 'false', 'null']), types: new Set(), stringDelims: `"` },
  yaml: { comment: null, hashComment: true, keywords: new Set(['true', 'false', 'null', 'yes', 'no']), types: new Set(), stringDelims: `"'` },
  toml: { comment: null, hashComment: true, keywords: new Set(['true', 'false']), types: new Set(), stringDelims: `"'` },
  sql: { comment: /\/\*[\s\S]*?\*\//, sqlComment: true, keywords: SQL_KEYWORDS, types: SQL_TYPES, stringDelims: `'` },
  html: { comment: /<!--[\s\S]*?-->/, keywords: new Set(), types: new Set(), stringDelims: `"'`, markup: true },
  css: { comment: /\/\*[\s\S]*?\*\//, keywords: CSS_KEYWORDS, types: new Set(), stringDelims: `"'` },
  markdown: { comment: null, keywords: new Set(), types: new Set(), stringDelims: '', markdown: true },
}

const ALIASES: Record<string, string> = {
  javascript: 'js', mjs: 'js', cjs: 'js',
  typescript: 'ts', mts: 'ts', cts: 'ts',
  python: 'py', rs: 'rust', cs: 'csharp',
  sh: 'bash', shell: 'bash', zsh: 'bash',
  yml: 'yaml', xml: 'html', svg: 'html', markup: 'html', md: 'markdown',
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function span(kind: TokenKind, text: string): string {
  return `<span style="color: ${PALETTE[kind]}">${escapeHtml(text)}</span>`
}

function highlightMarkdown(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      if (/^#{1,6}\s/.test(line)) return span('heading', line)
      if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) return span('comment', line)
      if (/^\s*>\s?/.test(line)) return span('comment', line)
      return escapeHtml(line)
    })
    .join('\n')
}

export function highlightCodeToInlineHtml(code: string, rawLang: string): string {
  const key = rawLang.trim().toLowerCase()
  const lang = ALIASES[key] ?? key
  const rule = RULES[lang]
  if (!rule) return escapeHtml(code)
  if (rule.markdown) return highlightMarkdown(code)

  let out = ''
  let i = 0
  const len = code.length
  const isSql = lang === 'sql'

  while (i < len) {
    const ch = code[i]

    // Line / block comments
    if (rule.hashComment && ch === '#') {
      const end = code.indexOf('\n', i)
      const slice = end === -1 ? code.slice(i) : code.slice(i, end)
      out += span('comment', slice)
      i += slice.length
      continue
    }
    if (rule.sqlComment && ch === '-' && code[i + 1] === '-') {
      const end = code.indexOf('\n', i)
      const slice = end === -1 ? code.slice(i) : code.slice(i, end)
      out += span('comment', slice)
      i += slice.length
      continue
    }
    if (rule.comment) {
      const match = rule.comment.exec(code.slice(i))
      if (match && match.index === 0) {
        out += span('comment', match[0])
        i += match[0].length
        continue
      }
    }

    // Strings
    if (rule.stringDelims.includes(ch)) {
      let j = i + 1
      while (j < len) {
        if (code[j] === '\\') {
          j += 2
          continue
        }
        if (code[j] === ch) {
          j += 1
          break
        }
        j += 1
      }
      out += span('string', code.slice(i, j))
      i = j
      continue
    }

    // HTML / JSX tags
    if (rule.markup && ch === '<' && /[a-zA-Z/]/.test(code[i + 1] ?? '')) {
      const tagMatch = /^<\/?[a-zA-Z0-9.:-]+/.exec(code.slice(i))
      if (tagMatch) {
        out += escapeHtml(tagMatch[0].slice(0, tagMatch[0].startsWith('</') ? 2 : 1))
        out += span('tag', tagMatch[0].slice(tagMatch[0].startsWith('</') ? 2 : 1))
        i += tagMatch[0].length
        continue
      }
    }

    // Numbers
    if (/[0-9]/.test(ch) && (i === 0 || !/[a-zA-Z0-9_$]/.test(code[i - 1]))) {
      const numMatch = /^(?:0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|[0-9][0-9_]*(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?)/.exec(
        code.slice(i),
      )
      if (numMatch) {
        out += span('number', numMatch[0])
        i += numMatch[0].length
        continue
      }
    }

    // Identifiers / keywords / types / function calls
    if (/[a-zA-Z_$]/.test(ch)) {
      const idMatch = /^[a-zA-Z0-9_$-]+/.exec(code.slice(i))
      if (idMatch) {
        const word = idMatch[0]
        const lookup = isSql ? word.toUpperCase() : word
        const nextChar = code[i + word.length]
        if (rule.keywords.has(lookup)) {
          out += span('keyword', word)
        } else if (rule.types.has(lookup)) {
          out += span('type', word)
        } else if (nextChar === '(') {
          out += span('fn', word)
        } else {
          out += escapeHtml(word)
        }
        i += word.length
        continue
      }
    }

    // Operators
    if ('=+-*/<>!&|^%~?:'.includes(ch)) {
      out += span('operator', ch)
      i += 1
      continue
    }

    out += escapeHtml(ch)
    i += 1
  }

  return out
}
