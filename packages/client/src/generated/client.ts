import type {
  HealthGetOutput,
  LocationGetInput,
  LocationGetOutput,
  AgentsListInput,
  AgentsListOutput,
  SessionsListInput,
  SessionsListOutput,
  SessionsCreateInput,
  SessionsCreateOutput,
  SessionsActiveOutput,
  SessionsGetInput,
  SessionsGetOutput,
  SessionsSwitchAgentInput,
  SessionsSwitchAgentOutput,
  SessionsSwitchModelInput,
  SessionsSwitchModelOutput,
  SessionsPromptInput,
  SessionsPromptOutput,
  SessionsCompactInput,
  SessionsCompactOutput,
  SessionsWaitInput,
  SessionsWaitOutput,
  SessionsStageInput,
  SessionsStageOutput,
  SessionsClearInput,
  SessionsClearOutput,
  SessionsCommitInput,
  SessionsCommitOutput,
  SessionsContextInput,
  SessionsContextOutput,
  SessionsHistoryInput,
  SessionsHistoryOutput,
  SessionsEventsInput,
  SessionsEventsOutput,
  SessionsInterruptInput,
  SessionsInterruptOutput,
  SessionsMessageInput,
  SessionsMessageOutput,
  MessagesListInput,
  MessagesListOutput,
  ModelsListInput,
  ModelsListOutput,
  ProvidersListInput,
  ProvidersListOutput,
  ProvidersGetInput,
  ProvidersGetOutput,
  IntegrationsListInput,
  IntegrationsListOutput,
  IntegrationsGetInput,
  IntegrationsGetOutput,
  IntegrationsConnectKeyInput,
  IntegrationsConnectKeyOutput,
  IntegrationsConnectOauthInput,
  IntegrationsConnectOauthOutput,
  IntegrationsAttemptStatusInput,
  IntegrationsAttemptStatusOutput,
  IntegrationsAttemptCompleteInput,
  IntegrationsAttemptCompleteOutput,
  IntegrationsAttemptCancelInput,
  IntegrationsAttemptCancelOutput,
  CredentialsUpdateInput,
  CredentialsUpdateOutput,
  CredentialsRemoveInput,
  CredentialsRemoveOutput,
  PermissionsListRequestsInput,
  PermissionsListRequestsOutput,
  PermissionsListSavedInput,
  PermissionsListSavedOutput,
  PermissionsRemoveSavedInput,
  PermissionsRemoveSavedOutput,
  PermissionsCreateInput,
  PermissionsCreateOutput,
  PermissionsListInput,
  PermissionsListOutput,
  PermissionsGetInput,
  PermissionsGetOutput,
  PermissionsReplyInput,
  PermissionsReplyOutput,
  FilesListInput,
  FilesListOutput,
  FilesFindInput,
  FilesFindOutput,
  CommandsListInput,
  CommandsListOutput,
  SkillsListInput,
  SkillsListOutput,
  EventsSubscribeOutput,
  PtysListInput,
  PtysListOutput,
  PtysCreateInput,
  PtysCreateOutput,
  PtysGetInput,
  PtysGetOutput,
  PtysUpdateInput,
  PtysUpdateOutput,
  PtysRemoveInput,
  PtysRemoveOutput,
  QuestionsListRequestsInput,
  QuestionsListRequestsOutput,
  QuestionsListInput,
  QuestionsListOutput,
  QuestionsReplyInput,
  QuestionsReplyOutput,
  QuestionsRejectInput,
  QuestionsRejectOutput,
  ReferencesListInput,
  ReferencesListOutput,
  ProjectCopiesCreateInput,
  ProjectCopiesCreateOutput,
  ProjectCopiesRemoveInput,
  ProjectCopiesRemoveOutput,
  ProjectCopiesRefreshInput,
  ProjectCopiesRefreshOutput,
  ServerNovelListInput,
  ServerNovelListOutput,
  ServerNovelCreateInput,
  ServerNovelCreateOutput,
  ServerNovelForSessionInput,
  ServerNovelForSessionOutput,
  ServerNovelSessionBindingsInput,
  ServerNovelSessionBindingsOutput,
  ServerNovelDetailInput,
  ServerNovelDetailOutput,
  ServerNovelVolumesInput,
  ServerNovelVolumesOutput,
  ServerNovelChaptersInput,
  ServerNovelChaptersOutput,
  ServerNovelChapterInput,
  ServerNovelChapterOutput,
  ServerNovelChapterVersionsInput,
  ServerNovelChapterVersionsOutput,
  ServerNovelChapterReviewsInput,
  ServerNovelChapterReviewsOutput,
  ServerNovelRollbackInput,
  ServerNovelRollbackOutput,
  ServerNovelUpdateContentInput,
  ServerNovelUpdateContentOutput,
  ServerNovelApprovalInput,
  ServerNovelApprovalOutput,
  ServerNovelCharactersInput,
  ServerNovelCharactersOutput,
  ServerNovelPlotThreadsInput,
  ServerNovelPlotThreadsOutput,
  ServerNovelForeshadowingInput,
  ServerNovelForeshadowingOutput,
  ServerNovelWorldEntriesInput,
  ServerNovelWorldEntriesOutput,
  ServerNovelOutlineInput,
  ServerNovelOutlineOutput,
  ServerNovelUpdateOutlineInput,
  ServerNovelUpdateOutlineOutput,
  ServerNovelExportInput,
  ServerNovelExportOutput,
  ServerNovelDeleteChapterInput,
  ServerNovelDeleteChapterOutput,
  ServerNovelCreateVolumeInput,
  ServerNovelCreateVolumeOutput,
  ServerNovelUpdateVolumeInput,
  ServerNovelUpdateVolumeOutput,
  ServerNovelDeleteVolumeInput,
  ServerNovelDeleteVolumeOutput,
  ServerNovelRestoreVersionInput,
  ServerNovelRestoreVersionOutput,
  ServerNovelMoveChapterInput,
  ServerNovelMoveChapterOutput,
  ServerNovelUpdateChapterInput,
  ServerNovelUpdateChapterOutput,
  ServerNovelRelationshipsInput,
  ServerNovelRelationshipsOutput,
  ServerNovelCreateRelationshipInput,
  ServerNovelCreateRelationshipOutput,
  ServerNovelUpdateRelationshipInput,
  ServerNovelUpdateRelationshipOutput,
  ServerNovelDeleteRelationshipInput,
  ServerNovelDeleteRelationshipOutput,
  ServerNovelCharacterStatesInput,
  ServerNovelCharacterStatesOutput,
  ServerNovelAllCharacterStatesInput,
  ServerNovelAllCharacterStatesOutput,
  ServerNovelCreateCharacterStateInput,
  ServerNovelCreateCharacterStateOutput,
  ServerNovelUpdateCharacterStateInput,
  ServerNovelUpdateCharacterStateOutput,
  ServerNovelDeleteCharacterStateInput,
  ServerNovelDeleteCharacterStateOutput,
  ServerNovelStyleGuideInput,
  ServerNovelStyleGuideOutput,
  ServerNovelUpdateStyleGuideInput,
  ServerNovelUpdateStyleGuideOutput,
  ServerNovelSearchInput,
  ServerNovelSearchOutput,
  ServerNovelTensionInput,
  ServerNovelTensionOutput,
  ServerNovelBindInput,
  ServerNovelBindOutput,
  ServerNovelCreateChapterInput,
  ServerNovelCreateChapterOutput,
  ServerNovelUpdateInput,
  ServerNovelUpdateOutput,
  ServerNovelDeleteInput,
  ServerNovelDeleteOutput,
  ServerNovelCreateCharacterInput,
  ServerNovelCreateCharacterOutput,
  ServerNovelUpdateCharacterInput,
  ServerNovelUpdateCharacterOutput,
  ServerNovelDeleteCharacterInput,
  ServerNovelDeleteCharacterOutput,
  ServerNovelCreateTensionInput,
  ServerNovelCreateTensionOutput,
  ServerNovelUpdateTensionInput,
  ServerNovelUpdateTensionOutput,
  ServerNovelDeleteTensionInput,
  ServerNovelDeleteTensionOutput,
  ServerNovelCreatePlotThreadInput,
  ServerNovelCreatePlotThreadOutput,
  ServerNovelUpdatePlotThreadInput,
  ServerNovelUpdatePlotThreadOutput,
  ServerNovelDeletePlotThreadInput,
  ServerNovelDeletePlotThreadOutput,
  ServerNovelCreateForeshadowingInput,
  ServerNovelCreateForeshadowingOutput,
  ServerNovelUpdateForeshadowingInput,
  ServerNovelUpdateForeshadowingOutput,
  ServerNovelDeleteForeshadowingInput,
  ServerNovelDeleteForeshadowingOutput,
  ServerNovelCreateWorldEntryInput,
  ServerNovelCreateWorldEntryOutput,
  ServerNovelUpdateWorldEntryInput,
  ServerNovelUpdateWorldEntryOutput,
  ServerNovelDeleteWorldEntryInput,
  ServerNovelDeleteWorldEntryOutput,
  NovelModesGetInput,
  NovelModesGetOutput,
  NovelModesSetInput,
  NovelModesSetOutput,
} from "./types"
import { ClientError } from "./client-error"

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: HeadersInit
}

