# Quadlo release checklist

## Automated gates

- [ ] Clean checkout completes `npm ci`.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run validate:primitives` reports closed positive-volume CAD meshes.
- [ ] `npm run build` passes without unexpected chunk warnings.
- [ ] `go test ./...` passes.
- [ ] `npm audit --omit=dev` reports no known production vulnerabilities.
- [ ] `npm run app:build` creates `build/bin/Quadlo.exe`.
- [ ] GitHub Actions passes on the release commit.

## Packaged Windows smoke test

- [ ] Launch Quadlo on a machine with the supported WebView2 runtime.
- [ ] Create, select, transform, duplicate, hide, and delete objects.
- [ ] Exercise vertex, edge, and face selection plus undo and redo.
- [ ] Create every CAD primitive in front, right, and top views.
- [ ] Draw and undo a complete sketch, path, lathe, and sculpt gesture.
- [ ] Open the UV, Material, and Pixel editors; paint and verify model updates.
- [ ] Save a project, create a new project, reopen the saved project, and compare state.
- [ ] Import supported OBJ, STL, and GLTF samples; export supported formats and reopen them in an independent viewer.
- [ ] Confirm malformed and oversized files fail with a useful error without changing the current project.
- [ ] Confirm discard prompts protect unsaved work from menu and keyboard entry points.

## Lifecycle and performance smoke test

- [ ] Verify an idle quad view produces no continuous WebGL draws.
- [ ] Repeatedly maximize and restore viewports without increasing the steady WebGL context count.
- [ ] Open and close secondary 3D previews repeatedly without retaining renderers.
- [ ] Replace textures and projects repeatedly; confirm heap and GPU use stabilize after garbage collection.
- [ ] Verify transform, sculpt, draw, and paint interactions remain responsive on the release hardware target.
- [ ] Record packaged startup time and compare viewport benchmarks with `docs/PERFORMANCE_BASELINE.md`.

## Release artifacts

- [ ] Update `package.json` and `wails.json` to the intended matching version.
- [ ] Verify application icon, product name, company name, copyright, and executable metadata.
- [ ] Record user-visible changes and known issues.
- [ ] Archive the exact executable produced by the green release workflow.
- [ ] Sign the Windows executable when a code-signing identity is available.
- [ ] Tag the tested commit only after the packaged smoke test passes.
