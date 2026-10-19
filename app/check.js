// ¿Se puede armar este modelo con mi inventario? Compartido por la app y scripts/build_models.mjs.
// bom: [{ part, family, qty }]   inventory: data/inventory.json   reserved: { 'part|family': qty } en uso por modelos armados
export function checkBom(bom, inventory, reserved = {}) {
  const parts = new Map(inventory.parts.map(p => [p.part, p]));
  const need = new Map();
  for (const b of bom) need.set(`${b.part}|${b.family}`, (need.get(`${b.part}|${b.family}`) || 0) + b.qty);
  const have = (part, fam) => (parts.get(part)?.colors[fam] || 0) - (reserved[`${part}|${fam}`] || 0);

  const missing = [];
  let total = 0, ok = 0;
  for (const [key, qty] of need) {
    const [part, family] = key.split('|');
    const h = Math.max(0, have(part, family));
    total += qty;
    ok += Math.min(qty, h);
    if (h >= qty) continue;
    // Sustitutos: misma forma en otro color con sobrante suficiente.
    const short = qty - h;
    const alts = Object.keys(parts.get(part)?.colors || {})
      .filter(f => f !== family)
      .map(f => ({ family: f, spare: have(part, f) - (need.get(`${part}|${f}`) || 0) }))
      .filter(a => a.spare >= short)
      .sort((a, b) => b.spare - a.spare);
    missing.push({ part, family, need: qty, have: h, short, alts, unknown: !parts.has(part) });
  }
  return { ok: missing.length === 0, total, available: ok, missing };
}

// Suma las piezas de varios modelos (para reservar las de los modelos que estan armados).
export function sumBoms(boms) {
  const r = {};
  for (const bom of boms) for (const b of bom) r[`${b.part}|${b.family}`] = (r[`${b.part}|${b.family}`] || 0) + b.qty;
  return r;
}
