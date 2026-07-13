/** Shared selection rule for clicking authored faces in the UV 3D preview. */
export function resolveUvPreviewFaceSelection(
  current: readonly number[],
  face: number,
  additive: boolean
): number[] {
  if (!additive) return [face]
  if (current.includes(face)) return current.filter((value) => value !== face)
  return [...new Set([...current, face])]
}
