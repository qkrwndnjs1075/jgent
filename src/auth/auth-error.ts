export class MissingCredentialError extends Error {
  readonly name = "MissingCredentialError"

  constructor(readonly provider: string) {
    super(`Credential required for ${provider}`)
  }
}
