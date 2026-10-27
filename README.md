# onesol Bundle Discount — Shopify Discount Function

> **One-time note**: this app goes in the `onesol-bundle-discount/` folder, separate from the theme.  
> It doesn't touch the theme. It only lives on Shopify as an installed app in the store.

---

## What it does

When the shopper reaches checkout, Shopify runs this function for each cart. The function:

1. Reads the **line_item attributes** of each product in the cart.
2. Finds those that have `_bundle_item = "true"` (set by `bundle-builder-page.js`).
3. Computes the tier from the group's total quantity itself — `resolveTier()` in
   `extensions/bundle-discount-function/src/run.js`: 2 → 15%, 3 → 20%, 4+ → 25%.
   (No `_bundle_discount_pct` line property is read — the theme never sets one;
   an earlier version of this doc described a property-driven design that was
   never actually implemented.)
4. Applies that percentage to the whole bundle group's subtotal as one combined
   discount (correct rounding, instead of rounding each line independently) —
   the rest of the cart remains unchanged.

---

## Prerequisites

- Node.js 22+
- Shopify CLI v3+ → `npm install -g @shopify/cli`
- A [Shopify Partners](https://partners.shopify.com) account
- The real store domain connected to your Partner account — **not** a guess at
  the name. Confirm with `shopify theme list --store <domain>` from the
  theme's own repo if unsure; for onesol this is `onesolsupps.myshopify.com`
  (not `onesol.myshopify.com` or `onesol-supplements.myshopify.com`, both of
  which appeared in earlier drafts of this doc and don't exist).

---

## Step-by-step setup (per store)

The Function itself (`extensions/bundle-discount-function`) has no store-specific
logic — the same deployed app (`shopify.app.<name>.toml`, one config per store)
just needs to be (a) built/deployed once, then (b) installed + activated on
each store separately. Steps (a)/(b) are already done for `ambrosia` and
`gettrusupps` — see their `oauth-create-discount.<store>.mjs` scripts, which
is the pattern to follow for any new store:

### 1. Deploy the Function

```bash
shopify app deploy --config <store-config-name> --allow-updates
```

(`<store-config-name>` matches the `shopify.app.<store-config-name>.toml`
file — e.g. `onesol-bundle-builder-discount`.) This publishes the Function to
the app on Shopify's side; it does not touch any store's live discounts yet.

### 2. Get the app's client secret

Partners → Apps → (this app) → Client credentials. Set it locally:

```bash
$env:SHOPIFY_CLIENT_SECRET="shpss_..."
```

### 3. Run the OAuth activation script for that store

```bash
node oauth-create-discount.<store>.mjs
```

It prints an authorize URL — open it in a browser **while logged into that
store's own Shopify admin**, click install/authorize. The script then creates
the live `discountAutomaticAppCreate` discount automatically and exits. This
step needs a real interactive login; it can't be scripted/automated further.

### 4. Verify in Shopify Admin

Go to **Discounts** → you should see **"Bundle Builder Discount"** active with
type **Automatic**, on that store specifically.

This publishes the function to Shopify and replaces the development draft.

---

## File structure

```
onesol-bundle-discount/
├── shopify.app.toml                          ← Shopify App configuration
├── package.json
└── extensions/
    └── bundle-discount-function/
        ├── shopify.extension.toml            ← Function extension configuration
        └── src/
            ├── run.graphql                   ← Input query (what data the function requests)
            └── run.js                        ← Function logic (JavaScript)
```

---

## How the discount works with the theme

```
bundle-builder-page.js (theme)
  └── /cart/add.js with properties:
        _bundle_item         = "true"
        _bundle_id           = "bb-1234-abc"
        _bundle_discount_pct = "20"          ← according to the active tier

  → Customer goes to checkout

Shopify runs run.js (this function)
  └── Reads attributes of each cart line
  └── Filters those with _bundle_item = "true"
  └── Reads _bundle_discount_pct = "20"
  └── Applies 20% ONLY to those lines
  └── The rest of the cart → no discount ✅
```

---

## Discount tiers (configured in the theme)

| Bundle products in cart | Discount applied |
|---|---|
| 2 | 20% |
| 3 | 25% |
| 4 | 30% |

These percentages are set in `bundle-builder-page.js` → `getCurrentTier()` and are passed as `_bundle_discount_pct` at the moment of add-to-cart.

---

## Tier schedule (onesol)

Tiers are data, not code. The function reads a JSON config from the discount's metafield `$app:bundle/config` and the store-local date (`shop.localTime.date`). With no metafield (or invalid JSON) it uses the defaults 2 → 15%, 3 → 20%, 4+ → 25%, so other stores are unaffected.

- Shape: see `bundle-schedule.onesol.json`. Tier key = minimum quantity (highest key ≤ qty wins). Dates are `YYYY-MM-DD` in the store timezone, `end` is exclusive, `end: null` = open-ended. First matching window wins; outside any window `defaultTiers` applies.
Expected behavior per period (store timezone America/Los_Angeles):

| Period | Hero images | Hero title | Tiers |
|---|---|---|---|
| before 10-28 | current | merchant title (25%) | default: 2=15, 3=20, 4+=25 (no 1-item bundles) |
| 10-28 to 10-31 | Halloween | "Bundle & Save Up To 30%" | promo: 1=15, 2=20, 3=25, 4+=30 |
| 11-01 | current | merchant title (25%) | default |
| from 11-02 (no end) | current | "Bundle & Save Up To 30%" | promo |

> Keep `bundle-schedule.onesol.json` (function metafield, set with `set-bundle-schedule.onesol.mjs`) and the theme file `snippets/bundle-tier-schedule.liquid` (default source on the theme side) in sync: dates and tiers must match exactly; paste the same JSON into both. The theme section setting `bundle_schedule` (Bundle Builder - Cart) is empty by default and, if filled, overrides the snippet (use `{"schedule":[]}` to disable). The `banner` keys (images, title, eyebrow) are only read by the theme; the function ignores unknown keys (covered by a test). The theme ignores `defaultTiers` (its Bundle Tier blocks are the default), so keep those equal to the function defaults.

- Deploy the function once (it reads new input fields): `shopify app deploy`.
- Set/update the schedule (no redeploy needed): `$env:SHOPIFY_CLIENT_SECRET="shpss_..."`, then `node set-bundle-schedule.onesol.mjs --dry-run` (prints shop timezone + current config), then the same without `--dry-run`.
- Tests: `npm test --prefix extensions/bundle-discount-function`.
- The theme must show the same tiers (`snippets/bundle-tier-schedule.liquid`, optionally overridden by the `bundle_schedule` section setting).

---

## Testing

```bash
# Run the function locally with a test JSON input
shopify app function run --input='{"cart":{"lines":[{"id":"gid://shopify/CartLine/1","quantity":1,"attributes":[{"key":"_bundle_item","value":"true"},{"key":"_bundle_discount_pct","value":"20"}],"cost":{"subtotalAmount":{"amount":"49.99","currencyCode":"USD"}}}]},"discount":{"discountClasses":["PRODUCT"]}}'
```

---

## Replaying real executions

While `shopify app dev` is running, every checkout that uses the function appears in the terminal. To replay an execution locally:

```bash
shopify app function replay
```

Select the execution from the list → it shows the full input/output.
