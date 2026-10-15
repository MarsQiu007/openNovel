import config from "../playwright.config"

export default {
  ...config,
  testDir: ".",
  testMatch: "**/*.spec.ts",
  // 不继承 performance config 的 testIgnore（其 timeline-stability/** 会误排本目录）
  testIgnore: [],
  outputDir: "../../test-results/timeline-stability",
  reporter: [["html", { outputFolder: "../../playwright-report/timeline-stability", open: "never" }], ["line"]],
  retries: 0,
  workers: 1,
  use: {
    ...config.use,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
}
