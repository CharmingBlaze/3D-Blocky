/**
 * Viewport grid cell size in scene units ({@link ViewportGrid} uses the same value).
 * glTF/Blender treat 1 exported unit as 1 meter, so we map one grid cell → 1 meter.
 */
export const SCENE_GRID_CELL = 8

/** Multiply baked world positions by this before writing GLB/OBJ/STL. */
export const EXPORT_UNIT_SCALE = 1 / SCENE_GRID_CELL
