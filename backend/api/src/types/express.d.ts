import type { PublicUser } from "../services/user.service.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by the authenticate middleware for logged-in requests. */
      auth?: { user: PublicUser };
    }
  }
}

export {};
