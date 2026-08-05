import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.OPENNOVEL_MODELS_URL || "https://models.dev"
const localPath = path.join(__dirname, "api.json")
const loadRemote = () =>
  fetch(`${modelsUrl}/api.json`)
    .then((x) => x.text())
    .catch((error) => {
      console.warn(
        `Failed to fetch ${modelsUrl}/api.json (${error.message}); falling back to empty snapshot. ` +
          `Set MODELS_DEV_API_JSON=<path> to use a local snapshot, or OPENNOVEL_MODELS_URL to a reachable mirror.`,
      )
      return "{}"
    })
export const modelsData = process.env.MODELS_DEV_API_JSON
  ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  : await Bun.file(localPath).text().catch(loadRemote)
console.log("Loaded models.dev snapshot")
