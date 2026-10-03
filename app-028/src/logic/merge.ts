/**
 * 多客户合并拼版引擎。
 *
 * 核心约束：每个客户的照片必须落在「独立能裁开」的一块里。做法是把 guillotine
 * 整边切分产生的每个空闲矩形都标上属主（客户），属主只在「余料让渡」时转移；
 * 因此每个客户的照片天然各自位于切割树的若干子树中（先沿客户分界刀把纸切成
 * 单客户块，再在块内切照片）。
 *
 * 分户的唯一依据是「合并后实际要切的切割步骤」（cutSteps），不是各客户自己的
 * 排样：各客户独立排样从未在这批合并相纸上发生过，纸上不存在那些切割线，按它
 * 们拆不出物理上可分开的取件包。见 splitByCutTree 的实现与 merge-selfTest 中
 * 「拆单依据」断言。
 */
import {
  EPS,
  decompose,
  decomposeByOwner,
  validateCutSequence,
  type CutLine,
  type OwnerCutLine,
  type Rect,
} from './guillotine'
import type { PackOptions } from './packer'
import { usableRegion } from './packer'
import { round } from './units'
import type {
  CustomerBlock,
  CustomerParcel,
  HandoverRecord,
  MergeCompare,
  MergeItem,
  MergeResult,
  MergeStats,
  HandoverPolicy,
  ParcelUsageRow,
  Placement,
  Sheet,
} from './types'

/** 对外输出坐标统一精度：清单 / 预览 / 导出三处都用它，保证坐标精度一致 */
export const COORD_DIGITS = 2

/** 最小可用余料（mm）：小于该尺寸的空闲矩形不参与让渡判定 */
const MIN_LEAF_MM = 3

interface Fit {
  idx: number
  rotated: boolean
  w: number
  h: number
}

const FIT_EPS = 1e-6

interface FreeLeaf {
  x: number
  y: number
  w: number
  h: number
  /** 当前属主客户；null = 无主边角料（让渡后未被使用，不归属任何客户） */
  owner: string | null
}

interface PlacedRaw {
  itemId: string
  customerId: string
  rect: Rect
  rotated: boolean
}

function slotSize(g: MergeItem, m: number): { w: number; h: number } {
  return { w: g.photoW + 2 * m, h: g.photoH + 2 * m }
}

function findBest(
  free: FreeLeaf[],
  owner: string,
  w: number,
  h: number,
  allowRotate: boolean,
): Fit | null {
  let best: Fit | null = null
  let bestScore: number[] | null = null
  const consider = (i: number, rw: number, rh: number, pw: number, ph: number, rot: boolean) => {
    if (pw > rw + FIT_EPS || ph > rh + FIT_EPS) return
    const dw = rw - pw
    const dh = rh - ph
    const score = [Math.min(dw, dh), Math.max(dw, dh), rw * rh - pw * ph]
    if (
      !bestScore ||
      score[0] < bestScore[0] - EPS ||
      (Math.abs(score[0] - bestScore[0]) < EPS &&
        (score[1] < bestScore[1] - EPS ||
          (Math.abs(score[1] - bestScore[1]) < EPS && score[2] < bestScore[2] - EPS)))
    ) {
      bestScore = score
      best = { idx: i, rotated: rot, w: pw, h: ph }
    }
  }
  for (let i = 0; i < free.length; i++) {
    if (free[i].owner !== owner) continue
    const f = free[i]
    consider(i, f.w, f.h, w, h, false)
    if (allowRotate && Math.abs(w - h) > EPS) consider(i, f.w, f.h, h, w, true)
  }
  return best
}

/** 任意空闲矩形（不限属主）里是否放得下 pw×ph（允许旋转） */
function fitsAnyRect(r: Rect, w: number, h: number, allowRotate: boolean): boolean {
  return (
    (w <= r.w + FIT_EPS && h <= r.h + FIT_EPS) ||
    (allowRotate && h <= r.w + FIT_EPS && w <= r.h + FIT_EPS)
  )
}

/** 在空闲矩形内放置并按整边切分（与单客户排样器同一套 guillotine split 规则） */
function splitPlace(free: FreeLeaf[], idx: number, pw: number, ph: number): Rect {
  const f = free[idx]
  free.splice(idx, 1)
  const placed: Rect = { x: f.x, y: f.y, w: pw, h: ph }
  const dw = f.w - pw
  const dh = f.h - ph
  const mk = (x: number, y: number, w: number, h: number): FreeLeaf => ({
    x,
    y,
    w,
    h,
    owner: f.owner,
  })
  if (dh <= EPS && dw <= EPS) return placed
  if (dh <= EPS) {
    free.push(mk(f.x + pw, f.y, dw, ph))
    return placed
  }
  if (dw <= EPS) {
    free.push(mk(f.x, f.y + ph, f.w, dh))
    return placed
  }
  const maxH = Math.max(f.w * dh, dw * ph)
  const maxV = Math.max(dw * f.h, pw * dh)
  if (maxH >= maxV) {
    free.push(mk(f.x, f.y + ph, f.w, dh))
    free.push(mk(f.x + pw, f.y, dw, ph))
  } else {
    free.push(mk(f.x + pw, f.y, dw, f.h))
    free.push(mk(f.x, f.y + ph, pw, dh))
  }
  return placed
}

