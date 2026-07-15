import { prepareSceneObject } from '../mesh/objectTransform'
import { generateId, type Vec3 } from '../utils/math'
import {
  DEFAULT_IMAGE_WORLD_WIDTH,
  DEFAULT_REFERENCE_WIDTH,
  type BillboardImage,
  type ImageDropMode,
  type ReferenceImage,
} from '../images/imageDropTypes'
import { loadImageFile } from '../images/loadImageFile'
import { createEditableImagePlaneObject } from '../images/createTexturedPlane'
import { importImageAsNewDocument } from '../pixel/pixelEditorSlice'
import { setObjectMaterialMode } from '../material/materialEditorSlice'
import type { PixelDocument } from '../pixel/pixelTypes'
import type { ViewType } from '../scene/viewTypes'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { MeshComponentSelection } from '../mesh/meshSelection'
import type { UvTextureInfo } from './appStore'

export type { ImageDropMode, ReferenceImage, BillboardImage } from '../images/imageDropTypes'

export interface ImageDropLayoutState {
  imageDropMode: ImageDropMode
  referenceImages: ReferenceImage[]
  selectedReferenceImageId: string | null
  billboardImages: BillboardImage[]
  selectedBillboardImageId: string | null
}

export interface ImageDropLayoutActions {
  setImageDropMode: (mode: ImageDropMode) => void
  dropImageInView: (
    view: ViewType,
    file: File,
    world: Vec3,
    referenceNorm: { x: number; y: number }
  ) => Promise<void>
  selectReferenceImage: (id: string | null) => void
  updateReferenceImage: (id: string, patch: Partial<ReferenceImage>) => void
  commitReferenceImageEdit: () => void
  removeReferenceImage: (id: string) => void
  selectBillboardImage: (id: string | null) => void
  updateBillboardImage: (id: string, patch: Partial<BillboardImage>) => void
  commitBillboardImageEdit: () => void
  removeBillboardImage: (id: string) => void
  deleteSelectedImageDrop: () => void
}

export type ImageDropSlice = ImageDropLayoutState & ImageDropLayoutActions

export const imageDropInitialState: ImageDropLayoutState = {
  /** Default: empty-space drops create a selectable, editable image mesh. */
  imageDropMode: 'textured-plane',
  referenceImages: [],
  selectedReferenceImageId: null,
  billboardImages: [],
  selectedBillboardImageId: null,
}

export interface ImageDropSliceDeps {
  reconcileBlobUrls: () => void
  addObject: (
    obj: SceneObject,
    options?: { skipHistory?: boolean; skipSymmetry?: boolean }
  ) => void
  updateObject: (id: string, updates: Partial<SceneObject>) => void
}

type ImageDropStore = ImageDropLayoutState & {
  objectTextures: Record<string, UvTextureInfo>
  pixelDocuments: Record<string, PixelDocument>
  pixelEditorDocId: string | null
  pixelTextureRevision: number
  selectedObjectId: string | null
  selectionObjectIds: string[]
  meshSelection: MeshComponentSelection | null
  commitHistory: (label?: string) => boolean
}

