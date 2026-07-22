# Snacko Menu Editor: Build Specification

## Purpose

Add a password-protected web editor to the Snack-O project so a non-technical squadron snacko can manage the menu without ever visiting GitHub. All writes are brokered by a Cloudflare Worker that holds the GitHub credential. The customer facing page remains a static GitHub Pages site with no runtime dependency on the Worker.

## Current repository state

Repository: `D-Pretzel/snacko`, deployed at `https://d-pretzel.github.io/snacko/`.

| File | Purpose |
| :---- | :---- |
| `index.html` | Entire app. Inline `CONFIG` object, inline CSS, inline render logic. |
| `enjjpt-logo.png` | Header emblem. |
| `venmo-logo.png` | Pay button mark. |
| `README.md` | Setup and customization instructions. |

The customer flow is: tap NFC tag, load page, increment item quantities, tap "Pay with Venmo," which opens a `venmo.com` deep link with amount and itemized note prefilled.

## Target architecture

Four components. The first three live in this repository. The fourth is deployed separately.

1. `menu.json`: sole source of truth for menu data.  
2. `index.html`: refactored to fetch `menu.json` at load. Rendering logic gains sale price support and optional item descriptions.  
3. `admin.html`: form-based editor. Reads `menu.json`, writes through the Worker.  
4. `worker/`: Cloudflare Worker holding the GitHub token and edit password.

Write path: `admin.html` \-\> Worker \-\> GitHub Contents API \-\> commit to `main` \-\> GitHub Pages rebuild.

Read path: customer browser \-\> GitHub Pages \-\> `menu.json`. The Worker is not involved. If Cloudflare is unavailable, the snack stand still functions and only editing is affected.

## Data schema

`menu.json` at repository root:

{

  "name": "Snack-O",

  "venmoUsername": "your-venmo-username",

  "categories": \[

    {

      "label": "Drinks",

      "items": \[

        {

          "name": "Red Bull",

          "price": 2.50,

          "description": "12 oz cans",

          "sale": { "percentOff": 20, "until": "2026-08-01" },

          "hidden": false

        }

      \]

    }

  \]

}

Field rules:

- `name`: required, non-empty string, trimmed, max 60 characters.  
- `price`: required, number, greater than or equal to 0, at most 2 decimal places.  
- `description`: optional. Absent or empty string renders nothing.  
- `sale`: optional object. `percentOff` is an integer from 1 to 99\. `until` is optional and formatted `YYYY-MM-DD`, treated as an inclusive final day.  
- `hidden`: optional boolean, defaults to false. Hidden items are excluded from the customer page but retained in `menu.json`.

Sale price is computed at render time and never stored:

const sale \= Math.round(price \* (1 \- percentOff / 100\) \* 100\) / 100;

An expired sale is ignored by the renderer rather than removed from the file. Expiry is evaluated against the local date, not UTC, so a sale ending on the first of the month remains active through the end of that day.

## Build order

### Step 1: Extract menu data

Create `menu.json` from the existing `CONFIG` object. Preserve the current three categories and their items exactly. Remove the inline `CONFIG` script block from `index.html`.

### Step 2: Refactor `index.html`

Fetch the menu on load with a cache-busting parameter. GitHub Pages serves assets behind a CDN with a short max-age, and without this the snacko will change a price and see no effect for several minutes.

