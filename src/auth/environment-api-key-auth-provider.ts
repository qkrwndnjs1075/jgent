import { MissingCredentialError } from "./auth-error.ts"
import type { AuthProvider } from "./auth-provider.ts"
import type { ApiKeyCredential } from "./credential.ts"

export class EnvironmentApiKeyAuthProvider implements AuthProvider<ApiKeyCredential> {
  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly variableName = "OPENAI_API_KEY",
  ) {}

  async getCredential(): Promise<ApiKeyCredential> {
    const value = this.environment[this.variableName]?.trim()

    if (value === undefined || value.length === 0) {
      throw new MissingCredentialError("openai")
    }

    return { type: "api_key", value }
  }
}
