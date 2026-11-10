import { describe, expect, test } from "bun:test"
import { isAbsoluteDirectoryPath, resolveDirectoryCommit } from "./settings-tool-insight-logic"

describe("isAbsoluteDirectoryPath", () => {
  test("接受 POSIX 根、Windows 盘符与 UNC 共享，拒绝相对路径与空串", () => {
    expect(isAbsoluteDirectoryPath("/var/log")).toBe(true)
    expect(isAbsoluteDirectoryPath("D:\\books\\logs")).toBe(true)
    expect(isAbsoluteDirectoryPath("D:/books/logs")).toBe(true)
    expect(isAbsoluteDirectoryPath("\\\\server\\share")).toBe(true)
    expect(isAbsoluteDirectoryPath("books")).toBe(false)
    expect(isAbsoluteDirectoryPath("./books")).toBe(false)
    expect(isAbsoluteDirectoryPath("../books")).toBe(false)
    expect(isAbsoluteDirectoryPath("~/books")).toBe(false)
    expect(isAbsoluteDirectoryPath("")).toBe(false)
  })
})

describe("resolveDirectoryCommit", () => {
  test("未编辑跳过：不产生任何保存", () => {
    expect(resolveDirectoryCommit({ saved: "D:\\logs", draft: undefined })).toEqual({ action: "skip" })
  })

  test("与已保存值相同跳过（含双方均为空串的默认位置）", () => {
    expect(resolveDirectoryCommit({ saved: "D:\\logs", draft: " D:\\logs " })).toEqual({ action: "skip" })
    expect(resolveDirectoryCommit({ saved: "", draft: "   " })).toEqual({ action: "skip" })
  })

  test("非法相对路径拒绝提交，结果标 invalid", () => {
    expect(resolveDirectoryCommit({ saved: "", draft: "books/logs" })).toEqual({ action: "invalid" })
    expect(resolveDirectoryCommit({ saved: "D:\\logs", draft: "~/logs" })).toEqual({ action: "invalid" })
  })

  test("有效新值按修剪值保存；空白草稿保存空串表示清空回默认位置", () => {
    expect(resolveDirectoryCommit({ saved: "D:\\old", draft: " D:\\new\\logs " })).toEqual({ action: "save", value: "D:\\new\\logs" })
    expect(resolveDirectoryCommit({ saved: "D:\\old", draft: "  " })).toEqual({ action: "save", value: "" })
  })
})
