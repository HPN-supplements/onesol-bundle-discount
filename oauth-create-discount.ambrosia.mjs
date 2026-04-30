/**
 * One-time OAuth helper to create the Bundle Builder Discount for ambrosia-nutraceuticals.
 *
 * 1. Run:  node oauth-create-discount.ambrosia.mjs
 * 2. Open the URL printed in the terminal in your browser
 * 3. Authorize the app → it redirects back to localhost
 * 4. The script creates the discount automatically and exits
 *
 * You can delete this file after the discount is created.
 */

import http from 'node:http';
import crypto from 'node:crypto';

// ── Your app credentials ────────────────────────────────────────────────────
// Set CLIENT_SECRET via environment variable: $env:SHOPIFY_CLIENT_SECRET="shpss_..."
const CLIENT_ID     = 'aa390ea6cae089d79abd5914e6aef8e7';
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOP          = 'ambrosia-nutraceuticals.myshopify.com';
const SCOPES        = 'write_discounts,read_discounts';
const REDIRECT_URI  = 'http://localhost:3456/callback';

// ── Helpers ─────────────────────────────────────────────────────────────────
const nonce = crypto.randomBytes(16).toString('hex');

function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state: nonce,
    grant_options: '',
  });
  return `https://${SHOP}/admin/oauth/authorize?${params}`;
}

async function exchangeToken(code) {
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
    }),
  });
  const data = await res.json();
  return data.access_token;
}

async function createDiscount(token) {
  // First, query to find our function's real GID as seen by our app
  const findQuery = `
    query {
      shopifyFunctions(first: 25) {
        nodes {
          id
          title
          apiType
          app { title id }
        }
      }
    }
  `;

  console.log('Querying functions visible to our app...');
  const findRes = await fetch(`https://${SHOP}/admin/api/2026-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query: findQuery }),
  });
  const findData = await findRes.json();
  const functions = findData.data?.shopifyFunctions?.nodes ?? [];
  console.log('Functions found:', functions.length);
  functions.forEach(f => console.log(`  - ${f.title} (${f.apiType}) [${f.id}] app: ${f.app?.title}`));

  // Find our bundle discount function
  const bundleFn = functions.find(f =>
    f.title?.toLowerCase().includes('bundle') ||
    f.app?.title?.toLowerCase().includes('bundle')
  );

  if (!bundleFn) {
    console.log('\n❌ Could not find bundle function automatically.');
    console.log('Please check the function list above and update FUNCTION_GID manually.');
    process.exit(1);
  }

  console.log(`\n✅ Found function: "${bundleFn.title}" → ${bundleFn.id}`);
  return createDiscountWithGid(token, bundleFn.id);
}

async function createDiscountWithGid(token, functionGid) {
  const mutation = `
    mutation {
      discountAutomaticAppCreate(automaticAppDiscount: {
        title: "Bundle Builder Discount"
        functionId: "${functionGid}"
        discountClasses: [PRODUCT]
        startsAt: "2026-01-01T00:00:00Z"
        combinesWith: {
          productDiscounts: false
          orderDiscounts: true
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

  const res = await fetch(`https://${SHOP}/admin/api/2026-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query: mutation }),
  });
  return res.json();
}

// ── Server ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3456');

  if (url.pathname === '/callback') {
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (state !== nonce) {
      res.writeHead(400);
      res.end('State mismatch — try again.');
      return;
    }

    console.log('\n✅ Authorization code received. Exchanging for access token...');
    const token = await exchangeToken(code);
    console.log('✅ Access token obtained.\n');

    console.log('Creating discount...');
    const result = await createDiscount(token);
    console.log('\nResult:', JSON.stringify(result, null, 2));

    const discountData = result.data?.discountAutomaticAppCreate;
    if (discountData?.userErrors?.length) {
      console.log('\n❌ User errors:', discountData.userErrors);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>❌ Error creating discount</h1><pre>' + JSON.stringify(discountData.userErrors, null, 2) + '</pre>');
    } else if (result.errors) {
      console.log('\n❌ API errors:', result.errors);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>❌ API Error</h1><pre>' + JSON.stringify(result.errors, null, 2) + '</pre>');
    } else {
      console.log('\n🎉 Discount created successfully!');
      console.log('   ID:', discountData.automaticAppDiscount?.discountId);
      console.log('   Title:', discountData.automaticAppDiscount?.title);
      console.log('   Status:', discountData.automaticAppDiscount?.status);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>🎉 Bundle Builder Discount created!</h1><p>You can close this tab and go back to your terminal.</p><pre>' + JSON.stringify(discountData, null, 2) + '</pre>');
    }

    // Shut down after a short delay
    setTimeout(() => { server.close(); process.exit(0); }, 2000);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(3456, () => {
  const authUrl = buildAuthUrl();
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Open this URL in your browser to authorize the app:');
  console.log('');
  console.log('  ' + authUrl);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Waiting for callback on http://localhost:3456/callback ...');
});
