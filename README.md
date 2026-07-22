# 🍿 Snack-O

A tap-to-pay honor-system snack stand. Customers tap an NFC tag, pick what they grabbed, and pay through Venmo in a single tap. No Square, no card reader, no monthly fees.

- **Live page:** https://d-pretzel.github.io/snacko/
- **Menu editor:** https://d-pretzel.github.io/snacko/admin.html

---

## How it works

1. A customer taps their phone on the tag stuck to the snack container.
2. Their phone opens the page, which loads the menu from `menu.json`.
3. They tap the items they took, and a running total builds itself.
4. One button hands off to Venmo with the amount and a plain-English itemized note already filled in.

Because the tag only stores the page's URL, you never re-write a tag when prices change. You just change the menu.

The customer page has no server behind it: GitHub Pages hands out `index.html` and `menu.json`, and the browser does the rest. **Editing** the menu does depend on a small Cloudflare Worker, because something has to hold the GitHub credential. If Cloudflare is having a bad day, the snack stand keeps selling — only editing stops.

---

## Changing the menu

Open **https://d-pretzel.github.io/snacko/admin.html**, enter the editor password, and change what you need. There is no GitHub account, no code, and no file to find.

You can:

- Add, rename, reorder, and delete categories and items
- Set prices, and move an item from one category to another
- Add a short description under any item ("12 oz cans")
- Put an item on sale by a percentage, with an optional end date
- Hide an item without deleting it, for when you are out of stock
- Preview the customer view before you save

Press **Save changes**. The live page catches up within about a minute. If a field is wrong, it is highlighted with the reason and nothing is sent until it is fixed. If a save fails — bad signal, usually — every edit stays on screen, so nothing is lost; press Save again.

### Add to Home Screen

Worth doing on the first visit. The editor ships a `manifest.json` and an app icon, so this produces a real icon and opens without browser chrome, like an app. On iOS use Share → Add to Home Screen; on Android, the browser menu offers Install.

### Sales

A sale is stored as a percentage off, never as a second price. The discounted price is worked out when the page renders, so the original price is never lost. A sale with an end date stops applying the day after that date, judged by the phone's own clock, and the sale itself stays in the file until you clear it.

### Editing `menu.json` directly

`menu.json` is a plain data file in this repository, and it is the only place menu data lives. If the editor is ever unavailable, open `menu.json` on GitHub, click the pencil, and edit it by hand:

```json
{
  "name": "Snack-O",
  "venmoUsername": "your-venmo-username",
  "categories": [
    {
      "label": "Drinks",
      "items": [
        { "name": "Red Bull", "price": 2.50, "description": "12 oz cans" },
        { "name": "Water", "price": 1.00, "sale": { "percentOff": 20, "until": "2026-08-01" } },
        { "name": "White Monster", "price": 3.00, "hidden": true }
      ]
    }
  ]
}
```

- `name` — what shows in the header and the browser tab.
- `venmoUsername` — the handle, without the `@`.
- `price` — dollars, at most two decimal places.
- `description` — optional. Leave it out and the row looks exactly as it always has.
- `sale` — optional. `percentOff` is a whole number from 1 to 99; `until` is optional and formatted `YYYY-MM-DD`, and the last day counts.
- `hidden` — optional. `true` keeps the item in the file but off the customer page.

Every past version of the menu is in the repository's commit history, so a bad edit is always one revert away.

---

## Hosting

Already configured, and there is no build step. GitHub Pages serves this repository's root from the `main` branch, so anything committed to `main` is live at `https://d-pretzel.github.io/snacko/` within about a minute. The setting is under **Settings → Pages**: source **Deploy from a branch**, branch `main`, folder `/ (root)`.

`index.html` and `menu.json` must stay in the repository root, since the page fetches `menu.json` as a relative path.

---

## The editor's plumbing

Already deployed — this section is for maintaining it, not setting it up. Full detail lives in [`worker/README.md`](worker/README.md).

The Worker is `snacko` on Cloudflare, serving `https://snacko.petzoldavid02.workers.dev`, and `admin.html` already points at it. It holds two secrets: a GitHub fine-grained token scoped to this repository with Contents read and write, and the shared editor password.

