"use client";

import { useEffect, useRef, useState } from "react";
import type { PrfNotification } from "../notifications";
import { relativeTime, unreadCount } from "../notifications";

export type NotificationBellProps = {
  notifications: PrfNotification[];
  /** Marks everything read. Called when the panel opens. */
  onMarkAllRead?: () => void;
  /** Opens the request a notification refers to. */
  onOpen?: (requestId: string) => void;
  /** Shown when there is nothing to report. */
  emptyLabel?: string;
};

const ICONS: Record<PrfNotification["kind"], string> = {
  submitted: "↗",
  approved: "✓",
  returned: "!",
  revision: "✎",
};

/**
 * Notification bell with a dropdown centre, for the application header.
 *
 * The badge counts unread items; opening the panel marks them read. Entries are newest first and each
 * one opens the PRF it refers to.
 *
 * ```tsx
 * <NotificationBell
 *   notifications={notifications}
 *   onMarkAllRead={() => setNotifications(markAllRead)}
 *   onOpen={openRequestById}
 * />
 * ```
 */
export function NotificationBell({
  notifications,
  onMarkAllRead,
  onOpen,
  emptyLabel = "No notifications yet",
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const unread = unreadCount(notifications);

  // Clicking anywhere else, or pressing Escape, closes the panel.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread) onMarkAllRead?.();
  };

  return (
    <div className="notificationBell" ref={rootRef}>
      <button
        type="button"
        className="bellButton"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={toggle}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="bellBadge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="bellPanel" role="dialog" aria-label="Notifications">
          <header>
            <strong>Notifications</strong>
            <small>{notifications.length ? `${notifications.length} recent` : ""}</small>
          </header>
          {notifications.length ? (
            <ul>
              {notifications.map(notification => (
                <li key={notification.id} className={notification.read ? "" : "unread"}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpen?.(notification.requestId);
                      setOpen(false);
                    }}
                  >
                    <span className={`bellIcon kind-${notification.kind}`} aria-hidden="true">
                      {ICONS[notification.kind]}
                    </span>
                    <span className="bellText">
                      <strong>{notification.title}</strong>
                      <span>{notification.body}</span>
                      <small>
                        {relativeTime(notification.at)}
                        {notification.audience === "approver" ? ` · for ${notification.recipient}` : ""}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bellEmpty">{emptyLabel}</p>
          )}
        </div>
      )}
    </div>
  );
}
