/** Normalized texture coordinates (0–1). */
export interface Uv2 {
  u: number
  v: number
}

export function uv2(u: number, v: number): Uv2 {
  return { u, v }
}

export function cloneUv2(uv: Uv2): Uv2 {
  return { u: uv.u, v: uv.v }
}
