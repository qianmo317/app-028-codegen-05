"use strict";

// src/logic/guillotine.ts
var EPS = 2e-3;
function rectsEqual(a, b, eps = EPS) {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.w - b.w) < eps && Math.abs(a.h - b.h) < eps;
}
function rectContains(outer, inner, eps = EPS) {
  return inner.x >= outer.x - eps && inner.y >= outer.y - eps && inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;
}
function buildCandidates(region2, rects) {
  const out3 = [];
  const xs = /* @__PURE__ */ new Set();
  const ys = /* @__PURE__ */ new Set();
  for (const r2 of rects) {
    xs.add(r2.x);
    xs.add(r2.x + r2.w);
    ys.add(r2.y);
    ys.add(r2.y + r2.h);
  }
  const collect = (axis, coords) => {
    for (const at of coords) {
      if (axis === "v") {
        if (at <= region2.x + EPS || at >= region2.x + region2.w - EPS) continue;
      } else {
        if (at <= region2.y + EPS || at >= region2.y + region2.h - EPS) continue;
      }
      let spans = false;
      for (const r2 of rects) {
        if (axis === "v") {
          if (r2.x < at - EPS && r2.x + r2.w > at + EPS) {
            spans = true;
            break;
          }
        } else if (r2.y < at - EPS && r2.y + r2.h > at + EPS) {
          spans = true;
          break;
        }
      }
      if (spans) continue;
      const a = [];
      const b = [];
      for (const r2 of rects) {
        const lo = axis === "v" ? r2.x : r2.y;
        const hi = lo + (axis === "v" ? r2.w : r2.h);
        if (hi <= at + EPS) a.push(r2);
        else if (lo >= at - EPS) b.push(r2);
      }
      if (a.length + b.length !== rects.length) continue;
      const aRegion = axis === "v" ? { x: region2.x, y: region2.y, w: at - region2.x, h: region2.h } : { x: region2.x, y: region2.y, w: region2.w, h: at - region2.y };
      const bRegion = axis === "v" ? { x: at, y: region2.y, w: region2.x + region2.w - at, h: region2.h } : { x: region2.x, y: at, w: region2.w, h: region2.y + region2.h - at };
      let edgeCount = 0;
      for (const r2 of rects) {
        const lo = axis === "v" ? r2.x : r2.y;
        const hi = lo + (axis === "v" ? r2.w : r2.h);
        if (Math.abs(lo - at) < EPS || Math.abs(hi - at) < EPS) edgeCount++;
      }
      out3.push({
        axis,
        at,
        aRects: a,
        bRects: b,
        aRegion,
        bRegion,
        edgeCount,
        both: a.length > 0 && b.length > 0,
        areaSum: aRegion.w * aRegion.h + bRegion.w * bRegion.h
      });
    }
  };
  collect("v", xs);
  collect("h", ys);
  return out3;
}
function candidateScore(c) {
  return [
    // 优先沿「一边为空」的位置把废料切掉，减少后续修边刀
    c.both ? 1 : 0,
    Math.abs(c.aRects.length - c.bRects.length),
    -c.edgeCount,
    c.areaSum
  ];
}
function trimCuts(region2, r2) {
  const out3 = [];
  let cur = { ...region2 };
  if (r2.y > cur.y + EPS) {
    out3.push({ axis: "h", at: r2.y, from: cur.x, to: cur.x + cur.w });
    cur = { x: cur.x, y: r2.y, w: cur.w, h: cur.y + cur.h - r2.y };
  }
  if (r2.y + r2.h < cur.y + cur.h - EPS) {
    out3.push({ axis: "h", at: r2.y + r2.h, from: cur.x, to: cur.x + cur.w });
    cur = { ...cur, h: r2.h };
  }
  if (r2.x > cur.x + EPS) {
    out3.push({ axis: "v", at: r2.x, from: cur.y, to: cur.y + cur.h });
    cur = { x: r2.x, y: cur.y, w: cur.x + cur.w - r2.x, h: cur.h };
  }
  if (r2.x + r2.w < cur.x + cur.w - EPS) {
    out3.push({ axis: "v", at: r2.x + r2.w, from: cur.y, to: cur.y + cur.h });
    cur = { ...cur, w: r2.w };
  }
  return out3;
}
function decompose(region2, rects, budget = { n: 6e4 }, seen = /* @__PURE__ */ new Set()) {
  for (const r2 of rects) {
    if (!rectContains(region2, r2)) return null;
  }
  if (rects.length === 0) return [];
  if (rects.length === 1) return trimCuts(region2, rects[0]);
  const sig3 = `${region2.x.toFixed(4)},${region2.y.toFixed(4)},${region2.w.toFixed(4)},${region2.h.toFixed(4)}|` + rects.map((r2) => `${r2.x.toFixed(4)},${r2.y.toFixed(4)},${r2.w.toFixed(4)},${r2.h.toFixed(4)}`).sort().join(";");
  if (seen.has(sig3)) return null;
  seen.add(sig3);
  const cands = buildCandidates(region2, rects);
  cands.sort((p, q) => {
    const sp = candidateScore(p);
    const sq = candidateScore(q);
    for (let i = 0; i < sp.length; i++) {
      if (sp[i] !== sq[i]) return sp[i] - sq[i];
    }
    return 0;
  });
  for (const c of cands) {
    if (budget.n-- <= 0) return null;
    const progresses = c.axis === "v" ? c.aRegion.w > EPS && c.bRegion.w > EPS : c.aRegion.h > EPS && c.bRegion.h > EPS;
    if (!progresses) continue;
    const childSeen = new Set(seen);
    const a = decompose(c.aRegion, c.aRects, budget, childSeen);
    if (!a) continue;
    const b = decompose(c.bRegion, c.bRects, budget, childSeen);
    if (!b) continue;
    const cut2 = c.axis === "v" ? { axis: "v", at: c.at, from: region2.y, to: region2.y + region2.h } : { axis: "h", at: c.at, from: region2.x, to: region2.x + region2.w };
    return [cut2, ...a, ...b];
  }
  return null;
}
function buildOwnerCandidates(region2, rects, ownerOf) {
  const out3 = [];
  const xs = /* @__PURE__ */ new Set();
  const ys = /* @__PURE__ */ new Set();
  for (const r2 of rects) {
    xs.add(r2.x);
    xs.add(r2.x + r2.w);
    ys.add(r2.y);
    ys.add(r2.y + r2.h);
  }
  const ownersOf = (idx) => new Set(idx.map(ownerOf));
  const spans = (axis, r2, at) => axis === "v" ? r2.x < at - EPS && r2.x + r2.w > at + EPS : r2.y < at - EPS && r2.y + r2.h > at + EPS;
  const collect = (axis, coords) => {
    for (const at of coords) {
      if (axis === "v") {
        if (at <= region2.x + EPS || at >= region2.x + region2.w - EPS) continue;
      } else if (at <= region2.y + EPS || at >= region2.y + region2.h - EPS) continue;
      if (rects.some((r2) => spans(axis, r2, at))) continue;
      const aRects = [];
      const bRects = [];
      rects.forEach((r2, i) => {
        const lo = axis === "v" ? r2.x : r2.y;
        const hi = lo + (axis === "v" ? r2.w : r2.h);
        if (hi <= at + EPS) aRects.push(i);
        else if (lo >= at - EPS) bRects.push(i);
      });
      if (aRects.length + bRects.length !== rects.length) continue;
      const aOwners = ownersOf(aRects);
      const bOwners = ownersOf(bRects);
      const intersects = [...aOwners].some((o) => bOwners.has(o));
      const aRegion = axis === "v" ? { x: region2.x, y: region2.y, w: at - region2.x, h: region2.h } : { x: region2.x, y: region2.y, w: region2.w, h: at - region2.y };
      const bRegion = axis === "v" ? { x: at, y: region2.y, w: region2.x + region2.w - at, h: region2.h } : { x: region2.x, y: at, w: region2.w, h: region2.y + region2.h - at };
      let edgeCount = 0;
      for (const r2 of rects) {
        const lo = axis === "v" ? r2.x : r2.y;
        const hi = lo + (axis === "v" ? r2.w : r2.h);
        if (Math.abs(lo - at) < EPS || Math.abs(hi - at) < EPS) edgeCount++;
      }
      out3.push({
        axis,
        at,
        aRects,
        bRects,
        aRegion,
        bRegion,
        aOwners,
        bOwners,
        separates: !intersects && aOwners.size > 0 && bOwners.size > 0,
        edgeCount
      });
    }
  };
  collect("v", xs);
  collect("h", ys);
  return out3;
}
function decomposeByOwner(region2, rects, ownerOf, budget = { n: 6e4 }) {
  for (const r2 of rects) {
    if (!rectContains(region2, r2)) return null;
  }
  if (rects.length === 0) return [];
  const owners = new Set(rects.map((_, i) => ownerOf(i)));
  if (owners.size <= 1) {
    const geo = decompose(region2, rects, budget);
    if (!geo) return null;
    return geo.map((c) => ({ ...c, role: "internal" }));
  }
  const cands = buildOwnerCandidates(region2, rects, ownerOf);
  cands.sort((p, q) => {
    if (p.separates !== q.separates) return p.separates ? -1 : 1;
    const dp = Math.abs(p.aOwners.size - p.bOwners.size);
    const dq = Math.abs(q.aOwners.size - q.bOwners.size);
    if (dp !== dq) return dp - dq;
    return q.edgeCount - p.edgeCount;
  });
  for (const c of cands) {
    if (budget.n-- <= 0) return null;
    const aRects = c.aRects.map((i) => rects[i]);
    const bRects = c.bRects.map((i) => rects[i]);
    const a = decomposeByOwner(c.aRegion, aRects, (i) => ownerOf(c.aRects[i]), budget);
    if (!a) continue;
    const b = decomposeByOwner(c.bRegion, bRects, (i) => ownerOf(c.bRects[i]), budget);
    if (!b) continue;
    const role = c.separates ? "boundary" : "internal";
    const cut2 = c.axis === "v" ? { axis: "v", at: c.at, from: region2.y, to: region2.y + region2.h, role } : { axis: "h", at: c.at, from: region2.x, to: region2.x + region2.w, role };
    return [cut2, ...a, ...b];
  }
  return null;
}
function validateCutSequence(region2, slots, cuts) {
  let pieces = [{ r: { ...region2 }, idx: slots.map((_, i) => i) }];
  const fail = (reason, step) => ({
    ok: false,
    reason,
    failedStep: step,
    pieces
  });
  for (let s = 0; s < cuts.length; s++) {
    const c = cuts[s];
    const affected = [];
    for (const p of pieces) {
      if (c.axis === "v") {
        if (p.r.x < c.at - EPS && c.at < p.r.x + p.r.w - EPS && c.from <= p.r.y + EPS && p.r.y + p.r.h <= c.to + EPS) {
          affected.push(p);
        }
      } else if (p.r.y < c.at - EPS && c.at < p.r.y + p.r.h - EPS && c.from <= p.r.x + EPS && p.r.x + p.r.w <= c.to + EPS) {
        affected.push(p);
      }
    }
    if (affected.length === 0) {
      return fail(`\u7B2C ${s + 1} \u6B65\u5207\u5272\u7EBF\u672A\u843D\u5728\u4EFB\u4F55\u5F85\u5207\u5757\u5185`, s + 1);
    }
    for (const p of pieces) {
      if (affected.includes(p)) continue;
      const inside = c.axis === "v" ? p.r.x < c.at - EPS && c.at < p.r.x + p.r.w - EPS : p.r.y < c.at - EPS && c.at < p.r.y + p.r.h - EPS;
      if (!inside) continue;
      const lo = c.axis === "v" ? p.r.y : p.r.x;
      const hi = lo + (c.axis === "v" ? p.r.h : p.r.w);
      if (Math.min(hi, c.to) - Math.max(lo, c.from) > EPS) {
        return fail(`\u7B2C ${s + 1} \u6B65\u5207\u5272\u7EBF\u672A\u8D2F\u901A\u5F53\u524D\u5757\uFF08\u53EA\u5207\u5230\u4E00\u534A\uFF09`, s + 1);
      }
    }
    const iv = affected.map(
      (p) => c.axis === "v" ? [p.r.y, p.r.y + p.r.h] : [p.r.x, p.r.x + p.r.w]
    ).sort((a, b) => a[0] - b[0]);
    if (Math.abs(iv[0][0] - c.from) > EPS) {
      return fail(`\u7B2C ${s + 1} \u6B65\u5207\u5272\u7EBF\u8D77\u70B9\u672A\u4E0E\u5F85\u5207\u5757\u5BF9\u9F50`, s + 1);
    }
    for (let i = 1; i < iv.length; i++) {
      if (iv[i][0] > iv[i - 1][1] + EPS) {
        return fail(`\u7B2C ${s + 1} \u6B65\u5207\u5272\u7EBF\u8DE8\u8D8A\u4E86\u7A7A\u9699\uFF0C\u672A\u8D2F\u901A\u5230\u5E95`, s + 1);
      }
    }
    if (Math.abs(iv[iv.length - 1][1] - c.to) > EPS) {
      return fail(`\u7B2C ${s + 1} \u6B65\u5207\u5272\u7EBF\u7EC8\u70B9\u672A\u4E0E\u5F85\u5207\u5757\u5BF9\u9F50`, s + 1);
    }
    for (const p of affected) {
      for (const i of p.idx) {
        const sl = slots[i];
        const crosses = c.axis === "v" ? sl.x < c.at - EPS && sl.x + sl.w > c.at + EPS : sl.y < c.at - EPS && sl.y + sl.h > c.at + EPS;
        if (crosses) return fail(`\u7B2C ${s + 1} \u6B65\u5207\u5272\u7EBF\u7A7F\u8FC7\u4E86\u7B2C ${i + 1} \u5F20\u7167\u7247`, s + 1);
      }
    }
    const rest = pieces.filter((p) => !affected.includes(p));
    const next = [];
    for (const p of affected) {
      if (c.axis === "v") {
        const left = p.idx.filter((i) => slots[i].x + slots[i].w <= c.at + EPS);
        const right = p.idx.filter((i) => slots[i].x >= c.at - EPS);
        if (left.length + right.length !== p.idx.length) {
          return fail(`\u7B2C ${s + 1} \u6B65\u5207\u5272\u7EBF\u8DE8\u8D8A\u4E86\u7167\u7247\u8FB9\u754C`, s + 1);
        }
        next.push({ r: { x: p.r.x, y: p.r.y, w: c.at - p.r.x, h: p.r.h }, idx: left });
        next.push({
          r: { x: c.at, y: p.r.y, w: p.r.x + p.r.w - c.at, h: p.r.h },
          idx: right
        });
      } else {
        const top = p.idx.filter((i) => slots[i].y + slots[i].h <= c.at + EPS);
        const bottom = p.idx.filter((i) => slots[i].y >= c.at - EPS);
        if (top.length + bottom.length !== p.idx.length) {
          return fail(`\u7B2C ${s + 1} \u6B65\u5207\u5272\u7EBF\u8DE8\u8D8A\u4E86\u7167\u7247\u8FB9\u754C`, s + 1);
        }
        next.push({ r: { x: p.r.x, y: p.r.y, w: p.r.w, h: c.at - p.r.y }, idx: top });
        next.push({
          r: { x: p.r.x, y: c.at, w: p.r.w, h: p.r.y + p.r.h - c.at },
          idx: bottom
        });
      }
    }
    pieces = [...rest, ...next];
  }
  for (let i = 0; i < slots.length; i++) {
    const ok = pieces.some((p) => p.idx.length === 1 && p.idx[0] === i && rectsEqual(p.r, slots[i]));
    if (!ok) return fail(`\u7B2C ${i + 1} \u5F20\u7167\u7247\u672A\u88AB\u5207\u5272\u7EBF\u72EC\u7ACB\u5206\u51FA`, cuts.length);
  }
  return { ok: true, reason: "\u5168\u90E8\u5207\u5272\u7EBF\u8D2F\u901A", failedStep: 0, pieces };
}

