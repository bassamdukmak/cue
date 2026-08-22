// Published USD rates per million tokens. This is the authoritative table for
// persisted usage; the renderer only has a legacy fallback for older mains.
const MODEL_RATES = {
  'deepseek-v4-flash': { in: 0.14, cachedIn: 0.0028, out: 0.28 },
  'deepseek-v4-flash-vision-exp': { in: 0.22, cachedIn: 0.0044, out: 0.66 },
  'deepseek-v4-pro': { in: 0.435, cachedIn: 0.003625, out: 0.87 },
  'deepseek-chat': { in: 0.14, cachedIn: 0.0028, out: 0.28 },
  'deepseek-reasoner': { in: 0.14, cachedIn: 0.0028, out: 0.28 },
  'gpt-4o': { in: 2.50, cachedIn: 1.25, out: 10.00 },
  'gpt-4o-mini': { in: 0.15, cachedIn: 0.075, out: 0.60 },
  'claude-3-5-haiku-latest': { in: 0.80, cachedIn: 0.08, out: 4.00 },
  'claude-3-5-sonnet-latest': { in: 3.00, cachedIn: 0.30, out: 15.00 },
  'claudecli': { in: 0, cachedIn: 0, out: 0 },
};

function rateFor(model) {
  const name = String(model || '').toLowerCase();
  if (MODEL_RATES[name]) return MODEL_RATES[name];
  if (/^claude.*haiku/.test(name)) return MODEL_RATES['claude-3-5-haiku-latest'];
  if (/^claude.*sonnet/.test(name)) return MODEL_RATES['claude-3-5-sonnet-latest'];
  if (/^claude.*opus/.test(name)) return { in: 15, cachedIn: 1.5, out: 75 };
  return null;
}

function estimateCost(byModel) {
  return Object.entries(byModel || {}).reduce((total, [model, usage]) => {
    const rate = rateFor(model);
    if (!rate) return total;
    const prompt = Number(usage?.promptTokens) || 0;
    const cached = Math.min(prompt, Math.max(0, Number(usage?.cachedTokens) || 0));
    return total + ((prompt - cached) * rate.in + cached * rate.cachedIn + (Number(usage?.completionTokens) || 0) * rate.out) / 1e6;
  }, 0);
}

function unpricedModels(byModel) {
  return Object.keys(byModel || {}).filter((model) => !rateFor(model));
}

function emptyUsage({ lifetime = false } = {}) {
  return { promptTokens: 0, cachedTokens: 0, completionTokens: 0, calls: 0, costUsd: 0, byModel: {}, ...(lifetime ? { since: null } : {}) };
}

function accumulateUsage(totals, usage, { lifetime = false, now = new Date() } = {}) {
  const next = { ...emptyUsage({ lifetime }), ...(totals || {}), byModel: { ...(totals?.byModel || {}) } };
  const model = usage?.model || 'unknown';
  const perModel = { promptTokens: 0, cachedTokens: 0, completionTokens: 0, calls: 0, ...(next.byModel[model] || {}) };
  for (const field of ['promptTokens', 'cachedTokens', 'completionTokens']) {
    const amount = Number(usage?.[field]) || 0;
    next[field] += amount;
    perModel[field] += amount;
  }
  next.calls += 1;
  perModel.calls += 1;
  next.byModel[model] = perModel;
  next.costUsd = estimateCost(next.byModel);
  if (lifetime && !next.since) next.since = now.toISOString();
  return next;
}

module.exports = { MODEL_RATES, estimateCost, unpricedModels, emptyUsage, accumulateUsage };
