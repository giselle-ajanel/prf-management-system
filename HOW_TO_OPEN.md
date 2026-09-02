# How to open the Purchase Request Hub

Three ways in, depending on what you need. None of them require Terminal.

---

## 1. The quickest look — open the demo file

**No installation. Nothing running in the background. Works on any computer.**

Open `share/PRF-Hub.html` — double-click it, or drag it onto Chrome, Edge, or Safari.

That single file *is* the whole application. You can create a request, sign and submit it, approve it as a
supervisor, review it as Finance, and watch it move through both stages. Everything you do is saved in that
browser, on that computer, and nowhere else.

It is a demonstration: the data is invented, and the accounts below are the only ones that exist in it.

---

## 2. Run the real application on your own computer

**Double-click the launcher:**

| Your computer | Double-click this |
| --- | --- |
| Mac | `Launch_Purchase_Request_Hub.command` |
| Windows | `Launch_Purchase_Request_Hub.bat` |

A window opens, says *"Purchase Request Hub is running!"*, and your browser goes to the app. **Leave that
window open while you use the app** — closing it stops the application. That is also how you shut it down.

The first run takes about a minute while it sets itself up. After that it takes a few seconds.

**If your Mac says the file cannot be opened**, right-click it once and choose **Open**, then **Open**
again. macOS asks this the first time for anything downloaded. If it says *permission denied*, open
Terminal once and paste this line:

```
chmod +x "/Users/owner/Downloads/prf-management-system/Launch_Purchase_Request_Hub.command"
```

**If it says Node.js is not installed**, get it from [nodejs.org](https://nodejs.org) — choose the big
green **LTS** button — then double-click the launcher again.

---

## 3. The shared link

See `DEPLOYING.md` for the public preview link and how it is published.

---

## Signing in

On your first visit the login page shows a **"Trying it out? Pick a role."** panel. Click any role and it
fills in the sign-in details for you — then press **Sign in**. That is the easiest way, and it means you
never need to type a password.

If you would rather type them, here is what each role can do:

| Role | Email | What they can do |
| --- | --- | --- |
| **Requester** | `requester@…` | Create a request, attach receipts, sign and submit it, track their own |
| **Manager** (Approver) | `manager@…` | Everything above, plus approve requests **up to $5,000** |
| **Director** (Approver) | `director@…` | Everything above, plus approve **up to $15,000** |
| **Finance Reviewer** | `finance@…` | Review approved requests for coding and receipts, then clear for payment |
| **Auditor** (View-Only) | `auditor@…` | Read everything. Export to CSV. Cannot change anything |

In the demo file (option 1) every password is the word **`demo`** and the addresses end `@woodcraft.demo`.

When you run it on your own computer (option 2), passwords are generated for you the first time and written
to `.secure-data/seed-credentials.txt` inside the project folder — but you will not need them, because the
"Pick a role" panel fills them in.

---

## Try this — it takes three minutes

1. Sign in as the **Requester**. Click *Start a new request*.
2. Pick a site — start typing a school name. Notice the **funding source fills itself in**.
3. Add an item and an amount over $5,000, sign your name at the bottom, and submit.
4. Sign out. Sign in as the **Manager** and open the request. It refuses to let you approve it, and tells
   you it needs a Director. *That is the dollar threshold doing its job.*
5. Sign out. Sign in as the **Director** and approve it. It does **not** finish — it moves to
   *Pending Finance Review*.
6. Sign out. Sign in as **Finance** and clear it for payment. Now it is done.
7. Sign in as the **Auditor**. You can read all of it and export it — and every button that would change
   something is gone.

---

## Questions people ask

**Do I need to install anything?** For the demo file, no. For the launcher, only Node.js, and only once.

**Will I break anything?** No. The data is invented and lives on your own computer. Delete
`.secure-data/prf-store.json` to start over with a clean set.

**Can other people see what I do?** No. Nothing leaves your computer in either option.

**Where did my request go?** Requests move through two stages — a supervisor approves, then Finance
reviews. Check the *Approvals* tab of whichever role is next in the chain.
