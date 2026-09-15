export type ProductChannel = "dev" | "beta" | "prod"

export function resolveProductChannel(raw: string | undefined): ProductChannel {
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (raw === "latest") return "prod"
  return "dev"
}
