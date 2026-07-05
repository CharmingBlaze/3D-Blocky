import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../../store/appStore'
import { ColorPickerSection } from './ColorPickerSection'

/** Material Editor — recolors selected mesh/material. */
export function MaterialColorSection() {
  const {
    materialEditorColor,
    materialEditorPaletteId,
    materialEditorCustomPalettes,
    setMaterialEditorColorLive,
    commitMaterialEditorColor,
    setMaterialEditorPaletteId,
    addCustomPaletteSwatch,
    generateMaterialHarmonyPalette,
  } = useAppStore(
    useShallow((s) => ({
      materialEditorColor: s.materialEditorColor,
      materialEditorPaletteId: s.materialEditorPaletteId,
      materialEditorCustomPalettes: s.materialEditorCustomPalettes,
      setMaterialEditorColorLive: s.setMaterialEditorColorLive,
      commitMaterialEditorColor: s.commitMaterialEditorColor,
      setMaterialEditorPaletteId: s.setMaterialEditorPaletteId,
      addCustomPaletteSwatch: s.addCustomPaletteSwatch,
      generateMaterialHarmonyPalette: s.generateMaterialHarmonyPalette,
    }))
  )

  return (
    <ColorPickerSection
      color={materialEditorColor}
      paletteId={materialEditorPaletteId}
      customPalettes={materialEditorCustomPalettes}
      onChange={setMaterialEditorColorLive}
      onCommit={commitMaterialEditorColor}
      onPaletteIdChange={setMaterialEditorPaletteId}
      onAddSwatch={addCustomPaletteSwatch}
      onHarmony={generateMaterialHarmonyPalette}
      hintLabel="Material"
    />
  )
}
