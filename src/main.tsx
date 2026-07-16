import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { APP_NAME } from './app/branding'
import { applyTheme } from './theme/applyTheme'
import { readStoredThemeId } from './theme/bootstrapTheme'
import * as THREE from 'three'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'

// @ts-ignore
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
// @ts-ignore
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
// @ts-ignore
THREE.Mesh.prototype.raycast = acceleratedRaycast

document.title = APP_NAME
applyTheme(readStoredThemeId())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
