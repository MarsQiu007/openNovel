/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeOpenNovelContent from "./skill/customize-opennovel.md" with { type: "text" }

export const CustomizeOpenNovelContent = customizeOpenNovelContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-opennovel",
            description:
              "Use ONLY when the user is editing or creating opennovel's own configuration: opennovel.json, opennovel.jsonc, files under .opennovel/, or files under ~/.config/opennovel/. Also use when creating or fixing opennovel agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opennovel itself.",
            location: AbsolutePath.make("/builtin/customize-opennovel.md"),
            content: CustomizeOpenNovelContent,
          }),
        }),
      )
    })
  }),
})
