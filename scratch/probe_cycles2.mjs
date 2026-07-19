import fs from 'fs'
import path from 'path'

const root = 'src/vector/vectorSource.ts'
const typeOnly = /^\s*import\s+type\s/
const skipType = /import\s+type\s*\{/
const importRe = /from\s+['\"](\.[^'\"]+)['\"]/g

function resolve(from, spec) {
  const base = path.resolve(path.dirname(from), spec)
  for (const ext of ['.ts', '.tsx', '/index.ts']) {
    if (fs.existsSync(base + ext)) return path.normalize(base + ext)
    if (fs.existsSync(base) && base.endsWith(ext)) return path.normalize(base)
  }
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return path.normalize(base)
  return null
}

const seen = new Set()
const stack = []
const cycles = []

function walk(file) {
  const norm = path.normalize(file)
  if (seen.has(norm)) return
  if (stack.includes(norm)) {
    cycles.push([...stack.slice(stack.indexOf(norm)), norm])
    return
  }
  if (!fs.existsSync(norm)) return
  seen.add(norm)
  stack.push(norm)
  const src = fs.readFileSync(norm, 'utf8')
  const lines = src.split(/\r?\n/)
  for (const line of lines) {
    if (typeOnly.test(line) || /^\s*import\s+type\b/.test(line)) continue
    // skip import type { ... }
    if (/^\s*import\s+type\s*\{/.test(line)) continue
    // handle mixed: import { type X, y } - treat as value import
    let m
    const re = /from\s+['\"](\.[^'\"]+)['\"]/g
    while ((m = re.exec(line))) {
      // if entire import is type-only form
      if (/^\s*import\s+type\b/.test(line)) continue
      const resolved = resolve(norm, m[1])
      if (resolved && resolved.endsWith('.ts') || (resolved && resolved.endsWith('.tsx'))) walk(resolved)
    }
  }
  stack.pop()
}

walk(root)
const hit = cycles.filter(c => c.some(f => /vectorToolsSlice|appStore/.test(f)))
console.log('files visited', seen.size)
console.log('cycles', cycles.length)
console.log('cycles hitting store', hit.length)
for (const c of hit.slice(0, 15)) console.log(c.map(f => path.relative('src', f)).join(' -> '))
// also show if appStore/vectorTools visited
console.log('visited appStore', [...seen].some(f => /appStore/.test(f)))
console.log('visited vectorTools', [...seen].some(f => /vectorToolsSlice/.test(f)))
