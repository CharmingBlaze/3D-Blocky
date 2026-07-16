import type {
  ActiveTool,
  DrawInputMode,
  PolyDrawMode,
  PrimitiveKind,
  SelectionMode,
  StrokeMode,
  ToolCategory,
} from '../store/appStore'
import type { ShapeKind } from '../vector/types'

export type ToolRingEntry =
  | { kind: 'tool'; tool: ActiveTool; label: string; selectionMode?: SelectionMode }
  | { kind: 'primitive'; primitive: PrimitiveKind; label: string }
  | { kind: 'shape'; shape: ShapeKind; label: string }
  | { kind: 'polyMode'; mode: PolyDrawMode; label: string }
  | { kind: 'stroke'; mode: StrokeMode; label: string }
  | { kind: 'drawInput'; mode: DrawInputMode; label: string }
  | { kind: 'action'; id: string; label: string }

export const TOOL_RING_CATEGORIES: { id: ToolCategory; label: string }[] = [
  { id: 'draw', label: 'Draw' },
  { id: 'create', label: 'Create' },
  { id: 'vector', label: 'Vector' },
  { id: 'sculpt', label: 'Sculpt' },
  { id: 'select', label: 'Select' },
  { id: 'transform', label: 'Transform' },
  { id: 'mesh', label: 'Mesh' },
  { id: 'boolean', label: 'Modify' },
]

export const TOOL_RING_BRANCHES: Record<ToolCategory, ToolRingEntry[]> = {
  draw: [
    { kind: 'drawInput', mode: 'regular', label: 'Sketch' },
    { kind: 'drawInput', mode: 'vector-pen', label: 'Vector Pen' },
    { kind: 'polyMode', mode: 'poly', label: 'Mesh · Line' },
    { kind: 'polyMode', mode: 'rectangle', label: 'Mesh · Rectangle' },
    { kind: 'polyMode', mode: 'ngon', label: 'Mesh · Polygon' },
    { kind: 'stroke', mode: 'outline', label: 'Stroke · Outline' },
    { kind: 'stroke', mode: 'centerline', label: 'Stroke · Path' },
    { kind: 'stroke', mode: 'blob', label: 'Stroke · Blob' },
    { kind: 'stroke', mode: 'capsule', label: 'Stroke · Capsule' },
    { kind: 'stroke', mode: 'ribbon', label: 'Tool · Ribbon' },
    { kind: 'stroke', mode: 'tapered-tube', label: 'Tool · Tapered Tube' },
    { kind: 'stroke', mode: 'hair-paths', label: 'Stroke · Hair Paths' },
    { kind: 'stroke', mode: 'hair-strips', label: 'Stroke · Hair Strips' },
    { kind: 'stroke', mode: 'hair-round', label: 'Stroke · Rounded Hair' },
    { kind: 'action', id: 'extrude', label: 'Extrude Sketch' },
  ],
  create: [
    { kind: 'primitive', primitive: 'box', label: 'Box' },
    { kind: 'primitive', primitive: 'icosphere', label: 'Icosphere' },
    { kind: 'primitive', primitive: 'sphere', label: 'Sphere' },
    { kind: 'primitive', primitive: 'cylinder', label: 'Cylinder' },
    { kind: 'primitive', primitive: 'capsule', label: 'Capsule' },
    { kind: 'primitive', primitive: 'cone', label: 'Cone' },
    { kind: 'primitive', primitive: 'pyramid', label: 'Pyramid' },
    { kind: 'primitive', primitive: 'doughnut', label: 'Doughnut' },
    { kind: 'primitive', primitive: 'ring', label: 'Ring' },
    { kind: 'primitive', primitive: 'stairs', label: 'Stairs' },
    { kind: 'primitive', primitive: 'star', label: 'Star' },
    { kind: 'primitive', primitive: 'dome', label: 'Dome' },
    { kind: 'primitive', primitive: 'halfCircle', label: 'Half Circle' },
  ],
  vector: [
    { kind: 'drawInput', mode: 'vector-pen', label: 'Pen Tool' },
    { kind: 'shape', shape: 'sphere', label: 'Sphere' },
    { kind: 'shape', shape: 'circle', label: 'Circle' },
    { kind: 'shape', shape: 'box', label: 'Box' },
    { kind: 'shape', shape: 'roundedBox', label: 'Rounded Box' },
    { kind: 'shape', shape: 'plane', label: 'Plane' },
    { kind: 'shape', shape: 'cylinder', label: 'Cylinder' },
    { kind: 'shape', shape: 'capsule', label: 'Capsule' },
    { kind: 'shape', shape: 'pyramid', label: 'Pyramid' },
    { kind: 'shape', shape: 'cone', label: 'Cone' },
  ],
  sculpt: [
    { kind: 'tool', tool: 'push', label: 'Push' },
    { kind: 'tool', tool: 'pull', label: 'Pull' },
    { kind: 'tool', tool: 'inflate', label: 'Inflate' },
    { kind: 'tool', tool: 'deflate', label: 'Deflate' },
    { kind: 'tool', tool: 'relax', label: 'Smooth' },
    { kind: 'tool', tool: 'pinch', label: 'Pinch' },
  ],
  select: [
    { kind: 'tool', tool: 'select-object', label: 'Object', selectionMode: 'object' },
    { kind: 'tool', tool: 'select-vertex', label: 'Vertex', selectionMode: 'vertex' },
    { kind: 'tool', tool: 'select-edge', label: 'Edge', selectionMode: 'edge' },
    { kind: 'tool', tool: 'select-face', label: 'Face', selectionMode: 'face' },
    { kind: 'tool', tool: 'knife', label: 'Knife' },
    { kind: 'tool', tool: 'loop-cut', label: 'Loop Cut' },
  ],
  transform: [
    { kind: 'tool', tool: 'move', label: 'Move (W)' },
    { kind: 'tool', tool: 'rotate', label: 'Rotate (R)' },
    { kind: 'tool', tool: 'scale', label: 'Scale (S)' },
    { kind: 'tool', tool: 'bend', label: 'Bend' },
    { kind: 'action', id: 'select-tool', label: 'Select (G)' },
  ],
  mesh: [
    { kind: 'tool', tool: 'knife', label: 'Knife (K)' },
    { kind: 'tool', tool: 'loop-cut', label: 'Loop Cut (Ctrl+R)' },
    { kind: 'action', id: 'subdivide', label: 'Subdivide' },
    { kind: 'action', id: 'flip-normals', label: 'Flip Normals' },
    { kind: 'action', id: 'double-sided', label: 'Double Sided' },
    { kind: 'action', id: 'subd', label: 'Toggle SubD' },
    { kind: 'action', id: 'shade-flat', label: 'Shade Flat' },
    { kind: 'action', id: 'shade-smooth', label: 'Shade Smooth' },
    { kind: 'action', id: 'uv-editor', label: 'UV Editor' },
    { kind: 'action', id: 'topology-lock', label: 'Topology Lock' },
  ],
  boolean: [
    { kind: 'tool', tool: 'boolean-hole', label: 'Boolean Hole' },
    { kind: 'action', id: 'simplify', label: 'Simplify Mesh' },
    { kind: 'action', id: 'import', label: 'Import…' },
    { kind: 'action', id: 'export', label: 'Export…' },
    { kind: 'action', id: 'copy', label: 'Copy (Ctrl+C)' },
    { kind: 'action', id: 'paste', label: 'Paste (Ctrl+V)' },
    { kind: 'action', id: 'delete', label: 'Delete' },
  ],
}

