import { expect, test } from "bun:test"
import { resolveProductChannel } from "./channel"

test("maps release stage aliases to desktop product channels", () => {
  expect(resolveProductChannel("dev")).toBe("dev")
  expect(resolveProductChannel("beta")).toBe("beta")
  expect(resolveProductChannel("prod")).toBe("prod")
  expect(resolveProductChannel("latest")).toBe("prod")
  expect(resolveProductChannel("local")).toBe("dev")
  expect(resolveProductChannel(undefined)).toBe("dev")
})
