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
      bundleGroups.set(bundleId, { lines: [], totalQty: 0 });
    }

    const group = bundleGroups.get(bundleId);
    group.lines.push(line);
    group.totalQty += line.quantity ?? 1;
  }

  // Build discount candidates per bundle group
  const candidates = [];

  for (const [, group] of bundleGroups) {
    const pct = resolveTier(group.totalQty);
    if (pct <= 0) continue;

    for (const line of group.lines) {
      candidates.push({
        message: 'Bundle ' + pct + '% off',
        targets: [{ cartLine: { id: line.id } }],
        value: { percentage: { value: pct } },
      });
    }
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
  if (totalQty >= 4) return 30;
  if (totalQty >= 3) return 25;
  if (totalQty >= 2) return 20;
  return 0;
}
