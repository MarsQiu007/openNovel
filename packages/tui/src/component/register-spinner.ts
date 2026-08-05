import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerOpenNovelSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
