/** @deprecated Use `src/io/sceneExport` and `src/io/download` */
export { downloadFile, downloadJSON } from '../io/download'
export { exportSceneOBJ as exportOBJ, downloadSceneOBJ } from '../io/sceneExport'

/** Legacy JSON glTF export — prefer `exportSceneGLB` / `exportSceneGLTF`. */
export { exportSceneGLTF as exportGLTF } from '../io/sceneExport'