export interface RequestOptions {
  readonly signal?: AbortSignal
  readonly headers?: HeadersInit
}

interface RequestDescriptor {
  readonly method: string
  readonly path: string
  readonly query?: Record<string, unknown>
  readonly headers?: Record<string, unknown>
  readonly body?: unknown
  readonly successStatus: number
  readonly declaredStatuses: ReadonlyArray<number>
  readonly empty: boolean
}

export function make(options: ClientOptions) {
  const fetch = options.fetch ?? globalThis.fetch

  const prepare = (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    const url = new URL(descriptor.path, options.baseUrl)
    for (const [key, value] of Object.entries(descriptor.query ?? {})) appendQuery(url.searchParams, key, value)
    const headers = new Headers(options.headers)
    for (const [key, value] of Object.entries(descriptor.headers ?? {})) {
      if (value !== undefined && value !== null) headers.set(key, String(value))
    }
    for (const [key, value] of new Headers(requestOptions?.headers)) headers.set(key, value)
    if (descriptor.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")
    return {
      url,
      init: {
        method: descriptor.method,
        signal: requestOptions?.signal,
        headers,
        body: descriptor.body === undefined ? undefined : JSON.stringify(descriptor.body),
      } satisfies RequestInit,
    }
  }

  const execute = async (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    try {
      const prepared = prepare(descriptor, requestOptions)
      return await fetch(prepared.url, prepared.init)
    } catch (cause) {
      throw new ClientError("Transport", { cause })
    }
  }

  const responseError = async (response: Response, descriptor: RequestDescriptor): Promise<never> => {
    if (descriptor.declaredStatuses.includes(response.status)) throw await json(response)
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnexpectedStatus", { cause: { status: response.status } })
  }

  const request = async <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): Promise<A> => {
    const response = await execute(descriptor, requestOptions)
    if (response.status !== descriptor.successStatus) return responseError(response, descriptor)
    if (descriptor.empty) {
      try {
        await response.body?.cancel()
      } catch {}
      return undefined as A
    }
    return (await json(response)) as A
  }

  const sse = <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): AsyncIterable<A> => ({
    async *[Symbol.asyncIterator]() {
      const response = await execute(descriptor, requestOptions)
      if (response.status !== descriptor.successStatus) await responseError(response, descriptor)
      if (!isContentType(response, "text/event-stream")) {
        try {
          await response.body?.cancel()
        } catch {}
        throw new ClientError("UnsupportedContentType")
      }
      if (response.body === null) throw new ClientError("MalformedResponse")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        while (true) {
          let next
          try {
            next = await reader.read()
          } catch (cause) {
            throw new ClientError("Transport", { cause })
          }
          buffer += decoder.decode(next.value, { stream: !next.done })
          if (buffer.length > 1_048_576) throw new ClientError("MalformedResponse")
          const trailingCarriageReturn = !next.done && buffer.endsWith("\r")
          if (trailingCarriageReturn) buffer = buffer.slice(0, -1)
          buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
          if (trailingCarriageReturn) buffer += "\r"
          if (next.done && buffer !== "") buffer += "\n\n"
          let boundary = buffer.indexOf("\n\n")
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = block
              .split("\n")
              .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
              .join("\n")
            if (data !== "") {
              try {
                yield JSON.parse(data) as A
              } catch (cause) {
                throw new ClientError("MalformedResponse", { cause })
              }
            }
            boundary = buffer.indexOf("\n\n")
          }
          if (next.done) return
        }
      } finally {
        try {
          await reader.cancel()
        } catch {}
        reader.releaseLock()
      }
    },
  })

  return {
    health: {
      get: (requestOptions?: RequestOptions) =>
        request<HealthGetOutput>(
          { method: "GET", path: `/api/health`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
    },
    location: {
      get: (input?: LocationGetInput, requestOptions?: RequestOptions) =>
        request<LocationGetOutput>(
          {
            method: "GET",
            path: `/api/location`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    agents: {
      list: (input?: AgentsListInput, requestOptions?: RequestOptions) =>
        request<AgentsListOutput>(
          {
            method: "GET",
            path: `/api/agent`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    sessions: {
      list: (input?: SessionsListInput, requestOptions?: RequestOptions) =>
        request<SessionsListOutput>(
          {
            method: "GET",
            path: `/api/session`,
            query: {
              workspace: input?.["workspace"],
              limit: input?.["limit"],
              order: input?.["order"],
              search: input?.["search"],
              directory: input?.["directory"],
              project: input?.["project"],
              subpath: input?.["subpath"],
              cursor: input?.["cursor"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: SessionsCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsCreateOutput }>(
          {
            method: "POST",
            path: `/api/session`,
            body: {
              id: input?.["id"],
              agent: input?.["agent"],
              model: input?.["model"],
              location: input?.["location"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      active: (requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsActiveOutput }>(
          {
            method: "GET",
            path: `/api/session/active`,
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      get: (input: SessionsGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      switchAgent: (input: SessionsSwitchAgentInput, requestOptions?: RequestOptions) =>
        request<SessionsSwitchAgentOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/agent`,
            body: { agent: input["agent"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      switchModel: (input: SessionsSwitchModelInput, requestOptions?: RequestOptions) =>
        request<SessionsSwitchModelOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/model`,
            body: { model: input["model"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      prompt: (input: SessionsPromptInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsPromptOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/prompt`,
            body: { id: input["id"], prompt: input["prompt"], delivery: input["delivery"], resume: input["resume"] },
            successStatus: 200,
            declaredStatuses: [409, 404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      compact: (input: SessionsCompactInput, requestOptions?: RequestOptions) =>
        request<SessionsCompactOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/compact`,
            successStatus: 204,
            declaredStatuses: [404, 503, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      wait: (input: SessionsWaitInput, requestOptions?: RequestOptions) =>
        request<SessionsWaitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/wait`,
            successStatus: 204,
            declaredStatuses: [404, 503, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      stage: (input: SessionsStageInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsStageOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/stage`,
            body: { messageID: input["messageID"], files: input["files"] },
            successStatus: 200,
            declaredStatuses: [404, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      clear: (input: SessionsClearInput, requestOptions?: RequestOptions) =>
        request<SessionsClearOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/clear`,
            successStatus: 204,
            declaredStatuses: [404, 500, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      commit: (input: SessionsCommitInput, requestOptions?: RequestOptions) =>
        request<SessionsCommitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/commit`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      context: (input: SessionsContextInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsContextOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/context`,
            successStatus: 200,
            declaredStatuses: [404, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      history: (input: SessionsHistoryInput, requestOptions?: RequestOptions) =>
        request<SessionsHistoryOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/history`,
            query: { limit: input["limit"], after: input["after"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      events: (input: SessionsEventsInput, requestOptions?: RequestOptions): AsyncIterable<SessionsEventsOutput> =>
        sse<SessionsEventsOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/event`,
            query: { after: input["after"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      interrupt: (input: SessionsInterruptInput, requestOptions?: RequestOptions) =>
        request<SessionsInterruptOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/interrupt`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      message: (input: SessionsMessageInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsMessageOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
    },
    messages: {
      list: (input: MessagesListInput, requestOptions?: RequestOptions) =>
        request<MessagesListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/message`,
            query: { limit: input["limit"], order: input["order"], cursor: input["cursor"] },
            successStatus: 200,
            declaredStatuses: [400, 404, 500, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    models: {
      list: (input?: ModelsListInput, requestOptions?: RequestOptions) =>
        request<ModelsListOutput>(
          {
            method: "GET",
            path: `/api/model`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    providers: {
      list: (input?: ProvidersListInput, requestOptions?: RequestOptions) =>
        request<ProvidersListOutput>(
          {
            method: "GET",
            path: `/api/provider`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ProvidersGetInput, requestOptions?: RequestOptions) =>
        request<ProvidersGetOutput>(
          {
            method: "GET",
            path: `/api/provider/${encodeURIComponent(input.providerID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    integrations: {
      list: (input?: IntegrationsListInput, requestOptions?: RequestOptions) =>
        request<IntegrationsListOutput>(
          {
            method: "GET",
            path: `/api/integration`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: IntegrationsGetInput, requestOptions?: RequestOptions) =>
        request<IntegrationsGetOutput>(
          {
            method: "GET",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      connectKey: (input: IntegrationsConnectKeyInput, requestOptions?: RequestOptions) =>
        request<IntegrationsConnectKeyOutput>(
          {
            method: "POST",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/key`,
            query: { location: input["location"] },
            body: { key: input["key"], label: input["label"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      connectOauth: (input: IntegrationsConnectOauthInput, requestOptions?: RequestOptions) =>
        request<IntegrationsConnectOauthOutput>(
          {
            method: "POST",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth`,
            query: { location: input["location"] },
            body: { methodID: input["methodID"], inputs: input["inputs"], label: input["label"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      attemptStatus: (input: IntegrationsAttemptStatusInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptStatusOutput>(
          {
            method: "GET",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      attemptComplete: (input: IntegrationsAttemptCompleteInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptCompleteOutput>(
          {
            method: "POST",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}/complete`,
            query: { location: input["location"] },
            body: { code: input["code"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      attemptCancel: (input: IntegrationsAttemptCancelInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptCancelOutput>(
          {
            method: "DELETE",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    credentials: {
      update: (input: CredentialsUpdateInput, requestOptions?: RequestOptions) =>
        request<CredentialsUpdateOutput>(
          {
            method: "PATCH",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            query: { location: input["location"] },
            body: { label: input["label"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
      remove: (input: CredentialsRemoveInput, requestOptions?: RequestOptions) =>
        request<CredentialsRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    permissions: {
      listRequests: (input?: PermissionsListRequestsInput, requestOptions?: RequestOptions) =>
        request<PermissionsListRequestsOutput>(
          {
            method: "GET",
            path: `/api/permission/request`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      listSaved: (input?: PermissionsListSavedInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsListSavedOutput }>(
          {
            method: "GET",
            path: `/api/permission/saved`,
            query: { projectID: input?.["projectID"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      removeSaved: (input: PermissionsRemoveSavedInput, requestOptions?: RequestOptions) =>
        request<PermissionsRemoveSavedOutput>(
          {
            method: "DELETE",
            path: `/api/permission/saved/${encodeURIComponent(input.id)}`,
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
      create: (input: PermissionsCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsCreateOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            body: {
              id: input["id"],
              action: input["action"],
              resources: input["resources"],
              save: input["save"],
              metadata: input["metadata"],
              source: input["source"],
              agent: input["agent"],
            },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      list: (input: PermissionsListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      get: (input: PermissionsGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      reply: (input: PermissionsReplyInput, requestOptions?: RequestOptions) =>
        request<PermissionsReplyOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}/reply`,
            body: { reply: input["reply"], message: input["message"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    files: {
      list: (input?: FilesListInput, requestOptions?: RequestOptions) =>
        request<FilesListOutput>(
          {
            method: "GET",
            path: `/api/fs/list`,
            query: { location: input?.["location"], path: input?.["path"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      find: (input: FilesFindInput, requestOptions?: RequestOptions) =>
        request<FilesFindOutput>(
          {
            method: "GET",
            path: `/api/fs/find`,
            query: { location: input["location"], query: input["query"], type: input["type"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    commands: {
      list: (input?: CommandsListInput, requestOptions?: RequestOptions) =>
        request<CommandsListOutput>(
          {
            method: "GET",
            path: `/api/command`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    skills: {
      list: (input?: SkillsListInput, requestOptions?: RequestOptions) =>
        request<SkillsListOutput>(
          {
            method: "GET",
            path: `/api/skill`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    events: {
      subscribe: (requestOptions?: RequestOptions): AsyncIterable<EventsSubscribeOutput> =>
        sse<EventsSubscribeOutput>(
          { method: "GET", path: `/api/event`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
    },
    ptys: {
      list: (input?: PtysListInput, requestOptions?: RequestOptions) =>
        request<PtysListOutput>(
          {
            method: "GET",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: PtysCreateInput, requestOptions?: RequestOptions) =>
        request<PtysCreateOutput>(
          {
            method: "POST",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            body: {
              command: input?.["command"],
              args: input?.["args"],
              cwd: input?.["cwd"],
              title: input?.["title"],
              env: input?.["env"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: PtysGetInput, requestOptions?: RequestOptions) =>
        request<PtysGetOutput>(
          {
            method: "GET",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: PtysUpdateInput, requestOptions?: RequestOptions) =>
        request<PtysUpdateOutput>(
          {
            method: "PUT",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            body: { title: input["title"], size: input["size"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: PtysRemoveInput, requestOptions?: RequestOptions) =>
        request<PtysRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [404, 401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    questions: {
      listRequests: (input?: QuestionsListRequestsInput, requestOptions?: RequestOptions) =>
        request<QuestionsListRequestsOutput>(
          {
            method: "GET",
            path: `/api/question/request`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      list: (input: QuestionsListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: QuestionsListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      reply: (input: QuestionsReplyInput, requestOptions?: RequestOptions) =>
        request<QuestionsReplyOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reply`,
            body: { answers: input["answers"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      reject: (input: QuestionsRejectInput, requestOptions?: RequestOptions) =>
        request<QuestionsRejectOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reject`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    references: {
      list: (input?: ReferencesListInput, requestOptions?: RequestOptions) =>
        request<ReferencesListOutput>(
          {
            method: "GET",
            path: `/api/reference`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    projectCopies: {
      create: (input: ProjectCopiesCreateInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesCreateOutput>(
          {
            method: "POST",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
            query: { location: input["location"] },
            body: { strategy: input["strategy"], directory: input["directory"], name: input["name"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ProjectCopiesRemoveInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesRemoveOutput>(
          {
            method: "DELETE",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
            query: { location: input["location"] },
            body: { directory: input["directory"], force: input["force"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      refresh: (input: ProjectCopiesRefreshInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesRefreshOutput>(
          {
            method: "POST",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy/refresh`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    "server.novel": {
      list: (input?: ServerNovelListInput, requestOptions?: RequestOptions) =>
        request<ServerNovelListOutput>(
          {
            method: "GET",
            path: `/api/novel`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: ServerNovelCreateInput, requestOptions?: RequestOptions) =>
        request<ServerNovelCreateOutput>(
          {
            method: "POST",
            path: `/api/novel`,
            query: { location: input["location"] },
            body: { title: input["title"], genre: input["genre"], synopsis: input["synopsis"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      "for-session": (input: ServerNovelForSessionInput, requestOptions?: RequestOptions) =>
        request<ServerNovelForSessionOutput>(
          {
            method: "GET",
            path: `/api/novel/for-session/${encodeURIComponent(input.sessionID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "session-bindings": (input?: ServerNovelSessionBindingsInput, requestOptions?: RequestOptions) =>
        request<ServerNovelSessionBindingsOutput>(
          {
            method: "GET",
            path: `/api/novel/session-bindings`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      detail: (input: ServerNovelDetailInput, requestOptions?: RequestOptions) =>
        request<ServerNovelDetailOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      volumes: (input: ServerNovelVolumesInput, requestOptions?: RequestOptions) =>
        request<ServerNovelVolumesOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/volumes`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      chapters: (input: ServerNovelChaptersInput, requestOptions?: RequestOptions) =>
        request<ServerNovelChaptersOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/chapters`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      chapter: (input: ServerNovelChapterInput, requestOptions?: RequestOptions) =>
        request<ServerNovelChapterOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/chapters/${encodeURIComponent(input.chapterID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "chapter-versions": (input: ServerNovelChapterVersionsInput, requestOptions?: RequestOptions) =>
        request<ServerNovelChapterVersionsOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/chapters/${encodeURIComponent(input.chapterID)}/versions`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "chapter-reviews": (input: ServerNovelChapterReviewsInput, requestOptions?: RequestOptions) =>
        request<ServerNovelChapterReviewsOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/chapters/${encodeURIComponent(input.chapterID)}/reviews`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      rollback: (input: ServerNovelRollbackInput, requestOptions?: RequestOptions) =>
        request<ServerNovelRollbackOutput>(
          {
            method: "POST",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/chapters/${encodeURIComponent(input.chapterID)}/rollback`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "update-content": (input: ServerNovelUpdateContentInput, requestOptions?: RequestOptions) =>
        request<ServerNovelUpdateContentOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/chapters/${encodeURIComponent(input.chapterID)}/content`,
            query: { location: input["location"] },
            body: { content: input["content"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      approval: (input: ServerNovelApprovalInput, requestOptions?: RequestOptions) =>
        request<ServerNovelApprovalOutput>(
          {
            method: "POST",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/chapters/${encodeURIComponent(input.chapterID)}/approval`,
            query: { location: input["location"] },
            body: { action: input["action"], comment: input["comment"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      characters: (input: ServerNovelCharactersInput, requestOptions?: RequestOptions) =>
        request<ServerNovelCharactersOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/characters`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "plot-threads": (input: ServerNovelPlotThreadsInput, requestOptions?: RequestOptions) =>
        request<ServerNovelPlotThreadsOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/plot-threads`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      foreshadowing: (input: ServerNovelForeshadowingInput, requestOptions?: RequestOptions) =>
        request<ServerNovelForeshadowingOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/foreshadowing`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "world-entries": (input: ServerNovelWorldEntriesInput, requestOptions?: RequestOptions) =>
        request<ServerNovelWorldEntriesOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/world-entries`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      outline: (input: ServerNovelOutlineInput, requestOptions?: RequestOptions) =>
        request<ServerNovelOutlineOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/outline`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "update-outline": (input: ServerNovelUpdateOutlineInput, requestOptions?: RequestOptions) =>
        request<ServerNovelUpdateOutlineOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/outline`,
            query: { location: input["location"] },
            body: { section: input["section"], id: input["id"], markdown: input["markdown"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      export: (input: ServerNovelExportInput, requestOptions?: RequestOptions) =>
        request<ServerNovelExportOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/export`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "delete-chapter": (input: ServerNovelDeleteChapterInput, requestOptions?: RequestOptions) =>
        request<ServerNovelDeleteChapterOutput>(
          {
            method: "DELETE",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/chapters/${encodeURIComponent(input.chapterID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "create-volume": (input: ServerNovelCreateVolumeInput, requestOptions?: RequestOptions) =>
        request<ServerNovelCreateVolumeOutput>(
          {
            method: "POST",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/volumes`,
            query: { location: input["location"] },
            body: { title: input["title"], summary: input["summary"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "update-volume": (input: ServerNovelUpdateVolumeInput, requestOptions?: RequestOptions) =>
        request<ServerNovelUpdateVolumeOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/volumes/${encodeURIComponent(input.volumeID)}`,
            query: { location: input["location"] },
            body: { title: input["title"], summary: input["summary"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "delete-volume": (input: ServerNovelDeleteVolumeInput, requestOptions?: RequestOptions) =>
        request<ServerNovelDeleteVolumeOutput>(
          {
            method: "DELETE",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/volumes/${encodeURIComponent(input.volumeID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "restore-version": (input: ServerNovelRestoreVersionInput, requestOptions?: RequestOptions) =>
        request<ServerNovelRestoreVersionOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/chapters/${encodeURIComponent(input.chapterID)}/restore`,
            query: { location: input["location"] },
            body: { version: input["version"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "move-chapter": (input: ServerNovelMoveChapterInput, requestOptions?: RequestOptions) =>
        request<ServerNovelMoveChapterOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/chapters/${encodeURIComponent(input.chapterID)}/move`,
            query: { location: input["location"] },
            body: { action: input["action"], volumeId: input["volumeId"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "update-chapter": (input: ServerNovelUpdateChapterInput, requestOptions?: RequestOptions) =>
        request<ServerNovelUpdateChapterOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/chapters/${encodeURIComponent(input.chapterID)}`,
            query: { location: input["location"] },
            body: { title: input["title"], status: input["status"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      relationships: (input: ServerNovelRelationshipsInput, requestOptions?: RequestOptions) =>
        request<ServerNovelRelationshipsOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/relationships`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "create-relationship": (input: ServerNovelCreateRelationshipInput, requestOptions?: RequestOptions) =>
        request<ServerNovelCreateRelationshipOutput>(
          {
            method: "POST",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/relationships`,
            query: { location: input["location"] },
            body: {
              charAId: input["charAId"],
              charBId: input["charBId"],
              type: input["type"],
              description: input["description"],
            },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "update-relationship": (input: ServerNovelUpdateRelationshipInput, requestOptions?: RequestOptions) =>
        request<ServerNovelUpdateRelationshipOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/relationships/${encodeURIComponent(input.relationshipID)}`,
            query: { location: input["location"] },
            body: { type: input["type"], description: input["description"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "delete-relationship": (input: ServerNovelDeleteRelationshipInput, requestOptions?: RequestOptions) =>
        request<ServerNovelDeleteRelationshipOutput>(
          {
            method: "DELETE",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/relationships/${encodeURIComponent(input.relationshipID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "character-states": (input: ServerNovelCharacterStatesInput, requestOptions?: RequestOptions) =>
        request<ServerNovelCharacterStatesOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/characters/${encodeURIComponent(input.characterID)}/states`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "all-character-states": (input: ServerNovelAllCharacterStatesInput, requestOptions?: RequestOptions) =>
        request<ServerNovelAllCharacterStatesOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/character-states`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "create-character-state": (input: ServerNovelCreateCharacterStateInput, requestOptions?: RequestOptions) =>
        request<ServerNovelCreateCharacterStateOutput>(
          {
            method: "POST",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/characters/${encodeURIComponent(input.characterID)}/states`,
            query: { location: input["location"] },
            body: {
              chapterId: input["chapterId"],
              place: input["place"],
              mood: input["mood"],
              summary: input["summary"],
            },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "update-character-state": (input: ServerNovelUpdateCharacterStateInput, requestOptions?: RequestOptions) =>
        request<ServerNovelUpdateCharacterStateOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/character-states/${encodeURIComponent(input.stateID)}`,
            query: { location: input["location"] },
            body: { active: input["active"], place: input["place"], mood: input["mood"], summary: input["summary"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "delete-character-state": (input: ServerNovelDeleteCharacterStateInput, requestOptions?: RequestOptions) =>
        request<ServerNovelDeleteCharacterStateOutput>(
          {
            method: "DELETE",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/character-states/${encodeURIComponent(input.stateID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "style-guide": (input: ServerNovelStyleGuideInput, requestOptions?: RequestOptions) =>
        request<ServerNovelStyleGuideOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/style-guide`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "update-style-guide": (input: ServerNovelUpdateStyleGuideInput, requestOptions?: RequestOptions) =>
        request<ServerNovelUpdateStyleGuideOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/style-guide`,
            query: { location: input["location"] },
            body: { tone: input["tone"], pov: input["pov"], tense: input["tense"], rules: input["rules"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      search: (input: ServerNovelSearchInput, requestOptions?: RequestOptions) =>
        request<ServerNovelSearchOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/search`,
            query: { q: input["q"], location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      tension: (input: ServerNovelTensionInput, requestOptions?: RequestOptions) =>
        request<ServerNovelTensionOutput>(
          {
            method: "GET",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/tension`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      bind: (input: ServerNovelBindInput, requestOptions?: RequestOptions) =>
        request<ServerNovelBindOutput>(
          {
            method: "POST",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/bind`,
            query: { location: input["location"] },
            body: { sessionID: input["sessionID"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "create-chapter": (input: ServerNovelCreateChapterInput, requestOptions?: RequestOptions) =>
        request<ServerNovelCreateChapterOutput>(
          {
            method: "POST",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/chapters`,
            query: { location: input["location"] },
            body: { title: input["title"], volumeId: input["volumeId"], order: input["order"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: ServerNovelUpdateInput, requestOptions?: RequestOptions) =>
        request<ServerNovelUpdateOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}`,
            query: { location: input["location"] },
            body: { title: input["title"], synopsis: input["synopsis"], genre: input["genre"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      delete: (input: ServerNovelDeleteInput, requestOptions?: RequestOptions) =>
        request<ServerNovelDeleteOutput>(
          {
            method: "DELETE",
            path: `/api/novel/${encodeURIComponent(input.novelID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "create-character": (input: ServerNovelCreateCharacterInput, requestOptions?: RequestOptions) =>
        request<ServerNovelCreateCharacterOutput>(
          {
            method: "POST",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/characters`,
            query: { location: input["location"] },
            body: { name: input["name"], role: input["role"], description: input["description"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "update-character": (input: ServerNovelUpdateCharacterInput, requestOptions?: RequestOptions) =>
        request<ServerNovelUpdateCharacterOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/characters/${encodeURIComponent(input.characterID)}`,
            query: { location: input["location"] },
            body: {
              name: input["name"],
              role: input["role"],
              description: input["description"],
              status: input["status"],
            },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "delete-character": (input: ServerNovelDeleteCharacterInput, requestOptions?: RequestOptions) =>
        request<ServerNovelDeleteCharacterOutput>(
          {
            method: "DELETE",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/characters/${encodeURIComponent(input.characterID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "create-tension": (input: ServerNovelCreateTensionInput, requestOptions?: RequestOptions) =>
        request<ServerNovelCreateTensionOutput>(
          {
            method: "POST",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/tension`,
            query: { location: input["location"] },
            body: { chapterNumber: input["chapterNumber"], level: input["level"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "update-tension": (input: ServerNovelUpdateTensionInput, requestOptions?: RequestOptions) =>
        request<ServerNovelUpdateTensionOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/tension/${encodeURIComponent(input.pointID)}`,
            query: { location: input["location"] },
            body: { level: input["level"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "delete-tension": (input: ServerNovelDeleteTensionInput, requestOptions?: RequestOptions) =>
        request<ServerNovelDeleteTensionOutput>(
          {
            method: "DELETE",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/tension/${encodeURIComponent(input.pointID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "create-plot-thread": (input: ServerNovelCreatePlotThreadInput, requestOptions?: RequestOptions) =>
        request<ServerNovelCreatePlotThreadOutput>(
          {
            method: "POST",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/plot-threads`,
            query: { location: input["location"] },
            body: { title: input["title"], priority: input["priority"], description: input["description"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "update-plot-thread": (input: ServerNovelUpdatePlotThreadInput, requestOptions?: RequestOptions) =>
        request<ServerNovelUpdatePlotThreadOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/plot-threads/${encodeURIComponent(input.threadID)}`,
            query: { location: input["location"] },
            body: {
              title: input["title"],
              status: input["status"],
              priority: input["priority"],
              description: input["description"],
            },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "delete-plot-thread": (input: ServerNovelDeletePlotThreadInput, requestOptions?: RequestOptions) =>
        request<ServerNovelDeletePlotThreadOutput>(
          {
            method: "DELETE",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/plot-threads/${encodeURIComponent(input.threadID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "create-foreshadowing": (input: ServerNovelCreateForeshadowingInput, requestOptions?: RequestOptions) =>
        request<ServerNovelCreateForeshadowingOutput>(
          {
            method: "POST",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/foreshadowing`,
            query: { location: input["location"] },
            body: { content: input["content"], plantedChapterId: input["plantedChapterId"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "update-foreshadowing": (input: ServerNovelUpdateForeshadowingInput, requestOptions?: RequestOptions) =>
        request<ServerNovelUpdateForeshadowingOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/foreshadowing/${encodeURIComponent(input.entryID)}`,
            query: { location: input["location"] },
            body: { content: input["content"], state: input["state"], resolvedChapterId: input["resolvedChapterId"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "delete-foreshadowing": (input: ServerNovelDeleteForeshadowingInput, requestOptions?: RequestOptions) =>
        request<ServerNovelDeleteForeshadowingOutput>(
          {
            method: "DELETE",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/foreshadowing/${encodeURIComponent(input.entryID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "create-world-entry": (input: ServerNovelCreateWorldEntryInput, requestOptions?: RequestOptions) =>
        request<ServerNovelCreateWorldEntryOutput>(
          {
            method: "POST",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/world-entries`,
            query: { location: input["location"] },
            body: { category: input["category"], title: input["title"], content: input["content"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "update-world-entry": (input: ServerNovelUpdateWorldEntryInput, requestOptions?: RequestOptions) =>
        request<ServerNovelUpdateWorldEntryOutput>(
          {
            method: "PUT",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/world-entries/${encodeURIComponent(input.entryID)}`,
            query: { location: input["location"] },
            body: { category: input["category"], title: input["title"], content: input["content"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      "delete-world-entry": (input: ServerNovelDeleteWorldEntryInput, requestOptions?: RequestOptions) =>
        request<ServerNovelDeleteWorldEntryOutput>(
          {
            method: "DELETE",
            path: `/api/novel/${encodeURIComponent(input.novelID)}/world-entries/${encodeURIComponent(input.entryID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    novelModes: {
      get: (input?: NovelModesGetInput, requestOptions?: RequestOptions) =>
        request<NovelModesGetOutput>(
          {
            method: "GET",
            path: `/api/novel/mode`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      set: (input?: NovelModesSetInput, requestOptions?: RequestOptions) =>
        request<NovelModesSetOutput>(
          {
            method: "PUT",
            path: `/api/novel/mode`,
            query: { location: input?.["location"] },
            body: { writing_mode: input?.["writing_mode"], setup_mode: input?.["setup_mode"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
  }
}

function appendQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(params, key, item)
    return
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(value)) appendQuery(params, `${key}[${child}]`, item)
    return
  }
  params.append(key, String(value))
}

async function json(response: Response): Promise<unknown> {
  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnsupportedContentType")
  }
  let text: string
  try {
    text = await response.text()
  } catch (cause) {
    throw new ClientError("Transport", { cause })
  }
  if (text === "") throw new ClientError("MalformedResponse")
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ClientError("MalformedResponse", { cause })
  }
}

function isContentType(response: Response, expected: string) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected
}
