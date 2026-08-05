const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://opennovel.ai" : `https://${stage}.opennovel.ai`,
  console: stage === "production" ? "https://opennovel.ai/auth" : `https://${stage}.opennovel.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/opennovel",
  discord: "https://opennovel.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
