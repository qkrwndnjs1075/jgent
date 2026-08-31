export interface ModelTransport<TRequest, TCredential> {
  send(request: TRequest, credential: TCredential, context: ModelTransportContext): Promise<unknown>
}

export type ModelTransportContext = {
  readonly signal: AbortSignal
}