const res \= await fetch(\`menu.json?v=${Date.now()}\`, { cache: "no-store" });

Requirements:

- Replace all `innerHTML` interpolation of menu data with `textContent` assignment. Item names and descriptions are now user-entered free text and must not be parsed as HTML.  
- Render an item description, when present, as a smaller muted line beneath the item name. Reuse the existing `--muted` color token.  
- Render a sale item with the original price struck through, the sale price beside it, and a compact percent-off tag. Match the existing visual language; the `--accent` coral token is the natural choice for the tag.  
- Use sale prices in the running total and in the Venmo amount.  
- Skip items where `hidden` is true.  
- Skip categories that contain no visible items.  
- On fetch failure, display a readable error state with a retry control rather than an empty page.  
- Preserve current behavior otherwise: the pay button stays disabled at zero total, the Venmo note stays itemized, and light and dark mode both work.

Note that fetching `menu.json` breaks opening `index.html` directly from the filesystem, because browsers block `fetch` over `file://`. Local testing requires a static server such as `python3 -m http.server`.

### Step 3: Build `admin.html`

A single self-contained page reusing the CSS tokens and component styling from `index.html` so both pages read as one product. Assume a phone screen first.

Authentication:

- On load, check `localStorage` for a saved password. If absent, show a single password field and nothing else.  
- Verify the password against the Worker before revealing the editor.  
- Persist the password in `localStorage` on success. Provide a "Sign out" control that clears it.

Editor behavior:

- Load current menu from `menu.json` with the same cache-busting fetch.  
- Hold all edits in memory. Nothing transmits until the user presses Save.  
- Categories render as collapsible sections with inline rename, plus up and down controls for reordering. Do not implement drag and drop; it is unreliable on touch devices.  
- Each item exposes: name field, price field, description field, sale toggle, hide toggle, delete control, up and down reorder controls, and a category dropdown for moving the item to a different section.  
- Price inputs use `type="number"`, `step="0.01"`, and `inputmode="decimal"` so mobile keyboards present a number pad.  
- The description field starts collapsed behind an "Add description" control so the default row stays visually simple.  
- The sale toggle reveals a percent field and an optional end date field. An expired sale displays an "Expired" marker and offers a one-tap clear.  
- Deletion requires confirmation.  
- Include a preview mode that renders the customer view from the in-memory state, so sale formatting can be verified before committing.  
- Include a link to the repository commit history labeled in plain language, such as "See past versions." Git already provides version history and it costs nothing to surface it.

Validation before Save, enforcing every rule in the schema section above, plus:

- No two categories may share a label.  
- At least one category must exist.  
- Validation failures scroll to and highlight the offending field. Do not use `alert()`.

Serialization:

- Build the payload with `JSON.stringify` from validated in-memory state. Never assemble JSON through string concatenation, so output is valid by construction.  
- Serialize with two-space indentation so GitHub diffs remain readable.

Save flow:

- Disable the Save control and show progress while the request is in flight.  
- On success, display confirmation stating the change will appear on the live page within roughly one minute.  
- On authentication failure, clear the stored password and return to the login view with a clear message.  
- On any other failure, retain all in-memory edits so no work is lost, and surface the Worker's error message.

Installability:

- Add `manifest.json` with name, icons, `display: "standalone"`, and a start URL pointing at `admin.html`.  
- Add an `apple-touch-icon` link and the iOS standalone meta tags so "Add to Home Screen" produces a proper app icon.  
- Add `<meta name="robots" content="noindex">` to `admin.html`.

### Step 4: Build the Cloudflare Worker

Create a `worker/` directory containing `wrangler.toml`, `src/index.js`, and a short `README.md` covering deployment.

Environment bindings:

| Binding | Type | Contents |
| :---- | :---- | :---- |
| `GH_TOKEN` | secret | Fine-grained PAT, `D-Pretzel/snacko` only, Contents read and write. |
| `EDIT_PASSWORD` | secret | Shared password issued to the snacko. |
| `ALLOWED_ORIGIN` | var | `https://d-pretzel.github.io` |
| `GH_REPO` | var | `D-Pretzel/snacko` |

Endpoints:

`POST /verify` Request: `{ "pass": string }` Response: 200 on match, 401 otherwise. Used by the login screen so an incorrect password fails before any editing occurs.

`POST /save` Request: `{ "pass": string, "menu": object, "summary": string }` Response: 200 with `{ "commit": string }` on success.

Server-side requirements:

- Validate the password first and return 401 before doing anything else.  
    
- Re-validate the full menu structure against the schema. The Worker is the last line of defense and must not trust the client, even though the client is a page you wrote.  
    
- Handle `OPTIONS` preflight and attach CORS headers to every response, including error responses. Restrict `Access-Control-Allow-Origin` to `ALLOWED_ORIGIN` rather than using a wildcard. Omitted CORS headers on the error path is the most common failure in this design, so verify it explicitly.  
    
- `GET` the current file to obtain its `sha` immediately before the `PUT`, then include that `sha` in the write. On a 409 response, retry once with a freshly fetched `sha` before returning an error.  
    
- GitHub requires a `User-Agent` header. Cloudflare Workers do not set one automatically, and omitting it produces a confusing 403\.  
    
- Base64-encode using UTF-8 aware encoding. A bare `btoa()` call throws on any non-Latin1 character, which will eventually appear in an item name:  
    
  const bytes \= new TextEncoder().encode(json);  
    
  const b64 \= btoa(String.fromCharCode(...bytes));  
    
- Compare the password in constant time to avoid leaking length through timing.  
    
- Compose the commit message from the client-supplied `summary`, for example `Menu update: Red Bull 20% off` rather than an undifferentiated string. Treat the summary as untrusted text: truncate it and strip newlines before use.  
    
- Consider a simple rate limit on `/verify`, such as a short lockout after repeated failures, to blunt password guessing.

### Step 5: Update `README.md`

Rewrite the customization section. It currently instructs the reader to edit a `CONFIG` block inside `index.html`, which will no longer exist. Cover:

- Day-to-day menu changes happen at `admin.html`, not in any file.  
- `menu.json` is the data file, editable directly on GitHub as a fallback.  
- Worker deployment and secret rotation.  
- The revised file table.

The README currently claims there is nothing to run on a server. That claim now requires qualification: the customer page still has no server dependency, but editing does.

## Manual steps outside the scope of the code

These require account access and must be performed by hand.

1. Create a fine-grained personal access token on GitHub. Scope it to the `D-Pretzel/snacko` repository only, grant `Contents: Read and write`, and set an explicit expiration. Record the expiration date somewhere you will see it.  
2. Create a Cloudflare account and install `wrangler`.  
3. Set secrets with `wrangler secret put GH_TOKEN` and `wrangler secret put EDIT_PASSWORD`.  
4. Deploy the Worker and record its URL. Insert that URL into `admin.html`.  
5. Confirm GitHub Pages is still building from `main` at the root.

## Acceptance checks

Functional:

- Editing a price in `admin.html` produces a commit and the change appears on the live page within roughly one minute.  
- An incorrect password is rejected and grants no editor access.  
- A request sent to the Worker from an origin other than `ALLOWED_ORIGIN` is rejected.  
- Adding, renaming, reordering, and deleting both items and categories all persist correctly.  
- Moving an item between categories persists correctly.  
- A sale renders with strikethrough original price and correct discounted price, and the Venmo amount reflects the discount.  
- A sale with a past `until` date is ignored by the customer page.  
- A hidden item does not appear on the customer page and is not payable.  
- An item with no description renders identically to the current layout.  
- An item name containing an apostrophe, an accented character, or an HTML tag renders as literal text and does not break the page.  
- A failed save preserves all in-memory edits.

Non-functional:

- The customer page loads and functions with the Worker unreachable.  
- Both pages remain usable in light and dark mode.  
- Test the full flow on both an iPhone and an Android device. The existing README already flags that the Venmo handoff behaves differently across platforms, and that warning still applies.

## Suggested opening message for the Claude Code session

> Read `snacko-editor-spec.md` in full, then work through it in order. Start with steps 1 and 2, extracting `menu.json` and refactoring `index.html`, and stop for review before building `admin.html`. Do not commit anything until I have reviewed the customer-facing changes on a local server.  
