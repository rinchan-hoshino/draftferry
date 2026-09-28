const OWNER_KINDS = {
  vue2: 'vue2',
  vue3: 'vue3',
  reactFiber: 'reactFiber',
  reactProps: 'reactProps',
}

const FRAMEWORK_GRAPH_EDGES = [
  '$parent',
  '_data',
  'ctx',
  'current',
  'data',
  'editor',
  'editorRef',
  'exposed',
  'memoizedProps',
  'memoizedState',
  'next',
  'parent',
  'pendingProps',
  'props',
  'proxy',
  'quill',
  'ref',
  'return',
  'setupState',
  'stateNode',
  'value',
]

// Follow references owned by the associated component, including application-
// named instance fields and React memo tuples. Never walk into sibling/child
// component trees, alternate renders, constructors, or framework back-pointers.
const EXCLUDED_GRAPH_EDGES = new Set([
  'child', 'children', 'sibling', 'alternate',
  'constructor', 'prototype', '__proto__',
  '_reactInternals', '_reactInternalFiber', '__reactInternalMemoizedMaskedChildContext',
])

function frameworkOwnerKind(name) {
  if (name === '__vue__') return OWNER_KINDS.vue2
  if (name === '__vueParentComponent') return OWNER_KINDS.vue3
  if (/^__reactFiber\$|^__reactInternalInstance\$/.test(name)) return OWNER_KINDS.reactFiber
  if (/^__reactProps\$/.test(name)) return OWNER_KINDS.reactProps
  return null
}

function dataProperty(object, name) {
  let current = object
  for (let depth = 0; current && depth < 6; depth += 1) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(current, name)
      if (descriptor) return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
      current = Object.getPrototypeOf(current)
    } catch {
      return undefined
    }
  }
  return undefined
}

function isMethod(object, name) {
  return typeof dataProperty(object, name) === 'function'
}

function apiKind(object) {
  if (
    isMethod(object, 'getContents')
    && isMethod(object, 'setContents')
    && isMethod(object, 'getLength')
  ) {
    const clipboard = dataProperty(object, 'clipboard')
    if (clipboard && isMethod(clipboard, 'dangerouslyPasteHTML')) return 'quill'
  }
  if (
    isMethod(object, 'getHtml')
    && isMethod(object, 'setHtml')
    && isMethod(object, 'clear')
    && isMethod(object, 'dangerouslyInsertHtml')
  ) return 'wang-editor'
  if (isMethod(object, 'create') && isMethod(object, 'destroy') && isMethod(object, 'initSelection')) {
    try {
      // These are constructor-owned fields in legacy wangEditor. Like Quill's
      // root, the userscript bridge can expose them without own descriptors.
      if (isMethod(object.txt, 'html') && object.$textElem) return 'wang-editor-legacy'
    } catch { /* An inaccessible editor is not an import candidate. */ }
  }
  return null
}

export function isValidatedQuillApi(object) {
  return apiKind(object) === 'quill'
}

function candidateRelation(candidate, target, kind) {
  if (kind === 'wang-editor-legacy') {
    try {
      if ((candidate.$textElem.elems?.[0] ?? candidate.$textElem[0]) === target) {
        return 'wang-editor-root'
      }
    } catch { /* Keep the weaker owner relation for diagnostics only. */ }
  }
  if (kind === 'quill') {
    if (dataProperty(candidate, 'root') === target) return 'quill-root'
    const container = dataProperty(candidate, 'container')
    try {
      const Node = target.ownerDocument?.defaultView?.Node
      const nativeContains = dataProperty(Node?.prototype, 'contains')
      if (
        Node
        && container instanceof Node
        && typeof nativeContains === 'function'
        && nativeContains.call(container, target)
      ) return 'quill-container'
    } catch {
      // A relation obtained through the framework owner is still bounded to an ancestor.
    }
  }
  return 'framework-owner'
}

function isTraversable(value, targetWindow) {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false
  try {
    if (value === targetWindow || value === targetWindow?.document) return false
    if (targetWindow?.Node && value instanceof targetWindow.Node) return false
  } catch {
    return false
  }
  return true
}