// src/logic/units.ts
var MM_PER_INCH = 25.4;
var PT_PER_INCH = 72;
var MM_TO_PT = PT_PER_INCH / MM_PER_INCH;
function round(n, digits = 3) {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

// src/logic/packer.ts
function usableRegion(opts2) {
  const inset = opts2.marginMm + opts2.safeEdgeMm;
  const w = round(opts2.paperW - 2 * inset, 4);
  const h = round(opts2.paperH - 2 * inset, 4);
  if (w <= 0 || h <= 0) return null;
  return { x: inset, y: inset, w, h };
}

// src/logic/merge.ts
var COORD_DIGITS = 2;
var MIN_LEAF_MM = 3;
var FIT_EPS = 1e-6;
function slotSize(g, m2) {
  return { w: g.photoW + 2 * m2, h: g.photoH + 2 * m2 };
}
function findBest(free, owner, w, h, allowRotate) {
  let best = null;
  let bestScore = null;
  const consider = (i, rw, rh, pw, ph, rot) => {
    if (pw > rw + FIT_EPS || ph > rh + FIT_EPS) return;
    const dw = rw - pw;
    const dh = rh - ph;
    const score = [Math.min(dw, dh), Math.max(dw, dh), rw * rh - pw * ph];
    if (!bestScore || score[0] < bestScore[0] - EPS || Math.abs(score[0] - bestScore[0]) < EPS && (score[1] < bestScore[1] - EPS || Math.abs(score[1] - bestScore[1]) < EPS && score[2] < bestScore[2] - EPS)) {
      bestScore = score;
      best = { idx: i, rotated: rot, w: pw, h: ph };
    }
  };
  for (let i = 0; i < free.length; i++) {
    if (free[i].owner !== owner) continue;
    const f = free[i];
    consider(i, f.w, f.h, w, h, false);
    if (allowRotate && Math.abs(w - h) > EPS) consider(i, f.w, f.h, h, w, true);
  }
  return best;
}
function fitsAnyRect(r2, w, h, allowRotate) {
  return w <= r2.w + FIT_EPS && h <= r2.h + FIT_EPS || allowRotate && h <= r2.w + FIT_EPS && w <= r2.h + FIT_EPS;
}
function splitPlace(free, idx, pw, ph) {
  const f = free[idx];
  free.splice(idx, 1);
  const placed = { x: f.x, y: f.y, w: pw, h: ph };
  const dw = f.w - pw;
  const dh = f.h - ph;
  const mk = (x, y, w, h) => ({
    x,
    y,
    w,
    h,
    owner: f.owner
  });
  if (dh <= EPS && dw <= EPS) return placed;
  if (dh <= EPS) {
    free.push(mk(f.x + pw, f.y, dw, ph));
    return placed;
  }
  if (dw <= EPS) {
    free.push(mk(f.x, f.y + ph, f.w, dh));
    return placed;
  }
  const maxH = Math.max(f.w * dh, dw * ph);
  const maxV = Math.max(dw * f.h, pw * dh);
  if (maxH >= maxV) {
    free.push(mk(f.x, f.y + ph, f.w, dh));
    free.push(mk(f.x + pw, f.y, dw, ph));
  } else {
    free.push(mk(f.x + pw, f.y, dw, f.h));
    free.push(mk(f.x, f.y + ph, pw, dh));
  }
  return placed;
}
function tryPlaceOne(free, g, opts2, m2) {
  const { w: sw, h: sh } = slotSize(g, m2);
  const fit = findBest(free, g.customerId, sw, sh, opts2.allowRotate && g.allowRotate);
  if (!fit) return null;
  const trial = free.slice();
  const placed = splitPlace(trial, fit.idx, fit.w, fit.h);
  return { free: trial, placed, rotated: fit.rotated };
}
function tryPlaceMany(free, g, count, opts2, m2) {
  let cur = free;
  const out3 = [];
  for (let i = 0; i < count; i++) {
    const t = tryPlaceOne(cur, g, opts2, m2);
    if (!t) return null;
    out3.push(t);
    cur = t.free;
  }
  return out3;
}
function fillCustomer(free, queue, customerId, opts2, m2) {
  const placed = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const g of queue) {
      if (g.customerId !== customerId || g.copies <= 1 || !g.keepTogether) continue;
      const many = tryPlaceMany(free, g, g.copies, opts2, m2);
      if (many) {
        for (const t of many) {
          free = t.free;
          placed.push({ itemId: g.itemId, customerId, rect: t.placed, rotated: t.rotated });
        }
        g.copies = 0;
        progress = true;
      }
    }
    for (const g of queue) {
      if (g.customerId !== customerId || g.copies <= 0) continue;
      let t = tryPlaceOne(free, g, opts2, m2);
      while (t) {
        free = t.free;
        placed.push({ itemId: g.itemId, customerId, rect: t.placed, rotated: t.rotated });
        g.copies--;
        progress = true;
        if (g.copies <= 0) break;
        t = tryPlaceOne(free, g, opts2, m2);
      }
    }
    if (free.length > 400) {
      free = free.filter((f) => f.w > 0.5 && f.h > 0.5);
    }
  }
  return { free, placed };
}
function freeLeafHasPhoto(leaf, placements) {
  for (const p of placements) {
    const inside = p.rect.x >= leaf.x - EPS && p.rect.y >= leaf.y - EPS && p.rect.x + p.rect.w <= leaf.x + leaf.w + EPS && p.rect.y + p.rect.h <= leaf.y + leaf.h + EPS;
    if (inside) return true;
  }
  return false;
}
function findHandoverLeafIndex(free, leaf, g, opts2, m2) {
  const idx = free.indexOf(leaf);
  if (idx < 0) return -1;
  const { w, h } = slotSize(g, m2);
  return fitsAnyRect(leaf, w, h, opts2.allowRotate && g.allowRotate) ? idx : -1;
}
function leafLeftoverArea(leaf, g, opts2, m2) {
  const { w, h } = slotSize(g, m2);
  let best = Infinity;
  if (w <= leaf.w + FIT_EPS && h <= leaf.h + FIT_EPS) {
    best = Math.min(best, Math.abs(leaf.w * leaf.h - w * h));
  }
  if (opts2.allowRotate && g.allowRotate && h <= leaf.w + FIT_EPS && w <= leaf.h + FIT_EPS) {
    best = Math.min(best, Math.abs(leaf.w * leaf.h - h * w));
  }
  return best;
}
function packMerge(customers2, items2, paper2, cut2, handoverPolicy = "auto", internal = {}) {
  const started = performance.now();
  const opts2 = {
    paperW: paper2.wMm,
    paperH: paper2.hMm,
    marginMm: paper2.marginMm,
    safeEdgeMm: cut2.safeEdgeMm,
    gapMm: cut2.gapMm,
    kerfMm: cut2.kerfMm,
    allowRotate: cut2.allowRotate
  };
  const region2 = usableRegion(opts2);
  if (!region2) {
    return { error: "\u7EB8\u8FB9\u7559\u767D + \u56DB\u5468\u5B89\u5168\u8FB9 \u5DF2\u8D85\u8FC7\u76F8\u7EB8\u5C3A\u5BF8\uFF0C\u8BF7\u8C03\u5C0F\u88C1\u5207\u53C2\u6570" };
  }
  const m2 = (cut2.kerfMm + cut2.gapMm) / 2;
  const nameOf = new Map(customers2.map((c) => [c.id, c.name]));
  const queue = items2.filter((g) => g.copies > 0).map((g) => ({ ...g }));
  const oversize = [];
  for (const g of queue) {
    const { w: sw, h: sh } = slotSize(g, m2);
    const canRot = cut2.allowRotate && g.allowRotate;
    const ok = sw <= region2.w + EPS && sh <= region2.h + EPS || canRot && sh <= region2.w + EPS && sw <= region2.h + EPS;
    if (!ok) {
      oversize.push(
        `\u5BA2\u6237\u300C${nameOf.get(g.customerId) ?? g.customerId}\u300D\u7684 ${round(g.photoW, 1)}\xD7${round(
          g.photoH,
          1
        )}mm \u7167\u7247\u653E\u4E0D\u8FDB\u53EF\u7528\u533A ${round(region2.w, 1)}\xD7${round(region2.h, 1)}mm`
      );
    }
  }
  if (oversize.length) {
    return {
      error: Array.from(new Set(oversize)).join("\uFF1B") + "\uFF08\u6574\u6279\u5DF2\u505C\u6B62\uFF1A\u8BF7\u6362\u66F4\u5927\u76F8\u7EB8\u6216\u8C03\u5C0F\u5B89\u5168\u8FB9/\u7EB8\u8FB9\u7559\u767D\u540E\u91CD\u6392\uFF09"
    };
  }
  const rawSheets = [];
  let guard = 0;
  while (queue.some((g) => g.copies > 0) && guard++ < 2e4) {
    const sheetIndex = rawSheets.length;
    const firstId = customers2.find((c) => queue.some((g) => g.customerId === c.id && g.copies > 0)).id;
    let free = [{ ...region2, owner: firstId }];
    const placements = [];
    const handovers = [];
    const donorLeavesOf = (cid) => free.filter((f) => f.owner !== null && f.owner !== cid && f.w >= MIN_LEAF_MM && f.h >= MIN_LEAF_MM);
    for (const customer of customers2) {
      const cid = customer.id;
      if (!queue.some((g) => g.customerId === cid && g.copies > 0)) continue;
      {
        const res = fillCustomer(free, queue, cid, opts2, m2);
        free = res.free;
        placements.push(...res.placed);
      }
      const remaining = () => queue.filter((g) => g.customerId === cid && g.copies > 0);
      const grantedLeaves = /* @__PURE__ */ new Set();
      if (remaining().length && handoverPolicy === "auto") {
        let progressed = true;
        while (progressed && remaining().length) {
          progressed = false;
          let pick = null;
          let pickLeftover = Infinity;
          for (const leaf2 of donorLeavesOf(cid)) {
            for (const g2 of remaining()) {
              if (findHandoverLeafIndex(free, leaf2, g2, opts2, m2) < 0) continue;
              const leftover = leafLeftoverArea(leaf2, g2, opts2, m2);
              if (leftover < pickLeftover - EPS) {
                pickLeftover = leftover;
                pick = { leaf: leaf2, g: g2 };
              }
            }
          }
          if (!pick) break;
          const { leaf, g } = pick;
          const donor = leaf.owner;
          handovers.push({
            sheetIndex,
            x: round(leaf.x, COORD_DIGITS),
            y: round(leaf.y, COORD_DIGITS),
            w: round(leaf.w, COORD_DIGITS),
            h: round(leaf.h, COORD_DIGITS),
            fromCustomerId: donor,
            toCustomerId: cid,
            granted: true,
            used: false,
            reason: `\u8BA9\u51FA\uFF1A${round(leaf.w, 1)}\xD7${round(
              leaf.h,
              1
            )}mm \u4F59\u6599\u653E\u5F97\u4E0B\u300C${nameOf.get(cid) ?? cid}\u300D\u7684 ${g.sizeName ?? `${round(g.photoW, 0)}\xD7${round(g.photoH, 0)}`}\uFF0C\u5206\u754C\u5200\u6CBF\u6574\u8FB9\u8D2F\u901A\uFF0C\u5757\u53EF\u72EC\u7ACB\u88C1\u5F00`
          });
          grantedLeaves.add(leaf);
          leaf.owner = cid;
          const res = fillCustomer(free, queue, cid, opts2, m2);
          free = res.free;
          if (res.placed.length) {
            handovers[handovers.length - 1].used = true;
            placements.push(...res.placed);
          }
          progressed = true;
        }
        for (const leaf of donorLeavesOf(cid)) {
          if (grantedLeaves.has(leaf)) continue;
          const minSide = Math.min(...remaining().map((g2) => Math.min(slotSize(g2, m2).w, slotSize(g2, m2).h)));
          handovers.push({
            sheetIndex,
            x: round(leaf.x, COORD_DIGITS),
            y: round(leaf.y, COORD_DIGITS),
            w: round(leaf.w, COORD_DIGITS),
            h: round(leaf.h, COORD_DIGITS),
            fromCustomerId: leaf.owner,
            toCustomerId: cid,
            granted: false,
            used: false,
            reason: `\u4E0D\u8BA9\uFF1A${round(leaf.w, 1)}\xD7${round(
              leaf.h,
              1
            )}mm \u4F59\u6599\u653E\u4E0D\u4E0B\u300C${nameOf.get(cid) ?? cid}\u300D\u4EFB\u4F55\u5269\u4F59\u7167\u7247\uFF08\u6700\u5C0F\u7167\u7247\u5207\u5757\u77ED\u8FB9\u7EA6 ${round(
              minSide,
              1
            )}mm\uFF09\uFF1B\u5F3A\u884C\u8BA9\u4F1A\u4F7F\u7167\u7247\u8DE8\u754C\u3001\u5757\u88C1\u4E0D\u5F00\u3002\u4F59\u6599\u4FDD\u7559\u7ED9\u66F4\u540E\u9762\u7684\u5BA2\u6237`
          });
        }
      } else if (remaining().length && handoverPolicy === "none") {
        for (const f of donorLeavesOf(cid)) {
          const couldFit = remaining().some((g2) => {
            const { w, h } = slotSize(g2, m2);
            return fitsAnyRect(f, w, h, opts2.allowRotate && g2.allowRotate);
          });
          handovers.push({
            sheetIndex,
            x: round(f.x, COORD_DIGITS),
            y: round(f.y, COORD_DIGITS),
            w: round(f.w, COORD_DIGITS),
            h: round(f.h, COORD_DIGITS),
            fromCustomerId: f.owner,
            toCustomerId: cid,
            granted: false,
            used: false,
            reason: couldFit ? "\u4E0D\u8BA9\uFF1A\u7B56\u7565\u4E3A\u300C\u5BA2\u6237\u4E0D\u5171\u7EB8\u300D\uFF0C\u51E0\u4F55\u4E0A\u672C\u53EF\u8BA9\u51FA\uFF0C\u4F46\u6309\u7B56\u7565\u8BE5\u5BA2\u6237\u53E6\u8D77\u4E00\u5F20\uFF08\u4EE3\u4EF7\uFF1A\u591A\u8017\u7EB8\u5F20\uFF09" : "\u4E0D\u8BA9\uFF1A\u7B56\u7565\u4E3A\u300C\u5BA2\u6237\u4E0D\u5171\u7EB8\u300D\uFF0C\u4E14\u8BE5\u4F59\u6599\u4E5F\u653E\u4E0D\u4E0B\u6B64\u5BA2\u6237\u5269\u4F59\u7167\u7247"
          });
        }
      }
      for (const f of free) {
        if (f.owner === cid && (f.w < MIN_LEAF_MM || f.h < MIN_LEAF_MM)) f.owner = null;
      }
    }
    for (const f of free) {
      if (f.owner !== null && !freeLeafHasPhoto(f, placements)) f.owner = null;
    }
    if (placements.length === 0) {
      const stuck = queue.filter((g) => g.copies > 0).map((g) => nameOf.get(g.customerId) ?? g.customerId);
      return {
        error: `\u6392\u6837\u65E0\u8FDB\u5C55\uFF0C\u6574\u6279\u505C\u6B62\uFF08\u70B9\u540D\u5BA2\u6237\uFF1A${Array.from(new Set(stuck)).join(
          "\u3001"
        )}\uFF09\u3002\u8BF7\u68C0\u67E5\u7167\u7247\u5C3A\u5BF8\u4E0E\u76F8\u7EB8\u53EF\u7528\u533A\u3002`
      };
    }
    rawSheets.push({ placements, handovers });
  }
  const allPlacements = [];
  let seq = 0;
  const perSheetRaw = [];
  for (const raw of rawSheets) {
    const ordered = raw.placements.slice().sort(
      (a, b) => Math.abs(a.rect.y - b.rect.y) > 0.01 ? a.rect.y - b.rect.y : a.rect.x - b.rect.x
    );
    perSheetRaw.push(ordered);
    for (const p of ordered) {
      seq += 1;
      allPlacements.push({
        itemId: p.itemId,
        customerId: p.customerId,
        sheetIndex: rawSheets.indexOf(raw),
        x: round(p.rect.x + m2, COORD_DIGITS),
        y: round(p.rect.y + m2, COORD_DIGITS),
        w: round(p.rect.w - 2 * m2, COORD_DIGITS),
        h: round(p.rect.h - 2 * m2, COORD_DIGITS),
        rotated: p.rotated,
        seq
      });
    }
  }
  const derived = deriveSheets(allPlacements, opts2, customers2);
  if ("error" in derived) return { error: derived.error };
  for (const block of derived.blocks) {
    for (const s2 of block.placementSeqs) {
      const p = allPlacements.find((x) => x.seq === s2);
      if (p) p.blockId = block.id;
    }
  }
  const parcels = buildParcels(customers2, derived.blocks, allPlacements);
  const usages = buildUsages(customers2, derived.blocks);
  const compare = internal.skipCompare ? emptyCompare(customers2, derived.sheets.length, paper2.priceCents) : buildCompare(customers2, items2, paper2, cut2, derived.sheets.length);
  const totalPhotos = allPlacements.length;
  const totalUsed = allPlacements.reduce((a, p) => a + p.w * p.h, 0);
  const stats = {
    totalPhotos,
    sheetCount: derived.sheets.length,
    customerCount: customers2.length,
    blockCount: derived.blocks.length,
    handoverGranted: rawSheets.reduce(
      (a, r2) => a + r2.handovers.filter((h) => h.granted).length,
      0
    ),
    handoverRefused: rawSheets.reduce(
      (a, r2) => a + r2.handovers.filter((h) => !h.granted).length,
      0
    ),
    avgUtilization: totalUsed > 0 ? totalUsed / (derived.sheets.length * paper2.wMm * paper2.hMm) : 0,
    elapsedMs: round(performance.now() - started, 2)
  };
  return {
    result: {
      sheets: derived.sheets,
      parcels,
      blocks: derived.blocks,
      usages,
      handovers: rawSheets.flatMap((r2) => r2.handovers),
      compare,
      stats
    }
  };
}
function ownerOfNode(node, customerOfSlot) {
  if (node.slots.length === 0) return void 0;
  const first = customerOfSlot(node.slots[0]);
  for (let k = 1; k < node.slots.length; k++) {
    if (customerOfSlot(node.slots[k]) !== first) return null;
  }
  return first;
}
function buildCutTree(region2, slots, rawCuts, customerOfSlot) {
  const root = {
    r: { ...region2 },
    slots: slots.map((_, i) => i),
    left: null,
    right: null,
    owner: void 0
  };
  let leaves = [root];
  for (const cut2 of rawCuts) {
    let target = null;
    for (const n of leaves) {
      const spans = cut2.axis === "v" ? Math.abs(cut2.from - n.r.y) < EPS && Math.abs(cut2.to - (n.r.y + n.r.h)) < EPS : Math.abs(cut2.from - n.r.x) < EPS && Math.abs(cut2.to - (n.r.x + n.r.w)) < EPS;
      const inside = cut2.axis === "v" ? cut2.at > n.r.x + EPS && cut2.at < n.r.x + n.r.w - EPS : cut2.at > n.r.y + EPS && cut2.at < n.r.y + n.r.h - EPS;
      if (spans && inside) {
        target = n;
        break;
      }
    }
    if (!target) continue;
    const leftSlots = [];
    const rightSlots = [];
    let lr;
    let rr;
    if (cut2.axis === "v") {
      lr = { x: target.r.x, y: target.r.y, w: cut2.at - target.r.x, h: target.r.h };
      rr = { x: cut2.at, y: target.r.y, w: target.r.x + target.r.w - cut2.at, h: target.r.h };
      for (const i of target.slots) {
        if (slots[i].x + slots[i].w <= cut2.at + EPS) leftSlots.push(i);
        else rightSlots.push(i);
      }
    } else {
      lr = { x: target.r.x, y: target.r.y, w: target.r.w, h: cut2.at - target.r.y };
      rr = { x: target.r.x, y: cut2.at, w: target.r.w, h: target.r.y + target.r.h - cut2.at };
      for (const i of target.slots) {
        if (slots[i].y + slots[i].h <= cut2.at + EPS) leftSlots.push(i);
        else rightSlots.push(i);
      }
    }
    target.left = { r: lr, slots: leftSlots, left: null, right: null, owner: void 0 };
    target.right = { r: rr, slots: rightSlots, left: null, right: null, owner: void 0 };
    leaves = leaves.filter((n) => n !== target);
    leaves.push(target.left, target.right);
  }
  const annotate = (n) => {
    if (!n.left || !n.right) {
      n.owner = ownerOfNode(n, customerOfSlot);
      return;
    }
    annotate(n.left);
    annotate(n.right);
    n.owner = ownerOfNode(n, customerOfSlot);
  };
  annotate(root);
  return root;
}
function deriveSheets(allPlacements, opts2, customers2) {
  const region2 = usableRegion(opts2);
  if (!region2) return { error: "\u7EB8\u8FB9\u7559\u767D + \u56DB\u5468\u5B89\u5168\u8FB9 \u5DF2\u8D85\u8FC7\u76F8\u7EB8\u5C3A\u5BF8" };
  const m2 = (opts2.kerfMm + opts2.gapMm) / 2;
  const sheetCount = Math.max(0, ...allPlacements.map((p) => p.sheetIndex + 1));
  const DEFAULT_CUSTOMER = "__default__";
  const cidOf = (p) => p.customerId ?? DEFAULT_CUSTOMER;
  void customers2;
  const sheets = [];
  const blocks = [];
  for (let s = 0; s < sheetCount; s++) {
    const list = allPlacements.filter((p) => p.sheetIndex === s).slice().sort((a, b) => Math.abs(a.y - b.y) > 0.01 ? a.y - b.y : a.x - b.x);
    const slots = list.map((p) => ({
      x: p.x - m2,
      y: p.y - m2,
      w: p.w + 2 * m2,
      h: p.h + 2 * m2
    }));
    const customerOfSlot = (i) => cidOf(list[i]);
    const ownerCuts = decomposeByOwner(region2, slots, customerOfSlot) ?? // 无法按属主干净分开（旧任务手工交错排样）→ 退回纯几何拆解，每照片独立成块
    (decompose(region2, slots) ?? []).map((c) => ({ ...c, role: "internal" }));
    const ownerValidation = validateCutSequence(region2, slots, ownerCuts);
    if (!ownerValidation.ok) {
      return { error: `\u7B2C ${s + 1} \u5F20\u7EB8\u4E0D\u6EE1\u8DB3 guillotine \u8D2F\u901A\u88C1\u5207\uFF1A${ownerValidation.reason}` };
    }
    const root = buildCutTree(region2, slots, ownerCuts, customerOfSlot);
    const blocksThisSheet = [];
    const collect = (n) => {
      if (!n.left || !n.right) {
        if (n.slots.length > 0 && n.owner) blocksThisSheet.push({ node: n });
        return;
      }
      if (n.owner !== null && n.owner !== void 0) {
        blocksThisSheet.push({ node: n });
        return;
      }
      collect(n.left);
      collect(n.right);
    };
    collect(root);
    const slotToBlock = /* @__PURE__ */ new Map();
    blocksThisSheet.sort(
      (a, b) => Math.abs(a.node.r.y - b.node.r.y) > EPS ? a.node.r.y - b.node.r.y : a.node.r.x - b.node.r.x
    );
    blocksThisSheet.forEach(({ node }, bi) => {
      const owner = node.owner;
      const blockId = `P${s + 1}-${String.fromCharCode(65 + bi)}`;
      const slotArea = node.slots.reduce((a2, i) => a2 + slots[i].w * slots[i].h, 0);
      const photoArea = node.slots.reduce((a2, i) => a2 + list[i].w * list[i].h, 0);
      const block = {
        id: blockId,
        customerId: owner === DEFAULT_CUSTOMER ? "" : owner,
        sheetIndex: s,
        x: round(node.r.x, COORD_DIGITS),
        y: round(node.r.y, COORD_DIGITS),
        w: round(node.r.w, COORD_DIGITS),
        h: round(node.r.h, COORD_DIGITS),
        photoCount: node.slots.length,
        photoAreaMm2: round(photoArea, COORD_DIGITS),
        wasteAreaMm2: round(Math.max(0, node.r.w * node.r.h - slotArea), COORD_DIGITS),
        placementSeqs: node.slots.map((i) => list[i].seq)
      };
      blocks.push(block);
      for (const i of node.slots) slotToBlock.set(i, block);
    });
    list.forEach((p, i) => {
      const b = slotToBlock.get(i);
      if (b) p.blockId = b.id;
    });
    const mergedCuts = mergeOwnerCuts(ownerCuts);
    const mergedValid = validateCutSequence(region2, slots, mergedCuts);
    const useMerged = mergedValid.ok && mergedCuts.length < ownerCuts.length;
    const finalCuts = useMerged ? mergedCuts : ownerCuts;
    const cutSteps = finalCuts.map((c) => {
      const covered = ownerCuts.filter(
        (r2) => r2.axis === c.axis && Math.abs(r2.at - c.at) < EPS && r2.from >= c.from - EPS && r2.to <= c.to + EPS
      );
      let role = "internal";
      const custSet = /* @__PURE__ */ new Set();
      for (const rc of covered) {
        if (rc.role === "boundary") role = "boundary";
        for (const [i, sl] of slots.entries()) {
          const touches = rc.axis === "v" ? Math.abs(sl.x + sl.w - rc.at) < EPS || Math.abs(sl.x - rc.at) < EPS : Math.abs(sl.y + sl.h - rc.at) < EPS || Math.abs(sl.y - rc.at) < EPS;
          if (touches) {
            const o = customerOfSlot(i);
            if (o && o !== DEFAULT_CUSTOMER) custSet.add(o);
          }
        }
      }
      return {
        sheetIndex: s,
        axis: c.axis,
        at: round(c.at, COORD_DIGITS),
        from: round(c.from, COORD_DIGITS),
        to: round(c.to, COORD_DIGITS),
        merged: covered.length > 1,
        role,
        customerIds: custSet.size ? Array.from(custSet) : void 0
      };
    });
    const usedAreaMm2 = list.reduce((a2, p) => a2 + p.w * p.h, 0);
    const sheetAreaMm2 = opts2.paperW * opts2.paperH;
    sheets.push({
      index: s,
      placements: list,
      cutSteps,
      rawCutCount: ownerCuts.length,
      usedAreaMm2: round(usedAreaMm2, COORD_DIGITS),
      sheetAreaMm2,
      utilization: usedAreaMm2 / sheetAreaMm2,
      wasteRects: ownerValidation.pieces.filter((pc) => pc.idx.length === 0 && pc.r.w >= 8 && pc.r.h >= 8).map((pc) => ({
        x: round(pc.r.x, COORD_DIGITS),
        y: round(pc.r.y, COORD_DIGITS),
        w: round(pc.r.w, COORD_DIGITS),
        h: round(pc.r.h, COORD_DIGITS)
      }))
    });
  }
  return { sheets, blocks };
}
function mergeOwnerCuts(cuts) {
  const groups = /* @__PURE__ */ new Map();
  const order = [];
  for (const c of cuts) {
    const key = `${c.axis}@${c.at.toFixed(6)}`;
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
      order.push(key);
    }
    g.push(c);
  }
  const out3 = [];
  for (const key of order) {
    const g = groups.get(key).slice().sort((a, b) => a.from - b.from);
    let cur = { ...g[0] };
    for (let i = 1; i < g.length; i++) {
      if (g[i].from <= cur.to + EPS) {
        cur.to = Math.max(cur.to, g[i].to);
        if (g[i].role === "boundary") cur.role = "boundary";
      } else {
        out3.push(cur);
        cur = { ...g[i] };
      }
    }
    out3.push(cur);
  }
  return out3;
}
function buildParcels(customers2, blocks, placements) {
  const nameOf = new Map(customers2.map((c) => [c.id, c.name]));
  const ids = customers2.map((c) => c.id);
  if (!ids.length && placements.some((p) => !p.customerId)) ids.push("");
  const out3 = [];
  for (const cid of ids) {
    const cb = blocks.filter((b) => b.customerId === cid);
    const ps = placements.filter((p) => (p.customerId ?? "") === cid);
    out3.push({
      customerId: cid,
      customerName: cid ? nameOf.get(cid) ?? cid : "\u672A\u6807\u6CE8\u5BA2\u6237",
      photoCount: ps.length,
      photoAreaMm2: round(ps.reduce((a, p) => a + p.w * p.h, 0), COORD_DIGITS),
      blockCount: cb.length,
      sheetIndexes: Array.from(new Set(cb.map((b) => b.sheetIndex))).sort((a, b) => a - b),
      blocks: cb.slice().sort(bySheetPosition)
    });
  }
  return out3.filter((p) => p.photoCount > 0);
}
function bySheetPosition(a, b) {
  if (a.sheetIndex !== b.sheetIndex) return a.sheetIndex - b.sheetIndex;
  if (Math.abs(a.y - b.y) > EPS) return a.y - b.y;
  return a.x - b.x;
}
function buildUsages(customers2, blocks) {
  const nameOf = new Map(customers2.map((c) => [c.id, c.name]));
  return blocks.slice().sort(bySheetPosition).map((b) => ({
    customerId: b.customerId,
    customerName: b.customerId ? nameOf.get(b.customerId) ?? b.customerId : "\u672A\u6807\u6CE8\u5BA2\u6237",
    sheetIndex: b.sheetIndex,
    blockId: b.id,
    photos: b.photoCount,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h
  }));
}
function emptyCompare(customers2, mergedSheets, priceCents) {
  return {
    separateSheets: mergedSheets,
    separateCents: mergedSheets * priceCents,
    mergedSheets,
    mergedCents: mergedSheets * priceCents,
    savedSheets: 0,
    savedCents: 0,
    savedRate: 0,
    separateByCustomer: customers2.map((c) => ({ customerId: c.id, sheets: 0, cents: 0 }))
  };
}
function buildCompare(customers2, items2, paper2, cut2, mergedSheets) {
  const separateByCustomer = [];
  let separateSheets = 0;
  for (const c of customers2) {
    const ci = items2.filter((g) => g.customerId === c.id && g.copies > 0);
    if (!ci.length) continue;
    const out3 = packMerge([c], ci, paper2, cut2, "none", { skipCompare: true });
    const n = out3.result ? out3.result.stats.sheetCount : 0;
    separateSheets += n;
    separateByCustomer.push({ customerId: c.id, sheets: n, cents: n * paper2.priceCents });
  }
  const separateCents = separateSheets * paper2.priceCents;
  const mergedCents = mergedSheets * paper2.priceCents;
  const savedCents = separateCents - mergedCents;
  return {
    separateSheets,
    separateCents,
    mergedSheets,
    mergedCents,
    savedSheets: separateSheets - mergedSheets,
    savedCents,
    savedRate: separateCents > 0 ? savedCents / separateCents : 0,
    separateByCustomer
  };
}
function relabelMerge(placements, opts2, customers2, customerOf) {
  const relabeled = placements.map((p) => ({ ...p, customerId: customerOf(p) }));
  const derived = deriveSheets(relabeled, opts2, customers2);
  if ("error" in derived) return { error: derived.error };
  for (const b of derived.blocks) {
    for (const sq of b.placementSeqs) {
      const p = relabeled.find((x) => x.seq === sq);
      if (p) p.blockId = b.id;
    }
  }
  return {
    result: {
      sheets: derived.sheets,
      blocks: derived.blocks,
      parcels: buildParcels(customers2, derived.blocks, relabeled),
      usages: buildUsages(customers2, derived.blocks),
      stats: {
        totalPhotos: relabeled.length,
        sheetCount: derived.sheets.length,
        customerCount: customers2.length,
        blockCount: derived.blocks.length,
        handoverGranted: 0,
        handoverRefused: 0,
        avgUtilization: relabeled.reduce((a, p) => a + p.w * p.h, 0) / (derived.sheets.length * opts2.paperW * opts2.paperH),
        elapsedMs: 0
      }
    }
  };
}

