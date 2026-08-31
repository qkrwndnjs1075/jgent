export type ModelErrorKind =
  | "authentication"
  | "permission"
  | "rate_limit"
  | "transport"
  | "timeout"
  | "cancelled"
  | "provider_response"
  | "incomplete"
  | "invalid_response"
  | "invalid_continuation"
  | "refusal"

export type ModelErrorDetails = {
  readonly kind: ModelErrorKind
  readonly message: string
  readonly retryable: boolean
  readonly status?: number
  readonly requestId?: string
}

export class ModelError extends Error {
  readonly name = "ModelError"
  readonly kind: ModelErrorKind
  readonly retryable: boolean
  readonly status: number | undefined
  readonly requestId: string | undefined

  constructor(details: ModelErrorDetails) {
    super(details.message)
    this.kind = details.kind
    this.retryable = details.retryable
    this.status = details.status
    this.requestId = details.requestId
  }
}
