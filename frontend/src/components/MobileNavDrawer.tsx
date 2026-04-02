import { useCallback, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { IconCalendarMark, IconClose, IconSignOut } from "./NavIcons.js";
import { PrimaryNavList } from "./PrimaryNavList.js";
import { roleLabel, userInitial } from "../utils/navUser.js";

type MobileNavDrawerProps = {
  open: boolean;
  onClose: () => void;
  userName: string | undefined;
  userRole: string | undefined;
  canManage: boolean;
  isStaff: boolean;
  isAdmin: boolean;
  onSignOut: () => void;
};

const drawerLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `nav-rail__link${isActive ? " nav-rail__link--active" : ""}`;

/** Dark slide-out navigation (mobile). Same links & styling as desktop sidebar. */
export function MobileNavDrawer({
  open,
  onClose,
  userName,
  userRole,
  canManage,
  isStaff,
  isAdmin,
  onSignOut,
}: MobileNavDrawerProps): React.ReactElement {
  const location = useLocation();
  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    close();
  }, [location.pathname, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <div className={`mobile-drawer${open ? " mobile-drawer--open" : ""}`} aria-hidden={!open}>
      <button type="button" className="mobile-drawer__backdrop" onClick={onClose} tabIndex={open ? 0 : -1} aria-label="Close menu" />
      <div
        id="mobile-nav-drawer-panel"
        className="mobile-drawer__panel nav-rail"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        <div className="nav-rail__top">
          <div className="nav-rail__brand-row">
            <div className="nav-rail__logo-mark" aria-hidden>
              <IconCalendarMark />
            </div>
            <div className="nav-rail__brand-text-block">
              <span className="nav-rail__brand-text">ShiftSync</span>
            </div>
            <button type="button" className="nav-rail__close" onClick={onClose} aria-label="Close menu">
              <IconClose />
            </button>
          </div>
        </div>

        <nav className="nav-rail__nav" aria-label="Primary">
          <PrimaryNavList
            linkClass={drawerLinkClass}
            iconWrapClassName="nav-rail__icon-wrap"
            onNavigate={onClose}
            canManage={canManage}
            isStaff={isStaff}
            isAdmin={isAdmin}
          />
        </nav>

        <div className="nav-rail__footer">
          <div className="nav-rail__profile">
            <div className="nav-rail__avatar" aria-hidden>
              {userInitial(userName)}
            </div>
            <div className="nav-rail__profile-text">
              <span className="nav-rail__profile-name">{userName ?? "Signed in"}</span>
              <span className="nav-rail__profile-role">{roleLabel(userRole)}</span>
            </div>
          </div>
          <button
            type="button"
            className="nav-rail__signout"
            onClick={() => {
              onClose();
              onSignOut();
            }}
          >
            <IconSignOut />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