interface Try {
  free: FreeLeaf[]
  placed: Rect
  rotated: boolean
}

function tryPlaceOne(
  free: FreeLeaf[],
  g: MergeItem,
  opts: PackOptions,
  m: number,
): Try | null {
  const { w: sw, h: sh } = slotSize(g, m)
  const fit = findBest(free, g.customerId, sw, sh, opts.allowRotate && g.allowRotate)
  if (!fit) return null
  const trial = free.slice()
  const placed = splitPlace(trial, fit.idx, fit.w, fit.h)
  return { free: trial, placed, rotated: fit.rotated }
}

function tryPlaceMany(
  free: FreeLeaf[],
  g: MergeItem,
  count: number,
  opts: PackOptions,
  m: number,
): Try[] | null {
  let cur = free
  const out: Try[] = []
  for (let i = 0; i < count; i++) {
    const t = tryPlaceOne(cur, g, opts, m)
    if (!t) return null
    out.push(t)
    cur = t.free
  }
  return out
}

/** 把某客户在当前纸上能排的照片尽量排满（属主叶子）。返回新的空闲数组与已排照片 */
function fillCustomer(
  free: FreeLeaf[],
  queue: MergeItem[],
  customerId: string,
  opts: PackOptions,
  m: number,
): { free: FreeLeaf[]; placed: PlacedRaw[] } {
  const placed: PlacedRaw[] = []
  let progress = true
  while (progress) {
    progress = false
    // 不拆散：整组放得下就一次放下；只放得进空纸、放不进当前余料时本张先跳过
    for (const g of queue) {
      if (g.customerId !== customerId || g.copies <= 1 || !g.keepTogether) continue
      const many = tryPlaceMany(free, g, g.copies, opts, m)
      if (many) {
        for (const t of many) {
          free = t.free
          placed.push({ itemId: g.itemId, customerId, rect: t.placed, rotated: t.rotated })
        }
        g.copies = 0
        progress = true
      }
    }
    for (const g of queue) {
      if (g.customerId !== customerId || g.copies <= 0) continue
      let t = tryPlaceOne(free, g, opts, m)
      while (t) {
        free = t.free
        placed.push({ itemId: g.itemId, customerId, rect: t.placed, rotated: t.rotated })
        g.copies--
        progress = true
        if (g.copies <= 0) break
        t = tryPlaceOne(free, g, opts, m)
      }
    }
    if (free.length > 400) {
      free = free.filter((f) => f.w > 0.5 && f.h > 0.5)
    }
  }
  return { free, placed }
}

/** 叶子里是否已落入照片（整边切分后，照片要么整块在内、要么不相交） */
function freeLeafHasPhoto(leaf: FreeLeaf, placements: PlacedRaw[]): boolean {
  for (const p of placements) {
    const inside =
      p.rect.x >= leaf.x - EPS &&
      p.rect.y >= leaf.y - EPS &&
      p.rect.x + p.rect.w <= leaf.x + leaf.w + EPS &&
      p.rect.y + p.rect.h <= leaf.y + leaf.h + EPS
    if (inside) return true
  }
  return false
}

/** 指定让渡叶子是否放得下该客户的某张照片；返回 free 中的下标，否则 -1 */
function findHandoverLeafIndex(
  free: FreeLeaf[],
  leaf: FreeLeaf,
  g: MergeItem,
  opts: PackOptions,
  m: number,
): number {
  const idx = free.indexOf(leaf)
  if (idx < 0) return -1
  const { w, h } = slotSize(g, m)
  return fitsAnyRect(leaf, w, h, opts.allowRotate && g.allowRotate) ? idx : -1
}

/** 放进该照片后叶子剩余面积（取不旋转/旋转里更贴的一种）；放不下返回 Infinity */
function leafLeftoverArea(leaf: FreeLeaf, g: MergeItem, opts: PackOptions, m: number): number {
  const { w, h } = slotSize(g, m)
  let best = Infinity
  if (w <= leaf.w + FIT_EPS && h <= leaf.h + FIT_EPS) {
    best = Math.min(best, Math.abs(leaf.w * leaf.h - w * h))
  }
  if (
    opts.allowRotate &&
    g.allowRotate &&
    h <= leaf.w + FIT_EPS &&
    w <= leaf.h + FIT_EPS
  ) {
    best = Math.min(best, Math.abs(leaf.w * leaf.h - h * w))
  }
  return best
}

