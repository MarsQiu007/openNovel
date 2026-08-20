import { Soul } from "@opennovel-ai/schema/soul"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/api/soul"
const openapi = (identifier: string, summary: string) => OpenApi.annotations({ identifier, summary })

/**
 * 全局灵魂是应用级设置：读写均为全局操作，
 * 不挂在单个项目 Location 上（与云盘同步组同级）。
 */
export const SoulGroup = HttpApiGroup.make("server.soul")
  .add(
    HttpApiEndpoint.get("soul.global", `${root}/global`, {
      success: Soul.Global,
    }).annotateMerge(openapi("v2.soul.global", "Get global soul")),
  )
  .add(
    HttpApiEndpoint.put("soul.update-global", `${root}/global`, {
      payload: Soul.UpdateGlobalInput,
      success: Soul.Global,
    }).annotateMerge(openapi("v2.soul.update-global", "Update global soul")),
  )
