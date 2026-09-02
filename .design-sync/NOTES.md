# PRF Hub — design system & app notes

Running notes from the design-system extraction and the FY27 feature work.

## Needs a decision from Finance

- **`Dept Codes` → "Active?" column.** Every one of the 17 populated rows reads `No`. The existing
  inactive-word test in `lib/accounting.ts` matches `no`, so mapping that column to `status` would drop
  all 31 rows of the tab. It is currently **left unmapped**, meaning Dept Codes rows are all treated as
  available. If `No` really does mean inactive, that tab should be excluded entirely instead — the two
  readings are opposites and only Finance can say which is right.

- **Period-specific funding names.** `config/funding-overrides.json` ships with an empty `additions`
  list. The names in the brief (`Camino Nuevo 26-27`, `Camino Nuevo Summer 26`, `Camino Nuevo 27-28`)
  are **not in the workbook** — it lists a bare `Camino Nuevo`. They were not pre-filled because they are
  real accounting codes and inventing them would put unapproved codes into circulation. Add them to
  `additions` once confirmed, or to the master workbook.

## Workbook facts worth remembering

- Five sheets; four are read. `All Sites` (130 rows) is a site directory with no funding data and is not
  read. Grants site labels do **not** resolve against it.
- Site identity is `Site Code + Site Name`. Codes are reused across genuinely different sites — 2324 is
  both "Lennox Middle School- LX" and "McKinley ES".
- `Grants` funding names carry the periods the PRF form wants; `School Site Codes FY27` mostly does not.
- The workbook root copy `Accounting Codes FY27.xlsx` duplicates `.secure-data/`'s copy byte for byte.
  `.gitignore` now excludes `*.xlsx`; the root copy is otherwise untouched and could be deleted.

## Architecture

- **Server layer (added with authentication).** `lib/store.ts` is the data-access layer and the only place
  authorisation is decided; routes in `app/api/` are thin and never make a permission judgement of their
  own. `lib/api.ts` wraps every authenticated route with session, role, CSRF, rate limit and error mapping,
  so a new route cannot forget one. `lib/session.ts` owns the signed cookie and the idle rule.
- The approval ladder and the payment/expense vocabularies exist on both sides of the wire — the server
  cannot import the client barrel — and `test/authz.mjs` asserts the copies stay identical.
- Updating a draft is `PUT`, not `PATCH`: the body is the complete set of editable fields. An earlier
  PATCH-shaped handler silently blanked any field the body omitted, which is how the description of a
  submitted PRF went missing in testing.
- `app/page.tsx` owns state and persistence only. Every component, type and formatting helper lives in
  `design-system/src/` and is imported through the `@ds` path alias. `app/globals.css` is a single import
  of the design system's style entry point.
- **Style layer order is load-bearing.** `.modalBackdrop` is defined in layer 11 and redefined in layer 21
  with a higher z-index; `.ruleBanner` is patched by layer 24. `styles.css` replays the original file's
  order, and `snapshot.mjs` guards the concatenation with a recorded hash.
- `design-system/dist/` is build output for the design-sync converter. The app imports source, not dist.

## Testing

`npm test` runs all three groups: `test:ds` (design system), `test:server` (authorisation, sessions, input
handling — no server needed), and `test:http` (the same rules over HTTP against a dev server on a throwaway
store, so it never touches `.secure-data/`).

`npm run test:ds` runs seven suites. Parity suites pin markup to the pre-extraction commit `84fee05`;
components that intentionally move on graduate into `snapshot.mjs`.

- `utils-parity` — helpers vs originals over an edge-case matrix
- `render-parity` — extracted components vs originals
- `snapshot` — components that have deliberately changed, plus the stylesheet hash
- `options` — combobox option building; the menu only renders while open, so snapshots cannot see it
- `slice-parity` — components built from inline JSX vs the app's own output
- `page-snapshot` — the whole page in six states: the two gate states plus each role's own views. The
  requester snapshot is additionally asserted to contain none of the approver's surfaces, as a property
  rather than a recording.

Snapshot workflow: `UPDATE=1 node design-system/test/snapshot.mjs`, then review the diff before committing.

## Out of reach in this architecture

Email and push notifications still need a real transport; the in-app bell and the typed delivery seam are
in place so wiring one later is an isolated change.

The file store serialises writes through an in-process queue and commits by atomic rename. That is correct
for one Node process and wrong for several — the Prisma implementation of the same interface is where
multi-instance deployment starts.

## Decisions worth remembering

- **Roles are two, not nine.** `prisma/schema.prisma` models the full ladder (MANAGER … CEO, FINANCE,
  ADMIN); the running system collapses it to REQUESTER and APPROVER, which is what the two portals need.
  The dollar thresholds still name the authority level on the PRF, so widening this later is additive.
- **404 rather than 403** for a PRF the caller may not see, so the response cannot be used to discover which
  PRF numbers exist.
- **Demo passwords are generated, never committed.** They land in `.secure-data/seed-credentials.txt` beside
  the store, so pointing `PRF_STORE_PATH` at a test directory cannot overwrite a running instance's copy.
