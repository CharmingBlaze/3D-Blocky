try {
  const mod = await import('./src/store/appStore.ts')
  console.log('appStore ok', typeof mod.useAppStore)
} catch (e) {
  console.error('FAIL', e)
}