export interface PackMergeOutput {
  result?: MergeResult
  error?: string
}

interface RawSheet {
  placements: PlacedRaw[]
  handovers: HandoverRecord[]
}

/** 合并拼版主入口。客户按清单顺序（customers 顺序）填充与让渡，结果确定可复现。 */
export function packMerge(
  customers: Array<{ id: string; name: string }>,
  items: MergeItem[],
  paper: { wMm: number; hMm: number; marginMm: number; priceCents: number },
  cut: { gapMm: number; kerfMm: number; safeEdgeMm: number; allowRotate: boolean },
  handoverPolicy: HandoverPolicy = 'auto',
  internal: { skipCompare?: boolean } = {},
): PackMergeOutput {
  const started = performance.now()
  const opts: PackOptions = {
    paperW: paper.wMm,
    paperH: paper.hMm,
    marginMm: paper.marginMm,
    safeEdgeMm: cut.safeEdgeMm,
    gapMm: cut.gapMm,
    kerfMm: cut.kerfMm,
    allowRotate: cut.allowRotate,
  }
  const region = usableRegion(opts)
  if (!region) {
    return { error: '纸边留白 + 四周安全边 已超过相纸尺寸，请调小裁切参数' }
  }
  const m = (cut.kerfMm + cut.gapMm) / 2
  const nameOf = new Map(customers.map((c) => [c.id, c.name]))

  // 深拷贝，保证连排两次互不干扰、结果一致
  const queue: MergeItem[] = items
    .filter((g) => g.copies > 0)
    .map((g) => ({ ...g }))

  // 预检：单张都放不下的照片直接整批停下，并点名客户（真排不下，不出半成品）
  const oversize: string[] = []
  for (const g of queue) {
    const { w: sw, h: sh } = slotSize(g, m)
    const canRot = cut.allowRotate && g.allowRotate
    const ok =
      (sw <= region.w + EPS && sh <= region.h + EPS) ||
      (canRot && sh <= region.w + EPS && sw <= region.h + EPS)
    if (!ok) {
      oversize.push(
        `客户「${nameOf.get(g.customerId) ?? g.customerId}」的 ${round(g.photoW, 1)}×${round(
          g.photoH,
          1,
        )}mm 照片放不进可用区 ${round(region.w, 1)}×${round(region.h, 1)}mm`,
      )
    }
  }
  if (oversize.length) {
    return {
      error:
        Array.from(new Set(oversize)).join('；') +
        '（整批已停止：请换更大相纸或调小安全边/纸边留白后重排）',
    }
  }

  const rawSheets: RawSheet[] = []
  let guard = 0
  while (queue.some((g) => g.copies > 0) && guard++ < 20000) {
    const sheetIndex = rawSheets.length
    const firstId = customers.find((c) => queue.some((g) => g.customerId === c.id && g.copies > 0))!.id
    let free: FreeLeaf[] = [{ ...region, owner: firstId }]
    const placements: PlacedRaw[] = []
    const handovers: HandoverRecord[] = []

    /** 当前可让渡给 cid 的余料：属主为更早轮次客户（owner != cid）的叶子 */
    const donorLeavesOf = (cid: string): FreeLeaf[] =>
      free.filter((f) => f.owner !== null && f.owner !== cid && f.w >= MIN_LEAF_MM && f.h >= MIN_LEAF_MM)

    for (const customer of customers) {
      const cid = customer.id
      if (!queue.some((g) => g.customerId === cid && g.copies > 0)) continue

      // 阶段一：排满自己名下（起手是整张新纸）的区域；非首位客户此时还没有自有叶
      {
        const res = fillCustomer(free, queue, cid, opts, m)
        free = res.free
        placements.push(...res.placed)
      }

      // 阶段二：还有剩 → 吃进前面各客户让出来的余料。
      // 属主转移即「让出」：属主只在这一步改变，因此客户块始终是切割树子树。
      const remaining = () => queue.filter((g) => g.customerId === cid && g.copies > 0)
      const grantedLeaves = new Set<FreeLeaf>()
      if (remaining().length && handoverPolicy === 'auto') {
        let progressed = true
        while (progressed && remaining().length) {
          progressed = false
          // 在所有（让渡方余料 × 该客户剩余照片）组合里，挑装下后边角最小的一组
          let pick: { leaf: FreeLeaf; g: MergeItem } | null = null
          let pickLeftover = Infinity
          for (const leaf of donorLeavesOf(cid)) {
            for (const g of remaining()) {
              if (findHandoverLeafIndex(free, leaf, g, opts, m) < 0) continue
              const leftover = leafLeftoverArea(leaf, g, opts, m)
              if (leftover < pickLeftover - EPS) {
                pickLeftover = leftover
                pick = { leaf, g }
              }
            }
          }
          if (!pick) break
          const { leaf, g } = pick
          const donor = leaf.owner as string
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
            reason: `让出：${round(leaf.w, 1)}×${round(
              leaf.h,
              1,
            )}mm 余料放得下「${nameOf.get(cid) ?? cid}」的 ${g.sizeName ?? `${round(g.photoW, 0)}×${round(g.photoH, 0)}`}，分界刀沿整边贯通，块可独立裁开`,
          })
          grantedLeaves.add(leaf)
          leaf.owner = cid
          const res = fillCustomer(free, queue, cid, opts, m)
          free = res.free
          if (res.placed.length) {
            handovers[handovers.length - 1].used = true
            placements.push(...res.placed)
          }
          progressed = true
        }

        // 仍未让出（该客户一张都放不进）的余料：记录「不让」及卡点，但保留给更后面的客户
        for (const leaf of donorLeavesOf(cid)) {
          if (grantedLeaves.has(leaf)) continue
          const minSide = Math.min(...remaining().map((g2) => Math.min(slotSize(g2, m).w, slotSize(g2, m).h)))
          handovers.push({
            sheetIndex,
            x: round(leaf.x, COORD_DIGITS),
            y: round(leaf.y, COORD_DIGITS),
            w: round(leaf.w, COORD_DIGITS),
            h: round(leaf.h, COORD_DIGITS),
            fromCustomerId: leaf.owner as string,
            toCustomerId: cid,
            granted: false,
            used: false,
            reason: `不让：${round(leaf.w, 1)}×${round(
              leaf.h,
              1,
            )}mm 余料放不下「${nameOf.get(cid) ?? cid}」任何剩余照片（最小照片切块短边约 ${round(
              minSide,
              1,
            )}mm）；强行让会使照片跨界、块裁不开。余料保留给更后面的客户`,
          })
        }
      } else if (remaining().length && handoverPolicy === 'none') {
        // 策略上不共享纸张：逐片记录「不让」及代价（几何上能不能放都写明）
        for (const f of donorLeavesOf(cid)) {
          const couldFit = remaining().some((g2) => {
            const { w, h } = slotSize(g2, m)
            return fitsAnyRect(f, w, h, opts.allowRotate && g2.allowRotate)
          })
          handovers.push({
            sheetIndex,
            x: round(f.x, COORD_DIGITS),
            y: round(f.y, COORD_DIGITS),
            w: round(f.w, COORD_DIGITS),
            h: round(f.h, COORD_DIGITS),
            fromCustomerId: f.owner as string,
            toCustomerId: cid,
            granted: false,
            used: false,
            reason: couldFit
              ? '不让：策略为「客户不共纸」，几何上本可让出，但按策略该客户另起一张（代价：多耗纸张）'
              : '不让：策略为「客户不共纸」，且该余料也放不下此客户剩余照片',
          })
        }
      }

      // 太小、谁都用不上的叶子清成无主边角料；其余保持属主，供更后面的客户让渡
      for (const f of free) {
        if (f.owner === cid && (f.w < MIN_LEAF_MM || f.h < MIN_LEAF_MM)) f.owner = null
      }
    }

    // 到纸尾仍整片没排进照片、却还挂着属主的叶子，归为无主公共边角料
    for (const f of free) {
      if (f.owner !== null && !freeLeafHasPhoto(f, placements)) f.owner = null
    }

    if (placements.length === 0) {
      const stuck = queue
        .filter((g) => g.copies > 0)
        .map((g) => nameOf.get(g.customerId) ?? g.customerId)
      return {
        error: `排样无进展，整批停止（点名客户：${Array.from(new Set(stuck)).join(
          '、',
        )}）。请检查照片尺寸与相纸可用区。`,
      }
    }
    rawSheets.push({ placements, handovers })
  }

  // ---- 组装 placements（每纸从上到下、从左到右全局编号），再由几何结果推导块 ----
  const allPlacements: Placement[] = []
  let seq = 0
  const perSheetRaw: PlacedRaw[][] = []
  for (const raw of rawSheets) {
    const ordered = raw.placements
      .slice()
      .sort((a, b) =>
        Math.abs(a.rect.y - b.rect.y) > 0.01 ? a.rect.y - b.rect.y : a.rect.x - b.rect.x,
      )
    perSheetRaw.push(ordered)
    for (const p of ordered) {
      seq += 1
      allPlacements.push({
        itemId: p.itemId,
        customerId: p.customerId,
        sheetIndex: rawSheets.indexOf(raw),
        x: round(p.rect.x + m, COORD_DIGITS),
        y: round(p.rect.y + m, COORD_DIGITS),
        w: round(p.rect.w - 2 * m, COORD_DIGITS),
        h: round(p.rect.h - 2 * m, COORD_DIGITS),
        rotated: p.rotated,
        seq,
      })
    }
  }

  const derived = deriveSheets(allPlacements, opts, customers)
  if ('error' in derived) return { error: derived.error }

  // 把块 id 回填到 placements
  for (const block of derived.blocks) {
    for (const s2 of block.placementSeqs) {
      const p = allPlacements.find((x) => x.seq === s2)
      if (p) p.blockId = block.id
    }
  }

  const parcels = buildParcels(customers, derived.blocks, allPlacements)
  const usages = buildUsages(customers, derived.blocks)
  const compare = internal.skipCompare
    ? emptyCompare(customers, derived.sheets.length, paper.priceCents)
    : buildCompare(customers, items, paper, cut, derived.sheets.length)

  const totalPhotos = allPlacements.length
  const totalUsed = allPlacements.reduce((a, p) => a + p.w * p.h, 0)
  const stats: MergeStats = {
    totalPhotos,
    sheetCount: derived.sheets.length,
    customerCount: customers.length,
    blockCount: derived.blocks.length,
    handoverGranted: rawSheets.reduce(
      (a, r) => a + r.handovers.filter((h) => h.granted).length,
      0,
    ),
    handoverRefused: rawSheets.reduce(
      (a, r) => a + r.handovers.filter((h) => !h.granted).length,
      0,
    ),
    avgUtilization:
      totalUsed > 0 ? totalUsed / (derived.sheets.length * paper.wMm * paper.hMm) : 0,
    elapsedMs: round(performance.now() - started, 2),
  }

  return {
    result: {
      sheets: derived.sheets,
      parcels,
      blocks: derived.blocks,
      usages,
      handovers: rawSheets.flatMap((r) => r.handovers),
      compare,
      stats,
    },
  }
}

