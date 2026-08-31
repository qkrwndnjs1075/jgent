import { expect, test } from "bun:test"
import { z } from "zod"
import { EnvironmentApiKeyAuthProvider } from "../../src/auth/index.ts"
import type { AgentMessage, ModelOutput, ToolDefinition } from "../../src/core/index.ts"
import { OpenAIAdapter, OpenAIModelClient, OpenAITransport } from "../../src/model/index.ts"

const requestSchema = z.object({
  previous_response_id: z.string().optional(),
  input: z.array(z.unknown()),
})

class TestInvariantError extends Error {
  readonly name = "TestInvariantError"
}

test("keeps AgentLoop in control across an OpenAI reasoning tool round trip", async () => {
  // Given
  const requestBodies: unknown[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      requestBodies.push(await request.json())

      if (requestBodies.length === 1) {
        return Response.json({
          id: "resp_tool_call",
          object: "response",
          created_at: 0,
          status: "completed",
          error: null,
          incomplete_details: null,
          model: "gpt-4.1",
          output: [
            { type: "reasoning", id: "reasoning_local", summary: [] },
            {
              type: "function_call",
              id: "function_local",
              call_id: "call_read_file",
              name: "read_file",
              arguments: '{"path":"package.json"}',
              status: "completed",
            },
          ],
        })
      }

      return Response.json({
        id: "resp_final",
        object: "response",
        created_at: 1,
        status: "completed",
        error: null,
        incomplete_details: null,
        model: "gpt-4.1",
        output: [
          {
            type: "message",
            id: "message_final",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "FINAL_OUTPUT", annotations: [] }],
          },
        ],
      })
    },
  })

  try {
    const client = new OpenAIModelClient(
      new EnvironmentApiKeyAuthProvider({ OPENAI_API_KEY: "local-test-key" }),
      new OpenAIAdapter({ model: "gpt-4.1" }),
      new OpenAITransport({ baseURL: `http://127.0.0.1:${server.port}/v1`, timeoutMs: 1_000 }),
    )
    const toolDefinition: ToolDefinition = {
      name: "read_file",
      description: "READ_FILE_DESCRIPTION",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    }
    const messages: AgentMessage[] = [{ role: "user", content: "USER_INPUT" }]

    // When
    const firstOutput = await client.generate({ messages, tools: [toolDefinition] })
    appendToolRoundTrip(messages, firstOutput)
    const continuation = firstOutput.continuation
    if (continuation === undefined) {
      throw new TestInvariantError("Expected continuation")
    }
    const finalOutput = await client.generate({
      messages,
      tools: [toolDefinition],
      continuation,
    })

    // Then
    expect(firstOutput).toMatchObject({
      stopReason: "tool_calls",
      toolCalls: [{ id: "call_read_file", name: "read_file", arguments: { path: "package.json" } }],
      continuation: {
        provider: "openai",
        state: "resp_tool_call",
        consumedMessageCount: 2,
      },
    })
    expect(finalOutput).toMatchObject({
      stopReason: "completed",
      content: "FINAL_OUTPUT",
    })
    expect(requestBodies).toHaveLength(2)
    const secondRequest = requestSchema.parse(requestBodies[1])
    expect(secondRequest.previous_response_id).toBe("resp_tool_call")
    expect(secondRequest.input).toEqual([
      {
        type: "function_call_output",
        call_id: "call_read_file",
        output: "FILE_OUTPUT",
      },
    ])
  } finally {
    server.stop(true)
  }
})

function appendToolRoundTrip(messages: AgentMessage[], output: ModelOutput): void {
  if (output.stopReason !== "tool_calls") {
    throw new TestInvariantError("Expected tool calls")
  }

  messages.push(
    output.content === undefined
      ? { role: "assistant", toolCalls: output.toolCalls }
      : { role: "assistant", content: output.content, toolCalls: output.toolCalls },
  )
  for (const call of output.toolCalls) {
    messages.push({
      role: "tool",
      result: {
        toolCallId: call.id,
        success: true,
        output: "FILE_OUTPUT",
      },
    })
  }
}
