import type { Effect, Option, Schema, Scope } from "effect"
import type { Registration } from "./registration.js"

/**
 * Observation context handed to a source `load`: the session whose context
 * epoch is currently observing sources, when the observation is session-bound.
 * Sources resolving session-bound entities (e.g. a novel bound through the
 * session parent chain) key off `sessionID`; omitted means the observation is
 * not tied to a session.
 */
export interface LoadContext {
  readonly sessionID?: string
}

/**
 * Plugin-side descriptor for one system context source. `load` returning
 * `Option.none()` maps to the core `unavailable` sentinel: refresh preserves
 * the admitted snapshot instead of rendering an incomplete baseline.
 */
export interface SystemContextSource<A = unknown> {
  readonly key: string
  readonly codec: Schema.Codec<A, Schema.Json>
  readonly load: (context: LoadContext) => Effect.Effect<Option.Option<A>>
  readonly baseline: (current: A) => string
  readonly update: (previous: A, current: A) => string
  readonly removed?: (previous: A) => string
}

export interface SystemContextDomain {
  readonly register: (source: SystemContextSource<any>) => Effect.Effect<Registration, never, Scope.Scope>
}
