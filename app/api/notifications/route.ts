import { authenticated, json } from "@/lib/api";
import { listNotifications, markNotificationsRead } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The bell. Notifications are addressed to an account id, or to an email for a colleague who was copied in
// on a request but has no account of their own — listNotifications resolves both against the caller.

export const GET = authenticated({ name: "notifications.list" }, async ({ session }) => {
  return json({ notifications: await listNotifications(session) });
});

export const POST = authenticated({ name: "notifications.read", mutation: true }, async ({ session }) => {
  await markNotificationsRead(session);
  return json({ read: true });
});
