import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { UnauthorizedError } from "../errors"

export class Authorization extends HttpApiMiddleware.Service<Authorization>()("@opennovel/HttpApiAuthorization", {
  error: UnauthorizedError,
}) {}