function traversableEdgeValues(value, targetWindow, budget) {
  const values = []
  let names
  try { names = Object.getOwnPropertyNames(value) } catch { return values }
  if (names.length > 200) budget.truncated = true
  // Known owner/state paths go first; private scalar values and accessors are
  // neither followed nor included in diagnostics.
  for (const name of new Set([...FRAMEWORK_GRAPH_EDGES, ...names.slice(0, 200)])) {
    if (EXCLUDED_GRAPH_EDGES.has(name)) continue
    let descriptor
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, name)
    } catch {
      continue
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue
    if (!isTraversable(descriptor.value, targetWindow)) continue
    values.push(descriptor.value)
  }
  return values
}

function scanOwnerReference(reference, context) {
  const queue = [{ value: reference, depth: 0 }]
  while (queue.length > 0) {
    if (context.objectSeen.size >= context.maxObjects) {
      context.budget.truncated = true
      break
    }
    const current = queue.shift()
    if (
      !isTraversable(current.value, context.targetWindow)
      || context.objectSeen.has(current.value)
    ) continue
    context.objectSeen.add(current.value)

    const kind = apiKind(current.value)
    if (kind && !context.candidateObjects.has(current.value)) {
      context.candidateObjects.add(current.value)
      context.candidates.push({
        ownerKind: context.ownerKind,
        ancestorDepth: context.ancestorDepth,
        apiKind: kind,
        discoveryDepth: current.depth,
        relation: candidateRelation(current.value, context.target, kind),
      })
      context.onCandidate?.(current.value, kind, candidateRelation(current.value, context.target, kind))
    }
    if (kind) continue
    const edgeValues = traversableEdgeValues(current.value, context.targetWindow, context.budget)
    if (current.depth >= context.maxDepth) {
      if (edgeValues.some((value) => !context.objectSeen.has(value))) {
        context.budget.truncated = true
      }
      continue
    }
    for (const value of edgeValues) {
      queue.push({ value, depth: current.depth + 1 })
    }
  }
}

function scanFrameworkInstances(target, options = {}, onCandidate) {
  const maxAncestors = options.maxAncestors ?? 8
  const ownerCounts = {
    vue2: 0,
    vue3: 0,
    reactFiber: 0,
    reactProps: 0,
  }
  const candidates = []
  const candidateObjects = new Set()
  const objectSeen = new Set()
  const budget = { truncated: false }
  const maxObjects = options.maxObjects ?? 200
  const maxOwners = options.maxOwners ?? 40
  let ownerCount = 0
  let element = target
  for (let ancestorDepth = 0; element && ancestorDepth <= maxAncestors; ancestorDepth += 1) {
    let names
    try {
      names = Object.getOwnPropertyNames(element)
    } catch {
      names = []
    }
    for (const name of names) {
      const ownerKind = frameworkOwnerKind(name)
      if (!ownerKind) continue
      let descriptor
      try {
        descriptor = Object.getOwnPropertyDescriptor(element, name)
      } catch {
        continue
      }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue
      if (ownerCount >= maxOwners) {
        budget.truncated = true
        continue
      }
      ownerCount += 1
      ownerCounts[ownerKind] += 1
      scanOwnerReference(descriptor.value, {
        target,
        targetWindow: target.ownerDocument?.defaultView,
        ownerKind,
        ancestorDepth,
        candidates,
        candidateObjects,
        objectSeen,
        budget,
        maxDepth: options.maxDepth ?? 20,
        maxObjects,
        onCandidate,
      })
    }
    element = element.parentElement
  }
  return { ownerCounts, candidates, truncated: budget.truncated }
}

export function collectFrameworkInstances(target, options = {}) {
  return scanFrameworkInstances(target, options)
}

export function findLegacyWangEditor(target) {
  const instances = []
  scanFrameworkInstances(target, {}, (instance, kind, relation) => {
    if (kind === 'wang-editor-legacy' && relation === 'wang-editor-root') instances.push(instance)
  })
  // Truncation describes the surrounding framework graph, not this API's
  // identity. Exact DOM-root equality is required even when that graph is large.
  return instances.length === 1 ? instances[0] : null
}
