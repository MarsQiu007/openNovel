export * as Mcp from "./mcp"

import { Schema } from "effect"

const StatusConnected = Schema.Struct({ status: Schema.Literal("connected") }).annotate({
  identifier: "MCPStatusConnected",
})
const StatusDisabled = Schema.Struct({ status: Schema.Literal("disabled") }).annotate({
  identifier: "MCPStatusDisabled",
})
const StatusFailed = Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).annotate({
  identifier: "MCPStatusFailed",
})
const StatusNeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth") }).annotate({
  identifier: "MCPStatusNeedsAuth",
})
const StatusNeedsClientRegistration = Schema.Struct({
  status: Schema.Literal("needs_client_registration"),
  error: Schema.String,
}).annotate({ identifier: "MCPStatusNeedsClientRegistration" })

export const Status = Schema.Union([
  StatusConnected,
  StatusDisabled,
  StatusFailed,
  StatusNeedsAuth,
  StatusNeedsClientRegistration,
]).annotate({ identifier: "MCPStatus", discriminator: "status" })
export type Status = Schema.Schema.Type<typeof Status>

export const ServerInfo = Schema.Struct({
  name: Schema.String,
  status: Status,
}).annotate({ identifier: "MCPServerInfo" })
export type ServerInfo = Schema.Schema.Type<typeof ServerInfo>

export const AuthStatus = Schema.Literals(["authenticated", "expired", "not_authenticated"]).annotate({
  identifier: "MCPAuthStatus",
})
export type AuthStatus = Schema.Schema.Type<typeof AuthStatus>
