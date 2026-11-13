/** Mirrors the backend's public user shape (backend/api/src/services/user.service.ts). */
export type UserRole = "CITIZEN" | "ADMIN" | "ENGINEER";
export type AccountStatus = "PENDING_VERIFICATION" | "ACTIVE" | "DEACTIVATED";

export interface User {
  id: string;
  fullName: string;
  mobileNumber: string;
  role: UserRole;
  status: AccountStatus;
  mobileVerifiedAt: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
