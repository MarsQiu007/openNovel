/**
 * 技法库管理协议组。
 *
 * 提供技法列表、详情、创建、更新、删除，以及项目级技法注入开关读写。
 * `/config` 路由必须在 `/:techniqueID` 之前声明，避免被动态段吞掉。
 */
import {
  CreateTechniqueInput,
  Technique,
  TechniqueDetail,
  TechniqueInjection,
  UpdateTechniqueInput,
} from "@opennovel-ai/schema/technique"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

const root = "/api/techniques"

export class TechniqueNotFoundError extends Schema.ErrorClass<TechniqueNotFoundError>("TechniqueNotFoundError")(
  {
    name: Schema.Literal("TechniqueNotFoundError"),
    data: Schema.Struct({
      message: Schema.String,
      techniqueId: Schema.optional(Schema.String),
    }),
  },
  { httpApiStatus: 404 },
) {}

export class TechniqueValidationError extends Schema.ErrorClass<TechniqueValidationError>("TechniqueValidationError")(
  {
    name: Schema.Literal("TechniqueValidationError"),
    data: Schema.Struct({
      message: Schema.String,
      techniqueId: Schema.optional(Schema.String),
    }),
  },
  { httpApiStatus: 400 },
) {}

export const TechniqueGroup = HttpApiGroup.make("server.technique")
  .add(
    HttpApiEndpoint.get("technique.list", root, {
      query: LocationQuery,
      success: Schema.Array(Technique),
      error: TechniqueValidationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.technique.list",
          summary: "列出技法",
          description: "列出项目技法库中的全部技法，返回顺序按置信度和更新时间排序。",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("technique.create", root, {
      query: LocationQuery,
      payload: CreateTechniqueInput,
      success: Technique,
      error: TechniqueValidationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.technique.create",
          summary: "创建技法",
          description: "人工创建技法；未显式给出的字段使用默认值。",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("technique.config", `${root}/config`, {
      query: LocationQuery,
      success: TechniqueInjection,
      error: TechniqueValidationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.technique.config.get",
          summary: "读取技法注入开关",
          description: "读取项目级 technique_injection；缺失或非法值视为关闭。",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("technique.set-config", `${root}/config`, {
      query: LocationQuery,
      payload: TechniqueInjection,
      success: TechniqueInjection,
      error: TechniqueValidationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.technique.config.set",
          summary: "更新技法注入开关",
          description: "只更新 .novel/config.json 中的 technique_injection 字段。",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("technique.detail", `${root}/:techniqueID`, {
      params: { techniqueID: Schema.String },
      query: LocationQuery,
      success: TechniqueDetail,
      error: TechniqueNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.technique.detail",
          summary: "技法详情",
          description: "获取单条技法内容和反馈记录。",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("technique.update", `${root}/:techniqueID`, {
      params: { techniqueID: Schema.String },
      query: LocationQuery,
      payload: UpdateTechniqueInput,
      success: Technique,
      error: TechniqueNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.technique.update",
          summary: "更新技法",
          description: "PATCH 语义更新技法；confidence 和使用统计由既有闭环维护。",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("technique.delete", `${root}/:techniqueID`, {
      params: { techniqueID: Schema.String },
      query: LocationQuery,
      success: Schema.Struct({ deleted: Schema.Boolean }),
      error: TechniqueNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.technique.delete",
          summary: "删除技法",
          description: "删除技法及其反馈记录。",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "technique",
      description: "Project-level technique library management and injection switch.",
    }),
  )