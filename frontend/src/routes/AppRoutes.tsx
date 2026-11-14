import { Route, Routes } from "react-router";
import { EngineerDetailPage } from "../features/admin/EngineerDetailPage";
import { EngineersPage } from "../features/admin/EngineersPage";
import { ChangePasswordPage } from "../features/auth/ChangePasswordPage";
import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { VerifyOtpPage } from "../features/auth/VerifyOtpPage";
import { CitizenDashboardPage } from "../features/citizen/CitizenDashboardPage";
import { NewReportPage } from "../features/citizen/NewReportPage";
import { ReportDetailPage } from "../features/citizen/ReportDetailPage";
import { AppLayout } from "../layouts/AppLayout";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ProfilePage } from "../pages/ProfilePage";
import { HomeRedirect, PublicOnly, RequireAuth, RequireRole } from "./guards";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify" element={<VerifyOtpPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route element={<AppLayout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/reports" element={<RequireRole roles={["CITIZEN"]} />}>
            <Route index element={<CitizenDashboardPage />} />
            <Route path="new" element={<NewReportPage />} />
            <Route path=":id" element={<ReportDetailPage />} />
          </Route>
          <Route path="/admin" element={<RequireRole roles={["ADMIN"]} />}>
            <Route path="engineers" element={<EngineersPage />} />
            <Route path="engineers/:id" element={<EngineerDetailPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
