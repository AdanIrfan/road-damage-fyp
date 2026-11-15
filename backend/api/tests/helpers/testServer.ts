import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Starts the app on a random free port on 127.0.0.1.
 * `onServer` can attach extra handlers to the HTTP server (e.g. the chat WebSocket gateway).
 */
export async function startTestServer(app: Express, onServer?: (server: Server) => void): Promise<TestServer> {
  const server = createServer(app);
  onServer?.(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server.closeAllConnections();
      }),
  };
}
