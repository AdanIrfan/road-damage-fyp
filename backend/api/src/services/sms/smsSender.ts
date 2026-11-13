/**
 * Provider-agnostic SMS interface. A real provider (not chosen yet) will implement this.
 * Implementations must throw if a message could not be handed to the provider.
 */
export interface SmsSender {
  readonly providerName: string;
  send(to: string, message: string): Promise<void>;
}
