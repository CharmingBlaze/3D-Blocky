/** Return the complete UV island connected to a seed face through shared UV edges. */
export function connectedUvFaces(faceUvIndices: number[][], seedFace: number): number[] {
  if (!faceUvIndices[seedFace]) return []
  const edgeFaces = new Map<string, number[]>()
  for (let fi = 0; fi < faceUvIndices.length; fi++) {
    const face = faceUvIndices[fi]
    if (!face || face.length < 2) continue
    for (let i = 0; i < face.length; i++) {
      const a = face[i]!
      const b = face[(i + 1) % face.length]!
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const list = edgeFaces.get(key)
      if (list) list.push(fi)
      else edgeFaces.set(key, [fi])
    }
  }

  const visited = new Set<number>([seedFace])
  const queue = [seedFace]
  while (queue.length) {
    const fi = queue.shift()!
    const face = faceUvIndices[fi]!
    for (let i = 0; i < face.length; i++) {
      const a = face[i]!
      const b = face[(i + 1) % face.length]!
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      for (const neighbor of edgeFaces.get(key) ?? []) {
        if (visited.has(neighbor)) continue
        visited.add(neighbor)
        queue.push(neighbor)
      }
    }
  }
  return [...visited].sort((a, b) => a - b)
}
