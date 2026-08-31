import { describe, expect, test } from "bun:test"
import { ModelError, type ModelInput, OpenAIAdapter } from "../../src/model/index.ts"

const input: ModelInput = {
  messages: [{ role: "user", content: "USER_INPUT" }],
  tools: [],
}

function completedResponse(
  id: string,
  output: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
  return {
    id,
    status: "completed",
    error: null,
    incomplete_details: null,
    output,
  }
}

describe("OpenAIAdapter.toOutput", () => {
  test("aggregates completed assistant text and returns a continuation cursor", () => {
    // Given
    const adapter = new OpenAIAdapter({ model: "gpt-4.1" })
    const response = completedResponse("resp_text", [
      { type: "reasoning", id: "reasoning_1", summary: [] },
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          { type: "output_text", text: "PART_ONE", annotations: [] },
          { type: "output_text", text: "PART_TWO", annotations: [] },
        ],
      },
    ])

    // When
    const output = adapter.toOutput(response, input)

    // Then
    expect(output).toEqual({
      stopReason: "completed",
      content: "PART_ONEPART_TWO",
      toolCalls: [],
      continuation: {
        provider: "openai",
        state: "resp_text",
        consumedMessageCount: 2,
      },
    })
  })

  test("preserves optional text and multiple completed function calls", () => {
    // Given
    const adapter = new OpenAIAdapter({ model: "gpt-4.1" })
    const response = completedResponse("resp_calls", [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "CALLING_TEXT", annotations: [] }],
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "read_file",
        arguments: '{"path":"a.json"}',
        status: "completed",
      },
      {
        type: "function_call",
        call_id: "call_2",
        name: "read_file",
        arguments: '{"path":"b.json"}',
        status: "completed",
      },
    ])

    // When
    const output = adapter.toOutput(response, input)

    // Then
    expect(output).toEqual({
      stopReason: "tool_calls",
      content: "CALLING_TEXT",
      toolCalls: [
        { id: "call_1", name: "read_file", arguments: { path: "a.json" } },
        { id: "call_2", name: "read_file", arguments: { path: "b.json" } },
      ],
      continuation: {
        provider: "openai",
        state: "resp_calls",
        consumedMessageCount: 2,
      },
    })
  })

  test.each(['{"value":1}', "[]", "null", "not-json"])(
    "rejects function arguments that are not JSON objects",
    (argumentsJson) => {
      // Given
      const adapter = new OpenAIAdapter({ model: "gpt-4.1" })
      const response = completedResponse("resp_invalid_arguments", [
        {
          type: "function_call",
          call_id: "call_1",
          name: "read_file",
          arguments: argumentsJson,
          status: "completed",
        },
      ])

      // When
      const convert = () => adapter.toOutput(response, input)

      // Then
      if (argumentsJson === '{"value":1}') {
        expect(convert).not.toThrow()
      } else {
        expect(convert).toThrow(ModelError)
        expect(convert).toThrow("arguments")
      }
    },
  )

  test.each([
    ["failed", "provider_response"],
    ["incomplete", "incomplete"],
    ["cancelled", "cancelled"],
    ["queued", "invalid_response"],
    ["in_progress", "invalid_response"],
  ] as const)("rejects non-completed provider status %s", (status, expectedKind) => {
    // Given
    const adapter = new OpenAIAdapter({ model: "gpt-4.1" })
    const response = {
      id: `resp_${status}`,
      status,
      error: status === "failed" ? { code: "server_error", message: "FAILED" } : null,
      incomplete_details: status === "incomplete" ? { reason: "max_output_tokens" } : null,
      output: [],
    }

    // When
    let caught: unknown
    try {
      adapter.toOutput(response, input)
    } catch (error) {
      if (error instanceof ModelError) {
        caught = error
      } else {
        throw error
      }
    }

    // Then
    expect(caught).toBeInstanceOf(ModelError)
    expect(caught).toMatchObject({ kind: expectedKind })
  })

  test.each([
    completedResponse("resp_refusal", [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "refusal", refusal: "REFUSAL" }],
      },
    ]),
    completedResponse("resp_unsupported", [
      { type: "web_search_call", id: "search_1", status: "completed" },
    ]),
    completedResponse("resp_empty", []),
    { status: "completed", output: [] },
  ])("rejects refusal, unsupported, empty, and malformed responses", (response) => {
    // Given
    const adapter = new OpenAIAdapter({ model: "gpt-4.1" })

    // When
    const convert = () => adapter.toOutput(response, input)

    // Then
    expect(convert).toThrow(ModelError)
  })
})
