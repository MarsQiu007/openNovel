import path from "path"

process.env.OPENNOVEL_DB = ":memory:"
// core 的旧版凭据兜底会读取数据目录的 auth.json；默认给空白内容，避免测试读到真实用户凭据。
process.env.OPENNOVEL_AUTH_CONTENT = "{}"
process.env.OPENNOVEL_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.OPENNOVEL_DISABLE_MODELS_FETCH = "true"
