/**
 * 书籍导入编码检测单测（book-import · 3.1）。
 * GBK/Big5 样例字节由运行时自检的字节表编码生成（TextDecoder 验证每个字节对）。
 */
import { describe, expect, test } from "bun:test"
import { decodeDataUrlBytes, decodeWithEncoding, detectAndDecode, IMPORT_SIZE_LIMIT_BYTES } from "../src/handlers/novel-import/encoding"

const GBK_TABLE: Record<string, number[]> = {
  第: [0xb5, 0xda],
  一: [0xd2, 0xbb],
  章: [0xd5, 0xc2],
  回: [0xbb, 0xd8],
  节: [0xbd, 0xda],
  卷: [0xbe, 0xed],
  部: [0xb2, 0xbf],
  序: [0xd0, 0xf2],
  楔: [0xd0, 0xa8],
  子: [0xd7, 0xd3],
  前: [0xc7, 0xb0],
  言: [0xd1, 0xd4],
  尾: [0xce, 0xb2],
  声: [0xc9, 0xf9],
  番: [0xb7, 0xac],
  外: [0xcd, 0xe2],
  正: [0xd5, 0xfd],
  文: [0xce, 0xc4],
  内: [0xc4, 0xda],
  容: [0xc8, 0xdd],
  风: [0xb7, 0xe7],
  起: [0xc6, 0xf0],
  东: [0xb6, 0xab],
  方: [0xb7, 0xbd],
}

const BIG5_TABLE: Record<string, number[]> = {
  第: [0xb2, 0xc4],
  一: [0xa4, 0x40],
  章: [0xb3, 0xb9],
  回: [0xa6, 0x5e],
  節: [0xb8, 0x60],
  卷: [0xa8, 0xf7],
  部: [0xb3, 0xa1],
  序: [0xa7, 0xc7],
  楔: [0xb7, 0xa4],
  子: [0xa4, 0x6c],
  前: [0xab, 0x65],
  言: [0xa8, 0xa5],
  尾: [0xa7, 0xc0],
  聲: [0xc1, 0x6e],
  番: [0xb5, 0x66],
  外: [0xa5, 0x7e],
  正: [0xa5, 0xbf],
  文: [0xa4, 0xe5],
  內: [0xa4, 0xba],
  容: [0xae, 0x65],
  風: [0xad, 0xb7],
  起: [0x8f, 0xfe],
  東: [0xaa, 0x46],
  方: [0xa4, 0xe8],
}

/** 用字节表把中文样例编码为指定编码字节；表内字符之外的字符（ASCII/空白）按单字节放行。 */
function encodeTable(text: string, table: Record<string, number[]>): Uint8Array {
  const bytes: number[] = []
  for (const char of text) {
    const pair = table[char]
    if (pair) {
      bytes.push(...pair)
      continue
    }
    const code = char.codePointAt(0)!
    if (code > 0x7f) throw new Error(`字节表缺字：${char}`)
    bytes.push(code)
  }
  return new Uint8Array(bytes)
}

// 夹具自检：每个字节对必须能解码回原文（防字节表手误）
describe("字节表自检", () => {
  test("GBK 表全部可解码回原文", () => {
    for (const [char, bytes] of Object.entries(GBK_TABLE)) {
      expect(new TextDecoder("gb18030", { fatal: true }).decode(new Uint8Array(bytes))).toBe(char)
    }
  })
  test("Big5 表全部可解码回原文", () => {
    for (const [char, bytes] of Object.entries(BIG5_TABLE)) {
      expect(new TextDecoder("big5", { fatal: true }).decode(new Uint8Array(bytes))).toBe(char)
    }
  })
})

