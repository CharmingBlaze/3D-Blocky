import fs from 'fs'

const path = 'src/store/uvEditorSlice.ts'
let t = fs.readFileSync(path, 'utf8')
const start = t.indexOf('  return {')
const end = t.lastIndexOf('  }\n}')
const head = t.slice(0, start)
const tail = t.slice(end)
let body = t.slice(start, end)

body = body.replace(/\bset\(/g, 'setPartial(')

// Cross-slice object patches
body = body.replace(
  /setPartial\(\(s\) => \(\{\s*objects: s\.objects\.map\(\(o\) => \(o\.id === objectId \? updated : o\)\),\s*\}\)\)/g,
  `setPartial((s) => {
        const st = s as unknown as UvStore
        return {
          objects: st.objects.map((o) => (o.id === objectId ? updated : o)),
        }
      })`
)

body = body.replace(
  /setPartial\(\(s\) => \(\{\s*objects: s\.objects\.map\(\(o\) =>\s*\n\s*o\.id === objectId \? \{ \.\.\.ensureObjectUVs\(o\), uvs, faceUvIndices: ensured\.faceUvIndices \} : o\s*\),\s*\}\)\)/g,
  `setPartial((s) => {
        const st = s as unknown as UvStore
        return {
          objects: st.objects.map((o) =>
            o.id === objectId ? { ...ensureObjectUVs(o), uvs, faceUvIndices: ensured.faceUvIndices } : o
          ),
        }
      })`
)

body = body.replace(
  /setPartial\(\(s\) => \(\{\s*objects: s\.objects\.map\(\(o\) =>\s*\n\s*o\.id === objectId\s*\n\s*\? \{ \.\.\.o, uvs, faceUvIndices, uvAutoPacked: uvAutoPacked \?\? true \}\s*\n\s*: o\s*\),\s*\}\)\)/g,
  `setPartial((s) => {
        const st = s as unknown as UvStore
        return {
          objects: st.objects.map((o) =>
            o.id === objectId
              ? { ...o, uvs, faceUvIndices, uvAutoPacked: uvAutoPacked ?? true }
              : o
          ),
        }
      })`
)

fs.writeFileSync(path, head + body + tail)
console.log('fixed uvEditorSlice setPartial usage')
