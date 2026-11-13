import type { RequestHandler } from "express";
import { getAuthUser } from "../middleware/auth.js";
import type { AuthService } from "../services/auth.service.js";
import type { UserService } from "../services/user.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { setSessionCookies, type CookieSettings } from "../utils/authCookies.js";
import { parseInput } from "../utils/validation.js";
import { changePasswordSchema, updateProfileSchema } from "../validation/schemas.js";

export interface ProfileController {
  get: RequestHandler;
  update: RequestHandler;
  changePassword: RequestHandler;
}

/** Every handler acts on the logged-in user only; there is no user id in the URL. */
export function createProfileController(deps: {
  auth: AuthService;
  users: UserService;
  cookies: CookieSettings;
}): ProfileController {
  return {
    get: (req, res) => {
      sendSuccess(res, { user: getAuthUser(req) });
    },

    update: async (req, res) => {
      const input = parseInput(updateProfileSchema, req.body);
      const user = await deps.users.updateProfile(getAuthUser(req).id, input);
      sendSuccess(res, { user });
    },

    changePassword: async (req, res) => {
      const input = parseInput(changePasswordSchema, req.body);
      const { user, session } = await deps.auth.changePassword(getAuthUser(req).id, input);
      setSessionCookies(res, session, deps.cookies);
      sendSuccess(res, { user });
    },
  };
}
