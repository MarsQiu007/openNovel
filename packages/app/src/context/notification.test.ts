import { describe, expect, test } from "bun:test"
import { buildNotificationIndex, type Notification } from "./notification-index"

const notification = (overrides: Partial<Notification> = {}): Notification => ({
  type: "turn-complete",
  time: 1,
  viewed: false,
  session: "ses_1",
  ...overrides,
})

describe("buildNotificationIndex project keys", () => {
  test("indexes mixed-form directories under the normalized key", () => {
    const index = buildNotificationIndex([
      notification({ session: "ses_1", directory: "D:\\novels\\book" }),
      notification({ session: "ses_2", directory: "D:/novels/book" }),
    ])

    expect(index.project.all["D:/novels/book"]).toHaveLength(2)
    expect(index.project.unseenCount["D:/novels/book"]).toBe(2)
  })

  test("keeps distinct directories apart", () => {
    const index = buildNotificationIndex([
      notification({ session: "ses_1", directory: "D:\\novels\\book" }),
      notification({ session: "ses_2", directory: "D:/novels/other" }),
    ])

    expect(index.project.all["D:/novels/book"]).toHaveLength(1)
    expect(index.project.all["D:/novels/other"]).toHaveLength(1)
  })

  test("skips viewed notifications in unseen counters", () => {
    const index = buildNotificationIndex([
      notification({ session: "ses_1", directory: "D:/novels/book", viewed: true }),
      notification({ session: "ses_2", directory: "D:/novels/book" }),
    ])

    expect(index.project.all["D:/novels/book"]).toHaveLength(2)
    expect(index.project.unseenCount["D:/novels/book"]).toBe(1)
    expect(index.session.unseenCount["ses_2"]).toBe(1)
  })
})
