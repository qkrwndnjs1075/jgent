import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { EnvironmentApiKeyAuthProvider } from "../../src/auth/index.ts"
import {
  ModelError,
  OpenAIAdapter,
  OpenAIModelClient,
  OpenAITransport,
} from "../../src/model/index.ts"

const requestSchema = z.object({
  model: z.string(),
  store: z.boolean(),
  input: z.array(z.unknown()),
})

type RequestObservation = {
  readonly method: string
  readonly pathname: string
  readonly authorization: string | null
  readonly body: unknown
}

describe("OpenAIModelClient API-key integration", () => {
  test("composes auth, adapter, SDK transport, and response normalization", async () => {
    // Given
    let observation: RequestObservation | undefined
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        observation = {
          method: request.method,
          pathname: new URL(request.url).pathname,
          authorization: request.headers.get("authorization"),
          body: await request.json(),
        }
        return Response.json({
          id: "resp_local",
          object: "response",
          created_at: 0,
          status: "completed",
          error: null,
          incomplete_details: null,
          model: "gpt-4.1",
          output: [
            {
              type: "message",
              id: "message_local",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "LOCAL_OUTPUT", annotations: [] }],
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

      // When
      const output = await client.generate({
        messages: [{ role: "user", content: "USER_INPUT" }],
        tools: [],
      })

      // Then
      expect(output).toEqual({
        stopReason: "completed",
        content: "LOCAL_OUTPUT",
        toolCalls: [],
        continuation: {
          provider: "openai",
          state: "resp_local",
          consumedMessageCount: 2,
        },
      })
      expect(observation).toMatchObject({
        method: "POST",
        pathname: "/v1/responses",
        authorization: "Bearer local-test-key",
      })
      const body = requestSchema.parse(observation?.body)
      expect(body).toMatchObject({ model: "gpt-4.1", store: true })
      expect(body.input).toEqual([{ role: "user", content: "USER_INPUT" }])
    } finally {
      server.stop(true)
    }
  })

  test("converts an SDK authentication failure without exposing the API key", async () => {
    // Given
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        Response.json(
          {
            error: {
              message: "Rejected local-test-key",
              type: "invalid_request_error",
              code: "invalid_api_key",
            },
          },
          { status: 401, headers: { "x-request-id": "request_local" } },
        ),
    })

    try {
      const client = new OpenAIModelClient(
        new EnvironmentApiKeyAuthProvider({ OPENAI_API_KEY: "local-test-key" }),
        new OpenAIAdapter({ model: "gpt-4.1" }),
        new OpenAITransport({ baseURL: `http://127.0.0.1:${server.port}/v1`, timeoutMs: 1_000 }),
      )

      // When
      let caught: unknown
      try {
        await client.generate({ messages: [{ role: "user", content: "USER_INPUT" }], tools: [] })
      } catch (error) {
        if (error instanceof ModelError) {
          caught = error
        } else {
          throw error
        }
      }

      // Then
      expect(caught).toBeInstanceOf(ModelError)
      expect(caught).toMatchObject({
        kind: "authentication",
        retryable: false,
        status: 401,
        requestId: "request_local",
      })
      expect(String(caught)).not.toContain("local-test-key")
    } finally {
      server.stop(true)
    }
  })

  test("aborts an in-flight OpenAI request", async () => {
    // Given
    const requestStarted = Promise.withResolvers<void>()
    const releaseResponse = Promise.withResolvers<Response>()
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        requestStarted.resolve()
        return releaseResponse.promise
      },
    })
    const controller = new AbortController()

    try {
      const client = new OpenAIModelClient(
        new EnvironmentApiKeyAuthProvider({ OPENAI_API_KEY: "local-test-key" }),
        new OpenAIAdapter({ model: "gpt-4.1" }),
        new OpenAITransport({ baseURL: `http://127.0.0.1:${server.port}/v1`, timeoutMs: 10_000 }),
      )
      const request = client.generate(
        { messages: [{ role: "user", content: "USER_INPUT" }], tools: [] },
        { signal: controller.signal },
      )
      await requestStarted.promise

      // When
      controller.abort()
      let caught: unknown
      try {
        await request
      } catch (error) {
        if (error instanceof ModelError) {
          caught = error
        } else {
          throw error
        }
      }

      // Then
      expect(caught).toBeInstanceOf(ModelError)
      expect(caught).toMatchObject({ kind: "cancelled", retryable: false })
    } finally {
      releaseResponse.resolve(new Response(null, { status: 204 }))
      server.stop(true)
    }
  })
})
