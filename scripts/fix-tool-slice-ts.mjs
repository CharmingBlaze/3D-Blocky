import fs from 'fs'

const path = 'src/store/toolActivationSlice.ts'
let t = fs.readFileSync(path, 'utf8')
const start = t.indexOf('  return {')
const end = t.lastIndexOf('  }\n}')
const head = t.slice(0, start)
const tail = t.slice(end)
let body = t.slice(start, end)

body = body.replace(/\bset\(/g, 'setPartial(')

// Fix applyObjectTransformModalPreview — cast state for objects
body = body.replace(
  /setPartial\(\(s\) => \(\{\s*objects: s\.objects\.map\(\(o\) => \{/,
  `setPartial((s) => {
        const st = s as unknown as ToolStore
        return {
          objects: st.objects.map((o) => {`
)
body = body.replace(
  /(\s+\}\),\s+\}\)\),\s+\n\s+\},\s+\n\s+beginObjectTransformModal:)/,
  `
          }),
        }
      })
    },

    beginObjectTransformModal:`
)

// Use clearVectorDraftState in stroke/extrude cases
body = body.replace(
  /activePrimitiveKind: null,\s*primitiveBoxDraft: null,\s*vectorDraft: \[\],\s*vectorIsDrawing: false,\s*vectorDraftView: null,\s*vectorPenDraft: null,\s*\.\.\.clearStrokeDraftState\(\)/g,
  '...clearVectorDraftState(),\n            ...clearStrokeDraftState()'
)

fs.writeFileSync(path, head + body + tail)
console.log('fixed toolActivationSlice setPartial usage')
