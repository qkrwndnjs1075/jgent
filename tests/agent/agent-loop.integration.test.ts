import { afterEach, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import {
  AgentLoop,
  AjvToolValidator,
  ContextAssembler,
  createWorkspaceToolSet,
  EnvironmentApiKeyAuthProvider,
  ExecutionHarness,
  OpenAIAdapter,
  OpenAIModelClient,
  OpenAITransport,
  ToolRuntime,
} from "../../src/index.ts"
import { createTemporaryWorkspace, runGit } from "../workspace/workspace-test-helpers.ts"

const requestSchema = z.object({
  input: z.array(z.unknown()),
  previous_response_id: z.string().optional(),
  tools: z.array(z.object({ name: z.string() })),
})
const toolOutputSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string(),
  output: z.string(),
})
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

test("runs read_file, grep, and git_diff until the model completes", async () => {
  // Given
  const workspaceRoot = await createTemporaryWorkspace()
  temporaryDirectories.push(workspaceRoot)
  await mkdir(join(workspaceRoot, "src"))
  await writeFile(join(workspaceRoot, "package.json"), '{ "name": "jgent" }\n', "utf8")
  await writeFile(
    join(workspaceRoot, "src/user-service.ts"),
    "export class UserService {}\n",
    "utf8",
  )
  await runGit(workspaceRoot, ["init", "--quiet"])
  await runGit(workspaceRoot, ["config", "user.email", "jgent@example.test"])
  await runGit(workspaceRoot, ["config", "user.name", "Jgent Test"])
  await runGit(workspaceRoot, ["add", "."])
  await runGit(workspaceRoot, ["commit", "--quiet", "-m", "baseline"])
  await writeFile(
    join(workspaceRoot, "src/user-service.ts"),
    "export class UserService { readonly active = true }\n",
    "utf8",
  )

  const requestBodies: unknown[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      requestBodies.push(await request.json())
      const requestNumber = requestBodies.length

      if (requestNumber === 1) {
        return toolCallResponse({
          responseId: "response_read",
          callId: "call_read",
          name: "read_file",
          arguments: { path: "package.json" },
        })
      }
      if (requestNumber === 2) {
        return toolCallResponse({
          responseId: "response_grep",
          callId: "call_grep",
          name: "grep",
          arguments: { query: "UserService", path: "src" },
        })
      }
      if (requestNumber === 3) {
        return toolCallResponse({
          responseId: "response_diff",
          callId: "call_diff",
          name: "git_diff",
          arguments: {},
        })
      }
      return Response.json({
        id: "response_complete",
        status: "completed",
        output: [
          {
            type: "message",
            status: "completed",
            content: [{ type: "output_text", text: "Workspace inspection complete" }],
          },
        ],
      })
    },
  })

  try {
    const toolSet = createWorkspaceToolSet(workspaceRoot)
    const modelClient = new OpenAIModelClient(
      new EnvironmentApiKeyAuthProvider({ OPENAI_API_KEY: "local-test-key" }),
      new OpenAIAdapter({ model: "gpt-4.1" }),
      new OpenAITransport({ baseURL: `http://127.0.0.1:${server.port}/v1`, timeoutMs: 1_000 }),
    )
    const loop = new AgentLoop(
      modelClient,
      new ExecutionHarness({
        tools: toolSet.definitions,
        toolRuntime: new ToolRuntime(toolSet.registry, new AjvToolValidator()),
        budget: {
          maxTurns: 8,
          maxModelCalls: 8,
          maxToolCalls: 16,
          maxRunTimeMs: 10_000,
          modelTimeoutMs: 2_000,
          toolTimeoutMs: 2_000,
          approvalTimeoutMs: 2_000,
          cleanupTimeoutMs: 1_000,
        },
        eventSink: { emit: async () => {} },
        exposurePolicy: { filter: (tools) => tools },
        capabilityPolicy: { evaluate: () => ({ type: "allow" }) },
        approvalBroker: {
          request: async (request) => ({
            approvalId: request.approvalId,
            effectDigest: request.effectDigest,
            status: "denied",
          }),
        },
      }),
      new ContextAssembler(),
    )

    // When
    const result = await loop.run(
      "package.json을 읽고, src에서 UserService를 찾은 뒤 현재 git diff를 알려줘",
    )

    // Then
    expect(result).toBe("Workspace inspection complete")
    expect(requestBodies).toHaveLength(4)
    const requests = requestBodies.map((body) => requestSchema.parse(body))
    expect(requests.map(({ previous_response_id }) => previous_response_id)).toEqual([
      undefined,
      "response_read",
      "response_grep",
      "response_diff",
    ])
    const exposedToolNames = [
      "read_file",
      "list_directory",
      "grep",
      "git_status",
      "git_diff",
      "write_file",
      "apply_patch",
      "shell",
    ]
    expect(requests.map(({ tools }) => tools.map(({ name }) => name))).toEqual([
      exposedToolNames,
      exposedToolNames,
      exposedToolNames,
      exposedToolNames,
    ])
    expect(toolOutputSchema.parse(requests[1]?.input[0]).output).toContain('"name": "jgent"')
    expect(toolOutputSchema.parse(requests[2]?.input[0]).output).toContain("src/user-service.ts:1")
    expect(toolOutputSchema.parse(requests[3]?.input[0]).output).toContain("readonly active = true")
  } finally {
    server.stop(true)
  }
})

type ToolCallResponseFixture = {
  readonly responseId: string
  readonly callId: string
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
}

function toolCallResponse(fixture: ToolCallResponseFixture): Response {
  return Response.json({
    id: fixture.responseId,
    status: "completed",
    output: [
      {
        type: "function_call",
        call_id: fixture.callId,
        name: fixture.name,
        arguments: JSON.stringify(fixture.arguments),
        status: "completed",
      },
    ],
  })
}
