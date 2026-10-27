export function run(input) {
  const lines = input.cart?.lines ?? [];
  const discountClasses = input.discount?.discountClasses ?? [];
  const tiers = resolveTiers(input.discount?.config?.jsonValue, input.shop?.localTime?.date);

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
    const pct = resolveTier(tiers, group.totalQty);
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

export const DEFAULT_TIERS = { 2: 15, 3: 20, 4: 25 };

export function resolveTiers(rawConfig, today) {
  const config = parseConfig(rawConfig);
  const base = normalizeTiers(config?.defaultTiers) ?? DEFAULT_TIERS;
  if (!config || typeof today !== 'string' || !Array.isArray(config.schedule)) return base;

  for (const window of config.schedule) {
    if (!window || typeof window.start !== 'string' || today < window.start) continue;
    if (typeof window.end === 'string' && today >= window.end) continue;
    const tiers = normalizeTiers(window.tiers);
    if (tiers) return tiers;
  }

  return base;
}

function parseConfig(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeTiers(tiers) {
  if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers)) return null;
  const out = {};
  for (const [qty, pct] of Object.entries(tiers)) {
    const q = Number(qty);
    if (!Number.isInteger(q) || q < 1 || typeof pct !== 'number' || !(pct >= 0 && pct <= 100)) return null;
    out[q] = pct;
  }
  return Object.keys(out).length ? out : null;
}

export function resolveTier(tiers, totalQty) {
  let best = 0;
  let bestQty = 0;
  for (const [qty, pct] of Object.entries(tiers)) {
    const q = Number(qty);
    if (q <= totalQty && q > bestQty) {
      bestQty = q;
      best = pct;
    }
  }
  return best;
}

function moneyToCents(amount) {
  const value = Number.parseFloat(amount ?? '0');
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function centsToMoney(cents) {
  return (cents / 100).toFixed(2);
}
