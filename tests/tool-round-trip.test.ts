import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentMessage,
  AjvToolValidator,
  InMemoryToolRegistry,
  type ModelOutput,
  type Tool,
  ToolRuntime,
} from "../src/index.ts"

type ReadFileInput = {
  readonly path: string
}

const readFileDefinition = {
  name: "read_file",
  description: "Reads a UTF-8 file",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
    },
    required: ["path"],
    additionalProperties: false,
  },
} satisfies Tool<ReadFileInput>["definition"]

test("preserves the first tool round trip from model output to tool message", async () => {
  // Given
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "jgent-round-trip-"))
  const filePath = join(temporaryDirectory, "package.json")
  await writeFile(filePath, '{ "name": "jgent" }', "utf8")

  try {
    const readFileTool: Tool<ReadFileInput> = {
      definition: readFileDefinition,
      capabilities: () => [],
      execute: async (input) => ({
        success: true,
        output: await Bun.file(input.path).text(),
      }),
    }
    const registry = new InMemoryToolRegistry()
    registry.register(readFileTool)
    const runtime = new ToolRuntime(registry, new AjvToolValidator())

    const modelOutput: ModelOutput = {
      stopReason: "tool_calls",
      toolCalls: [
        {
          id: "call_read_file",
          name: "read_file",
          arguments: { path: filePath },
        },
      ],
    }
    const messages: AgentMessage[] = [
      { role: "user", content: "package.json 읽어줘" },
      { role: "assistant", toolCalls: modelOutput.toolCalls },
    ]

    // When
    for (const call of modelOutput.toolCalls) {
      const result = await runtime.execute(call)
      messages.push({ role: "tool", result })
    }

    // Then
    expect(messages).toEqual([
      { role: "user", content: "package.json 읽어줘" },
      {
        role: "assistant",
        toolCalls: [
          {
            id: "call_read_file",
            name: "read_file",
            arguments: { path: filePath },
          },
        ],
      },
      {
        role: "tool",
        result: {
          toolCallId: "call_read_file",
          success: true,
          output: '{ "name": "jgent" }',
        },
      },
    ])
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
})
