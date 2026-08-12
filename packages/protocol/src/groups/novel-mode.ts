/**
 * 小说写作模式协议组
 *
 * 暴露 GET /api/novel/mode 读取、PUT /api/novel/mode 设置项目级模式。
 * 路径挂在 novel 路径下是因为 location.directory 已经是项目根，模式与项目强绑定。
 * 与 NovelGroup 共享同一路由前缀，避免新增顶层路径带来的客户端分发复杂度。
 */
import { NovelMode, NovelModePatch } from "@opennovel-ai/schema/novel-mode"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

const root = "/api/novel/mode"

/** 模式非法值错误（如客户端传了非枚举字符串） */
export class NovelModeError extends Schema.ErrorClass<NovelModeError>("NovelModeError")(
  {
    name: Schema.Literal("NovelModeError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export const NovelModeGroup = HttpApiGroup.make("server.novelMode")
  .add(
    HttpApiEndpoint.get("novelMode.get", root, {
      query: LocationQuery,
      success: NovelMode,
      error: NovelModeError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novelMode.get",
          summary: "读取项目写作模式",
          description: "读取 .novel/config.json 中的 writing_mode / setup_mode；文件不存在时返回默认值。",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("novelMode.set", root, {
      query: LocationQuery,
      payload: NovelModePatch,
      success: NovelMode,
      error: NovelModeError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.novelMode.set",
          summary: "更新项目写作模式",
          description: "PATCH 语义：仅修改入参中显式给出的字段，其余字段保持原值。",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "novelMode",
      description: "Project-level writing mode and setup mode management.",
    }),
  )
