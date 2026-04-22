const rateLimit = new Map();

const SYSTEM = `You are a senior automotive investment analyst specializing in exotic and collector vehicles. The user may write a simple query or a deep research prompt — always extract their intent and return comprehensive structured data.

CRITICAL: Return ONLY valid, complete JSON. No markdown, no code fences, no explanation. All string values ≤ 120 chars. Max 8 variants. Close ALL arrays and objects before finishing.

Return exactly this schema:
{"title":"short title","subtitle":"one line","market_context":"one sentence on market dynamics","peer_group_avg_mult":1.12,"investment_signal":"accumulate|hold|avoid","signal_reasoning":"one sentence with a specific data point supporting the signal","autoturn_lens":"one sentence on what this means for AutoTurn members rotating these cars","variants":[{"name":"Full Model Name","brand":"Ferrari","year_range":"2009-2012","segment":"Mid-Engine GT","msrp":233000,"auction_avg":185000,"multiplier":0.79,"roi_pct":-21,"beta":0.71,"production_count":19849,"rarity_score":3,"prestige_tier":"flagship","use_classification":"driver","collectability_score":6,"type":"base","trend":"rising|stable|falling","entry_window":"now|wait|passed","notes":"brief note max 120 chars"}],"insights":["specific insight with actual numbers","insight 2","insight 3","insight 4"],"beta_analysis":"2 sentences on which cars beat the peer group and why","sector_summary":{"top_performer":"Model Name","worst_performer":"Model Name","avg_return_mult":1.14,"avg_beta":0.95,"best_risk_adjusted":"Model Name"}}

Rules:
- beta = this car multiplier / peer_group_avg_mult (>1.0 = beat peer group)
- peer_group_avg_mult = mean of all variant multipliers
- investment_signal overall verdict: accumulate (strong buy case), hold (neutral/wait), avoid (poor risk-reward now)
- trend = 5-year price direction for this specific model: rising, stable, or falling
- entry_window: now = currently undervalued or momentum accelerating, wait = pricing likely to soften, passed = peak is likely behind it
- rarity_score 1-10, collectability_score 1-10
- prestige_tier: entry|mid|flagship|hypercar|ultra-rare
- use_classification: driver|investment|both
- type: base|flagship|peer
- Include cross-brand peer vehicles for true benchmarking
- Pick the 8 most illustrative and analytically distinct vehicles
- All insights must cite actual numbers from the data`;

function checkRate(ip) {
  const now = Date.now();
  const WINDOW = 3_600_000;
  const LIMIT = 10;
  const e = rateLimit.get(ip);
  if (!e || now > e.r) { rateLimit.set(ip, { c: 1, r: now + WINDOW }); return true; }
  if (e.c >= LIMIT) return false;
  e.c++;
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (!checkRate(ip)) {
    return res.status(429).json({ error: 'Rate limit reached — try again in an hour.' });
  }

  const { query, mode = 'quick' } = req.body || {};
  if (!query?.trim()) return res.status(400).json({ error: 'No query provided.' });

  const key = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server not configured.' });

  const isDeep = mode === 'deep';
  const payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: isDeep ? 16000 : 8000,
    system: SYSTEM,
    messages: [{ role: 'user', content: query.trim() }]
  };
  if (isDeep) payload.thinking = { type: 'enabled', budget_tokens: 8000 };

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: e.error?.message || `Anthropic error ${r.status}` });
    }

    const d = await r.json();
    const text = isDeep
      ? (d.content?.find(b => b.type === 'text')?.text || '')
      : (d.content?.[0]?.text || '');

    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Internal error.' });
  }
}
