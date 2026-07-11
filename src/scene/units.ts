/**
 * Viewport grid cell size in scene units ({@link ViewportGrid} uses the same value).
 */
export const SCENE_GRID_CELL = 8

/**
 * Real-world length of one grid cell when exported (meters).
 * glTF/Blender treat 1 unit as 1 meter — 10 cm per cell keeps furniture/props
 * Blender-sized instead of building-scale (1 cell = 1 m was ~10× too large).
 */
export const EXPORT_METERS_PER_GRID_CELL = 0.1

/** Multiply baked world positions by this before writing GLB/OBJ/STL. */
export const EXPORT_UNIT_SCALE = EXPORT_METERS_PER_GRID_CELL / SCENE_GRID_CELL
