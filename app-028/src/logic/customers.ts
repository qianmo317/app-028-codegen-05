/**
 * 多客户合并拼版、分户块与取件包分析。
 * 唯一几何口径：以合并后的 guillotine 切割树为准。各客户「自己的排样」只是成本基线，
 * 不会在混合纸上额外产生分户刀，因此不能从中算出另一套实体取件包。
 */
import { buildGuillotineTree, type CutTreeNode, type Rect } from './guillotine'
import { usableRegion, type PackOptions } from './packer'
import { round } from './units'
import type {
  CustomerBlock,
  CustomerCutRecord,
  CustomerMergeReport,
  CustomerPackage,
  CustomerSheetUse,
  Paper,
  Placement,
  Sheet,
  Task,
} from './types'

export const UNASSIGNED_CUSTOMER_ID = '__unassigned__'
export const UNASSIGNED_CUSTOMER_NAME = '未补标'

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be185d', '#4d7c0f']

export function customerIdOf(value: string | undefined): string {
  return value?.trim() || UNASSIGNED_CUSTOMER_ID
}

export function customerNameOf(value: string | undefined): string {
  return value?.trim() || UNASSIGNED_CUSTOMER_NAME
}

const q2 = (v: number) => round(v, 2)

function slotsOf(sheet: Sheet, opts: PackOptions): Rect[] {
  const m = (opts.kerfMm + opts.gapMm) / 2
  return sheet.placements.map((p) => ({
    x: p.x - m,
    y: p.y - m,
    w: p.w + 2 * m,
    h: p.h + 2 * m,
  }))
}

function customerOfPlacement(p: Placement, task: Task): { id: string; name: string } {
  const id = customerIdOf(p.customerId ?? task.items.find((i) => i.id === p.itemId)?.customerId)
  return { id, name: customerNameOf(id === UNASSIGNED_CUSTOMER_ID ? undefined : id) }
}

function nodeCustomers(node: CutTreeNode, task: Task, sourcePlacements: Placement[]): Set<string> {
  const out = new Set<string>()
  if (!node.children?.length) {
    for (const i of node.idx) {
      const p = sourcePlacements[i]
      if (p) out.add(customerOfPlacement(p, task).id)
    }
  } else {
    for (const child of node.children) {
      for (const id of nodeCustomers(child, task, sourcePlacements)) out.add(id)
    }
  }
  return out
}

function collectBlocksAndCuts(
  root: CutTreeNode,
  sheet: Sheet,
  task: Task,
  names: Map<string, string>,
  startBlockNo: number,
  sourcePlacements: Placement[],
): { blocks: CustomerBlock[]; boundaryByCustomer: Map<string, Set<string>>; blockCount: number } {
  const blocks: CustomerBlock[] = []
  let blockNo = startBlockNo

  function addBlock(node: CutTreeNode, customer: string) {
    const seqs = node.idx
      .map((i) => sourcePlacements[i]?.seq)
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b)
    blocks.push({
      id: `S${sheet.index + 1}-B${blockNo++}`,
      sheetIndex: sheet.index,
      customerId: customer,
      customerName: names.get(customer) ?? customerNameOf(customer === UNASSIGNED_CUSTOMER_ID ? undefined : customer),
      x: q2(node.r.x),
      y: q2(node.r.y),
      w: q2(node.r.w),
      h: q2(node.r.h),
      placementSeqs: seqs,
      photoCount: seqs.length,
    })
  }

  function collectCuts(node: CutTreeNode, boundaryByCustomer: Map<string, Set<string>>) {
    if (!node.children?.length || !node.axis || node.at === undefined) {
      node.children?.forEach((c) => collectCuts(c, boundaryByCustomer))
      return
    }
    const all = nodeCustomers(node, task, sourcePlacements)
    const childSets = node.children.map((c) => nodeCustomers(c, task, sourcePlacements))
    const key = `${node.axis}@${node.at.toFixed(6)}`
    if (all.size > 1) {
      for (const cid of all) {
        // 只要这一刀把本客户分到某一侧、另一侧还含有其它客户，对本客户就是分户边界
        const separatesCid =
          childSets[0].has(cid) !== childSets[1].has(cid) &&
          (childSets.some((s) => s.size > 1) || childSets.some((s) => !s.has(cid) && s.size > 0))
        if (separatesCid) {
          let set = boundaryByCustomer.get(cid)
          if (!set) boundaryByCustomer.set(cid, (set = new Set()))
          set.add(key)
        }
      }
    }
    node.children.forEach((c) => collectCuts(c, boundaryByCustomer))
  }

  /** 在「优先分户」的切割树上，取最早成为单一客户的最大节点作为独立取件块。
   *  这些分户线全部是照片边界线，必然出现在实际切割步骤集合里；执行时先切边界刀子集即可。 */
  function collectBlocks(node: CutTreeNode) {
    if (!node.children?.length) {
      if (node.idx.length > 0) addBlock(node, customerOfPlacement(sourcePlacements[node.idx[0]], task).id)
      return
    }
    const all = nodeCustomers(node, task, sourcePlacements)
    if (all.size === 1 && node.idx.length > 0) {
      addBlock(node, Array.from(all)[0])
      return
    }
    node.children.forEach(collectBlocks)
  }

  const boundaryByCustomer = new Map<string, Set<string>>()
  collectBlocks(root)
  collectCuts(root, boundaryByCustomer)

  blocks.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
  blocks.forEach((b, i) => {
    b.id = `S${sheet.index + 1}-B${i + 1}`
  })
  return { blocks, boundaryByCustomer, blockCount: blocks.length }
}

