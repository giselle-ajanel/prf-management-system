# Publishing a shared link

## The public preview

The offline demo is published straight from the repository, at:

**https://giselle-ajanel.github.io/prf-management-system/**

Anyone with that link can open the Hub on a desktop, tablet or phone with nothing installed. It is the
single-file build — the real interface and the real rules, running entirely in the visitor's browser, with
demo data that never leaves their device. Each visitor gets their own copy; nothing they do is visible to
anyone else.

Everything is invented: the accounts, the sites, the requests. The sign-in password in that build is the
word `demo`, and that is deliberate — there is nothing there to protect.

**Attachments in the demo.** Receipts upload, list, open and download there too, held as base64 in browser
storage rather than as files on disk. The ceiling is **1.5 MB per file** rather than the server's 10 MB:
base64 costs a third again in size and a browser gives an origin only a few megabytes in total, so a demo
that accepted a 10 MB scan would fail on the second one. Validation is identical — the same check on the
file's own leading bytes, so a renamed executable is refused there as well. One honest difference: in the
demo the bytes sit in the visitor's own browser storage, so the access rules around them are a courtesy
rather than a boundary. Everything in that build is, which is why it holds nothing real.

`npm run build:share` writes the demo to both `share/PRF-Hub.html` and `docs/index.html`, and GitHub Pages
serves the second one. There is no build pipeline to go wrong: the file in the repository *is* the site.

If the link 404s, Pages needs turning on once, which takes four clicks and no terminal:
**repository → Settings → Pages → Source: "Deploy from a branch" → Branch: `main`, folder: `/docs` → Save.**
Give it a minute and the link works. Every later `npm run build:share` plus a push updates it.

## Hosting the real application

The demo is enough for showing people how the Hub works. Hosting the *real* application — the one that
enforces its rules on a server the visitor does not control — needs somewhere with a writable disk.

**This matters more than it sounds.** Purchase requests are stored in a file under `.secure-data/`. On a
serverless host (Vercel, Netlify Functions, Cloudflare) the filesystem is temporary and not shared between
requests, so requests would appear to save and then vanish. Those hosts are the wrong shape for this
application as it stands.

Two ways forward:

1. **A host with a persistent disk** — Render, Railway, Fly.io, or any container. Attach a volume, point
   `PRF_STORE_PATH` at it, and it works as it does locally.
2. **Connect the database** — `prisma/schema.prisma` already describes the domain, and `lib/store.ts` is
   written behind a narrow interface for exactly this swap. With Postgres behind it, any host works,
   serverless included.

Either way, set these before letting anyone real use it:

| Variable | Why |
| --- | --- |
| `PRF_SESSION_SECRET` | 32+ characters. The server refuses to start in production without it |
| `PRF_STORE_PATH` | A path on the persistent disk |
| `PRF_ALLOW_PASSWORD_LOGIN` | Leave unset to require your organisation's single sign-on |
| `PRF_ALLOWED_EMAIL_DOMAINS` | The domains allowed to sign in |

And read the production boundary section of `README.md` first: durable file storage, backups, monitoring
and a security review are not addressed by this prototype.
