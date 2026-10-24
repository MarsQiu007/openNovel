import config from "../../playwright.config"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000)
process.env.PLAYWRIGHT_SERVER_PORT = String(port)
process.env.OPENNOVEL_PERFORMANCE_RUN_ID ??= `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`

export default {
  ...config,
  testDir: ".",
  // 收集边界：unit/** 与 **/*.test.ts 为 bun test 风格文件（Playwright 直接收集会因 bun:test 失败）；
  // timeline-stability 有独立 config 与 test:stability 脚本，不属本套件范围。
  testIgnore: ["unit/**", "**/*.test.ts", "timeline-stability/**"],
  outputDir: "../test-results/performance",
  fullyParallel: false,
  workers: 1,
  reporter: [["html", { outputFolder: "../playwright-report/performance", open: "never" }], ["line"]],
  webServer: {
    ...config.webServer,
    command: `bun run build && bun run serve -- --host 0.0.0.0 --port ${port} --strictPort`,
    reuseExistingServer: false,
  },
}
