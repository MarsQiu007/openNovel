import path from "path"

process.env.OPENNOVEL_DB = ":memory:"
process.env.OPENNOVEL_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.OPENNOVEL_DISABLE_MODELS_FETCH = "true"
