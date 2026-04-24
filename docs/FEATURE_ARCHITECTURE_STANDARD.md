# Feature Architecture Standard

This document defines the canonical layout for all new medium and large features in Daddy Agent. It captures the pattern already used by the reference slice `src/features/agent-graph/`.

> Reference implementation: [`src/features/agent-graph/`](../src/features/agent-graph/)

---

## Why slices

The codebase spans four processes (main, renderer, preload, shared). Without a consistent slice shape, domain logic leaks across layers, stores turn into god files, and UI components reach directly into storage or IPC. Slices keep a feature's domain logic, adapters, and UI co-located and force the public surface through a single barrel.

Use a feature slice when the work:
- has its own domain concepts (types, rules, pure functions),
- spans more than one process *or* has a non-trivial renderer state machine,
- needs to be testable in isolation without mounting the full app.

Thin renderer-only integrations that don't meet those criteria can stay under `src/renderer/features/*` (legacy) or as components.

---

## Canonical layout

```
src/features/<feature-name>/
├── core/
│   └── domain/             # Pure business logic. No React, no IPC, no async I/O.
│       ├── <rule>.ts
│       └── <semantics>.ts
├── main/                   # Optional. Main-process services, IPC handlers, watchers.
│   └── <FeatureService>.ts
├── renderer/
│   ├── adapters/           # Project Zustand/store state → feature ports (classes OK).
│   │   └── <FeatureAdapter>.ts
│   ├── hooks/              # React hooks: consume adapters, manage side effects.
│   │   └── use<Thing>.ts
│   ├── ui/                 # Components. Minimal logic — delegate to hooks.
│   │   └── <Component>.tsx
│   └── index.ts            # Renderer-facing public API (barrel).
├── shared/                 # Optional. Cross-process types/constants for this feature.
│   └── types.ts
└── index.ts                # Feature-wide barrel (re-exports renderer/main/shared public API).
```

Not every slice needs every folder. Start with `core/domain/` + `renderer/` + `index.ts`; add `main/` and `shared/` when the feature crosses process boundaries.

---

## Layer rules

### `core/domain/`
- Pure functions and pure classes only. No React, no `window`, no Node APIs, no IPC, no async I/O unless the signature is injected.
- Input: plain data. Output: plain data.
- Deterministic and unit-testable without mocks beyond trivial fixtures.
- Types live next to the functions that produce them (or in a local `types.ts`).

### `renderer/adapters/`
- Bridge the app's store/runtime into a feature-specific port shape.
- Own memoization and projection rules. No rendering.
- Typically exported as a class with a static `create()` factory, or as a pure function when stateless.
- Example: `TeamGraphAdapter` projects the Zustand team data into a `GraphDataPort`.

### `renderer/hooks/`
- Consume adapters, manage side effects, expose state/callbacks to components.
- Prefer one responsibility per hook. Compose, don't inline.
- Storage access goes through an injected port (see **Storage** below), never `localStorage` / `indexedDB` directly.

### `renderer/ui/`
- Components import from the slice's own hooks and barrel — never from sibling slices' internals.
- Cross-surface communication via typed `CustomEvent` dispatchers is acceptable (see `TeamGraphTab.tsx`); prefer hooks/store for in-slice wiring.
- Components should be thin: delegate logic to hooks, keep JSX readable.

### `main/` (optional)
- Main-process services, IPC registrations, file watchers.
- Register IPC through a small per-slice registrar; do not stuff handlers into `src/main/ipc/<domain>.ts` god files.
- Return typed DTOs from `shared/types.ts`.

### `shared/types.ts` (optional)
- Cross-process DTOs for this feature.
- No runtime code. No imports from `@main`, `@renderer`, or `@preload`.

### Barrel — `index.ts`
- The **only** supported entry point for consumers outside the slice.
- Re-export:
  - public domain functions / types,
  - adapter(s),
  - published components,
  - hooks that consumers are meant to use.
- Do **not** re-export internals (helpers, private hooks, UI subcomponents).

Consumers import only from the barrel:
```ts
import { TeamGraphAdapter, TeamGraphTab } from '@renderer/features/agent-graph';  // ✅
import { TeamGraphAdapter } from '@renderer/features/agent-graph/renderer/adapters/TeamGraphAdapter';  // ❌
```

---

## Naming conventions

