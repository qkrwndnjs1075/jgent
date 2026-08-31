export interface AuthProvider<TCredential> {
  getCredential(): Promise<TCredential>
}
