# Quadlo performance baseline

Captured on 2026-07-17 from commit `606829ea3c14b7d2d8bd1c7c9e8f9fba4cfee5aa`.

## Environment

- Windows 10.0.26200, amd64
- Node.js 26.3.0
- npm 11.16.0
- Go 1.26.3
- Wails CLI 2.12.0
- Dependency install: `npm ci`, 168 packages installed, 0 npm audit vulnerabilities

These numbers are local development-machine measurements, not universal hardware targets.

## Automated baseline

### History snapshot benchmark

Command: `npm run benchmark:history`

- Scene: 10,201 vertices, 10,000 faces
- 20 unchanged capture/equality passes: 0.12 ms total
- Mean: 0.01 ms/pass
- Correctness probes detected vertex and face-colour changes

### Viewport geometry benchmark

Command: `npm run benchmark:viewport`

- Grid 31 (1,024 vertices / 961 quads): 4.75 ms cold, 0.23 ms edge overlay, 4.83 ms measured shared four-view total.
- Grid 70 (5,041 vertices / 4,900 quads): 25.92 ms cold, 0.22 ms edge overlay, 25.25 ms measured shared four-view total.
- Grid 100 (10,201 vertices / 10,000 quads): 49.17 ms cold, 0.58 ms edge overlay, 68.18 ms measured shared four-view total.

The existing 16 ms build-wave cache substantially reduces the naive four-build estimate. The benchmark does not measure GPU upload, material allocation, React commits, actual frame time, or memory.

## Bundle baseline

Command: `npm run build`

- Build time: 6.41 s
- Modules transformed: 931
- CSS: 177.24 kB minified / 28.45 kB gzip
- Main application chunk: 725.34 kB / 210.47 kB gzip
- Three.js chunk: 801.40 kB / 208.79 kB gzip
- R3F chunk: 153.31 kB / 49.01 kB gzip
- React DOM chunk: 184.92 kB / 57.83 kB gzip
- Three.js remains intentionally isolated in one 801.40 kB minified / 208.79 kB gzip runtime chunk. The configured warning threshold documents this known split rather than hiding unexpected larger chunks.

## Runtime measurements still required

Browser smoke baseline at `http://127.0.0.1:5173/`:

- Four canvas elements and four WebGL contexts at initial quad-view load
- 2-second completely idle sample: 0 WebGL draw calls and 0 animation-frame requests
- Initial JS heap after load: 19.41 MB used / 29.29 MB allocated
- Dev-server navigation to DOM content loaded: 2.37 s
- Dev-server navigation to first meaningful paint: 3.72 s

Method: Chrome DevTools Protocol `Performance.getMetrics`, DOM canvas/context enumeration, and temporary prototype counters around WebGL draw methods plus `requestAnimationFrame`. Development-server load timing includes module transformation and is not representative of packaged Wails startup.

The repository has no production frame/memory instrumentation. The following are still not verified and must not be treated as passing:

- Packaged Wails initial application load time
- React commits during pointer movement
- Geometry, material, BVH, and texture allocation counts during edits
- WebGL context count across editor open/close and viewport maximize cycles
- Heap/GPU stabilization after create/delete, project reload, and texture replacement stress cycles
- Interaction latency during transform, sculpt, drawing, and pixel painting

Runtime evidence will be appended after deterministic DEV instrumentation and smoke scenarios are implemented.
