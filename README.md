# 🍿 Snack-O

A tap-to-pay honor-system snack stand. Customers tap an NFC tag, pick what they grabbed, and pay through Venmo in a single tap. No Square, no card reader, no monthly fees, and nothing to run on a server.

**Live page:** https://d-pretzel.github.io/snacko/

---

## How it works

The whole system is one static web page and a cheap NFC tag.

1. A customer taps their phone on the tag stuck to the snack container.
2. Their phone opens this page, which shows the menu.
3. They tap the items they took, and a running total builds itself.
4. One button hands off to Venmo with the amount and an itemized note already filled in.

Because the tag only stores the page's URL, you never re-write a tag when prices change. You just edit the page.

---

## Customizing the menu

Open `index.html` and edit the `CONFIG` block near the top. It is the only part you need to touch.

```js
const CONFIG = {
  name: "Snack-O",
  tagline: "Tap what you grabbed, then pay in one tap.",
  venmoUsername: "your-venmo-username", // no @ symbol
  items: [
    { emoji: "🍫", name: "Chocolate bar", price: 2.00 },
    { emoji: "🥤", name: "Soda",          price: 1.50 },
    { emoji: "🍪", name: "Cookie",        price: 1.00 },
  ],
};
```

- **venmoUsername** is the handle without the `@`.
- **items** is your menu. Add or remove lines freely, and set each `price` in dollars.
- Everything else, including the total and the Venmo note, updates on its own.

You can edit this file right in the GitHub website: open `index.html`, click the pencil icon, make the change, and commit. The live page refreshes within about a minute.

---

## Deploying with GitHub Pages

One-time setup:

1. Make sure `index.html` is in the root of this repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set the source to **Deploy from a branch**.
4. Choose the `main` branch and the `/ (root)` folder, then save.
5. Wait about a minute. Your page goes live at `https://d-pretzel.github.io/snacko/`.

There is no build step and nothing to maintain.

---

## Writing the NFC tag

1. Buy blank NTAG213 or NTAG215 stickers. They are inexpensive and widely available.
2. Install a free app like **NFC Tools** (iOS or Android).
3. Choose **Write → Add a record → URL**, and enter `https://d-pretzel.github.io/snacko/`.
4. Hold the sticker to your phone to write it, then stick it on the container.

Add a small "Tap to pay 📱" label near the tag so customers know what it is.

---

## Testing before you launch

Test the finished page on **both an iPhone and an Android** before sticking tags on anything. The browser-to-Venmo handoff behaves a little differently across phones, so confirm that the pay button opens Venmo with the correct amount already filled in.

---

## Good to know

- **The page adapts to light and dark mode** automatically.
- **The pay button stays disabled** until at least one item is added, so nobody sends a zero payment.
- **The payment note is itemized**, for example `2x Cookie, 1x Soda`, so you can see what each sale was.
- **Venmo's amount-prefill through links is undocumented** and has changed over the years. It works today, but if it ever breaks, the fix is on this page, not on the physical tags.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | The entire app. Menu, totals, and Venmo handoff in one self-contained file. |
| `README.md` | This document. |
