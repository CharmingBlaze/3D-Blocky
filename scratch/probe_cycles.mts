import madge from 'madge'
const res = await madge('src/store/vectorToolsSlice.ts', { fileExtensions: ['ts', 'tsx'], detectiveOptions: { ts: { skipTypeImports: true } } })
const cycles = res.circular()
const involving = cycles.filter(c => c.some(f => f.includes('vectorSource') || f.includes('vectorTools')))
console.log('cycles with vector*', involving.length)
for (const c of involving.slice(0, 20)) console.log(c.join(' -> '))
console.log('total cycles', cycles.length)