| Kind | Convention | Example |
|------|------------|---------|
| Feature folder | kebab-case | `agent-graph`, `team-provisioning` |
| Services / classes / components | PascalCase | `TeamGraphAdapter.ts`, `TeamGraphTab.tsx` |
| Pure utilities / hook files | camelCase | `buildInlineActivityEntries.ts`, `useTeamGraphAdapter.ts` |
| Constants files | camelCase, exports UPPER_SNAKE_CASE | `kanbanLimits.ts` → `MAX_COLUMNS` |
| Type guards | `isXxx` | `isGraphOwnerNode()` |
| Builders | `buildXxx` | `buildInlineActivityEntries()` |
| Getters | `getXxx` | `getGraphOwnerLabel()` |

Path aliases (required for cross-layer imports):
- `@main/*` → `src/main/*`
- `@renderer/*` → `src/renderer/*`
- `@shared/*` → `src/shared/*`
- `@preload/*` → `src/preload/*`

Within a slice, relative imports are fine (and preferred).

---

## Storage

Do **not** touch `localStorage`, `sessionStorage`, or `indexedDB` directly from components, hooks, or adapters.

Use the renderer storage port at `src/renderer/services/storage/` (to be introduced in the Phase 1 tidy). A slice that needs persistence should:

1. Declare a typed `KeyValueStore<T>` dependency in its hook/adapter.
2. Receive the concrete implementation from the app entry (web `localStorage` today, could be Electron-scoped tomorrow).
3. Namespace keys as `daddy:<feature>:<key>` — never collide with other slices.

Rationale: the high-level feature code should keep working if we swap browser storage for an Electron-scoped store or a server-backed store, without rewriting the rendering layer.

---

## IPC wiring

- Renderer slices never call `window.electron` / raw `ipcRenderer` directly. Go through the preload bridge (`src/preload/index.ts`, to be split per-domain in Phase 2).
- Main-process handlers for a slice live in the slice's `main/` folder and are registered by a single `registerXxxIpc(ipcMain)` function called from `src/main/index.ts`.
- IPC channel names: `daddy:<feature>:<action>` — keep the feature prefix so god files in `src/main/ipc/` stop growing.

---

## Testing

- `core/domain/` is where unit tests belong. A pure domain means trivial tests.
- Adapters can be tested against fake store snapshots.
- Hooks / UI: test only what the slice owns; don't assert on app-wide rendering.
- Place tests alongside code: `buildInlineActivityEntries.test.ts` next to `buildInlineActivityEntries.ts`.

---

## When to add a slice vs extend an existing one

Add a new slice when a feature has its own distinct domain model (its own nouns, verbs, rules). Extend an existing slice when you're adding a capability to an existing domain model.

If two slices start sharing substantial domain logic, extract the shared domain to `src/shared/<name>/` rather than deepening slice-to-slice coupling.

---

## Reference: `src/features/agent-graph/`

Concrete mapping of the rules above to the reference implementation:

- `core/domain/buildInlineActivityEntries.ts` — pure function, maps messages/comments to owner nodes.
- `core/domain/graphOwnerIdentity.ts` — stable ID generation.
- `core/domain/taskGraphSemantics.ts` — task state classification (blocked, in-review, etc.).
- `core/domain/collapseOverflowStacks.ts` — pure layout helper.
- `renderer/adapters/TeamGraphAdapter.ts` — class, `.create()` factory, projects store → `GraphDataPort`.
- `renderer/hooks/useTeamGraphAdapter.ts` — reads store, feeds adapter, returns graph data.
- `renderer/hooks/useGraphSidebarVisibility.ts` — persists UI state (currently via direct `localStorage`; **will migrate to the storage port in Phase 1**).
- `renderer/ui/TeamGraphTab.tsx` — thin wrapper around the external `GraphView` component; dispatches typed `CustomEvent`s for cross-surface actions.
- `renderer/index.ts` — barrel: exports `buildInlineActivityEntries`, `buildGraphMemberNodeIdForMember`, `TeamGraphAdapter`, `TeamGraphTab`, `TeamGraphOverlay`.

Known deviations from this standard in the reference (to be fixed):
- Direct `localStorage` access in `useGraphSidebarVisibility.ts`.
- No top-level `index.ts` — consumers import from `renderer/index.ts`. Fine for renderer-only slices; promote if the slice gains `main/` code.
- No `shared/types.ts` — acceptable while the slice is renderer-only.

---

## See also

- Feature-local guidance: [`src/features/CLAUDE.md`](../src/features/CLAUDE.md)
- Legacy note: [`src/renderer/features/CLAUDE.md`](../src/renderer/features/CLAUDE.md)
- Root project instructions: [`CLAUDE.md`](../CLAUDE.md)
