// @ts-nocheck

import { OpenNovel } from "@opennovel-ai/core"
import { ReadTool } from "@opennovel-ai/core/tools"

const opennovel = OpenNovel.make({})

opennovel.tool.add(ReadTool)

opennovel.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

opennovel.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

opennovel.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await opennovel.session.create({
  agent: "build",
})

opennovel.subscribe((event) => {
  console.log(event)
})

await opennovel.session.prompt({
  sessionID,
  text: "hey what is up",
})

await opennovel.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await opennovel.session.wait()

console.log(await opennovel.session.messages(sessionID))
