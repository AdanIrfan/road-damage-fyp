import type { Env } from "../../config/env.js";
import { MockSmsSender } from "./mockSmsSender.js";
import type { SmsSender } from "./smsSender.js";

export type { SmsSender } from "./smsSender.js";

/** Creates the configured SMS sender. Fails loudly instead of falling back to the mock. */
export function createSmsSender(env: Pick<Env, "nodeEnv" | "smsProvider">): SmsSender {
  switch (env.smsProvider) {
    case "mock":
      return new MockSmsSender(env.nodeEnv);
    case undefined:
      throw new Error("No SMS provider is configured (set SMS_PROVIDER)");
  }
}
