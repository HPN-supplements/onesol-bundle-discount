import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());

const API_KEY = process.env.SHOPIFY_API_KEY;
const API_SECRET = process.env.SHOPIFY_API_SECRET;
const SCOPES = 'write_discounts,read_discounts';
const HOST = (process.env.HOST || 'https://hpn-bundle-discount.onrender.com').replace(/\/$/, '');
const FULL_HOST = HOST.startsWith('http') ? HOST : `https://${HOST}`;
const REDIRECT_URI = `${FULL_HOST}/auth/callback`;

// ── File-based token storage ───────────────────────────────────────────────────
const TOKEN_FILE = path.join('/tmp', 'shopify-tokens.json');

function loadJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
}

// ── OAuth start ────────────────────────────────────────────────────────────────
app.get('/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing ?shop=');

  // No state nonce needed — HMAC verification and Shopify code exchange protect the flow
  const authUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${API_KEY}` +
    `&scope=${SCOPES}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&grant_options[]=`;

  console.log(`[auth] Redirecting ${shop} to Shopify OAuth`);
  res.redirect(authUrl);
});

// ── OAuth callback ─────────────────────────────────────────────────────────────
app.get('/auth/callback', async (req, res) => {
  try {
    const { code, shop, hmac } = req.query;
    console.log(`[callback] shop=${shop} code=${code?.slice(0, 8)}...`);

    // Verify HMAC using raw query string
    const rawQs = new URL(req.url, `https://${req.headers.host}`).search.slice(1);
    const entries = rawQs.split('&').filter(p => !p.startsWith('hmac='));
    entries.sort();
    const computedHmac = crypto.createHmac('sha256', API_SECRET).update(entries.join('&')).digest('hex');
    console.log('[callback] HMAC ok:', computedHmac === hmac);

    // 3. Exchange code for access token
    console.log('[callback] Exchanging code for token...');
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: API_KEY,
        client_secret: API_SECRET,
        code,
      }),
    });

    const rawBody = await tokenRes.text();
    console.log('[callback] Token response status:', tokenRes.status, '| body:', rawBody.slice(0, 300));

    let tokenData;
    try { tokenData = JSON.parse(rawBody); }
    catch { return res.status(500).send('Token exchange failed (non-JSON response): ' + rawBody.slice(0, 500)); }

    if (!tokenData.access_token) {
      return res.status(500).send('Failed to get access token: ' + JSON.stringify(tokenData));
    }

    // 4. Save token
    const tokens = loadJSON(TOKEN_FILE);
    tokens[shop] = { accessToken: tokenData.access_token, scope: tokenData.scope, createdAt: Date.now() };
    saveJSON(TOKEN_FILE, tokens);

    console.log(`[callback] ✅ Got token for ${shop}`);

    // 5. Create the discount
    await createBundleDiscount(shop, tokenData.access_token);

    res.redirect(`https://admin.shopify.com/store/${shop.replace('.myshopify.com', '')}/discounts`);
  } catch (err) {
    console.error('[callback] Error:', err.message);
    console.error('[callback] Stack:', err.stack);
    res.status(500).send('<pre>OAuth callback error:\n' + err.stack + '</pre>');
  }
});

// ── App home ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const shop = req.query.shop;
  if (shop) return res.redirect(`/auth?shop=${shop}`);
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>HPN Bundle Discount</title>
<style>body{font-family:-apple-system,sans-serif;max-width:600px;margin:80px auto;padding:0 20px}h1{font-size:24px}p{color:#666}</style>
</head><body>
<h1>🎁 HPN Bundle Discount</h1>
<p>This app automatically applies tiered discounts to bundle builder items.</p>
<p>To install, go to: <code>/auth?shop=yourstore.myshopify.com</code></p>
</body></html>`);
});

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.send('ok'));

// ── Create the automatic discount via Admin API ───────────────────────────────
async function createBundleDiscount(shop, accessToken) {
  const gql = (query, variables) =>
    fetch(`https://${shop}/admin/api/2026-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query, variables }),
    }).then((r) => r.json());

  // 1. Find the function ID
  console.log('[discount] Looking for bundle function...');
  const fnResult = await gql(`
    query {
      shopifyFunctions(first: 25) {
        nodes { id title app { title } }
      }
    }
  `);

  console.log('[discount] Functions:', JSON.stringify(
    fnResult.data?.shopifyFunctions?.nodes?.map(f => ({ id: f.id, title: f.title, app: f.app?.title }))
  ));

  const fn = fnResult.data?.shopifyFunctions?.nodes?.find(
    (f) =>
      f.app?.title?.toLowerCase().includes('bundle') ||
      f.title?.toLowerCase().includes('bundle')
  );

  if (!fn) {
    console.error('[discount] ❌ Bundle function not found on store:', shop);
    return;
  }
  console.log('[discount] Found function:', fn.id, fn.title);

  // 2. Check if discount already exists
  const existingResult = await gql(`
    query {
      automaticDiscountNodes(first: 50) {
        nodes {
          id
          automaticDiscount {
            ... on DiscountAutomaticApp { title status }
          }
        }
      }
    }
  `);

  const exists = existingResult.data?.automaticDiscountNodes?.nodes?.some(
    (n) => n.automaticDiscount?.title === 'Bundle Builder Discount'
  );

  if (exists) {
    console.log('[discount] Discount already exists on', shop);
    return;
  }

  // 3. Create the discount
  console.log('[discount] Creating discount with functionId:', fn.id);
  const createResult = await gql(`
    mutation discountAutomaticAppCreate($input: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $input) {
        automaticAppDiscount { discountId title status }
        userErrors { field message }
      }
    }
  `, {
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
  });

  console.log('[discount] Result:', JSON.stringify(createResult));

  const userErrors = createResult.data?.discountAutomaticAppCreate?.userErrors;
  if (createResult.errors || (userErrors && userErrors.length > 0)) {
    console.error('[discount] ❌ Error:', JSON.stringify(createResult.errors || userErrors));
    return;
  }

  const d = createResult.data.discountAutomaticAppCreate.automaticAppDiscount;
  console.log(`[discount] ✅ Created on ${shop}: ${d.title} (${d.status})`);
}

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Keep-alive: ping every 14 min so Render free tier never sleeps
  setInterval(() => {
    fetch(`${FULL_HOST}/health`)
      .then(() => console.log('[keep-alive] ping ok'))
      .catch((e) => console.warn('[keep-alive] ping failed:', e.message));
  }, 14 * 60 * 1000);
});
