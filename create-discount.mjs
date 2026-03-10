/**
 * Creates the Automatic Discount that activates the Bundle Discount Function.
 * Run once: node create-discount.mjs
 *
 * Replace ADMIN_TOKEN below with a token from:
 * Shopify Admin → Settings → Apps → Develop apps → Create a private app
 * Scopes needed: write_discounts
 */

const SHOP = 'hpn-supplements.myshopify.com';
const ADMIN_TOKEN = 'REPLACE_WITH_YOUR_TOKEN'; // ← put your token here

// The function GID is: gid://shopify/ShopifyFunction/<uid>
// uid from shopify.extension.toml = 019cd7f8-8383-7d8f-bc29-490ef3798fe9
// But we need to query it first to get the real GID

const query = `
  query {
    shopifyFunctions(first: 10) {
      nodes {
        id
        title
        apiType
        app { title }
      }
    }
  }
`;

const res = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': ADMIN_TOKEN,
  },
  body: JSON.stringify({ query }),
});

const data = await res.json();

if (data.errors) {
  process.exit(1);
}

const functions = data.data?.shopifyFunctions?.nodes ?? [];


// Find our function
const bundleFn = functions.find(f =>
  f.title?.toLowerCase().includes('bundle') ||
  f.app?.title?.toLowerCase().includes('bundle')
);

if (!bundleFn) {
  process.exit(0);
}

// Create the automatic discount
const createMutation = `
  mutation {
    discountAutomaticAppCreate(automaticAppDiscount: {
      title: "Bundle Builder Discount"
      functionId: "${bundleFn.id}"
      startsAt: "2024-01-01T00:00:00Z"
      combinesWith: {
        productDiscounts: false
        orderDiscounts: false
        shippingDiscounts: true
      }
    }) {
      automaticAppDiscount {
        discountId
        title
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const createRes = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': ADMIN_TOKEN,
  },
  body: JSON.stringify({ query: createMutation }),
});

const createData = await createRes.json();

if (createData.errors) {
  process.exit(1);
}

const result = createData.data?.discountAutomaticAppCreate;
if (result?.userErrors?.length) {
  process.exit(1);
}
