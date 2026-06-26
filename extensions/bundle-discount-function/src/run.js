export function run(input) {
  const lines = input.cart?.lines ?? [];
  const discountClasses = input.discount?.discountClasses ?? [];

  if (!discountClasses.includes('PRODUCT')) {
    return { operations: [] };
  }

  // Group bundle lines by their bundle ID
  const bundleGroups = new Map();

  for (const line of lines) {
    const isBundleItem = line.bundleItem?.value === 'true';
    const bundleId = line.bundleId?.value;

    if (!isBundleItem || !bundleId) continue;

    if (!bundleGroups.has(bundleId)) {
      bundleGroups.set(bundleId, { lines: [], totalQty: 0, subtotalCents: 0 });
    }

    const group = bundleGroups.get(bundleId);
    group.lines.push(line);
    group.totalQty += line.quantity ?? 1;
    group.subtotalCents += moneyToCents(line.cost?.subtotalAmount?.amount);
  }

  // Build one discount candidate per bundle group so rounding happens on the
  // full bundle subtotal instead of independently on each cart line.
  const candidates = [];

  for (const [, group] of bundleGroups) {
    const pct = resolveTier(group.totalQty);
    const discountCents = Math.round((group.subtotalCents * pct) / 100);

    if (pct <= 0 || discountCents <= 0) continue;

    candidates.push({
      message: 'Bundle ' + pct + '% off',
      targets: group.lines.map((line) => ({ cartLine: { id: line.id } })),
      value: {
        fixedAmount: {
          amount: centsToMoney(discountCents),
          appliesToEachItem: false,
        },
      },
    });
  }

  if (!candidates.length) {
    return { operations: [] };
  }

  return {
    operations: [
      {
        productDiscountsAdd: {
          selectionStrategy: 'ALL',
          candidates: candidates,
        },
      },
    ],
  };
}

function resolveTier(totalQty) {
  if (totalQty >= 4) return 25;
  if (totalQty >= 3) return 20;
  if (totalQty >= 2) return 15;
  return 0;
}

function moneyToCents(amount) {
  const value = Number.parseFloat(amount ?? '0');
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function centsToMoney(cents) {
  return (cents / 100).toFixed(2);
}
