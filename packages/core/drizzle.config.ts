import os from "os"
import path from "path"
import { defineConfig } from "drizzle-kit"

// 仅开发期 drizzle-kit 使用：默认取当前用户的 opennovel 数据目录，可用 OPENNOVEL_DB 覆盖（与 core 的 Global/Flag 语义一致）。
const dataDir = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
const configured = process.env.OPENNOVEL_DB
const dbUrl = configured && path.isAbsolute(configured) ? configured : path.join(dataDir, "opennovel", configured ?? "opennovel.db")

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"],
  out: "./migration",
  dbCredentials: {
    url: dbUrl,
  },
})