/* ================= 切割树 → 客户块 / 分户取件包 ================= */

interface TNode {
  r: Rect
  /** 该子树内的 slot（照片切块）在当前纸 slots 数组中的下标 */
  slots: number[]
  left: TNode | null
  right: TNode | null
  /** 单客户子树：该客户 id；混合：null；无照片（纯废料）：undefined */
  owner: string | null | undefined
}

function ownerOfNode(node: TNode, customerOfSlot: (i: number) => string): string | null | undefined {
  if (node.slots.length === 0) return undefined
  const first = customerOfSlot(node.slots[0])
  for (let k = 1; k < node.slots.length; k++) {
    if (customerOfSlot(node.slots[k]) !== first) return null
  }
  return first
}

/**
 * 按合并后的切割步骤（raw cuts，先于共边合并）重放出切割树，
 * 取「单客户极大子树」作为独立可裁开的块。这是分户的唯一事实来源。
 * 每一刀都对应 guillotine 整边切分，故单客户极大子树一定能独立裁开。
 */
function buildCutTree(
  region: Rect,
  slots: Rect[],
  rawCuts: CutLine[],
  customerOfSlot: (i: number) => string,
): TNode {
  const root: TNode = {
    r: { ...region },
    slots: slots.map((_, i) => i),
    left: null,
    right: null,
    owner: undefined,
  }
  let leaves: TNode[] = [root]
  for (const cut of rawCuts) {
    // 找这一刀当前所在的叶子块：刀必须整块贯穿该叶
    let target: TNode | null = null
    for (const n of leaves) {
      const spans =
        cut.axis === 'v'
          ? Math.abs(cut.from - n.r.y) < EPS && Math.abs(cut.to - (n.r.y + n.r.h)) < EPS
          : Math.abs(cut.from - n.r.x) < EPS && Math.abs(cut.to - (n.r.x + n.r.w)) < EPS
      const inside =
        cut.axis === 'v'
          ? cut.at > n.r.x + EPS && cut.at < n.r.x + n.r.w - EPS
          : cut.at > n.r.y + EPS && cut.at < n.r.y + n.r.h - EPS
      if (spans && inside) {
        target = n
        break
      }
    }
    if (!target) continue
    const leftSlots: number[] = []
    const rightSlots: number[] = []
    let lr: Rect
    let rr: Rect
    if (cut.axis === 'v') {
      lr = { x: target.r.x, y: target.r.y, w: cut.at - target.r.x, h: target.r.h }
      rr = { x: cut.at, y: target.r.y, w: target.r.x + target.r.w - cut.at, h: target.r.h }
      for (const i of target.slots) {
        if (slots[i].x + slots[i].w <= cut.at + EPS) leftSlots.push(i)
        else rightSlots.push(i)
      }
    } else {
      lr = { x: target.r.x, y: target.r.y, w: target.r.w, h: cut.at - target.r.y }
      rr = { x: target.r.x, y: cut.at, w: target.r.w, h: target.r.y + target.r.h - cut.at }
      for (const i of target.slots) {
        if (slots[i].y + slots[i].h <= cut.at + EPS) leftSlots.push(i)
        else rightSlots.push(i)
      }
    }
    target.left = { r: lr, slots: leftSlots, left: null, right: null, owner: undefined }
    target.right = { r: rr, slots: rightSlots, left: null, right: null, owner: undefined }
    leaves = leaves.filter((n) => n !== target)
    leaves.push(target.left, target.right)
  }
  // 后序标注属主
  const annotate = (n: TNode): void => {
    if (!n.left || !n.right) {
      n.owner = ownerOfNode(n, customerOfSlot)
      return
    }
    annotate(n.left)
    annotate(n.right)
    n.owner = ownerOfNode(n, customerOfSlot)
  }
  annotate(root)
  return root
}

