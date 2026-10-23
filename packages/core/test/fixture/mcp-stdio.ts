import { readFileSync } from "node:fs"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js"

// 1x1 透明 PNG
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

const defaults: Tool[] = [
  {
    name: "echo",
    description: "Echo text back",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
  },
  {
    name: "fail",
    description: "Always returns an error result",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "rich",
    description: "Returns one part of each supported content kind",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "structured",
    description: "Returns structured content",
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: { answer: { type: "number" } } },
  },
  {
    name: "json_text",
    description: "Returns JSON as plain text without an output schema",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "bad_schema",
    description: "Declares an unresolvable input schema",
    inputSchema: { type: "object", $ref: "#/definitions/Missing", definitions: {} },
  },
  {
    name: "reload",
    description: "Re-read the tools file and broadcast list_changed",
    inputSchema: { type: "object", properties: {} },
  },
]

// 置位时整表替换默认工具清单，reload 工具重读该文件驱动 ToolsChanged 场景
const toolsPath = process.env.MCP_FIXTURE_TOOLS

function loadTools(): Tool[] {
  if (!toolsPath) return defaults
  return JSON.parse(readFileSync(toolsPath, "utf8"))
}

const server = new Server(
  { name: "mcp-stdio-fixture", version: "1.0.0" },
  { capabilities: { tools: { listChanged: true } }, instructions: "fixture instructions" },
)

server.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools: loadTools() }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments ?? {}
  switch (request.params.name) {
    case "echo":
      return { content: [{ type: "text", text: typeof args.text === "string" ? args.text : "" }] }
    case "fail":
      return { content: [{ type: "text", text: "boom" }], isError: true }
    case "rich":
      return {
        content: [
          { type: "text", text: "plain" },
          { type: "image", data: PNG, mimeType: "image/png" },
          { type: "resource_link", uri: "file:///tmp/linked.txt", name: "linked" },
          { type: "resource", resource: { uri: "file:///tmp/notes.txt", mimeType: "text/plain", text: "note body" } },
          {
            type: "resource",
            resource: {
              uri: "file:///tmp/data.json",
              mimeType: "application/json",
              blob: Buffer.from('{"k":1}', "utf8").toString("base64"),
            },
          },
          {
            type: "resource",
            resource: {
              uri: "file:///tmp/blob.bin",
              mimeType: "application/octet-stream",
              blob: Buffer.from([1, 2, 3, 4]).toString("base64"),
            },
          },
        ],
      }
    case "structured":
      return {
        content: [{ type: "text", text: '{"answer":42}' }],
        structuredContent: { answer: 42 },
      }
    case "json_text":
      return { content: [{ type: "text", text: '{"answer":42}' }] }
    case "reload":
      loadTools()
      await server.sendToolListChanged()
      return { content: [{ type: "text", text: "reloaded" }] }
    default:
      return { content: [{ type: "text", text: `unknown tool: ${request.params.name}` }], isError: true }
  }
})

await server.connect(new StdioServerTransport())
