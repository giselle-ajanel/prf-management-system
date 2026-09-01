"use client";

import { Fragment } from "react";
import type { ReactNode } from "react";

export type NavItem = {
  /** Stable id, compared against `active` to decide which tab is current. */
  id: string;
  label: ReactNode;
  disabled?: boolean;
  /** Tooltip, typically explaining why the item is disabled. */
  title?: string;
};

export type AppHeaderProps = {
  items: NavItem[];
  /** Id of the current view. */
  active: string;
  onNavigate: (id: string) => void;
  /** Clicking the brand — usually navigates home. */
  onBrandClick?: () => void;
  /** Text in the rounded brand chip. */
  brandMark?: string;
  /** Brand wordmark, one entry per line. */
  brandLines?: string[];
  /** Initials shown in the avatar circle. */
  initials: string;
  userName: ReactNode;
  /** Role shown beside the name and selected in the switcher. */
  userRole: string;
  /** Secondary line under the name — org, department. */
  userOrg: ReactNode;
  /** Options for the role switcher. Omit to hide the switcher entirely. */
  roles?: string[];
  onRoleChange?: (role: string) => void;
  roleLabel?: string;
};

/**
 * Sticky application header: brand, primary navigation, and the profile cluster with its role switcher.
 *
 * Navigation items carry their own `disabled` and `title`, so permission rules live with the caller
 * rather than in the header. Below 820px the nav becomes a fixed bottom bar via the stylesheet.
 *
 * ```tsx
 * <AppHeader
 *   items={[
 *     { id: "overview", label: "Overview" },
 *     { id: "finance", label: "Finance", disabled: role !== "Finance", title: "Finance permission required" },
 *   ]}
 *   active={view}
 *   onNavigate={navigate}
 *   initials="GA"
 *   userName="Giselle Ajanel"
 *   userRole={role}
 *   userOrg="Woodcraft — Finance"
 *   roles={["Requester", "Finance"]}
 *   onRoleChange={setRole}
 * />
 * ```
 */
export function AppHeader({
  items,
  active,
  onNavigate,
  onBrandClick,
  brandMark = "PRF",
  brandLines = ["Purchase", "Request Hub"],
  initials,
  userName,
  userRole,
  userOrg,
  roles,
  onRoleChange,
  roleLabel = "Demo role",
}: AppHeaderProps) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onBrandClick}>
        <span className="brandMark">{brandMark}</span>
        <span>
          {brandLines.map((line, index) => (
            <Fragment key={line}>
              {index > 0 && <br />}
              {line}
            </Fragment>
          ))}
        </span>
      </button>
      <nav className="navLinks" aria-label="Primary navigation">
        {items.map(item => (
          <button
            key={item.id}
            className={active === item.id ? "active" : ""}
            disabled={item.disabled}
            // Left undefined rather than defaulted to "": React omits an undefined attribute but emits
            // title="" for an empty string, and the original markup has no title on unrestricted tabs.
            title={item.title}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="profile">
        <span className="avatar">{initials}</span>
        <span>
          <strong>
            {userName} · {userRole}
          </strong>
          <small>{userOrg}</small>
        </span>
        {roles && (
          <select
            aria-label={roleLabel}
            value={userRole}
            onChange={event => onRoleChange?.(event.target.value)}
          >
            {roles.map(role => (
              <option key={role}>{role}</option>
            ))}
          </select>
        )}
      </div>
    </header>
  );
}
