import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "./password";
import { listUsers, storeDirectory, upsertUser, type Role, type StoredUser } from "./store";

// First-run demo accounts.
//
// No password is written in this file, and none is committed anywhere. Each account gets a random one on
// first run, printed to the server console and written to .secure-data/seed-credentials.txt (git-ignored,
// mode 600). That is a little less convenient than a README with "password123" in it, and it means this
// repository cannot ship a working credential to whoever clones it next.
//
// These accounts exist for the demo path only. Under SSO the proxy asserts the identity and the password
// field is never consulted.

type SeedUser = { email: string; name: string; role: Role; district: string; school: string };

const SEED_USERS: SeedUser[] = [
  {
    email: "giselle.ajanel@woodcraftrangers.org",
    name: "Giselle Ajanel",
    role: "REQUESTER",
    district: "District 4",
    school: "Central High School",
  },
  {
    email: "maya.thompson@woodcraftrangers.org",
    name: "Maya Thompson",
    role: "REQUESTER",
    district: "District 1",
    school: "Lincoln Middle School",
  },
  {
    email: "marcus.lee@woodcraftrangers.org",
    name: "Marcus Lee",
    role: "APPROVER",
    district: "Woodcraft",
    school: "Finance",
  },
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
        name: seed.name,
        role: seed.role,
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
      ...created.map(entry => `${entry.user.role.padEnd(9)} ${entry.user.email}  ${entry.secret}`),
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
