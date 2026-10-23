import { expect } from "bun:test"
import { LayerNode } from "@opennovel-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Config } from "@/config/config"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Config.node))

it.instance(
  "agent color parsed from project config",
  () =>
    Effect.gen(function* () {
      const cfg = yield* Config.use.get()
      expect(cfg.agent?.["build"]?.color).toBe("#FFA500")
      expect(cfg.agent?.["plan"]?.color).toBe("primary")
    }),
  {
    git: true,
    config: {
      agent: {
        build: { color: "#FFA500" },
        plan: { color: "primary" },
      },
    },
  },
)
