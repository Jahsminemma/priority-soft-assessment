import { Link } from "react-router-dom";
import { normalizeIsoWeekKey } from "@shiftsync/shared";
import { ManagerHomeDashboard } from "../components/ManagerHomeDashboard.js";
import { StaffHomeDashboard } from "../components/StaffHomeDashboard.js";
import { useAuth } from "../context/AuthContext.js";
import { formatWeekRangeLabel, initialWeekKeyFromToday } from "../utils/weekKey.js";

export default function DashboardPage(): React.ReactElement {
  const { user, token } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";
  const isStaff = user?.role === "STAFF";

  if (isStaff && token) {
    return (
      <div className="page page--staff-dash">
        <StaffHomeDashboard token={token} userName={user?.name} />
      </div>
    );
  }

  if (canManage && token) {
    return <ManagerHomeDashboard token={token} userName={user?.name} role={user?.role} />;
  }

  return (
    <div className="page">
      <h1 className="page__title">Home</h1>
      <p className="page__lead muted">
        Choose something to do below, or use the menu on the left. Schedules are organized by{" "}
        <strong>week</strong>—for example <strong>{formatWeekRangeLabel(normalizeIsoWeekKey(initialWeekKeyFromToday()))}</strong> (pick any day in that week
        on schedule screens).
      </p>

      <div className="grid-2">
        <div className="card">
          <h2 className="card__title">Account</h2>
          <ul className="link-list">
            <li>
              <Link to="/notifications">Notifications</Link>
            </li>
            <li>
              <Link to="/settings">How you want to be notified</Link>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
