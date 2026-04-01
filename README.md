# onesol Bundle Discount — Shopify Discount Function

> **One-time note**: this app goes in the `onesol-bundle-discount/` folder, separate from the theme.  
> It doesn't touch the theme. It only lives on Shopify as an installed app in the store.

---

## What it does

When the shopper reaches checkout, Shopify runs this function for each cart. The function:

1. Reads the **line_item attributes** of each product in the cart.
2. Finds those that have `_bundle_item = "true"` (set by `bundle-builder-page.js`).
3. Reads the `_bundle_discount_pct` for each line (20, 25, or 30).
4. Applies that percentage **only to those lines** — the rest of the cart remains unchanged.

---

## Prerequisites

- Node.js 22+
- Shopify CLI v3+ → `npm install -g @shopify/cli`
- A [Shopify Partners](https://partners.shopify.com) account
- The store `onesol-supplements.myshopify.com` connected to your Partner account

---

## Step-by-step setup

### 1. Log in with Shopify CLI

```bash
cd onesol-bundle-discount
shopify auth login --store onesol-supplements.myshopify.com
```

### 2. Connect or create the app in your Partner account

```bash
shopify app dev
```

The first time it will ask whether you want to **create a new app** or **connect an existing one**.  
→ Choose **create new app** and name it "onesol Bundle Discount".  
The CLI will fill in `client_id` and `application_url` in `shopify.app.toml` automatically.

### 3. Install the app in the store (development)

While `shopify app dev` is running, the CLI gives you a URL like:
```
https://xyz.trycloudflare.com
```
Open it in the browser → install the app in `onesol.myshopify.com`.

### 4. Create the Automatic Discount in Shopify Admin

With `shopify app dev` running, press **`g`** in the terminal to open GraphiQL.

Run this mutation (replace `YOUR_STORE` with `onesol.myshopify.com`):

```graphql
mutation {
  discountAutomaticAppCreate(
    automaticAppDiscount: {
      title: "Bundle Builder Discount"
      functionHandle: "onesol-bundle-discount"
      discountClasses: [PRODUCT]
      startsAt: "2026-01-01T00:00:00"
      combinesWith: {
        orderDiscounts: true
        productDiscounts: false
        shippingDiscounts: true
      }
    }
  ) {
    automaticAppDiscount {
      discountId
    }
    userErrors {
      field
      message
    }
  }
}
```

If `userErrors` is empty, the discount is active. ✅

### 5. Verify in Shopify Admin

Go to **Discounts** → you should see **"Bundle Builder Discount"** active with type **Automatic**.

### 6. Deploy to production

When you're ready for production:

```bash
shopify app deploy
```

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