// scripts/merge-check.ts
var failures = 0;
function check(name, cond, detail = "") {
  if (!cond) {
    failures++;
    console.error(`\u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  } else {
    console.log(`\u2713 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}
var paper = { wMm: 305, hMm: 457, marginMm: 5, priceCents: 600 };
var cut = { gapMm: 0, kerfMm: 0.5, safeEdgeMm: 3, allowRotate: true };
var opts = {
  paperW: paper.wMm,
  paperH: paper.hMm,
  marginMm: paper.marginMm,
  safeEdgeMm: cut.safeEdgeMm,
  gapMm: cut.gapMm,
  kerfMm: cut.kerfMm,
  allowRotate: cut.allowRotate
};
var region = usableRegion(opts);
var m = (cut.kerfMm + cut.gapMm) / 2;
var customers = [
  { id: "A", name: "\u5BA2\u6237\u7532" },
  { id: "B", name: "\u5BA2\u6237\u4E59" },
  { id: "C", name: "\u5BA2\u6237\u4E19" }
];
function item(customerId, i, copies, w, h) {
  return {
    itemId: `${customerId}-${i}`,
    customerId,
    copies,
    photoW: w,
    photoH: h,
    allowRotate: true,
    keepTogether: false,
    sizeName: `${w}x${h}`
  };
}
var items = [
  item("A", 1, 6, 102, 152),
  item("B", 1, 4, 89, 127),
  item("C", 1, 20, 25, 35)
];
var out = packMerge(customers, items, paper, cut, "auto");
check("\u5408\u5E76\u6392\u6837\u6210\u529F", !out.error, out.error ?? "");
var r = out.result;
var guillotineOk = true;
for (const s of r.sheets) {
  const slots = s.placements.map((p) => ({ x: p.x - m, y: p.y - m, w: p.w + 2 * m, h: p.h + 2 * m }));
  const cuts = s.cutSteps.map((c) => ({ axis: c.axis, at: c.at, from: c.from, to: c.to }));
  const v = validateCutSequence(region, slots, cuts);
  if (!v.ok) guillotineOk = false;
}
check("\u5408\u5E76\u540E\u6BCF\u5200\u4ECD\u8D2F\u901A\uFF08guillotine \u5408\u6CD5\uFF09", guillotineOk);
var blockRects = r.blocks.map((b) => ({ ...b }));
var blockDisjoint = true;
for (let i = 0; i < blockRects.length; i++) {
  for (let j = i + 1; j < blockRects.length; j++) {
    const a = blockRects[i];
    const b = blockRects[j];
    if (a.sheetIndex !== b.sheetIndex) continue;
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox > 0.05 && oy > 0.05) blockDisjoint = false;
  }
}
check("\u5404\u5BA2\u6237\u5757\u4E92\u4E0D\u91CD\u53E0\uFF08\u72EC\u7ACB\u53EF\u88C1\u5F00\uFF09", blockDisjoint);
var membershipOk = true;
for (const s of r.sheets) {
  for (const p of s.placements) {
    const b = r.blocks.find((bb) => bb.placementSeqs.includes(p.seq));
    if (!b || b.customerId !== p.customerId) membershipOk = false;
    const inside = p.x >= b.x - 0.01 && p.y >= b.y - 0.01 && p.x + p.w <= b.x + b.w + 0.01 && p.y + p.h <= b.y + b.h + 0.01;
    if (!inside) membershipOk = false;
  }
}
check("\u6BCF\u5F20\u7167\u7247\u552F\u4E00\u5C5E\u4E8E\u540C\u5BA2\u6237\u7684\u4E00\u5757\u4E14\u843D\u5728\u5757\u5185", membershipOk);
var boundaryOk = true;
for (const s of r.sheets) {
  for (const c of s.cutSteps) {
    if (c.role === "boundary" && c.customerIds && c.customerIds.length < 2) boundaryOk = false;
  }
}
check("\u5206\u754C\u5200\u4E24\u4FA7\u786E\u4E3A\u4E0D\u540C\u5BA2\u6237", boundaryOk, `\u5206\u754C\u5200=${r.sheets.flatMap((s) => s.cutSteps).filter((c) => c.role === "boundary").length}`);
var countIn = (cid) => items.filter((g) => g.customerId === cid).reduce((a, g) => a + g.copies, 0);
for (const c of customers) {
  const parcel = r.parcels.find((p) => p.customerId === c.id);
  check(`\u5BA2\u6237${c.id}\u53D6\u4EF6\u5305\u5F20\u6570\u5B88\u6052`, parcel.photoCount === countIn(c.id), `${parcel.photoCount} vs ${countIn(c.id)}`);
}
check(
  "\u5408\u5E76\u5F20\u6570 \u2264 \u5206\u5F00\u5F20\u6570",
  r.compare.mergedSheets <= r.compare.separateSheets,
  `\u5408\u5E76 ${r.compare.mergedSheets} vs \u5206\u5F00 ${r.compare.separateSheets}\uFF0C\u7701 ${r.compare.savedSheets} \u5F20 / \xA5${(r.compare.savedCents / 100).toFixed(2)}`
);
check("\u7701\u94B1\u91D1\u989D\u4E0E\u5F20\u6570\u4E00\u81F4", r.compare.savedCents === r.compare.savedSheets * paper.priceCents);
console.log("  \u5206\u6237\u660E\u7EC6\uFF1A");
for (const u of r.usages) {
  console.log(`    ${u.customerName} \u7B2C${u.sheetIndex + 1}\u5F20 ${u.blockId} ${u.photos}\u5F20 @(${u.x},${u.y}) ${u.w}x${u.h}`);
}
check("usages \u603B\u6570 == \u5757\u6570", r.usages.length === r.blocks.length);
var granted = r.handovers.filter((h) => h.granted).length;
var refused = r.handovers.filter((h) => !h.granted).length;
check("\u8BA9\u6E21\u6709\u5224\u636E\u8BB0\u5F55\uFF08\u8BA9/\u4E0D\u8BA9\u81F3\u5C11\u5176\u4E00\uFF09", r.handovers.length > 0, `\u8BA9\u51FA ${granted}\uFF0C\u4E0D\u8BA9 ${refused}`);
var out2 = packMerge(customers, items, paper, cut, "auto");
var sig = JSON.stringify(r.sheets.map((s) => s.placements));
var sig2 = JSON.stringify(out2.result.sheets.map((s) => s.placements));
check("\u540C\u6279\u8FDE\u6392\u4E24\u6B21\u7ED3\u679C\u4E00\u81F4", sig === sig2);
check("\u8F93\u5165 copies \u672A\u88AB\u4FEE\u6539", items[0].copies === 6);
var tooBig = [item("A", 9, 1, 400, 400), item("B", 9, 1, 25, 35)];
var bad = packMerge(customers, tooBig, paper, cut, "auto");
check("\u653E\u4E0D\u4E0B\u65F6\u6574\u6279\u505C\u6B62\u5E76\u70B9\u540D\u5BA2\u6237", !!bad.error && bad.error.includes("\u5BA2\u6237\u7532"), bad.error ?? "");
check("\u653E\u4E0D\u4E0B\u65F6\u4E0D\u4EA7\u51FA\u534A\u6210\u54C1", !bad.result);
var single = packMerge([{ id: "A", name: "\u7532" }], [item("A", 1, 10, 89, 127)], paper, cut, "auto");
var sr = single.result;
var oldPlacements = sr.sheets.flatMap((s) => s.placements).map((p) => ({ ...p, customerId: void 0, blockId: void 0 })).sort((a, b) => a.seq - b.seq);
var rel = relabelMerge(
  oldPlacements,
  opts,
  [
    { id: "X", name: "\u8865\u6807\u5BA2\u6237X" },
    { id: "Y", name: "\u8865\u6807\u5BA2\u6237Y" }
  ],
  (p) => oldPlacements.indexOf(p) % 2 === 0 ? "X" : "Y"
);
check("\u65E7\u4EFB\u52A1\u53EF\u8865\u6807\u5206\u6237", !rel.error && rel.result.parcels.length === 2, rel.error ?? "");
var geomSame = rel.result.sheets.every(
  (s) => s.placements.every((p) => {
    const o = oldPlacements.find((q) => q.seq === p.seq);
    return Math.abs(p.x - o.x) < 1e-9 && Math.abs(p.y - o.y) < 1e-9 && p.rotated === o.rotated;
  })
);
check("\u8865\u6807\u4E0D\u6539\u53D8\u7167\u7247\u51E0\u4F55\uFF08\u5148\u6392\u5B8C\u518D\u8865\u6807\uFF09", geomSame);
var coordOk = JSON.stringify(r).split(",").every(() => true);
var allTwoDigits = true;
for (const p of r.sheets.flatMap((s) => s.placements)) {
  for (const v of [p.x, p.y, p.w, p.h]) {
    if (Math.abs(v - Math.round(v * 100) / 100) > 1e-9) allTwoDigits = false;
  }
}
check("\u5750\u6807\u7CBE\u5EA6\u7EDF\u4E00\u4E3A 0.01mm", allTwoDigits && coordOk);
check("\u5355\u5BA2\u6237\u53D6\u4EF6\u5305\u4E3A\u6574\u6279", sr.parcels.length === 1 && sr.parcels[0].photoCount === 10);
console.log(failures === 0 ? "\n\u5168\u90E8\u901A\u8FC7" : `
${failures} \u9879\u5931\u8D25`);
if (typeof process !== "undefined") process.exit(failures === 0 ? 0 : 1);
