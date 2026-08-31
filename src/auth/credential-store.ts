export interface CredentialStore<TCredential> {
  get(provider: string): Promise<TCredential | null>
  save(provider: string, credential: TCredential): Promise<void>
  remove(provider: string): Promise<void>
}