const SCULPT_TOOLS: ActiveTool[] = ['push', 'pull', 'inflate', 'deflate', 'relax', 'pinch']

export function categoryForActiveTool(tool: ActiveTool, fallback: ToolCategory): ToolCategory {
  if (tool === 'smart') return 'select'
  if (tool === 'extrude') return 'mesh'
  if (tool === 'move' || tool === 'rotate' || tool === 'scale' || tool === 'bend') return 'transform'
  if (SCULPT_TOOLS.includes(tool)) return 'sculpt'
  if (tool === 'boolean-hole') return 'boolean'
  if (tool === 'knife' || tool === 'mirror-knife' || tool === 'loop-cut') return 'mesh'
  if (tool.startsWith('select-')) return 'select'
  if (tool === 'vector-pen' || tool === 'vector-shape') return 'vector'
  if (tool === 'primitive-box' || tool === 'poly-draw' || tool === 'draw') return 'draw'
  return fallback
}

export interface ToolRingStateSlice {
  selectionMode: SelectionMode
  selectionObjectIds: string[]
  selectedObjectId: string | null
  meshSelection: { objectId: string; vertices: number[]; edges: string[]; faces: number[] } | null
  objects: { id: string; topologyLocked?: boolean }[]
  clipboard: unknown[] | null
  uvEditorOpen: boolean
}

export function isToolRingEntryDisabled(state: ToolRingStateSlice, entry: ToolRingEntry): boolean {
  const selectionCount = state.selectionObjectIds.length
  const hasObjectSelection = selectionCount > 0 || !!state.selectedObjectId
  const selectedObj = state.selectedObjectId
    ? state.objects.find((o) => o.id === state.selectedObjectId)
    : selectionCount === 1
      ? state.objects.find((o) => o.id === state.selectionObjectIds[0])
      : undefined
  const topologyLocked = !!selectedObj?.topologyLocked
  const hasMeshComponents =
    state.selectionMode !== 'object' &&
    !!state.meshSelection &&
    (state.meshSelection.vertices.length > 0 ||
      state.meshSelection.edges.length > 0 ||
      state.meshSelection.faces.length > 0)

  if (entry.kind === 'action') {
    switch (entry.id) {
      case 'subdivide':
      case 'subd':
      case 'shade-smooth':
      case 'shade-flat':
        return !hasObjectSelection || topologyLocked
      case 'flip-normals':
      case 'double-sided':
        return state.selectionMode === 'object' || !hasMeshComponents || topologyLocked
      case 'knife':
      case 'loop-cut':
        return !hasObjectSelection
      case 'uv-editor':
        return !state.uvEditorOpen && !hasObjectSelection
      case 'topology-lock':
        return !state.selectedObjectId
      case 'delete':
        return !hasObjectSelection && !hasMeshComponents
      case 'copy':
        return !hasObjectSelection && !hasMeshComponents
      case 'paste':
        return !state.clipboard?.length
      case 'simplify':
        return !hasObjectSelection || topologyLocked
      default:
        return false
    }
  }

  if (entry.kind === 'tool' && (entry.tool === 'knife' || entry.tool === 'loop-cut' || entry.tool === 'bend')) {
    return !hasObjectSelection
  }

  return false
}

export function toolRingEntryKey(entry: ToolRingEntry): string {
  switch (entry.kind) {
    case 'action':
      return entry.id
    case 'tool':
      return entry.tool
    case 'primitive':
      return entry.primitive
    case 'shape':
      return entry.shape
    case 'polyMode':
      return entry.mode
    case 'stroke':
      return entry.mode
    case 'drawInput':
      return entry.mode
    default:
      return 'unknown'
  }
}
