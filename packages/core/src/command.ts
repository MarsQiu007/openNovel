export * as CommandV2 from "./command"

import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Layer, Types } from "effect"
import { Command } from "@opennovel-ai/schema/command"
import { State } from "./state"

export const Info = Command.Info
export type Info = Command.Info

// 与 V1 SessionPrompt.command 一致的参数分词与占位符语义：
// 引号字符串为单 token；$1..$N 逐一代入，最大序号占位符吞掉剩余全部参数；
// $ARGUMENTS 代入原始串；模板无任何占位符且参数非空时追加到模板尾部。
const argsRegex = /(?:"[^"]*"|'[^']*'|[^\s"']+)/g
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export function expandTemplate(template: string, input: string): string {
  const args = (input.match(argsRegex) ?? []).map((arg) => arg.replace(quoteTrimRegex, ""))
  const placeholders = template.match(placeholderRegex) ?? []
  let last = 0
  for (const item of placeholders) {
    const value = Number(item.slice(1))
    if (value > last) last = value
  }
  const withArgs = template.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ""
    if (position === last) return args.slice(argIndex).join(" ")
    return args[argIndex]
  })
  const usesArgumentsPlaceholder = template.includes("$ARGUMENTS")
  let expanded = withArgs.replaceAll("$ARGUMENTS", input)
  if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.trim()) {
    expanded = expanded + "\n\n" + input
  }
  return expanded.trim()
}

export type Data = {
  commands: Map<string, Types.DeepMutable<Info>>
}

export type Draft = {
  list: () => readonly Info[]
  get: (name: string) => Info | undefined
  update: (name: string, update: (command: Types.DeepMutable<Info>) => void) => void
  remove: (name: string) => void
}

export interface Interface extends State.Transformable<Draft> {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/v2/Command") {}

const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const state = State.create<Data, Draft>({
      initial: () => ({ commands: new Map() }),
      draft: (draft) => ({
        list: () => Array.from(draft.commands.values()) as Info[],
        get: (name) => draft.commands.get(name),
        update: (name, update) => {
          const current = draft.commands.get(name) ?? ({ name, template: "" } as Types.DeepMutable<Info>)
          if (!draft.commands.has(name)) draft.commands.set(name, current)
          update(current)
          current.name = name
        },
        remove: (name) => {
          draft.commands.delete(name)
        },
      }),
    })

    return Service.of({
      reload: state.reload,
      transform: state.transform,
      get: Effect.fn("CommandV2.get")(function* (name) {
        return state.get().commands.get(name)
      }),
      list: Effect.fn("CommandV2.list")(function* () {
        return Array.from(state.get().commands.values())
      }),
    })
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [] })
