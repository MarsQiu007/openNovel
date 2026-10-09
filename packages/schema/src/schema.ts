import { DateTime, Option, Schema, SchemaGetter } from "effect"

export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const BooleanFromString = Schema.String.pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value) => String(value)),
  }),
)

export const RelativePath = Schema.String.pipe(Schema.brand("RelativePath"))
export type RelativePath = typeof RelativePath.Type

export const AbsolutePath = Schema.String.pipe(Schema.brand("AbsolutePath"))
export type AbsolutePath = typeof AbsolutePath.Type

export const optional = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema).pipe(
    Schema.decodeTo(Schema.optional(Schema.toType(schema)), {
      decode: SchemaGetter.passthrough({ strict: false }),
      encode: SchemaGetter.transformOptional(Option.filter((value) => value !== undefined)),
    }),
  )

export const statics =
  <S extends object, M extends Record<string, unknown>>(methods: (schema: S) => M) =>
  (schema: S): S & M =>
    Object.assign(schema, methods(schema))

export const DateTimeUtcFromMillis = Schema.Finite.pipe(
  Schema.decodeTo(Schema.DateTimeUtc, {
    decode: SchemaGetter.transform((value) => DateTime.makeUnsafe(value)),
    encode: SchemaGetter.transform((value) => DateTime.toEpochMillis(value)),
  }),
)

/**
 * 统计章节字数（网文字数口径）：汉字逐字计数 + 英文/数字按词计数，
 * 不含标点、空白与换行。全仓 chapters/chapter_versions 表 word_count 的
 * 写入与展示唯一口径，写作管线长度闸门与编辑器目标判定共用。
 */
export function countWords(text: string): number {
  let count = 0
  const cjk = text.match(/\p{Script=Han}/gu)
  if (cjk) count += cjk.length
  const tokens = text.match(/[a-zA-Z0-9]+/g)
  if (tokens) count += tokens.length
  return count
}
