try {
  const mod = await import('./src/store/vectorToolsSlice.ts')
  console.log('vectorToolsSlice keys sample', Object.keys(mod).slice(0, 20))
} catch (e) {
  console.error('FAIL', e)
}
