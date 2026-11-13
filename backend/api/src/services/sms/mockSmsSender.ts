import type { NodeEnv } from "../../config/env.js";
import type { SmsSender } from "./smsSender.js";

/**
 * DEVELOPMENT ONLY. Does not send anything: it prints the message to the server console so
 * a developer can read OTP codes locally. Refuses to be created outside development.
 */
export class MockSmsSender implements SmsSender {
  readonly providerName = "mock";

  constructor(nodeEnv: NodeEnv) {
    if (nodeEnv !== "development") {
      throw new Error("MockSmsSender can only be used when NODE_ENV=development");
    }
  }

  send(to: string, message: string): Promise<void> {
    console.log(`[MOCK SMS - NOT DELIVERED] to ${to}: ${message}`);
    return Promise.resolve();
  }
}
