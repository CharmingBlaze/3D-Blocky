import fs from 'fs'

let t = fs.readFileSync('src/store/vectorToolsSlice.ts', 'utf8')
const start = t.indexOf('  return {')
const end = t.lastIndexOf('  }\n}')
const head = t.slice(0, start)
const tail = t.slice(end)
let body = t.slice(start, end)

body = body.replace(/\bset\(/g, 'setPartial(')
// undo accidental replacement inside setPartial definition
body = body.replace(
  /const setPartial = \(partial: object \| \(\(state: T\) => object\)\) => \{\s*if \(typeof partial === 'function'\) \{\s*setPartial\(/,
  "const setPartial = (partial: object | ((state: T) => object)) => {\n    if (typeof partial === 'function') {\n      set("
)
body = body.replace(
  /\} else \{\s*setPartial\(partial as unknown as Partial<T>\)/,
  '} else {\n      set(partial as unknown as Partial<T>'
)
body = body.replace(/\} = get\(\)/g, '} = store()')

for (const m of [
  'addObject',
  'commitHistory',
  'clearExtrudeDrag',
  'penFinishPath',
  'commitPenPath',
  'commitVectorPath',
  'commitVectorShape',
  'penCancelPath',
  'commitPrimitiveBox',
]) {
  body = body.replaceAll(`get().${m}`, `store().${m}`)
}

body = body.replace(
  /if \(!s\.vectorIsDrawing \|\| s\.vectorDraft\.length === 0\) return s/,
  'if (!s.vectorIsDrawing || s.vectorDraft.length === 0) return {}'
)
body = body.replace(
  /if \(s\.activeTool !== 'vector-shape'\) return s/,
  "if ((s as VectorStore).activeTool !== 'vector-shape') return {}"
)

fs.writeFileSync('src/store/vectorToolsSlice.ts', head + body + tail)
console.log('replaced set with setPartial')