export function createImageDropSlice<T extends ImageDropLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & ImageDropLayoutActions,
  deps: ImageDropSliceDeps
): ImageDropLayoutActions {
  const store = () => get() as T & ImageDropLayoutActions & ImageDropStore
  const setPartial = (partial: object | ((state: T) => object)) => {
    if (typeof partial === 'function') {
      set((state) => partial(state) as Partial<T>)
    } else {
      set(partial as unknown as Partial<T>)
    }
  }

  const clearObjectSelection = {
    selectedObjectId: null as string | null,
    selectionObjectIds: [] as string[],
    meshSelection: null as MeshComponentSelection | null,
  }

  return {
    setImageDropMode: (mode) => setPartial({ imageDropMode: mode }),

    dropImageInView: async (view, file, world, referenceNorm) => {
      const mode = store().imageDropMode
      if (mode === 'off') return

      if (mode === 'textured-plane') {
        // Same import path as UV/material texture load so Pixel + UV editors work.
        const { docs, docId } = await importImageAsNewDocument(store().pixelDocuments, file)
        const doc = docs[docId]!
        const name = file.name.replace(/\.[^.]+$/, '') || 'Image'
        const obj = createEditableImagePlaneObject(
          name,
          view,
          world,
          DEFAULT_IMAGE_WORLD_WIDTH,
          doc.width,
          doc.height,
          docId
        )
        // Same material path as Material/UV "Import texture…" (mode + textureId).
        const textured = setObjectMaterialMode(obj, 'texture', docId)
        const prepared = prepareSceneObject({
          ...textured,
          material: {
            ...textured.material!,
            textureWrap: 'clamp',
            textureRepeat: [1, 1],
            textureOffset: [0, 0],
            textureRotation: 0,
            textureTint: [1, 1, 1, 1],
            textureTintStrength: 0,
            opacity: 1,
            // Dual faces already cover both sides; FrontSide avoids z-fighting over alpha holes.
            doubleSided: false,
          },
        })
        setPartial((s) => {
          const st = s as unknown as ImageDropStore
          return {
            pixelDocuments: docs,
            pixelEditorDocId: docId,
            objectTextures: {
              ...st.objectTextures,
              [docId]: {
                url: '',
                name,
                width: doc.width,
                height: doc.height,
              },
            },
            pixelTextureRevision: st.pixelTextureRevision + 1,
            selectedReferenceImageId: null,
            selectedBillboardImageId: null,
          }
        })
        deps.addObject(prepared, { skipHistory: true, skipSymmetry: true })
        // addObject stamps drawDoubleSided — keep FrontSide dual-face image cards.
        const mat = prepared.material
        if (mat) {
          deps.updateObject(prepared.id, {
            material: {
              ...mat,
              mode: 'texture',
              textureId: docId,
              textureWrap: 'clamp',
              textureRepeat: [1, 1],
              textureOffset: [0, 0],
              textureRotation: 0,
              textureTint: [1, 1, 1, 1],
              textureTintStrength: 0,
              opacity: 1,
              doubleSided: false,
            },
          })
        }
        deps.reconcileBlobUrls()
        store().commitHistory('Image plane')
        return
      }

      const loaded = await loadImageFile(file)
      const aspect = loaded.width / Math.max(loaded.height, 1)

      if (mode === 'reference') {
        const id = generateId()
        setPartial((s) => ({
          referenceImages: [
            ...s.referenceImages,
            {
              id,
              view,
              url: loaded.url,
              name: loaded.name,
              x: referenceNorm.x,
              y: referenceNorm.y,
              width: DEFAULT_REFERENCE_WIDTH,
              aspect,
              opacity: 0.55,
            },
          ],
          selectedReferenceImageId: id,
          selectedBillboardImageId: null,
        }))
        deps.reconcileBlobUrls()
        store().commitHistory('Reference image')
        return
      }

      if (mode === 'billboard') {
        const id = generateId()
        setPartial((s) => ({
          billboardImages: [
            ...s.billboardImages,
            {
              id,
              url: loaded.url,
              name: loaded.name,
              position: { ...world },
              rotation: { x: 0, y: 0, z: 0 },
              width: DEFAULT_IMAGE_WORLD_WIDTH,
              height: DEFAULT_IMAGE_WORLD_WIDTH / aspect,
              opacity: 0.92,
            },
          ],
          selectedBillboardImageId: id,
          selectedReferenceImageId: null,
        }))
        deps.reconcileBlobUrls()
        store().commitHistory('Billboard image')
      }
    },

    selectReferenceImage: (id) =>
      setPartial({
        selectedReferenceImageId: id,
        selectedBillboardImageId: null,
        ...(id ? clearObjectSelection : {}),
      }),

    updateReferenceImage: (id, patch) =>
      setPartial((s) => ({
        referenceImages: s.referenceImages.map((img) =>
          img.id === id ? { ...img, ...patch } : img
        ),
      })),

    commitReferenceImageEdit: () => {
      if (store().referenceImages.length === 0) return
      store().commitHistory('Edit reference image')
    },

    removeReferenceImage: (id) => {
      const img = store().referenceImages.find((r) => r.id === id)
      if (!img) return
      setPartial((s) => ({
        referenceImages: s.referenceImages.filter((r) => r.id !== id),
        selectedReferenceImageId:
          s.selectedReferenceImageId === id ? null : s.selectedReferenceImageId,
      }))
      deps.reconcileBlobUrls()
      store().commitHistory('Remove reference image')
    },

    selectBillboardImage: (id) =>
      setPartial({
        selectedBillboardImageId: id,
        selectedReferenceImageId: null,
        ...(id ? clearObjectSelection : {}),
      }),

    updateBillboardImage: (id, patch) =>
      setPartial((s) => ({
        billboardImages: s.billboardImages.map((bb) =>
          bb.id === id ? { ...bb, ...patch } : bb
        ),
      })),

    commitBillboardImageEdit: () => {
      if (store().billboardImages.length === 0) return
      store().commitHistory('Edit billboard')
    },

    removeBillboardImage: (id) => {
      const bb = store().billboardImages.find((b) => b.id === id)
      if (!bb) return
      setPartial((s) => ({
        billboardImages: s.billboardImages.filter((b) => b.id !== id),
        selectedBillboardImageId:
          s.selectedBillboardImageId === id ? null : s.selectedBillboardImageId,
      }))
      deps.reconcileBlobUrls()
      store().commitHistory('Remove billboard')
    },

    deleteSelectedImageDrop: () => {
      const { selectedReferenceImageId, selectedBillboardImageId } = store()
      if (selectedReferenceImageId) {
        store().removeReferenceImage(selectedReferenceImageId)
        return
      }
      if (selectedBillboardImageId) {
        store().removeBillboardImage(selectedBillboardImageId)
      }
    },
  }
}
