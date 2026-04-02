import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext.js";
import { AppShell } from "./layout/AppShell.js";
import LoginPage from "./pages/LoginPage.js";
import DashboardPage from "./pages/DashboardPage.js";
import SchedulePage from "./pages/SchedulePage.js";
import StaffSchedulePage from "./pages/StaffSchedulePage.js";
import StaffShiftDetailPage from "./pages/StaffShiftDetailPage.js";
import ClockPage from "./pages/ClockPage.js";
import AnalyticsPage from "./pages/AnalyticsPage.js";
import NotificationsPage from "./pages/NotificationsPage.js";
import SettingsPage from "./pages/SettingsPage.js";
import AvailabilityPage from "./pages/AvailabilityPage.js";
import RegisterPage from "./pages/RegisterPage.js";
import TeamPage from "./pages/TeamPage.js";
import AuditTrailPage from "./pages/AuditTrailPage.js";
import ManageShiftsPage from "./pages/ManageShiftsPage.js";

function ProtectedLayout(): React.ReactElement {
  const { token } = useAuth();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <AppShell />;
}

export default function App(): React.ReactElement {
  return (
    <div className="app-root">
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/manage/shifts" element={<ManageShiftsPage />} />
        <Route path="/assignments" element={<Navigate to="/schedule" replace />} />
        <Route path="/my-week" element={<StaffSchedulePage />} />
        <Route path="/my-shifts/:shiftId" element={<StaffShiftDetailPage />} />
        <Route path="/clock" element={<ClockPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/availability" element={<AvailabilityPage />} />
        <Route path="/admin/team" element={<TeamPage />} />
        <Route path="/admin/audit" element={<AuditTrailPage />} />
        <Route path="/admin/invites" element={<Navigate to="/admin/team" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </div>
  );
}
