/**
 * Renderer storage — barrel.
 *
 * Preferred entry point for renderer code that needs persistence:
 * - `localKv` for small typed key/value needs backed by `localStorage`.
 * - `*Storage` namespaces below wrap `idb-keyval` for larger structured
 *   snapshots (drafts, read state, context). They already define their own
 *   public API — use those directly, do not reimplement.
 *
 * Direct `localStorage` / `sessionStorage` / `indexedDB` calls from
 * components, hooks, or adapters are disallowed — see
 * `docs/FEATURE_ARCHITECTURE_STANDARD.md`.
 */

export * as localKv from './localKv';
export { namespacedKey } from './localKv';

export * as commentReadStorage from '../commentReadStorage';
export { composerDraftStorage } from '../composerDraftStorage';
export type { ComposerDraftSnapshot } from '../composerDraftStorage';
export { draftStorage } from '../draftStorage';
export { contextStorage } from '../contextStorage';
export type { ContextSnapshot } from '../contextStorage';
export { createTeamDraftStorage } from '../createTeamDraftStorage';
export type { CreateTeamDraftSnapshot, SerializedMemberDraft } from '../createTeamDraftStorage';
