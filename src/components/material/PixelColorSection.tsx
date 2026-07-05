import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../../store/appStore'
import { ColorPickerSection } from './ColorPickerSection'

/** Pixel Editor — pen color for texture painting only (not object material). */
export function PixelColorSection() {
  const {
    pixelEditorColor,
    pixelEditorPaletteId,
    pixelEditorCustomPalettes,
    setPixelEditorColorLive,
    commitPixelEditorColor,
    setPixelEditorPaletteId,
    addPixelEditorPaletteSwatch,
    generatePixelHarmonyPalette,
  } = useAppStore(
    useShallow((s) => ({
      pixelEditorColor: s.pixelEditorColor,
      pixelEditorPaletteId: s.pixelEditorPaletteId,
      pixelEditorCustomPalettes: s.pixelEditorCustomPalettes,
      setPixelEditorColorLive: s.setPixelEditorColorLive,
      commitPixelEditorColor: s.commitPixelEditorColor,
      setPixelEditorPaletteId: s.setPixelEditorPaletteId,
      addPixelEditorPaletteSwatch: s.addPixelEditorPaletteSwatch,
      generatePixelHarmonyPalette: s.generatePixelHarmonyPalette,
    }))
  )

  return (
    <ColorPickerSection
      color={pixelEditorColor}
      paletteId={pixelEditorPaletteId}
      customPalettes={pixelEditorCustomPalettes}
      onChange={setPixelEditorColorLive}
      onCommit={commitPixelEditorColor}
      onPaletteIdChange={setPixelEditorPaletteId}
      onAddSwatch={addPixelEditorPaletteSwatch}
      onHarmony={generatePixelHarmonyPalette}
      hintLabel="Pen"
    />
  )
}
