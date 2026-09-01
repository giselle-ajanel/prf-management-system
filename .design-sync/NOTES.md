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

- `app/page.tsx` owns state and persistence only. Every component, type and formatting helper lives in
  `design-system/src/` and is imported through the `@ds` path alias. `app/globals.css` is a single import
  of the design system's style entry point.
- **Style layer order is load-bearing.** `.modalBackdrop` is defined in layer 11 and redefined in layer 21
  with a higher z-index; `.ruleBanner` is patched by layer 24. `styles.css` replays the original file's
  order, and `snapshot.mjs` guards the concatenation with a recorded hash.
- `design-system/dist/` is build output for the design-sync converter. The app imports source, not dist.

## Testing

`npm run test:ds` runs six suites. Parity suites pin markup to the pre-extraction commit `84fee05`;
components that intentionally move on graduate into `snapshot.mjs`.

- `utils-parity` — helpers vs originals over an edge-case matrix
- `render-parity` — extracted components vs originals
- `snapshot` — components that have deliberately changed, plus the stylesheet hash
- `options` — combobox option building; the menu only renders while open, so snapshots cannot see it
- `slice-parity` — components built from inline JSX vs the app's own output
- `app-parity` — the whole page, three view states

Snapshot workflow: `UPDATE=1 node design-system/test/snapshot.mjs`, then review the diff before committing.

## Out of reach in this architecture

Email and push notifications need a server, durable storage and an auth boundary; this prototype has
browser-local persistence and demo identity. The notification work builds the in-app bell plus a typed
delivery seam so wiring a real transport later is an isolated change.
