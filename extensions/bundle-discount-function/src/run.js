// =============================================================================
// HPN Bundle Discount Function — run.js
//
// This Shopify Function runs at checkout for every cart that has this
// automatic discount active. It:
//
//   1. Reads every cart line's attributes (= Shopify line_item.properties).
//   2. Finds lines where  _bundle_item === "true".
//   3. Reads the discount % from  _bundle_discount_pct  (set by bundle-builder-page.js).
//   4. Returns a productDiscountsAdd operation that targets ONLY those lines.
//
// Lines WITHOUT _bundle_item are completely ignored — no discount applied.
// This is the key safety guarantee: non-bundle items are never touched.
//
// The function export name ("run") must match the `export` field in
// shopify.extension.toml → [[extensions.targeting]].
// =============================================================================

/**
 * @param {import("../generated/api").RunInput} input
 * @returns {import("../generated/api").FunctionRunResult}
 */
export function run(input) {
  // Guard: only act when this discount is configured as a PRODUCT discount.
  const discountClasses = input.discount?.discountClasses ?? [];
  const isProductDiscount = discountClasses.includes('PRODUCT');

  if (!isProductDiscount) {
    return { operations: [] };
  }

  const lines = input.cart?.lines ?? [];

  // ── Collect bundle lines, grouped by discount percentage ──────────────────
  // Structure: { "20": [lineId, lineId, ...], "25": [...], "30": [...] }
  const buckets = {};

  for (const line of lines) {
    const attrs = line.attribute ?? [];

    // Check _bundle_item === "true"
    const isBundleItem = attrs.some(
      (a) => a.key === '_bundle_item' && a.value === 'true'
    );

    if (!isBundleItem) continue; // skip — not a bundle item

    // Read the percentage from _bundle_discount_pct
    const pctAttr = attrs.find((a) => a.key === '_bundle_discount_pct');
    const pct = pctAttr ? parseInt(pctAttr.value, 10) : 0;

    if (!pct || pct <= 0 || pct > 100) continue; // skip — invalid or zero %

    const key = String(pct);
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(line.id);
  }

  // ── Build one productDiscountsAdd operation per distinct percentage ────────
  // Each operation applies a separate % to its specific set of lines.
  const operations = [];

  for (const [pctStr, lineIds] of Object.entries(buckets)) {
    const percentage = parseFloat(pctStr);

    operations.push({
      productDiscountsAdd: {
        selectionStrategy: 'ALL', // apply to ALL matched lines
        candidates: lineIds.map((lineId) => ({
          targets: [
            {
              cartLine: {
                id: lineId,
              },
            },
          ],
          value: {
            percentage: {
              value: percentage,
            },
          },
          message: `Bundle ${pctStr}% off`,
        })),
      },
    });
  }

  // Return empty operations if nothing matched (safe no-op)
  return { operations };
}
