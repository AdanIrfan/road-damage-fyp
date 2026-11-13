import { api } from "../../lib/api";
import type { User } from "../../lib/types";

export interface RegisterInput {
  fullName: string;
  mobileNumber: string;
  password: string;
  confirmPassword: string;
}

export interface OtpSent {
  mobileNumber?: string;
  otpExpiresAt?: string;
  resendAvailableAt?: string;
  message?: string;
}

export const authApi = {
  register: (input: RegisterInput) => api.post<Required<Omit<OtpSent, "message">>>("/api/v1/auth/register", input),
  verifyOtp: (mobileNumber: string, code: string) => api.post<{ verified: true }>("/api/v1/auth/otp/verify", { mobileNumber, code }),
  resendOtp: (mobileNumber: string) => api.post<OtpSent>("/api/v1/auth/otp/resend", { mobileNumber }),
  login: (mobileNumber: string, password: string) => api.post<{ user: User }>("/api/v1/auth/login", { mobileNumber, password }),
  logout: () => api.post<{ loggedOut: true }>("/api/v1/auth/logout"),
  me: () => api.get<{ user: User }>("/api/v1/auth/me"),
};

export const profileApi = {
  update: (fullName: string) => api.patch<{ user: User }>("/api/v1/profile", { fullName }),
  changePassword: (input: { currentPassword: string; newPassword: string; confirmNewPassword: string }) =>
    api.post<{ user: User }>("/api/v1/profile/password", input),
};
