/**
 * One-time script to create the Bundle Builder automatic discount
 * in hpnsupplements.myshopify.com
 *
 * Usage:
 *   node create-discount.mjs <ADMIN_API_ACCESS_TOKEN>
 *
 * Get the token from:
 *   Partners Dashboard → bundle-discount-setup app → API credentials → Admin API access token
 */

const SHOP = 'hpnsupplements.myshopify.com';
const API_VERSION = '2026-01';
const TOKEN = process.argv[2];

if (!TOKEN) {
  console.error('Usage: node create-discount.mjs <ADMIN_API_ACCESS_TOKEN>');
  process.exit(1);
}

// Step 1: Find the functionId of the installed hpn-bundle-discount function
const findFunctionQuery = `
  query {
    shopifyFunctions(first: 10) {
      nodes {
        id
        title
        apiType
        app {
          title
        }
      }
    }
  }
`;

async function graphql(query, variables = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
}

// Step 2: Create the automatic discount
const createDiscountMutation = `
  mutation discountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
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

async function main() {
  console.log('🔍 Finding HPN Bundle Discount function...');
  
  const functionsData = await graphql(findFunctionQuery);
  const functions = functionsData.shopifyFunctions.nodes;
  
  console.log('Available functions:');
  functions.forEach(f => console.log(`  - ${f.title} (${f.app?.title}) → ${f.id}`));

  const bundleFunction = functions.find(
    f => f.title?.toLowerCase().includes('bundle') || f.app?.title?.toLowerCase().includes('bundle')
  );

  if (!bundleFunction) {
    console.error('❌ HPN Bundle Discount function not found. Make sure hpn-bundle-builder-discount app is installed.');
    process.exit(1);
  }

  console.log(`\n✅ Found: ${bundleFunction.title} → ${bundleFunction.id}`);
  console.log('\n🚀 Creating automatic discount...');

  const result = await graphql(createDiscountMutation, {
    automaticAppDiscount: {
      title: 'Bundle Builder Discount',
      functionId: bundleFunction.id,
      startsAt: new Date().toISOString(),
      combinesWith: {
        orderDiscounts: false,
        productDiscounts: false,
        shippingDiscounts: false,
      },
    },
  });

  const { automaticAppDiscount, userErrors } = result.discountAutomaticAppCreate;

  if (userErrors.length > 0) {
    console.error('❌ Errors:', JSON.stringify(userErrors, null, 2));
    process.exit(1);
  }

  console.log('\n🎉 Discount created successfully!');
  console.log(`   ID:     ${automaticAppDiscount.discountId}`);
  console.log(`   Title:  ${automaticAppDiscount.title}`);
  console.log(`   Status: ${automaticAppDiscount.status}`);
  console.log('\n✅ The Bundle Builder discount is now ACTIVE on hpnsupplements.myshopify.com');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