export interface DerivedSheets {
  sheets: Sheet[]
  blocks: CustomerBlock[]
}

/**
 * 由 placements（已带 customerId）重建每张纸的切割步骤、客户块，
 * 并把 cutSteps 标注为「客户分界刀 / 块内部刀」。单客户与多客户通用，
 * 因此旧任务（无客户标记）也能先排完，再用本函数补标分户。
 */
export function deriveSheets(
  allPlacements: Placement[],
  opts: PackOptions,
  customers: Array<{ id: string; name: string }>,
): DerivedSheets | { error: string } {
  const region = usableRegion(opts)
  if (!region) return { error: '纸边留白 + 四周安全边 已超过相纸尺寸' }
  const m = (opts.kerfMm + opts.gapMm) / 2
  const sheetCount = Math.max(0, ...allPlacements.map((p) => p.sheetIndex + 1))
  const DEFAULT_CUSTOMER = '__default__'
  const cidOf = (p: Placement) => p.customerId ?? DEFAULT_CUSTOMER
  void customers

  const sheets: Sheet[] = []
  const blocks: CustomerBlock[] = []

  for (let s = 0; s < sheetCount; s++) {
    const list = allPlacements
      .filter((p) => p.sheetIndex === s)
      .slice()
      .sort((a, b) => (Math.abs(a.y - b.y) > 0.01 ? a.y - b.y : a.x - b.x))
    const slots: Rect[] = list.map((p) => ({
      x: p.x - m,
      y: p.y - m,
      w: p.w + 2 * m,
      h: p.h + 2 * m,
    }))
    const customerOfSlot = (i: number) => cidOf(list[i])

    // 属主感知拆解：多客户区域先沿「分界刀」切成单客户块，再在块内切照片
    const ownerCuts =
      decomposeByOwner(region, slots, customerOfSlot) ??
      // 无法按属主干净分开（旧任务手工交错排样）→ 退回纯几何拆解，每照片独立成块
      (decompose(region, slots) ?? [])
        .map((c) => ({ ...c, role: 'internal' as const }))
    const ownerValidation = validateCutSequence(region, slots, ownerCuts)
    if (!ownerValidation.ok) {
      return { error: `第 ${s + 1} 张纸不满足 guillotine 贯通裁切：${ownerValidation.reason}` }
    }

    // 用 ownerCuts 重放切割树 → 单客户极大子树（块）
    const root = buildCutTree(region, slots, ownerCuts, customerOfSlot)
    const blocksThisSheet: Array<{ node: TNode }> = []
    const collect = (n: TNode): void => {
      if (!n.left || !n.right) {
        if (n.slots.length > 0 && n.owner) blocksThisSheet.push({ node: n })
        return
      }
      if (n.owner !== null && n.owner !== undefined) {
        blocksThisSheet.push({ node: n })
        return
      }
      collect(n.left)
      collect(n.right)
    }
    collect(root)

    // 块编号：每张纸按位置顺序 A、B、C…（全局唯一，避免不同客户块号撞车）
    const slotToBlock = new Map<number, CustomerBlock>()
    blocksThisSheet.sort(
      (a, b) =>
        Math.abs(a.node.r.y - b.node.r.y) > EPS
          ? a.node.r.y - b.node.r.y
          : a.node.r.x - b.node.r.x,
    )
    blocksThisSheet.forEach(({ node }, bi) => {
      const owner = node.owner as string
      const blockId = `P${s + 1}-${String.fromCharCode(65 + bi)}`
      const slotArea = node.slots.reduce((a2, i) => a2 + slots[i].w * slots[i].h, 0)
      const photoArea = node.slots.reduce((a2, i) => a2 + list[i].w * list[i].h, 0)
      const block: CustomerBlock = {
        id: blockId,
        customerId: owner === DEFAULT_CUSTOMER ? '' : owner,
        sheetIndex: s,
        x: round(node.r.x, COORD_DIGITS),
        y: round(node.r.y, COORD_DIGITS),
        w: round(node.r.w, COORD_DIGITS),
        h: round(node.r.h, COORD_DIGITS),
        photoCount: node.slots.length,
        photoAreaMm2: round(photoArea, COORD_DIGITS),
        wasteAreaMm2: round(Math.max(0, node.r.w * node.r.h - slotArea), COORD_DIGITS),
        placementSeqs: node.slots.map((i) => list[i].seq),
      }
      blocks.push(block)
      for (const i of node.slots) slotToBlock.set(i, block)
    })

    // 回填 blockId
    list.forEach((p, i) => {
      const b = slotToBlock.get(i)
      if (b) p.blockId = b.id
    })

    // 共边合并：合并线只要含任一分界刀即视为分界刀；customerIds 取覆盖刀的两侧属主
    const mergedCuts = mergeOwnerCuts(ownerCuts)
    const mergedValid = validateCutSequence(region, slots, mergedCuts)
    const useMerged = mergedValid.ok && mergedCuts.length < ownerCuts.length
    const finalCuts = useMerged ? mergedCuts : ownerCuts
    const cutSteps = finalCuts.map((c) => {
      const covered = ownerCuts.filter(
        (r) =>
          r.axis === c.axis &&
          Math.abs(r.at - c.at) < EPS &&
          r.from >= c.from - EPS &&
          r.to <= c.to + EPS,
      )
      let role: 'boundary' | 'internal' = 'internal'
      const custSet = new Set<string>()
      for (const rc of covered) {
        if (rc.role === 'boundary') role = 'boundary'
        // 该刀两侧照片的属主
        for (const [i, sl] of slots.entries()) {
          const touches =
            rc.axis === 'v'
              ? Math.abs(sl.x + sl.w - rc.at) < EPS || Math.abs(sl.x - rc.at) < EPS
              : Math.abs(sl.y + sl.h - rc.at) < EPS || Math.abs(sl.y - rc.at) < EPS
          if (touches) {
            const o = customerOfSlot(i)
            if (o && o !== DEFAULT_CUSTOMER) custSet.add(o)
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
        customerIds: custSet.size ? Array.from(custSet) : undefined,
      }
    })

    const usedAreaMm2 = list.reduce((a2, p) => a2 + p.w * p.h, 0)
    const sheetAreaMm2 = opts.paperW * opts.paperH
    sheets.push({
      index: s,
      placements: list,
      cutSteps,
      rawCutCount: ownerCuts.length,
      usedAreaMm2: round(usedAreaMm2, COORD_DIGITS),
      sheetAreaMm2,
      utilization: usedAreaMm2 / sheetAreaMm2,
      wasteRects: ownerValidation.pieces
        .filter((pc) => pc.idx.length === 0 && pc.r.w >= 8 && pc.r.h >= 8)
        .map((pc) => ({
          x: round(pc.r.x, COORD_DIGITS),
          y: round(pc.r.y, COORD_DIGITS),
          w: round(pc.r.w, COORD_DIGITS),
          h: round(pc.r.h, COORD_DIGITS),
        })),
    })
  }

  return { sheets, blocks }
}

/** 共边合并并保留分界刀角色（同坐标相接的多刀合一；含任一分界刀即为分界刀） */
function mergeOwnerCuts(cuts: OwnerCutLine[]): OwnerCutLine[] {
  const groups = new Map<string, OwnerCutLine[]>()
  const order: string[] = []
  for (const c of cuts) {
    const key = `${c.axis}@${c.at.toFixed(6)}`
    let g = groups.get(key)
    if (!g) {
      g = []
      groups.set(key, g)
      order.push(key)
    }
    g.push(c)
  }
  const out: OwnerCutLine[] = []
  for (const key of order) {
    const g = groups.get(key)!.slice().sort((a, b) => a.from - b.from)
    let cur: OwnerCutLine = { ...g[0] }
    for (let i = 1; i < g.length; i++) {
      if (g[i].from <= cur.to + EPS) {
        cur.to = Math.max(cur.to, g[i].to)
        if (g[i].role === 'boundary') cur.role = 'boundary'
      } else {
        out.push(cur)
        cur = { ...g[i] }
      }
    }
    out.push(cur)
  }
  return out
}

function buildParcels(
  customers: Array<{ id: string; name: string }>,
  blocks: CustomerBlock[],
  placements: Placement[],
): CustomerParcel[] {
  const nameOf = new Map(customers.map((c) => [c.id, c.name]))
  const ids = customers.map((c) => c.id)
  // 兼容单客户（无标记）任务
  if (!ids.length && placements.some((p) => !p.customerId)) ids.push('')
  const out: CustomerParcel[] = []
  for (const cid of ids) {
    const cb = blocks.filter((b) => b.customerId === cid)
    const ps = placements.filter((p) => (p.customerId ?? '') === cid)
    out.push({
      customerId: cid,
      customerName: cid ? nameOf.get(cid) ?? cid : '未标注客户',
      photoCount: ps.length,
      photoAreaMm2: round(ps.reduce((a, p) => a + p.w * p.h, 0), COORD_DIGITS),
      blockCount: cb.length,
      sheetIndexes: Array.from(new Set(cb.map((b) => b.sheetIndex))).sort((a, b) => a - b),
      blocks: cb.slice().sort(bySheetPosition),
    })
  }
  return out.filter((p) => p.photoCount > 0)
}

/** 块排序：先按相纸，再按从上到下、从左到右（与全局编号方向一致） */
function bySheetPosition(a: CustomerBlock, b: CustomerBlock): number {
  if (a.sheetIndex !== b.sheetIndex) return a.sheetIndex - b.sheetIndex
  if (Math.abs(a.y - b.y) > EPS) return a.y - b.y
  return a.x - b.x
}

function buildUsages(
  customers: Array<{ id: string; name: string }>,
  blocks: CustomerBlock[],
): ParcelUsageRow[] {
  const nameOf = new Map(customers.map((c) => [c.id, c.name]))
  return blocks
    .slice()
    .sort(bySheetPosition)
    .map((b) => ({
      customerId: b.customerId,
      customerName: b.customerId ? nameOf.get(b.customerId) ?? b.customerId : '未标注客户',
      sheetIndex: b.sheetIndex,
      blockId: b.id,
      photos: b.photoCount,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
    }))
}

/** 分开排基线：同一引擎、同一参数，只把每个客户各自独立排（禁止让渡/共纸） */
/** 分开排基线（内部递归用）不做对比时的占位结果 */
function emptyCompare(
  customers: Array<{ id: string }>,
  mergedSheets: number,
  priceCents: number,
): MergeCompare {
  return {
    separateSheets: mergedSheets,
    separateCents: mergedSheets * priceCents,
    mergedSheets,
    mergedCents: mergedSheets * priceCents,
    savedSheets: 0,
    savedCents: 0,
    savedRate: 0,
    separateByCustomer: customers.map((c) => ({ customerId: c.id, sheets: 0, cents: 0 })),
  }
}

function buildCompare(
  customers: Array<{ id: string; name: string }>,
  items: MergeItem[],
  paper: { wMm: number; hMm: number; marginMm: number; priceCents: number },
  cut: { gapMm: number; kerfMm: number; safeEdgeMm: number; allowRotate: boolean },
  mergedSheets: number,
): MergeCompare {
  const separateByCustomer: MergeCompare['separateByCustomer'] = []
  let separateSheets = 0
  for (const c of customers) {
    const ci = items.filter((g) => g.customerId === c.id && g.copies > 0)
    if (!ci.length) continue
    const out = packMerge([c], ci, paper, cut, 'none', { skipCompare: true })
    const n = out.result ? out.result.stats.sheetCount : 0
    separateSheets += n
    separateByCustomer.push({ customerId: c.id, sheets: n, cents: n * paper.priceCents })
  }
  const separateCents = separateSheets * paper.priceCents
  const mergedCents = mergedSheets * paper.priceCents
  const savedCents = separateCents - mergedCents
  return {
    separateSheets,
    separateCents,
    mergedSheets,
    mergedCents,
    savedSheets: separateSheets - mergedSheets,
    savedCents,
    savedRate: separateCents > 0 ? savedCents / separateCents : 0,
    separateByCustomer,
  }
}

/**
 * 旧任务补标：几何完全不动（照片位置/旋转不变），仅按合并切割步骤重新分户。
 * 纯 guillotine 排样总能沿切割树拆成单客户极大子树，因此补标不会破坏可裁性；
 * 若同一客户被切成多块，会在结果里体现（块数 > 张数），代价是取件要收好几个块。
 */
export function relabelMerge(
  placements: Placement[],
  opts: PackOptions,
  customers: Array<{ id: string; name: string }>,
  customerOf: (p: Placement) => string,
): { result?: Omit<MergeResult, 'compare' | 'handovers'>; error?: string } {
  const relabeled = placements.map((p) => ({ ...p, customerId: customerOf(p) }))
  const derived = deriveSheets(relabeled, opts, customers)
  if ('error' in derived) return { error: derived.error }
  for (const b of derived.blocks) {
    for (const sq of b.placementSeqs) {
      const p = relabeled.find((x) => x.seq === sq)
      if (p) p.blockId = b.id
    }
  }
  return {
    result: {
      sheets: derived.sheets,
      blocks: derived.blocks,
      parcels: buildParcels(customers, derived.blocks, relabeled),
      usages: buildUsages(customers, derived.blocks),
      stats: {
        totalPhotos: relabeled.length,
        sheetCount: derived.sheets.length,
        customerCount: customers.length,
        blockCount: derived.blocks.length,
        handoverGranted: 0,
        handoverRefused: 0,
        avgUtilization:
          relabeled.reduce((a, p) => a + p.w * p.h, 0) /
          (derived.sheets.length * opts.paperW * opts.paperH),
        elapsedMs: 0,
      },
    },
  }
}