The token never touches the browser. The editor only ever sends the Worker a password and a menu; the Worker checks the password, re-validates the menu against the schema, and makes the commit.

**Changing the password**, when the job changes hands or you think it got out, is one command from `worker/`. No redeploy, effective immediately:

```bash
wrangler secret put EDIT_PASSWORD
```

Type it at the prompt rather than passing it as an argument, so it stays out of your shell history. Anyone still signed in on the old password gets returned to the login screen the next time they save, with their unsaved edits intact.

**The GitHub token expires.** When it does, saving fails and the error will not explain why. Mint a new fine-grained token with the same scope, run `wrangler secret put GH_TOKEN`, and revoke the old one. Keep the expiration date somewhere you will actually see it.

**Changing the Worker's code** means `wrangler deploy` from `worker/`. The `name` in `wrangler.toml` must match the Worker's name on the Cloudflare account exactly; if it does not, `wrangler secret put` fails with `This Worker does not exist on your account. [code: 10007]`, which is a name mismatch and not an authentication problem.

---

## Writing the NFC tag

1. Buy blank NTAG213 or NTAG215 stickers. They are inexpensive and widely available.
2. Install a free app like **NFC Tools** (iOS or Android).
3. Choose **Write → Add a record → URL**, and enter `https://d-pretzel.github.io/snacko/`.
4. Hold the sticker to your phone to write it, then stick it on the container.

Add a small "Tap to pay 📱" label near the tag so customers know what it is.

---

## Testing before you launch

**Set the Venmo username first.** It ships as the placeholder `your-venmo-username`, which is not a real account — until it is changed, the pay button opens a Venmo page that goes nowhere. Change it in the editor's "Venmo username" field, or in `menu.json`. Enter the handle without the `@`.

Then test on **both an iPhone and an Android** before sticking tags on anything. The browser-to-Venmo handoff behaves a little differently across phones, so confirm that the pay button opens Venmo with the correct amount already filled in, going to the right person.

To test locally, note that `index.html` now fetches `menu.json`, and browsers block `fetch` from `file://`. Opening the file by double-clicking it will show the error state. Serve the folder instead:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

The **editor** cannot be tested this way. The Worker only accepts requests from `https://d-pretzel.github.io`, so `admin.html` served from localhost is refused — that is the origin check doing its job, not a bug. Test the editor at its live URL, or see [`worker/README.md`](worker/README.md) for temporarily pointing `ALLOWED_ORIGIN` at a local server.

---

## Good to know

- **Both pages adapt to light and dark mode** automatically.
- **The pay button stays disabled** until at least one item is added, so nobody sends a zero payment.
- **The payment note is itemized** and written to read like a sentence, for example `E-Flight SNACKO: 2x Cookie and Soda`, so you can see what each sale was. It is prefixed with the stand name from `menu.json`, drops the `1x` for single items, and is trimmed at Venmo's 280-character limit.
- **Sale prices are what customers are charged** — the total and the Venmo amount both use the discounted price.
- **Item names are treated as plain text.** An apostrophe, an accent, or a stray `<` in a name shows up literally and cannot break the page.
- **The Venmo link is built with `encodeURIComponent`, not `URLSearchParams`.** `URLSearchParams` encodes spaces as `+`, and Venmo prints the note exactly as given — plus signs and all. If the note ever comes back full of `+`, that is why.
- **Venmo's amount-prefill through links is undocumented** and has changed over the years. It works today, but if it ever breaks, the fix is on this page, not on the physical tags.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | The customer page. Renders the menu, totals, and Venmo handoff. |
| `menu.json` | The menu itself. The only place menu data lives. |
| `admin.html` | Password-protected menu editor. |
| `manifest.json` | Makes the editor installable to a phone home screen. |
| `worker/` | Cloudflare Worker that holds the GitHub token and does the committing. |
| `enjjpt-logo.png` | Squadron patch shown in the header (currently the 459th FTS Twin Dragons). |
| `icon-192.png`, `icon-512.png` | Home-screen icons for the editor. |
| `venmo-logo.png` | Venmo mark shown on the pay button. |
| `snacko-editor-spec.md` | The build specification the editor was written from. |
| `.gitignore` | Keeps wrangler's local cache, which holds the Cloudflare account id, out of the repository. |
| `README.md` | This document. |
