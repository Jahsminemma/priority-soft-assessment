import { NavLink } from "react-router-dom";
import {
  IconAvailability,
  IconBell,
  IconCalendar,
  IconChart,
  IconClock,
  IconGrid,
  IconSettings,
  IconUsers,
} from "./NavIcons.js";

export type PrimaryNavListProps = {
  linkClass: ({ isActive }: { isActive: boolean }) => string;
  iconWrapClassName: string;
  onNavigate?: () => void;
  canManage: boolean;
  isStaff: boolean;
  unreadNotificationsCount?: number;
};

/**
 * Primary app routes with icons — used in desktop sidebar and mobile drawer.
 */
export function PrimaryNavList({
  linkClass,
  iconWrapClassName,
  onNavigate,
  canManage,
  isStaff,
  unreadNotificationsCount = 0,
}: PrimaryNavListProps): React.ReactElement {
  const iw = iconWrapClassName;
  const badgeCount = unreadNotificationsCount > 99 ? "99+" : String(unreadNotificationsCount);

  return (
    <>
      <NavLink to="/" end onClick={onNavigate} className={linkClass}>
        <span className={iw}>
          <IconGrid />
        </span>
        <span>Dashboard</span>
      </NavLink>
      {canManage ? (
        <NavLink to="/admin/team" onClick={onNavigate} className={linkClass}>
          <span className={iw}>
            <IconUsers />
          </span>
          <span>Team</span>
        </NavLink>
      ) : null}
      {canManage ? (
        <>
          <NavLink to="/schedule" onClick={onNavigate} className={linkClass}>
            <span className={iw}>
              <IconCalendar />
            </span>
            <span>Schedule & shifts</span>
          </NavLink>
          <NavLink to="/analytics" onClick={onNavigate} className={linkClass}>
            <span className={iw}>
              <IconChart />
            </span>
            <span>Schedule analytics</span>
          </NavLink>
        </>
      ) : null}
      {isStaff ? (
        <>
          <NavLink to="/my-week" onClick={onNavigate} className={linkClass}>
            <span className={iw}>
              <IconCalendar />
            </span>
            <span>My schedule</span>
          </NavLink>
          <NavLink to="/availability" onClick={onNavigate} className={linkClass}>
            <span className={iw}>
              <IconAvailability />
            </span>
            <span>My availability</span>
          </NavLink>
        </>
      ) : null}
      <NavLink to="/clock" onClick={onNavigate} className={linkClass}>
        <span className={iw}>
          <IconClock />
        </span>
        <span>Clock & on-duty</span>
      </NavLink>
      <NavLink to="/notifications" onClick={onNavigate} className={linkClass}>
        <span className={`${iw}${unreadNotificationsCount > 0 ? " nav-rail__icon-wrap--with-badge" : ""}`}>
          <IconBell />
          {unreadNotificationsCount > 0 ? (
            <span className="nav-rail__icon-badge" aria-hidden title="Unread notifications">
              {badgeCount}
            </span>
          ) : null}
        </span>
        <span className="nav-rail__label">Notifications</span>
      </NavLink>
      <NavLink to="/settings" onClick={onNavigate} className={linkClass}>
        <span className={iw}>
          <IconSettings />
        </span>
        <span>Settings</span>
      </NavLink>
    </>
  );
}
