/**
 * Sets the tier schedule (metafield $app:bundle/config) on the existing
 * "Bundle Builder Discount" automatic discount of onesolsupps.myshopify.com.
 * The function reads it at runtime, so changing dates/tiers needs no redeploy.
 *
 * 1. $env:SHOPIFY_CLIENT_SECRET="shpss_..."
 *    (Partners > Apps > bundle-builder-discount > Client credentials)
 * 2. Edit bundle-schedule.onesol.json (dates are in the store timezone, end is exclusive, null = open-ended)
 * 3. node set-bundle-schedule.onesol.mjs --dry-run   (prints timezone + current/new config, writes nothing)
 *    node set-bundle-schedule.onesol.mjs             (writes it)
 * 4. Open the printed URL while logged into the store admin; the script exits when done.
 *
 * Uses the DEFAULT app config (shopify.app.toml, same client_id as oauth-create-discount.onesol.mjs).
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';

const CLIENT_ID      = '7c4b3a3e21cbf6eb40a93e504827edc0';
const CLIENT_SECRET  = process.env.SHOPIFY_CLIENT_SECRET;
const SHOP           = 'onesolsupps.myshopify.com';
const SCOPES         = 'write_discounts,read_discounts';
const REDIRECT_URI   = 'http://localhost:3456/callback';
const API_VERSION    = '2026-01';
const DISCOUNT_TITLE = 'Bundle Builder Discount';
const METAFIELD      = { namespace: '$app:bundle', key: 'config' };
const CONFIG_FILE    = new URL('./bundle-schedule.onesol.json', import.meta.url);
const DRY_RUN        = process.argv.includes('--dry-run');

if (!CLIENT_SECRET) {
  console.error('\nMissing SHOPIFY_CLIENT_SECRET environment variable.');
  console.error('Run:  $env:SHOPIFY_CLIENT_SECRET="shpss_..."  before this script.\n');
  process.exit(1);
}

const TIER_KEY = /^[1-9]\d*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateTiers(tiers, where) {
  if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers) || !Object.keys(tiers).length) {
    throw new Error(`${where}: tiers must be a non-empty object`);
  }
  for (const [qty, pct] of Object.entries(tiers)) {
    if (!TIER_KEY.test(qty) || typeof pct !== 'number' || pct < 0 || pct > 100) {
      throw new Error(`${where}: invalid tier ${qty} -> ${pct}`);
    }
  }
}

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  validateTiers(config.defaultTiers, 'defaultTiers');
  if (!Array.isArray(config.schedule)) throw new Error('schedule must be an array');
  config.schedule.forEach((w, i) => {
    if (!DATE.test(w.start)) throw new Error(`schedule[${i}].start must be YYYY-MM-DD`);
    if (w.end !== null && !DATE.test(w.end)) throw new Error(`schedule[${i}].end must be YYYY-MM-DD or null`);
    if (w.end !== null && w.end <= w.start) throw new Error(`schedule[${i}]: end must be after start`);
    validateTiers(w.tiers, `schedule[${i}]`);
  });
  return config;
}

const config = loadConfig();
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
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
  });
  const data = await res.json();
  return data.access_token;
}

async function gql(token, query, variables) {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error('API errors: ' + JSON.stringify(data.errors));
  return data.data;
}

async function apply(token) {
  const found = await gql(token, `
    query($namespace: String!, $key: String!, $search: String!) {
      shop { ianaTimezone }
      discountNodes(first: 50, query: $search) {
        nodes {
          id
          metafield(namespace: $namespace, key: $key) { jsonValue }
          discount {
            __typename
            ... on DiscountAutomaticApp { title status }
          }
        }
      }
    }
  `, { ...METAFIELD, search: `title:*Bundle*` });

  console.log('Shop timezone (ianaTimezone):', found.shop.ianaTimezone);

  const matches = found.discountNodes.nodes.filter(
    (n) => n.discount?.__typename === 'DiscountAutomaticApp' && n.discount.title === DISCOUNT_TITLE,
  );
  if (matches.length !== 1) {
    throw new Error(`Expected exactly 1 app discount titled "${DISCOUNT_TITLE}", found ${matches.length}.`);
  }
  const node = matches[0];
  console.log(`Discount: ${node.id} (${node.discount.status})`);
  console.log('Current config:', JSON.stringify(node.metafield?.jsonValue ?? null, null, 2));
  console.log('New config:    ', JSON.stringify(config, null, 2));

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written.');
    return;
  }

  const result = await gql(token, `
    mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { namespace key jsonValue }
        userErrors { field message }
      }
    }
  `, {
    metafields: [{
      ownerId: node.id,
      ...METAFIELD,
      type: 'json',
      value: JSON.stringify(config),
    }],
  });

  const { metafields, userErrors } = result.metafieldsSet;
  if (userErrors.length) throw new Error('User errors: ' + JSON.stringify(userErrors));
  console.log('\nSchedule saved:', JSON.stringify(metafields[0], null, 2));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3456');

  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  if (url.searchParams.get('state') !== nonce) {
    res.writeHead(400);
    res.end('State mismatch, try again.');
    return;
  }

  let ok = true;
  try {
    const token = await exchangeToken(url.searchParams.get('code'));
    if (!token) throw new Error('Could not obtain an access token.');
    await apply(token);
  } catch (err) {
    ok = false;
    console.error('\nFailed:', err.message);
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(ok ? '<h1>Done</h1><p>Check your terminal. You can close this tab.</p>' : '<h1>Failed</h1><p>Check your terminal.</p>');
  setTimeout(() => { server.close(); process.exit(ok ? 0 : 1); }, 1000);
});

server.listen(3456, () => {
  console.log(DRY_RUN ? '\n(dry run)\n' : '');
  console.log('Open this URL in your browser to authorize the app:\n');
  console.log('  ' + buildAuthUrl() + '\n');
  console.log('Waiting for callback on http://localhost:3456/callback ...');
});
