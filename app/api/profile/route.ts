import { authenticated, json } from "@/lib/api";
import { email as parseEmail, line } from "@/lib/sanitize";
import { findUserById, updateProfile } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Your own profile. Name and contact address only — the position is not in the payload, and passing one
// changes nothing, because this handler never reads it.

export const GET = authenticated({ name: "profile.get" }, async ({ session }) => {
  const user = await findUserById(session.userId);
  return json({
    profile: {
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      email: session.email,
      contactEmail: user?.contactEmail || session.email,
      role: session.role,
      district: session.district,
      school: session.school,
    },
  });
});

export const PUT = authenticated({ name: "profile.update", mutation: true }, async ({ session, body }) => {
  const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const user = await updateProfile(session, {
    firstName: line(payload.firstName, "First name", 60),
    lastName: line(payload.lastName, "Last name", 60),
    contactEmail: payload.contactEmail ? parseEmail(payload.contactEmail, "Contact email") : session.email,
  });
  return json({ profile: { firstName: user.firstName, lastName: user.lastName, email: user.email, contactEmail: user.contactEmail, role: user.role } });
});