describe("detectAndDecode", () => {
  test("GBK 编码识别为 gb18030", () => {
    const sample = "第一章 正文内容\n风起东方"
    const result = detectAndDecode(encodeTable(sample, GBK_TABLE))
    expect(result?.encoding).toBe("gb18030")
    expect(result?.text.replace(/\r?\n/, "\n")).toBe(sample)
  })

  test("Big5 编码识别为 big5（繁体书稿不误判 GB18030）", () => {
    const sample = "第一章 正文內容\n風起東方"
    const result = detectAndDecode(encodeTable(sample, BIG5_TABLE))
    expect(result?.encoding).toBe("big5")
  })

  test("UTF-8 带 BOM", () => {
    const utf8 = new TextEncoder().encode("第一章 正文内容")
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])
    const result = detectAndDecode(bytes)
    expect(result?.encoding).toBe("utf-8")
    expect(result?.text).toBe("第一章 正文内容")
  })

  test("UTF-8 无 BOM", () => {
    const bytes = new TextEncoder().encode("第一章 正文内容，风起东方。")
    const result = detectAndDecode(bytes)
    expect(result?.encoding).toBe("utf-8")
  })

  test("UTF-16 LE 带 BOM", () => {
    const le = Buffer.from("第一章 正文内容", "utf16le")
    const bytes = new Uint8Array([0xff, 0xfe, ...le])
    const result = detectAndDecode(bytes)
    expect(result?.encoding).toBe("utf-16le")
    expect(result?.text).toBe("第一章 正文内容")
  })

  test("UTF-16 BE 无 BOM（零字节哨兵命中）", () => {
    const le = Buffer.from("第一章 正文内容风起东方天地玄黄", "utf16le")
    const be = new Uint8Array(le.length)
    for (let index = 0; index + 1 < le.length; index += 2) {
      be[index] = le[index + 1]!
      be[index + 1] = le[index]!
    }
    const result = detectAndDecode(be)
    expect(result?.encoding).toBe("utf-16be")
    expect(result?.text).toBe("第一章 正文内容风起东方天地玄黄")
  })

  test("二进制伪装报编码识别失败", () => {
    // 固定伪随机字节（非确定性 random 会引入 flake），头尾都像文本但中间是噪声
    const bytes = new Uint8Array(4096)
    let seed = 42
    for (let index = 0; index < bytes.length; index++) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      bytes[index] = seed & 0xff
    }
    expect(detectAndDecode(bytes)).toBeNull()
  })
})

describe("decodeWithEncoding", () => {
  test("指定编码解码成功", () => {
    const bytes = new TextEncoder().encode("hello 第一章")
    expect(decodeWithEncoding(bytes, "utf-8")).toBe("hello 第一章")
  })

  test("指定编码不匹配 fatal 失败（GBK 字节按 UTF-8 解码必然失败）", () => {
    expect(decodeWithEncoding(encodeTable("第一章正文内容", GBK_TABLE), "utf-8")).toBeNull()
  })
})

describe("decodeDataUrlBytes", () => {
  test("合法 dataUrl 解码", () => {
    const bytes = new TextEncoder().encode("abc")
    const dataUrl = `data:text/plain;base64,${Buffer.from(bytes).toString("base64")}`
    const result = decodeDataUrlBytes(dataUrl)
    expect(result).toEqual({ ok: true, bytes })
  })

  test("非 base64 dataUrl 拒绝", () => {
    expect(decodeDataUrlBytes("data:text/plain,abc")).toEqual({ ok: false, reason: "invalid-text" })
    expect(decodeDataUrlBytes("not-a-data-url")).toEqual({ ok: false, reason: "invalid-text" })
    expect(decodeDataUrlBytes("data:text/plain;base64,!!!")).toEqual({ ok: false, reason: "invalid-text" })
  })

  test("空文件拒绝", () => {
    expect(decodeDataUrlBytes("data:text/plain;base64,")).toEqual({ ok: false, reason: "empty" })
  })

  test("超大文件拒绝", () => {
    const big = Buffer.alloc(IMPORT_SIZE_LIMIT_BYTES + 1)
    const dataUrl = `data:text/plain;base64,${big.toString("base64")}`
    expect(decodeDataUrlBytes(dataUrl)).toEqual({ ok: false, reason: "file-too-large" })
  })
})
