import fs from 'fs'

const path = 'src/store/sceneSettingsSlice.ts'
let t = fs.readFileSync(path, 'utf8')
const start = t.indexOf('  return {')
const end = t.lastIndexOf('  }\n}')
const head = t.slice(0, start)
const tail = t.slice(end)
let body = t.slice(start, end)

body = body.replace(/\bset\(/g, 'setPartial(')

// setActiveColor / sculpt object updates
body = body.replace(
  /setPartial\(\{\s*objects: paintColorOnObjects\(/g,
  'setPartial((s) => {\n        const st = s as unknown as SettingsStore\n        return {\n          objects: paintColorOnObjects(\n            st.objects,'
)

// Fix first paintColorOnObjects block - it used `objects` from state
body = body.replace(
  /objects: paintColorOnObjects\(\s*objects,/g,
  'objects: paintColorOnObjects(\n            st.objects,'
)

// applySculptAt objects map
body = body.replace(
  /setPartial\(\(s\) => \(\{\s*objects: s\.objects\.map\(\(o\) => \(o\.id === targetId \? updated : o\)\),\s*\}\)\)/,
  `setPartial((s) => {
        const st = s as unknown as SettingsStore
        return {
          objects: st.objects.map((o) => (o.id === targetId ? updated : o)),
        }
      })`
)

body = body.replace(
  /setPartial\(\(s\) => \(\{\s*objects: s\.objects\.map\(\(o\) => \(o\.id === targetId \? updated : o\)\),\s*\}\)\),\s*\n\s+store\(\)\.commitHistory\('Simplify'\)/,
  `setPartial((s) => {
        const st = s as unknown as SettingsStore
        return {
          objects: st.objects.map((o) => (o.id === targetId ? updated : o)),
        }
      })
      store().commitHistory('Simplify')`
)

fs.writeFileSync(path, head + body + tail)
console.log('fixed sceneSettingsSlice setPartial usage')
