import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "./password";
import { listUsers, storeDirectory, upsertUser, type Role, type StoredUser, type Tier, type ViewerProfile } from "./store";

// First-run demo accounts.
//
// No password is written in this file, and none is committed anywhere. Each account gets a random one on
// first run, printed to the server console and written to .secure-data/seed-credentials.txt (git-ignored,
// mode 600). That is a little less convenient than a README with "password123" in it, and it means this
// repository cannot ship a working credential to whoever clones it next.
//
// These accounts exist for the demo path only. Under SSO the proxy asserts the identity and the password
// field is never consulted.

type SeedUser = { email: string; firstName: string; lastName: string; role: Role; tier?: Tier; viewer?: ViewerProfile; district: string; school: string };

// Position-prefixed addresses so it is obvious which ladder rung an account represents. The domain stays
// woodcraftrangers.org: PRF_ALLOWED_EMAIL_DOMAINS is configured for it, and an account on another domain
// would be refused the moment this deployment sits behind SSO.
const SEED_USERS: SeedUser[] = [
  { email: "giselle.ajanel@woodcraftrangers.org", firstName: "Giselle", lastName: "Ajanel", role: "REQUESTER", district: "District 4", school: "Central High School" },
  { email: "maya.thompson@woodcraftrangers.org", firstName: "Maya", lastName: "Thompson", role: "REQUESTER", district: "District 1", school: "Lincoln Middle School" },
  { email: "manager@woodcraftrangers.org", firstName: "Marcus", lastName: "Lee", role: "APPROVER", tier: "MANAGER", district: "Woodcraft", school: "Operations" },
  { email: "director@woodcraftrangers.org", firstName: "Ana", lastName: "Rivera", role: "APPROVER", tier: "DIRECTOR", district: "Woodcraft", school: "Programs" },
  { email: "seniordirector@woodcraftrangers.org", firstName: "Priya", lastName: "Nair", role: "APPROVER", tier: "SENIOR_DIRECTOR", district: "Woodcraft", school: "Programs" },
  { email: "chief@woodcraftrangers.org", firstName: "Daniel", lastName: "Okafor", role: "APPROVER", tier: "CHIEF", district: "Woodcraft", school: "Executive" },
  { email: "cfo@woodcraftrangers.org", firstName: "Sofia", lastName: "Alvarez", role: "APPROVER", tier: "CFO", district: "Woodcraft", school: "Executive" },
  { email: "ceo@woodcraftrangers.org", firstName: "Robert", lastName: "Chen", role: "APPROVER", tier: "CEO", district: "Woodcraft", school: "Executive" },
  { email: "finance@woodcraftrangers.org", firstName: "Tomas", lastName: "Reyes", role: "FINANCE_REVIEWER", district: "Woodcraft", school: "Finance" },
  { email: "financeadmin@woodcraftrangers.org", firstName: "Elena", lastName: "Petrov", role: "FINANCE_ADMIN", district: "Woodcraft", school: "Finance" },
  // The five viewer profiles, each on its own address so role-based testing is obvious at a glance.
  { email: "auditor@woodcraftrangers.org", firstName: "Nadia", lastName: "Reid", role: "VIEW_ONLY", viewer: "AUDITOR", district: "Woodcraft", school: "External Audit" },
  { email: "bookkeeper@woodcraftrangers.org", firstName: "Ben", lastName: "Ortiz", role: "VIEW_ONLY", viewer: "BOOKKEEPER", district: "Woodcraft", school: "Finance" },
  { email: "member@woodcraftrangers.org", firstName: "Sam", lastName: "Whitfield", role: "VIEW_ONLY", viewer: "MEMBER", district: "District 4", school: "Central High School" },
  { email: "travelmanager@woodcraftrangers.org", firstName: "Iris", lastName: "Kaur", role: "VIEW_ONLY", viewer: "TRAVEL_MANAGER", district: "Woodcraft", school: "Operations" },
  { email: "assistant@woodcraftrangers.org", firstName: "Leo", lastName: "Barnes", role: "VIEW_ONLY", viewer: "ASSISTANT", district: "Woodcraft", school: "Executive" },
];

const password = () => randomBytes(12).toString("base64url");

let seeding: Promise<void> | null = null;

/** Idempotent, and cheap after the first call: an existing user list short-circuits before any hashing. */
export async function ensureSeeded(): Promise<void> {
  if (seeding) return seeding;
  seeding = (async () => {
    if ((await listUsers()).length) return;

    const created: { user: StoredUser; secret: string }[] = [];
    for (const seed of SEED_USERS) {
      const secret = password();
      const user: StoredUser = {
        id: `user-${randomBytes(8).toString("hex")}`,
        email: seed.email,
        firstName: seed.firstName,
        lastName: seed.lastName,
        name: `${seed.firstName} ${seed.lastName}`,
        contactEmail: seed.email,
        role: seed.role,
        tier: seed.tier,
        viewer: seed.viewer,
        district: seed.district,
        school: seed.school,
        passwordHash: await hashPassword(secret),
      };
      await upsertUser(user);
      created.push({ user, secret });
    }

    const lines = [
      "Purchase Request Hub — demo sign-in credentials",
      `Generated ${new Date().toISOString()} on first run. Delete this file to rotate: the accounts are`,
      "recreated with new passwords when the store is empty.",
      "",
      ...created.map(entry => `${(entry.user.tier || entry.user.viewer ? `${entry.user.role}/${entry.user.tier || entry.user.viewer}` : entry.user.role).padEnd(26)} ${entry.user.email.padEnd(42)} ${entry.secret}`),
      "",
    ];
    // Alongside the store rather than at a fixed path, so pointing PRF_STORE_PATH elsewhere (a test
    // run, a second instance) cannot overwrite the credentials of the deployment next door.
    const target = path.join(storeDirectory(), "seed-credentials.txt");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, lines.join(String.fromCharCode(10)), { mode: 0o600 });
    console.log([String.fromCharCode(10), ...lines].join(String.fromCharCode(10)));
  })();
  return seeding;
}

/** Test seam: lets a suite re-seed against a fresh store path. */
export function resetSeedState(): void {
  seeding = null;
}
