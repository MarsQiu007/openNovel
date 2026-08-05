export const domain = (() => {
  if ($app.stage === "production") return "opennovel.ai"
  if ($app.stage === "dev") return "dev.opennovel.ai"
  return `${$app.stage}.dev.opennovel.ai`
})()

export const zoneID = "430ba34c138cfb5360826c4909f99be8"
export const awsStage = $app.stage === "production" ? "production" : "dev"
export const deployAws = $app.stage === awsStage

if ($app.stage === "production") {
  new cloudflare.DnsRecord("TrustCenter", {
    zoneId: zoneID,
    name: "trust.opennovel.ai",
    type: "CNAME",
    content: "3a69a5bb27875189.vercel-dns-016.com",
    proxied: false,
    ttl: 60,
  })

  new cloudflare.DnsRecord("TrustCenterVerification", {
    zoneId: zoneID,
    name: "opennovel.ai",
    type: "TXT",
    content: "compai-domain-verification=org_6993a99c6200a2d642bb115d",
    ttl: 60,
  })
}

new cloudflare.RegionalHostname("RegionalHostname", {
  hostname: domain,
  regionKey: "us",
  zoneId: zoneID,
})

export const shortDomain = (() => {
  if ($app.stage === "production") return "opncd.ai"
  if ($app.stage === "dev") return "dev.opncd.ai"
  return `${$app.stage}.dev.opncd.ai`
})()
