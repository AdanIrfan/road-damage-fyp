/** Returns the current time. Injected so tests can simulate expiry without waiting. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}
