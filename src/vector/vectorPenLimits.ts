/** Low-poly capsule targets for vector pen commits (shape-accurate, not dense). */
export const VECTOR_PEN_POLY_BUDGET = 384
export const VECTOR_PEN_MAX_BOUNDARY_VERTS = 24
export const VECTOR_PEN_MAX_PATH_SAMPLES = 18
export const VECTOR_PEN_RADIAL_SEGMENTS = 8
export const VECTOR_PEN_MIN_ANGLE_DEG = 12
/** Bézier flatten tolerance in view units — keeps corners, avoids micro-segments. */
export const VECTOR_PEN_FLATTEN_ERROR = 0.75
/** Finer flatten for lathe — keeps Bézier curves closer to the drawn path. */
export const VECTOR_PEN_LATHE_FLATTEN_ERROR = 0.38