/** 把实际合并切割步骤映射到客户包：边界刀按分户树判定，内部刀必须真正落在该客户块内部 */
function cutsForCustomer(
  customer: string,
  blocks: CustomerBlock[],
  boundaryBySheet: Map<string, Set<string>>,
  sheet: Sheet,
): CustomerCutRecord[] {
  const out: CustomerCutRecord[] = []
  const my = blocks.filter((b) => b.customerId === customer && b.sheetIndex === sheet.index)
  if (!my.length) return out
  const inside = (step: (typeof sheet.cutSteps)[number], b: CustomerBlock, strict: boolean) => {
    const eps = strict ? 0.02 : -0.02
    if (step.axis === 'v') {
      if (step.at <= b.x + eps || step.at >= b.x + b.w - eps) return false
      return Math.min(step.to, b.y + b.h) - Math.max(step.from, b.y) > 0.02
    }
    if (step.at <= b.y + eps || step.at >= b.y + b.h - eps) return false
    return Math.min(step.to, b.x + b.w) - Math.max(step.from, b.x) > 0.02
  }
  sheet.cutSteps.forEach((step, stepIndex) => {
    const key = `${step.axis}@${step.at.toFixed(6)}`
    const isBoundary = (boundaryBySheet.get(customer) ?? new Set<string>()).has(key)
    const internalBlocks = my.filter((b) => inside(step, b, true))
    // 边界刀即使只贴边也算；内部刀必须穿过客户自己的块内部，且不能先切断其它客户
    if (!isBoundary && !internalBlocks.length) return
    out.push({
      blockId: isBoundary ? my.find((b) =>
        step.axis === 'v'
          ? Math.abs(step.at - b.x) <= 0.02 || Math.abs(step.at - b.x - b.w) <= 0.02
          : Math.abs(step.at - b.y) <= 0.02 || Math.abs(step.at - b.y - b.h) <= 0.02,
      )?.id ?? my[0].id : internalBlocks[0]?.id ?? my[0].id,
      customerId: customer,
      customerName: '',
      sheetIndex: sheet.index,
      stepIndex,
      axis: step.axis,
      at: q2(step.at),
      from: q2(step.from),
      to: q2(step.to),
      merged: step.merged,
      role: isBoundary && internalBlocks.length ? 'shared' : isBoundary ? 'boundary' : 'internal',
    })
  })
  return out
}

export interface BuildOptions {
  merged: boolean
  baselineSheets?: number
  baselineCents?: number
  baselineUtilization?: number
}

