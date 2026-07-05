import type { SceneSnapshot } from '../history/sceneHistory'
import { releaseTextureUrl } from './textureCache'

function blobUrlsFromSnapshot(snapshot: SceneSnapshot): Set<string> {
  const urls = new Set<string>()
  for (const info of Object.values(snapshot.objectTextures)) {
    if (info.url.startsWith('blob:')) urls.add(info.url)
  }
  for (const img of snapshot.referenceImages) {
    if (img.url.startsWith('blob:')) urls.add(img.url)
  }
  for (const bb of snapshot.billboardImages) {
    if (bb.url.startsWith('blob:')) urls.add(bb.url)
  }
  return urls
}

export function collectActiveBlobUrls(
  current: SceneSnapshot,
  historySnapshots: SceneSnapshot[]
): Set<string> {
  const active = blobUrlsFromSnapshot(current)
  for (const snap of historySnapshots) {
    for (const url of blobUrlsFromSnapshot(snap)) active.add(url)
  }
  return active
}

export function collectActivePixelDocIds(
  current: SceneSnapshot,
  historySnapshots: SceneSnapshot[]
): Set<string> {
  const active = new Set(Object.keys(current.pixelDocuments ?? {}))
  for (const snap of historySnapshots) {
    for (const id of Object.keys(snap.pixelDocuments ?? {})) active.add(id)
  }
  return active
}

let previouslyRetained = new Set<string>()

/** Release blob URLs no longer referenced by current state or undo history. */
export function reconcileBlobUrls(active: Set<string>): void {
  for (const url of previouslyRetained) {
    if (!active.has(url)) {
      releaseTextureUrl(url)
    }
  }
  previouslyRetained = new Set(active)
}
