import { expect, test } from "bun:test"
import type { ApiKeyCredential, AuthProvider } from "../../src/auth/index.ts"
import { ModelError } from "../../src/model/model-error.ts"
import type { ModelTransport } from "../../src/model/model-transport.ts"
import { OpenAIAdapter } from "../../src/model/openai/openai-adapter.ts"
import { OpenAIModelClient } from "../../src/model/openai/openai-model-client.ts"
import type { OpenAIRequest } from "../../src/model/openai/openai-types.ts"

test("bounds credential acquisition with the ModelClient signal", async () => {
  // Given
  const controller = new AbortController()
  const credential: AuthProvider<ApiKeyCredential> = {
    getCredential: () => new Promise<ApiKeyCredential>(() => undefined),
  }
  const transport: ModelTransport<OpenAIRequest, ApiKeyCredential> = {
    send: async (): Promise<unknown> => {
      throw new ModelError({
        kind: "transport",
        message: "Transport should not run",
        retryable: false,
      })
    },
  }
  const client = new OpenAIModelClient(
    credential,
    new OpenAIAdapter({ model: "gpt-4.1" }),
    transport,
  )
  const request = client.generate(
    { messages: [{ role: "user", content: "USER_INPUT" }], tools: [] },
    { signal: controller.signal },
  )

  // When
  controller.abort()

  // Then
  await expect(request).rejects.toMatchObject({ kind: "cancelled", retryable: false })
})

test("bounds a non-cooperative transport with the ModelClient signal", async () => {
  // Given
  const controller = new AbortController()
  const credential: AuthProvider<ApiKeyCredential> = {
    getCredential: async () => ({ type: "api_key", value: "local-test-key" }),
  }
  const transport: ModelTransport<OpenAIRequest, ApiKeyCredential> = {
    send: async (): Promise<unknown> => new Promise<unknown>(() => undefined),
  }
  const client = new OpenAIModelClient(
    credential,
    new OpenAIAdapter({ model: "gpt-4.1" }),
    transport,
  )
  const request = client.generate(
    { messages: [{ role: "user", content: "USER_INPUT" }], tools: [] },
    { signal: controller.signal },
  )

  // When
  controller.abort()

  // Then
  await expect(request).rejects.toMatchObject({ kind: "cancelled", retryable: false })
})
