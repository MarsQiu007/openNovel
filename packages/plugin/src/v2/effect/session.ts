/** Minimal read view of a session, for parent-chain walks inside plugins. */
export interface SessionRef {
  readonly id: string
  readonly parentID?: string
}

export interface SessionDomain {
  readonly get: (id: string) => Promise<SessionRef | undefined>
}
