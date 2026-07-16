# Quadlo production audit

Status: remediation implemented; final manual smoke testing remains  
Baseline commit: `606829ea3c14b7d2d8bd1c7c9e8f9fba4cfee5aa`  
Baseline date: 2026-07-17

## Final automated verification

- `npm run typecheck`: pass for production and test sources.
- `npm test`: 77 files and 462 tests pass.
- `npm run validate:primitives`: all 39 view/type combinations pass with zero naked edges and positive signed volume.
- `npm run build`: pass; 931 modules transformed in 6.41 seconds.
- `go test ./...`: pass, including desktop path-authorization tests.
- `npm run app:build`: pass from the clean-install Wails configuration; `build/bin/Quadlo.exe` produced.
- `npm run benchmark:history`: 0.12 ms for 20 unchanged 10k-face snapshot passes.
- `npm run benchmark:viewport`: 4.83–68.18 ms measured shared four-view totals across supplied scenes.

## Correctness and geometry remediations

- History snapshots now compare visibility and retained primitive/lathe parameters, and deep-clone mutable lathe points.
- Full sculpt gestures replace the initial history head on pointer-up, preserving complete undo/redo strokes.
- Object deletion clears stale component selections and promotes a remaining selected object.
- New-project confirmation is centralized in the store action for every keyboard and UI entry point.
- Undo/redo cancels queued store and color-picker animation-frame work so stale material paint cannot overwrite a restored scene.
- Legacy objects with missing face colors are normalized safely, and duplicate pixel-document IDs are rejected before resource restoration.
- Stairs and half-circle CAD builders now emit welded, closed, positive-volume topology without T-junctions.
- Concave primitive validation no longer relies on the centroid inward-face heuristic where that heuristic is mathematically unreliable.

## Defensive I/O remediations

- Shared mesh structural validation bounds vertex, face, and corner counts and rejects malformed indices and UV rings.
- Project, pixel-document, and scene-import paths reject oversized, duplicate-ID, non-finite, and malformed inputs.
- Wails reads and writes are restricted to dialog-authorized paths and bounded by text/binary size limits.
- The frontend no longer depends on ignored generated Wails bindings for a normal TypeScript build.
- Temporary download Blob URLs are released after browser consumption.

## Rendering and lifecycle remediations

- Main viewport continuous rendering is derived from explicit interaction/CAD-preview state.
- Secondary UV and hair previews no longer keep the main viewport frame loop active; the hair preview uses demand rendering.
- WebGL renderer registration is deduplicated and paired with unregistration during canvas cleanup.
- Development diagnostics remove stale renderer/context references during remounts.

## Release engineering remediations

- CI now gates frontend typechecking, build, tests, primitive validation, benchmarks, Go tests, and Windows Wails packaging.
- Test sources have a dedicated strict TypeScript configuration; this exposed and removed stale API calls and incomplete fixtures.
- Primitive invariants and desktop file authorization have regression coverage.

## Remaining release risks

- Packaged startup time, transform/sculpt/paint interaction latency, and long-session heap/GPU stabilization still require manual or automated end-to-end measurement on release hardware.
- Browser-level workflow coverage remains absent; current coverage is unit/integration and package-build based.
- Benchmark scripts report evidence but do not yet enforce hardware-independent regression thresholds.
- Blocking browser dialogs remain in a few error paths and should eventually be replaced with accessible in-app notifications.

## Current verdict

Automated release gates are green and the previously confirmed P0 correctness and topology failures are remediated. The codebase is a release candidate, not an unconditional production sign-off, until the packaged smoke and lifecycle scenarios above are completed.