export function buildCustomerReport(
  task: Task,
  paper: Paper,
  sheets: Sheet[],
  options: BuildOptions,
): CustomerMergeReport {
  const opts: PackOptions = {
    paperW: paper.wMm,
    paperH: paper.hMm,
    marginMm: paper.marginMm,
    safeEdgeMm: task.safeEdgeMm,
    gapMm: task.gapMm,
    kerfMm: task.kerfMm,
    allowRotate: task.allowRotate,
  }
  const region = usableRegion(opts)
  const names = new Map<string, string>()
  const customerIds: string[] = []
  for (const s of sheets) {
    for (const p of s.placements) {
      const c = customerOfPlacement(p, task)
      if (!names.has(c.id)) {
        names.set(c.id, c.name)
        customerIds.push(c.id)
      }
    }
  }
  customerIds.sort()

  const blocks: CustomerBlock[] = []
  const boundariesBySheet = new Map<number, Map<string, Set<string>>>()
  if (region) {
    for (const sheet of sheets) {
      const slots = slotsOf(sheet, opts)
      const metas = slots.map((_, i) => customerOfPlacement(sheet.placements[i], task).id)
      const root = buildGuillotineTree(region, slots, undefined, undefined, 'customer', metas)
      if (root) {
        const got = collectBlocksAndCuts(root, sheet, task, names, blocks.length + 1, sheet.placements)
        blocks.push(...got.blocks)
        boundariesBySheet.set(sheet.index, got.boundaryByCustomer)
      }
    }
  }

  const colors: Record<string, string> = {}
  customerIds.forEach((id, i) => {
    colors[id] = COLORS[i % COLORS.length]
  })

  const packageMap = new Map<string, CustomerPackage>()
  for (const id of customerIds) {
    const cb: CustomerBlock[] = blocks.filter((b) => b.customerId === id)
    const cuts = sheets.flatMap((s) =>
      cutsForCustomer(id, cb, boundariesBySheet.get(s.index) ?? new Map<string, Set<string>>(), s),
    )
    cuts.forEach((c) => {
      c.customerName = names.get(id) ?? customerNameOf(undefined)
    })
    const sheetMap = new Map<number, CustomerSheetUse>()
    for (const b of cb) {
      let use = sheetMap.get(b.sheetIndex)
      if (!use) {
        use = { sheetIndex: b.sheetIndex, blockIds: [], blocks: [], photoCount: 0 }
        sheetMap.set(b.sheetIndex, use)
      }
      use.blockIds.push(b.id)
      use.blocks.push(b)
      use.photoCount += b.photoCount
    }
    packageMap.set(id, {
      customerId: id,
      customerName: names.get(id) ?? customerNameOf(undefined),
      color: colors[id],
      photoCount: cb.reduce((a, b) => a + b.photoCount, 0),
      sheets: Array.from(sheetMap.values()).sort((a, b) => a.sheetIndex - b.sheetIndex),
      blocks: cb,
      cuts: cuts.sort((a, b) => a.sheetIndex - b.sheetIndex || a.stepIndex - b.stepIndex),
    })
  }

  const mergedSheets = sheets.length
  const mergedCents = mergedSheets * paper.priceCents
  const mergedArea = mergedSheets * paper.wMm * paper.hMm
  const usedArea = sheets.reduce((a, s) => a + s.usedAreaMm2, 0)

  const hasLaterWork = (cid: string, index: number) =>
    sheets.some((sh) => sh.index > index && sh.placements.some((p) => customerOfPlacement(p, task).id === cid))
  const handoffs: CustomerMergeReport['handoffs'] = []
  const kerfMargin = (task.kerfMm + task.gapMm) / 2
  for (const s of sheets) {
    const ids = Array.from(new Set(s.placements.map((p) => customerOfPlacement(p, task).id))).sort()
    if (ids.length !== 1) continue
    const cid = ids[0]
    const later = customerIds.filter((x) => hasLaterWork(x, s.index))
    const waste = s.wasteRects.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0]
    if (!later.length) {
      handoffs.push({
        sheetIndex: s.index,
        customerId: cid,
        customerName: names.get(cid) ?? cid,
        handedOff: false,
        reason: '后面已无客户的活；本张整体作为该客户取件包，剩余边角只能登记余料，不能算让出。',
        fittedCustomers: [],
        freeX: waste?.x ?? 0,
        freeY: waste?.y ?? 0,
        freeW: waste?.w ?? 0,
        freeH: waste?.h ?? 0,
      })
      continue
    }
    const minSize = new Map<string, { w: number; h: number }>()
    for (const sh of sheets) {
      for (const p of sh.placements) {
        const x = customerOfPlacement(p, task).id
        if (!later.includes(x)) continue
        const cur = minSize.get(x)
        if (!cur || p.w * p.h < cur.w * cur.h) minSize.set(x, { w: p.w, h: p.h })
      }
    }
    const fitted: string[] = []
    for (const x of later) {
      const size = minSize.get(x)
      if (!size || !waste) continue
      const sw = size.w + 2 * kerfMargin
      const sh = size.h + 2 * kerfMargin
      const fits =
        (sw <= waste.w + 0.02 && sh <= waste.h + 0.02) ||
        (task.allowRotate && sh <= waste.w + 0.02 && sw <= waste.h + 0.02)
      if (fits) fitted.push(names.get(x) ?? x)
    }
    handoffs.push({
      sheetIndex: s.index,
      customerId: cid,
      customerName: names.get(cid) ?? cid,
      handedOff: false,
      reason: fitted.length
        ? `理论上 ${fitted.join('、')} 的最小照片能放入空矩形；但让出必须在重排阶段完成，已定刀路不能插入。`
        : `没有后续客户的最小照片（含 kerf/gap 补偿）能完整放入最大可直线裁开空矩形 ${waste ? `${q2(waste.w)}×${q2(waste.h)}mm` : '—'}；卡在边角不足或不能贯通裁开。`,
      fittedCustomers: fitted,
      freeX: waste?.x ?? 0,
      freeY: waste?.y ?? 0,
      freeW: waste?.w ?? 0,
      freeH: waste?.h ?? 0,
    })
  }

  const baselineSheets = options.baselineSheets ?? mergedSheets
  const baselineCents = options.baselineCents ?? mergedCents
  const baselineUtilization =
    options.baselineUtilization ??
    (baselineSheets * paper.wMm * paper.hMm > 0
      ? usedArea / (baselineSheets * paper.wMm * paper.hMm)
      : 0)

  return {
    merged: options.merged,
    signature: placementsSignature(sheets),
    customerIds,
    customerNames: Object.fromEntries(customerIds.map((id) => [id, names.get(id) ?? ''])),
    colors,
    blocks,
    packages: customerIds.map((id) => packageMap.get(id)!),
    cuts: customerIds.flatMap((id) => packageMap.get(id)!.cuts),
    baselineSheets,
    mergedSheets,
    baselineCents,
    mergedCents,
    savedSheets: baselineSheets - mergedSheets,
    savedCents: baselineCents - mergedCents,
    baselineUtilization,
    mergedUtilization: mergedArea > 0 ? usedArea / mergedArea : 0,
    rule: '取件包只按合并后的贯通切割树拆分；客户独立排样仅用于基线成本对比，其刀路没有打印到这批纸上，不能生成另一套可裁开的实体取件包。边角让出判据：只有后续客户的最小照片（含刀宽/隙距补偿、遵守旋转限制）能完整放入某个可贯通裁开空矩形时才可让出，且必须在重排阶段执行；刀路已定后不能插入。',
    handoffs,
  }
}

export function placementsSignature(sheets: Sheet[]): string {
  return sheets
    .flatMap((s) =>
      s.placements.map((p) =>
        `${s.index}:${p.seq}:${p.x.toFixed(3)}:${p.y.toFixed(3)}:${p.w.toFixed(3)}:${p.h.toFixed(3)}:${p.customerId ?? ''}`,
      ),
    )
    .join('|')
}

export function isMergeTask(task: Task): boolean {
  const customers = new Set(task.items.map((i) => customerIdOf(i.customerId)))
  if (task.mergeCustomers !== undefined) return task.mergeCustomers && customers.size > 1
  return customers.size > 1
}
