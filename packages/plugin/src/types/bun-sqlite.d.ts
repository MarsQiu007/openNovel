/**
 * bun:sqlite 类型声明（插件包内最小桩）
 *
 * 插件包 tsconfig 不含 @types/bun，此文件为 bun:sqlite 提供编译期类型。
 * opennovel 包有自己的 @types/bun，且其 tsconfig include 不覆盖此目录，不会冲突。
 */
declare module "bun:sqlite" {
  export interface DatabaseOptions {
    readonly?: boolean
    readwrite?: boolean
    create?: boolean
  }

  export class Database {
    constructor(filename?: string, options?: number | DatabaseOptions)
    exec(sql: string): this
    query<T = unknown>(sql: string): { all(): T[]; get(): T | null; run(): void }
  }
}
