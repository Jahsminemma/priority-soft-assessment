import { useCallback, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { MobileNavDrawer } from "../components/MobileNavDrawer.js";
import { IconSignOut } from "../components/NavIcons.js";
import { PrimaryNavList } from "../components/PrimaryNavList.js";
import { useAuth } from "../context/AuthContext.js";
import { useSocketSync } from "../hooks/useSocketSync.js";
import { roleLabel, userInitial } from "../utils/navUser.js";
import { useQuery } from "@tanstack/react-query";
import { fetchNotifications } from "../api.js";

const sidebarLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `nav-rail__link${isActive ? " nav-rail__link--active" : ""}`;

function IconHamburger(): React.ReactElement {
  return (
    <svg className="app-shell__hamburger-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path strokeWidth="2" strokeLinecap="round" d="M5 7h14M5 12h14M5 17h14" />
    </svg>
  );
}

function IconBellHeader(): React.ReactElement {
  return (
    <svg className="app-shell__bell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 7H3s3 0 3-7M10 20a2 2 0 0 0 4 0"
      />
    </svg>
  );
}

export function AppShell(): React.ReactElement {
  const { user, logout, token } = useAuth();
  useSocketSync();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";
  const isStaff = user?.role === "STAFF";
  const isAdmin = user?.role === "ADMIN";

  const unreadCount = useQuery({
    queryKey: ["notifications", token],
    queryFn: () => fetchNotifications(token!),
    enabled: Boolean(token),
    // Keep UI snappy; also driven by socket invalidations on new notifications.
    staleTime: 10_000,
    retry: false,
  });
  const unreadNotificationsCount = (unreadCount.data ?? []).filter((n) => !n.readAt).length;
  const badgeCount = unreadNotificationsCount > 99 ? "99+" : String(unreadNotificationsCount);

  const signOut = (): void => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-shell">
      <div className="app-shell__body">
        <aside className="app-shell__sidebar nav-rail" aria-label="Main navigation">
          <div className="nav-rail__top app-shell__sidebar-top">
            <div className="nav-rail__brand-row">
              <div className="nav-rail__brand-text-block">
                <span className="nav-rail__brand-text">ShiftSync</span>
                <span className="nav-rail__brand-sub">Workforce scheduling</span>
              </div>
            </div>
          </div>

          <nav className="nav-rail__nav app-shell__sidebar-nav" aria-label="Primary">
            <PrimaryNavList
              linkClass={sidebarLinkClass}
              iconWrapClassName="nav-rail__icon-wrap"
              canManage={canManage}
              isStaff={isStaff}
              isAdmin={isAdmin}
              unreadNotificationsCount={unreadNotificationsCount}
            />
          </nav>

          <div className="nav-rail__footer app-shell__sidebar-footer">
            <div className="nav-rail__profile">
              <div className="nav-rail__avatar" aria-hidden>
                {userInitial(user?.name)}
              </div>
              <div className="nav-rail__profile-text">
                <span className="nav-rail__profile-name">{user?.name ?? "Signed in"}</span>
                <span className="nav-rail__profile-role">{roleLabel(user?.role)}</span>
              </div>
            </div>
            <button type="button" className="nav-rail__signout" onClick={signOut}>
              <IconSignOut />
              <span>Sign out</span>
            </button>
          </div>
        </aside>
        <div className="app-shell__main">
          <header className="app-shell__header">
            <button
              type="button"
              className="app-shell__hamburger"
              aria-label="Open menu"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav-drawer-panel"
              onClick={() => setMobileNavOpen(true)}
            >
              <IconHamburger />
            </button>
            <span className="app-shell__header-brand-center">ShiftSync</span>
            <NavLink
              to="/notifications"
              className={({ isActive }) =>
                `app-shell__header-bell${isActive ? " app-shell__header-bell--active" : ""}`
              }
              aria-label="Notifications"
              onClick={closeMobileNav}
            >
              <span className="app-shell__bell-badge-wrap">
                <IconBellHeader />
                {unreadNotificationsCount > 0 ? (
                  <span className="app-shell__bell-badge" aria-hidden title="Unread notifications">
                    {badgeCount}
                  </span>
                ) : null}
              </span>
            </NavLink>
            <div className="app-shell__header-actions app-shell__header-actions--desktop">
              <div className="app-shell__user">
                <span className="app-shell__user-name">{user?.name}</span>
                <span className="app-shell__user-role">{user?.role}</span>
              </div>
              <button type="button" className="btn btn--ghost app-shell__signout" onClick={signOut}>
                Sign out
              </button>
            </div>
          </header>
          <main
            className={`app-shell__content${location.pathname.startsWith("/schedule") ? " app-shell__content--workspace" : ""}`}
          >
            <Outlet />
          </main>
        </div>
      </div>
      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={closeMobileNav}
        userName={user?.name}
        userRole={user?.role}
        canManage={canManage}
        isStaff={isStaff}
        isAdmin={isAdmin}
        onSignOut={signOut}
        unreadNotificationsCount={unreadNotificationsCount}
      />
    </div>
  );
}
