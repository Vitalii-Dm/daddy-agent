# Feature Slices — local guidance

Every folder directly under `src/features/` is a **slice**. Slices follow the canonical layout documented in [`docs/FEATURE_ARCHITECTURE_STANDARD.md`](../../docs/FEATURE_ARCHITECTURE_STANDARD.md).

Reference implementation: [`agent-graph/`](./agent-graph) — read this first before creating a new slice.

---

## Before adding a new slice

1. Read the [Feature Architecture Standard](../../docs/FEATURE_ARCHITECTURE_STANDARD.md).
2. Skim [`agent-graph/`](./agent-graph) to see the layout in practice.
3. Decide if you actually need a new slice, or if you're extending an existing one. Criteria: own domain concepts, crosses process boundaries or has non-trivial renderer state, needs isolated testing.

---

## Rules that apply to every slice

- **Public surface is the barrel.** Outside consumers import from `<slice>/index.ts` (or `<slice>/renderer/index.ts` for renderer-only slices). Do not import from `core/`, `hooks/`, or `ui/` directly.
- **Pure `core/domain/`.** No React, no `window`, no IPC, no async I/O, no Node APIs. If you need I/O, inject it.
- **No direct storage.** `localStorage`, `sessionStorage`, and `indexedDB` go through the renderer storage port, not the slice.
- **No direct IPC.** Renderer slices call the preload bridge; main-process slices register handlers via a `registerXxxIpc()` function.
- **Namespaced keys and channels.** Storage keys: `daddy:<feature>:<key>`. IPC channels: `daddy:<feature>:<action>`.
- **Types co-located.** Cross-process DTOs in `<slice>/shared/types.ts`. Single-process types live next to the code that produces them.

---

## When to keep code out of `src/features/`

- **Truly global UI primitives** (buttons, dialogs, form controls) → `src/renderer/components/ui/`.
- **Cross-slice shared domain logic** → `src/shared/`.
- **Process bootstrap, IPC registration entrypoint, app lifecycle** → `src/main/index.ts` and `src/preload/index.ts` (each split per-domain in Phase 2 of the cleanup).
- **Thin renderer-only integrations** may still live in `src/renderer/features/` (legacy). Do not add new cross-process features there.

---

## Review checklist for a new or modified slice

- [ ] Layout matches the standard (`core/domain`, `renderer/{adapters,hooks,ui}`, optional `main/`, `shared/types.ts`).
- [ ] Barrel `index.ts` exports only the public surface.
- [ ] `core/domain/` has no React, no `window`, no IPC, no Node APIs.
- [ ] No direct `localStorage` / `indexedDB` / `sessionStorage` access.
- [ ] No direct `ipcRenderer` / `ipcMain` usage; wired via the preload bridge or a `registerXxxIpc()`.
- [ ] IPC channels and storage keys use the `daddy:<feature>:...` namespace.
- [ ] Path aliases (`@main`, `@renderer`, `@shared`, `@preload`) used for cross-layer imports.
- [ ] Tests sit next to the code (`*.test.ts`), especially for `core/domain/`.
