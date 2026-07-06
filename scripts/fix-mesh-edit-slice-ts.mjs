import fs from 'fs'

const path = 'src/store/meshEditSlice.ts'
let t = fs.readFileSync(path, 'utf8')
const start = t.indexOf('  return {')
const end = t.lastIndexOf('  }\n}')
const head = t.slice(0, start)
const tail = t.slice(end)
let body = t.slice(start, end)

body = body.replace(/\bset\(/g, 'setPartial(')

body = body.replace(
  /setPartial\(\(s\) => \(\{\s*objects: s\.objects\.map\(\(o\) => \{/,
  `setPartial((s) => {
        const st = s as unknown as MeshStore
        return {
          objects: st.objects.map((o) => {`
)

body = body.replace(
  /return \{ \.\.\.o, positions: updated\.positions, faces: updated\.faces \}\s+\}\),\s+\}\)\),\s+\n\s+store\(\)\.commitHistory\(historyLabel\)/,
  `return { ...o, positions: updated.positions, faces: updated.faces }
          }),
        }
      })
      store().commitHistory(historyLabel)`
)

// toggleSubD and subd ops use objects from store() but setPartial with objects.map - fix to use st.objects when inside setPartial with s
body = body.replace(
  /setPartial\(\{\s*objects: objects\.map/g,
  'setPartial({\n        objects: store().objects.map'
)

fs.writeFileSync(path, head + body + tail)
console.log('fixed meshEditSlice setPartial usage')
