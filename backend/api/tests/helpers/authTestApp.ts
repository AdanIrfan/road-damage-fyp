import { createApp } from "../../src/app.js";
import type { PrismaClient } from "../../src/db/prisma.js";
import { createServices, type Services } from "../../src/services/index.js";
import type { SmsSender } from "../../src/services/sms/index.js";
import { startTestServer, type TestServer } from "./testServer.js";

export const ALLOWED_ORIGIN = "http://localhost:5173";

/** Records messages instead of sending them. */
export class FakeSms implements SmsSender {
  readonly providerName = "fake";
  readonly messages: { to: string; message: string }[] = [];

  send(to: string, message: string): Promise<void> {
    this.messages.push({ to, message });
    return Promise.resolve();
  }

  lastCodeFor(to: string): string {
    const message = this.messages.filter((m) => m.to === to).at(-1)?.message ?? "";
    const code = /\b(\d{6})\b/.exec(message)?.[1];
    if (code === undefined) {
      throw new Error(`No code was sent to ${to}`);
    }
    return code;
  }
}

/** A clock that tests can move forward to simulate expiry. */
export class TestClock {
  private offsetMs = 0;
  readonly now = (): Date => new Date(Date.now() + this.offsetMs);
  advanceSeconds(seconds: number): void {
    this.offsetMs += seconds * 1000;
  }
}

export interface AuthTestContext {
  server: TestServer;
  services: Services;
  sms: FakeSms;
  clock: TestClock;
  client: () => TestClient;
  close: () => Promise<void>;
}

export async function startAuthTestApp(prisma: PrismaClient, options: { rateLimiting?: boolean } = {}): Promise<AuthTestContext> {
  const sms = new FakeSms();
  const clock = new TestClock();
  const services = createServices({
    prisma,
    authSecret: "test-secret-that-is-long-enough-for-validation-0123456789",
    sms,
    phoneDefaultCountry: undefined,
    clock: clock.now,
  });
  const app = createApp(
    {
      checkDatabase: async () => {},
      v1: { services, cookies: { secure: false, sameSite: "lax" }, rateLimiting: options.rateLimiting ?? false },
    },
    { exposeErrorStack: false, logRequests: false, corsOrigins: [ALLOWED_ORIGIN] },
  );
  const server = await startTestServer(app);
  return {
    server,
    services,
    sms,
    clock,
    client: () => new TestClient(server.baseUrl),
    close: () => server.close(),
  };
}

export interface TestResponse {
  status: number;
  body: { success: boolean; data?: Record<string, unknown>; error?: { code: string; message: string; details?: Record<string, unknown> } };
  text: string;
  setCookies: string[];
}

/**
 * Minimal browser-like client: keeps cookies, sends the allowed Origin, and obtains and sends
 * the CSRF token for state-changing requests.
 */
export class TestClient {
  readonly cookies = new Map<string, string>();
  private csrfToken: string | undefined;

  constructor(private readonly baseUrl: string) {}

  async request(
    method: string,
    path: string,
    body?: unknown,
    options: { csrf?: boolean; headers?: Record<string, string> } = {},
  ): Promise<TestResponse> {
    const headers: Record<string, string> = { origin: ALLOWED_ORIGIN, ...options.headers };
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method);
    if (unsafe && options.csrf !== false) {
      headers["x-csrf-token"] = await this.getCsrfToken();
    }
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (this.cookies.size > 0) {
      headers["cookie"] = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const setCookies = res.headers.getSetCookie();
    this.storeCookies(setCookies);
    const text = await res.text();
    return { status: res.status, body: text === "" ? { success: false } : (JSON.parse(text) as TestResponse["body"]), text, setCookies };
  }

  get = (path: string): Promise<TestResponse> => this.request("GET", path);
  post = (path: string, body?: unknown): Promise<TestResponse> => this.request("POST", path, body ?? {});
  patch = (path: string, body?: unknown): Promise<TestResponse> => this.request("PATCH", path, body ?? {});

  async getCsrfToken(): Promise<string> {
    if (this.csrfToken === undefined) {
      const res = await this.request("GET", "/api/v1/auth/csrf");
      this.csrfToken = String(res.body.data?.["csrfToken"]);
    }
    return this.csrfToken;
  }

  private storeCookies(setCookies: string[]): void {
    for (const header of setCookies) {
      const [pair, ...attributes] = header.split(";");
      const separator = pair?.indexOf("=") ?? -1;
      if (pair === undefined || separator < 0) {
        continue;
      }
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((attribute) => {
        const [key, attributeValue] = attribute.trim().split("=");
        return key?.toLowerCase() === "expires" && attributeValue !== undefined && new Date(attributeValue) <= new Date();
      });
      if (value === "" || expired) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }
}

/** Fictional NANP numbers (555-01xx are reserved for fiction). */
export const numbers = {
  citizen: "+12025550101",
  citizen2: "+12025550102",
  admin: "+12025550110",
  engineer: "+12025550120",
  engineer2: "+12025550121",
};

export const PASSWORD = "correct-horse-battery";

/** Registers and verifies a citizen, returning a logged-in client. */
export async function createVerifiedCitizen(ctx: AuthTestContext, mobileNumber = numbers.citizen): Promise<TestClient> {
  const client = ctx.client();
  await client.post("/api/v1/auth/register", {
    fullName: "Test Citizen",
    mobileNumber,
    password: PASSWORD,
    confirmPassword: PASSWORD,
  });
  await client.post("/api/v1/auth/otp/verify", { mobileNumber, code: ctx.sms.lastCodeFor(mobileNumber) });
  await client.post("/api/v1/auth/login", { mobileNumber, password: PASSWORD });
  return client;
}
