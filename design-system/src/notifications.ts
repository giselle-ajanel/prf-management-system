// PRF notifications: what gets announced, to whom, and how it leaves the app.
//
// Delivery is deliberately behind a seam. This build has no server, no durable storage and no auth
// boundary, so email and push cannot be sent from here — a browser cannot authenticate as the
// organisation, and there is nowhere to queue a message that survives the tab closing. What it CAN do is
// decide precisely which events matter and who they are for, which is the part that would otherwise be
// re-litigated when a backend arrives. `notify()` takes that decision and hands it to a transport; the
// default transport records it locally and does nothing else.

import type { Request } from "./types";
import { money, routeFor } from "./utils";

/** What happened. Drives the icon and the wording. */
export type NotificationKind = "submitted" | "approved" | "returned" | "revision";

/** Who a notification is for. Resolved from the request, not from the viewer. */
export type NotificationAudience = "requester" | "approver";

export type PrfNotification = {
  id: string;
  kind: NotificationKind;
  audience: NotificationAudience;
  /** Display name of the person this is addressed to. */
  recipient: string;
  requestId: string;
  title: string;
  body: string;
  /** ISO timestamp. */
  at: string;
  read?: boolean;
};

/**
 * Where notifications go once raised.
 *
 * `deliver` is called for every notification. The in-app bell does not use it — it reads the returned
 * notification directly — so a transport is purely the outbound channel: email, push, a webhook, a queue.
 */
export type NotificationTransport = {
  name: string;
  deliver: (notification: PrfNotification) => void | Promise<void>;
};

/**
 * The default transport: records the notification and delivers nothing.
 *
 * Named rather than silent so it is obvious in a console why no email arrived. Replace it with
 * {@link setTransport} once there is a server able to send on the organisation's behalf.
 */
export const noopTransport: NotificationTransport = {
  name: "no-op (in-app only)",
  deliver: notification => {
    if (typeof console !== "undefined" && process.env.NODE_ENV !== "production") {
      console.info(`[notify:${notification.kind}] -> ${notification.recipient}: ${notification.title}`);
    }
  },
};

let transport: NotificationTransport = noopTransport;

/** Swaps the outbound channel. Call once at startup. */
export function setTransport(next: NotificationTransport) {
  transport = next;
}

/** The transport currently installed. */
export function currentTransport() {
  return transport;
}

let sequence = 0;
const nextId = () => `ntf-${Date.now().toString(36)}-${(sequence++).toString(36)}`;

/**
 * Builds the notification for a PRF event and hands it to the transport.
 *
 * Returns it so the caller can also place it in the in-app centre. Audience is derived from the event:
 * a submission is for whoever must approve it, every decision is for whoever raised it.
 *
 * ```ts
 * setNotifications(previous => [notify("submitted", request), ...previous]);
 * ```
 */
export function notify(kind: NotificationKind, request: Request, note = ""): PrfNotification {
  const at = new Date().toISOString();
  const total = money(request.amount);
  const approver = routeFor(request.amount);
  const built: Record<NotificationKind, Pick<PrfNotification, "audience" | "recipient" | "title" | "body">> = {
    submitted: {
      audience: "approver",
      recipient: approver,
      title: `${request.id} needs your review`,
      body: `${request.requester} submitted ${total} for ${request.school || "an unlisted site"}. Routed to ${approver} by the ${total} threshold.`,
    },
    approved: {
      audience: "requester",
      recipient: request.requester,
      title: `${request.id} was approved`,
      body: `${total} for ${request.vendor} has been approved and electronically signed.`,
    },
    returned: {
      audience: "requester",
      recipient: request.requester,
      title: `${request.id} was returned`,
      body: note ? `Returned for changes: ${note}` : `${total} for ${request.vendor} was returned for changes.`,
    },
    revision: {
      audience: "requester",
      recipient: request.requester,
      title: `${request.id} needs revision`,
      body: note || `Your approver asked for changes before ${total} can be approved.`,
    },
  };
  const notification: PrfNotification = { id: nextId(), kind, requestId: request.id, at, read: false, ...built[kind] };
  void transport.deliver(notification);
  return notification;
}

/** Count of unread notifications, for the bell badge. */
export const unreadCount = (notifications: PrfNotification[]) => notifications.filter(n => !n.read).length;

/** Marks every notification read. */
export const markAllRead = (notifications: PrfNotification[]) => notifications.map(n => ({ ...n, read: true }));

/** Relative time for the notification list — "just now", "12m ago", "3d ago". */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
