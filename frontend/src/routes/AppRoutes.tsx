import { Route, Routes } from "react-router";
import { AdminAnalyticsPage } from "../features/admin/AdminAnalyticsPage";
import { AdminDashboardPage } from "../features/admin/AdminDashboardPage";
import { AdminReportDetailPage } from "../features/admin/AdminReportDetailPage";
import { AdminReportsPage } from "../features/admin/AdminReportsPage";
import { EngineerDetailPage } from "../features/admin/EngineerDetailPage";
import { EngineersPage } from "../features/admin/EngineersPage";
import { ChangePasswordPage } from "../features/auth/ChangePasswordPage";
import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { VerifyOtpPage } from "../features/auth/VerifyOtpPage";
import { ChatPage } from "../features/chat/ChatPage";
import { CitizenDashboardPage } from "../features/citizen/CitizenDashboardPage";
import { NewReportPage } from "../features/citizen/NewReportPage";
import { ReportDetailPage } from "../features/citizen/ReportDetailPage";
import { EngineerDashboardPage } from "../features/engineer/EngineerDashboardPage";
import { EngineerHistoryPage } from "../features/engineer/EngineerHistoryPage";
import { EngineerJobDetailPage } from "../features/engineer/EngineerJobDetailPage";
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
            <Route index element={<AdminDashboardPage />} />
            <Route path="analytics" element={<AdminAnalyticsPage />} />
            <Route path="reports" element={<AdminReportsPage />} />
            <Route path="reports/:id" element={<AdminReportDetailPage />} />
            <Route path="engineers" element={<EngineersPage />} />
            <Route path="engineers/:id" element={<EngineerDetailPage />} />
          </Route>
          <Route path="/engineer" element={<RequireRole roles={["ENGINEER"]} />}>
            <Route index element={<EngineerDashboardPage />} />
            <Route path="jobs/:id" element={<EngineerJobDetailPage />} />
            <Route path="history" element={<EngineerHistoryPage />} />
          </Route>
          <Route path="/chat" element={<RequireRole roles={["ADMIN", "ENGINEER"]} />}>
            <Route index element={<ChatPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
