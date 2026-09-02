import { authenticated, json } from "@/lib/api";
import { id as parseId, oneOf } from "@/lib/sanitize";
import { ROLES, assignRole, listUsers } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The directory, and the one place a position can be reassigned. Finance and administrators only, enforced
// both at the route and again in the store — and never for your own account.

export const GET = authenticated({ name: "users.list", authority: "admin" }, async () => {
  const users = await listUsers();
  return json({
    users: users.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      contactEmail: user.contactEmail,
      role: user.role,
      district: user.district,
      school: user.school,
    })),
  });
});

export const PUT = authenticated(
  { name: "users.role", mutation: true, authority: "admin" },
  async ({ session, body }) => {
    const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const user = await assignRole(session, parseId(payload.userId, "User id"), oneOf(payload.role, "Position", ROLES));
    return json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  },
);
