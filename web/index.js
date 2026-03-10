import 'dotenv/config';
import express from 'express';
import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';

const app = express();
app.use(express.json());

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: ['write_discounts', 'read_discounts'],
  hostName: process.env.HOST.replace(/https?:\/\//, ''),
  apiVersion: ApiVersion.January26,
  isEmbeddedApp: true,
});

// ── OAuth start ───────────────────────────────────────────────────────────────
app.get('/auth', async (req, res) => {
  await shopify.auth.begin({
    shop: shopify.utils.sanitizeShop(req.query.shop, true),
    callbackPath: '/auth/callback',
    isOnline: false,
    rawRequest: req,
    rawResponse: res,
  });
});

// ── OAuth callback — installs app and creates discount ────────────────────────
app.get('/auth/callback', async (req, res) => {
  const callback = await shopify.auth.callback({
    rawRequest: req,
    rawResponse: res,
  });

  const session = callback.session;
  await createBundleDiscount(session);

  // Redirect to discount list in admin
  res.redirect(`https://${session.shop}/admin/discounts`);
});

// ── App home — shown when merchant opens the app ──────────────────────────────
app.get('/', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.send(homePage('Unknown', 'unknown'));

  res.send(homePage(shop, 'ACTIVE'));
});

// ── Create the automatic discount via Admin API ───────────────────────────────
async function createBundleDiscount(session) {
  const client = new shopify.clients.Graphql({ session });

  // 1. Find the function ID
  const { data: fnData } = await client.request(`
    query {
      shopifyFunctions(first: 20) {
        nodes { id title app { title } }
      }
    }
  `);

  const fn = fnData.shopifyFunctions.nodes.find(
    (f) =>
      f.app?.title?.toLowerCase().includes('bundle') ||
      f.title?.toLowerCase().includes('bundle')
  );

  if (!fn) {
    console.error('Bundle function not found on store:', session.shop);
    return;
  }

  // 2. Check if discount already exists
  const { data: existingData } = await client.request(`
    query {
      automaticDiscountNodes(first: 50) {
        nodes {
          id
          automaticDiscount {
            ... on DiscountAutomaticApp {
              title
              status
            }
          }
        }
      }
    }
  `);

  const exists = existingData.automaticDiscountNodes.nodes.some(
    (n) => n.automaticDiscount?.title === 'Bundle Builder Discount'
  );

  if (exists) {
    console.log('Discount already exists on', session.shop);
    return;
  }

  // 3. Create the discount
  const { data, errors } = await client.request(`
    mutation discountAutomaticAppCreate($input: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $input) {
        automaticAppDiscount { discountId title status }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      input: {
        title: 'Bundle Builder Discount',
        functionId: fn.id,
        startsAt: new Date().toISOString(),
        combinesWith: {
          orderDiscounts: false,
          productDiscounts: false,
          shippingDiscounts: false,
        },
      },
    },
  });

  if (errors || data.discountAutomaticAppCreate.userErrors.length > 0) {
    console.error('Error creating discount:', errors || data.discountAutomaticAppCreate.userErrors);
    return;
  }

  const d = data.discountAutomaticAppCreate.automaticAppDiscount;
  console.log(`✅ Discount created on ${session.shop}: ${d.title} (${d.status})`);
}

// ── Simple HTML page ──────────────────────────────────────────────────────────
function homePage(shop, status) {
  const isActive = status === 'ACTIVE';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>HPN Bundle Discount</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 600; }
    .active { background: #d4edda; color: #155724; }
    .inactive { background: #f8d7da; color: #721c24; }
    h1 { font-size: 24px; }
    p { color: #666; }
  </style>
</head>
<body>
  <h1>🎁 HPN Bundle Discount</h1>
  <p>Store: <strong>${shop}</strong></p>
  <p>Status: <span class="badge ${isActive ? 'active' : 'inactive'}">${isActive ? '✅ Active' : '⚠️ Setting up...'}</span></p>
  <p>This app automatically applies tiered discounts (20%, 25%, 30%) to bundle builder items at checkout. Non-bundle items are never affected.</p>
</body>
</html>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
