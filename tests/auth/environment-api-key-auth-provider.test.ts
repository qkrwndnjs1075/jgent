import { describe, expect, test } from "bun:test"
import { EnvironmentApiKeyAuthProvider, MissingCredentialError } from "../../src/auth/index.ts"

describe("EnvironmentApiKeyAuthProvider", () => {
  test("returns an API-key credential when the configured variable is present", async () => {
    // Given
    const auth = new EnvironmentApiKeyAuthProvider({ OPENAI_API_KEY: "test-api-key" })

    // When
    const credential = await auth.getCredential()

    // Then
    expect(credential).toEqual({ type: "api_key", value: "test-api-key" })
  })

  test.each([undefined, "", "   "])(
    "rejects a missing or blank API key without exposing its value",
    async (value) => {
      // Given
      const auth = new EnvironmentApiKeyAuthProvider({ OPENAI_API_KEY: value })

      // When
      const result = auth.getCredential()

      // Then
      await expect(result).rejects.toBeInstanceOf(MissingCredentialError)
      await expect(result).rejects.toMatchObject({ provider: "openai" })
    },
  )
})
