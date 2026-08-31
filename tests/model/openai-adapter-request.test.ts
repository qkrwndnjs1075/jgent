import { describe, expect, test } from "bun:test"
import type { ToolDefinition } from "../../src/core/index.ts"
import { ModelError, type ModelInput, OpenAIAdapter } from "../../src/model/index.ts"

const readFileDefinition: ToolDefinition = {
  name: "read_file",
  description: "READ_FILE_DESCRIPTION",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
    },
    required: ["path"],
    additionalProperties: false,
  },
}

describe("OpenAIAdapter.toRequest", () => {
  test("maps provider-neutral instructions outside the transcript cursor", () => {
    // Given
    const adapter = new OpenAIAdapter({ model: "gpt-4.1" })
    const input = {
      messages: [{ role: "user" as const, content: "USER_INPUT" }],
      tools: [],
      instructions: "<skills></skills>",
      continuation: {
        provider: "openai",
        state: "resp_previous",
        consumedMessageCount: 1,
      },
    }

    // When
    const request = adapter.toRequest(input)

    // Then
    expect(request.instructions).toBe("<skills></skills>")
    expect(request.input).toEqual([])
  })

  test("maps the complete v1 transcript and function definitions to Responses items", () => {
    // Given
    const adapter = new OpenAIAdapter({ model: "gpt-4.1" })
    const input: ModelInput = {
      messages: [
        { role: "system", content: "SYSTEM_INPUT" },
        { role: "user", content: "USER_INPUT" },
        { role: "assistant", content: "ASSISTANT_INPUT" },
        {
          role: "assistant",
          content: "CALLING_INPUT",
          toolCalls: [
            { id: "call_success", name: "read_file", arguments: { path: "package.json" } },
            { id: "call_failure", name: "read_file", arguments: { path: "missing.json" } },
          ],
        },
        {
          role: "tool",
          result: { toolCallId: "call_success", success: true, output: "SUCCESS_OUTPUT" },
        },
        {
          role: "tool",
          result: {
            toolCallId: "call_failure",
            success: false,
            output: "PARTIAL_OUTPUT",
            error: "FAILURE_CODE",
          },
        },
      ],
      tools: [readFileDefinition],
    }

    // When
    const request = adapter.toRequest(input)

    // Then
    expect(request.model).toBe("gpt-4.1")
    expect(request.store).toBe(true)
    expect(request.parallel_tool_calls).toBe(true)
    expect(request.tools).toEqual([
      {
        type: "function",
        name: "read_file",
        description: "READ_FILE_DESCRIPTION",
        parameters: readFileDefinition.inputSchema,
        strict: false,
      },
    ])
    expect(request.input).toEqual([
      { role: "system", content: "SYSTEM_INPUT" },
      { role: "user", content: "USER_INPUT" },
      { role: "assistant", content: "ASSISTANT_INPUT" },
      { role: "assistant", content: "CALLING_INPUT" },
      {
        type: "function_call",
        call_id: "call_success",
        name: "read_file",
        arguments: '{"path":"package.json"}',
      },
      {
        type: "function_call",
        call_id: "call_failure",
        name: "read_file",
        arguments: '{"path":"missing.json"}',
      },
      { type: "function_call_output", call_id: "call_success", output: "SUCCESS_OUTPUT" },
      {
        type: "function_call_output",
        call_id: "call_failure",
        output: '{"success":false,"output":"PARTIAL_OUTPUT","error":"FAILURE_CODE"}',
      },
    ])
  })

  test("uses continuation state and sends only messages after the consumed cursor", () => {
    // Given
    const adapter = new OpenAIAdapter({ model: "gpt-4.1" })
    const input: ModelInput = {
      messages: [
        { role: "user", content: "CONSUMED_USER_INPUT" },
        {
          role: "assistant",
          toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "a" } }],
        },
        {
          role: "tool",
          result: { toolCallId: "call_1", success: true, output: "TOOL_OUTPUT" },
        },
      ],
      tools: [readFileDefinition],
      continuation: {
        provider: "openai",
        state: "resp_previous",
        consumedMessageCount: 2,
      },
    }

    // When
    const request = adapter.toRequest(input)

    // Then
    expect(request.previous_response_id).toBe("resp_previous")
    expect(request.input).toEqual([
      { type: "function_call_output", call_id: "call_1", output: "TOOL_OUTPUT" },
    ])
  })

  test.each([
    {
      provider: "anthropic",
      state: "state",
      consumedMessageCount: 0,
    },
    {
      provider: "openai",
      state: "state",
      consumedMessageCount: 2,
    },
  ])("rejects incompatible continuation state", (continuation) => {
    // Given
    const adapter = new OpenAIAdapter({ model: "gpt-4.1" })
    const input: ModelInput = {
      messages: [{ role: "user", content: "USER_INPUT" }],
      tools: [],
      continuation,
    }

    // When
    const convert = () => adapter.toRequest(input)

    // Then
    expect(convert).toThrow(ModelError)
    expect(convert).toThrow("continuation")
  })
})
