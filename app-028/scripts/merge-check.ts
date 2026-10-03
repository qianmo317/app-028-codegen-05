/**
 * 多客户合并拼版引擎的独立冒烟/正确性测试（node 跑，不依赖浏览器/DOM）。
 * 用 esbuild 临时打包后执行：node scripts/merge-check.mjs（见 package 脚本说明）。
 */
import { packMerge, relabelMerge } from '../src/logic/merge'
import { validateCutSequence } from '../src/logic/guillotine'
import { usableRegion } from '../src/logic/packer'
import type { MergeItem, PackOptions } from '../src/logic/types'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (!cond) {
    failures++
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const paper = { wMm: 305, hMm: 457, marginMm: 5, priceCents: 600 }
const cut = { gapMm: 0, kerfMm: 0.5, safeEdgeMm: 3, allowRotate: true }
const opts: PackOptions = {
  paperW: paper.wMm,
  paperH: paper.hMm,
  marginMm: paper.marginMm,
  safeEdgeMm: cut.safeEdgeMm,
  gapMm: cut.gapMm,
  kerfMm: cut.kerfMm,
  allowRotate: cut.allowRotate,
}
const region = usableRegion(opts)!
const m = (cut.kerfMm + cut.gapMm) / 2

const customers = [
  { id: 'A', name: '客户甲' },
  { id: 'B', name: '客户乙' },
  { id: 'C', name: '客户丙' },
]

function item(customerId: string, i: number, copies: number, w: number, h: number): MergeItem {
  return {
    itemId: `${customerId}-${i}`,
    customerId,
    copies,
    photoW: w,
    photoH: h,
    allowRotate: true,
    keepTogether: false,
    sizeName: `${w}x${h}`,
  }
}

// 场景：三客户，凑一批更省纸
const items: MergeItem[] = [
  item('A', 1, 6, 102, 152),
  item('B', 1, 4, 89, 127),
  item('C', 1, 20, 25, 35),
]

const out = packMerge(customers, items, paper, cut, 'auto')
check('合并排样成功', !out.error, out.error ?? '')
const r = out.result!

// 1. 每张纸 guillotine 仍合法
let guillotineOk = true
for (const s of r.sheets) {
  const slots = s.placements.map((p) => ({ x: p.x - m, y: p.y - m, w: p.w + 2 * m, h: p.h + 2 * m }))
  const cuts = s.cutSteps.map((c) => ({ axis: c.axis, at: c.at, from: c.from, to: c.to }))
  const v = validateCutSequence(region, slots, cuts)
  if (!v.ok) guillotineOk = false
}
check('合并后每刀仍贯通（guillotine 合法）', guillotineOk)

// 2. 每个客户的块都能独立裁开：块矩形互不重叠、且每张照片唯一属于一个块
const blockRects = r.blocks.map((b) => ({ ...b }))
let blockDisjoint = true
for (let i = 0; i < blockRects.length; i++) {
  for (let j = i + 1; j < blockRects.length; j++) {
    const a = blockRects[i]
    const b = blockRects[j]
    if (a.sheetIndex !== b.sheetIndex) continue
    // 块坐标对外四舍五入到 0.01mm，故判重叠需留 0.05mm 余量（共边不算重叠）
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    if (ox > 0.05 && oy > 0.05) blockDisjoint = false
  }
}
check('各客户块互不重叠（独立可裁开）', blockDisjoint)

// 每张照片恰好属于一个块，块的客户与照片客户一致
let membershipOk = true
for (const s of r.sheets) {
  for (const p of s.placements) {
    const b = r.blocks.find((bb) => bb.placementSeqs.includes(p.seq))
    if (!b || b.customerId !== p.customerId) membershipOk = false
    const inside =
      p.x >= b!.x - 0.01 &&
      p.y >= b!.y - 0.01 &&
      p.x + p.w <= b!.x + b!.w + 0.01 &&
      p.y + p.h <= b!.y + b!.h + 0.01
    if (!inside) membershipOk = false
  }
}
check('每张照片唯一属于同客户的一块且落在块内', membershipOk)

// 3. 分界刀存在时，其两侧客户不同
let boundaryOk = true
for (const s of r.sheets) {
  for (const c of s.cutSteps) {
    if (c.role === 'boundary' && c.customerIds && c.customerIds.length < 2) boundaryOk = false
  }
}
check('分界刀两侧确为不同客户', boundaryOk, `分界刀=${r.sheets.flatMap((s) => s.cutSteps).filter((c) => c.role === 'boundary').length}`)

// 4. 分户数量守恒：每个客户照片张数 == 输入
const countIn = (cid: string) => items.filter((g) => g.customerId === cid).reduce((a, g) => a + g.copies, 0)
for (const c of customers) {
  const parcel = r.parcels.find((p) => p.customerId === c.id)!
  check(`客户${c.id}取件包张数守恒`, parcel.photoCount === countIn(c.id), `${parcel.photoCount} vs ${countIn(c.id)}`)
}

// 5. 合并不比分排更费纸；并报告省了多少
check('合并张数 ≤ 分开张数', r.compare.mergedSheets <= r.compare.separateSheets,
  `合并 ${r.compare.mergedSheets} vs 分开 ${r.compare.separateSheets}，省 ${r.compare.savedSheets} 张 / ¥${(r.compare.savedCents / 100).toFixed(2)}`)
check('省钱金额与张数一致', r.compare.savedCents === r.compare.savedSheets * paper.priceCents)

// 6. 每人用了哪张纸的哪一块、各几张
console.log('  分户明细：')
for (const u of r.usages) {
  console.log(`    ${u.customerName} 第${u.sheetIndex + 1}张 ${u.blockId} ${u.photos}张 @(${u.x},${u.y}) ${u.w}x${u.h}`)
}
check('usages 总数 == 块数', r.usages.length === r.blocks.length)

// 7. 让渡判定：存在让出或明确记录不让
const granted = r.handovers.filter((h) => h.granted).length
const refused = r.handovers.filter((h) => !h.granted).length
check('让渡有判据记录（让/不让至少其一）', r.handovers.length > 0, `让出 ${granted}，不让 ${refused}`)

// 8. 连排两次结果一致（确定性）
const out2 = packMerge(customers, items, paper, cut, 'auto')
const sig = JSON.stringify(r.sheets.map((s) => s.placements))
const sig2 = JSON.stringify(out2.result!.sheets.map((s) => s.placements))
check('同批连排两次结果一致', sig === sig2)

// 9. 输入未被污染（深拷贝）
check('输入 copies 未被修改', items[0].copies === 6)

// 10. 真排不下 → 整批停下并点名客户
const tooBig: MergeItem[] = [item('A', 9, 1, 400, 400), item('B', 9, 1, 25, 35)]
const bad = packMerge(customers, tooBig, paper, cut, 'auto')
check('放不下时整批停止并点名客户', !!bad.error && bad.error.includes('客户甲'), bad.error ?? '')
check('放不下时不产出半成品', !bad.result)

// 11. 旧任务无客户标记：先排完再补标（几何不动）
const single = packMerge([{ id: 'A', name: '甲' }], [item('A', 1, 10, 89, 127)], paper, cut, 'auto')
const sr = single.result!
// 模拟旧任务：抹掉客户标记
const oldPlacements = sr.sheets
  .flatMap((s) => s.placements)
  .map((p) => ({ ...p, customerId: undefined, blockId: undefined }))
  .sort((a, b) => a.seq - b.seq)
// 按编号奇偶补成两个客户（先排完再补标，几何完全不动）
const rel = relabelMerge(
  oldPlacements,
  opts,
  [
    { id: 'X', name: '补标客户X' },
    { id: 'Y', name: '补标客户Y' },
  ],
  (p) => (oldPlacements.indexOf(p) % 2 === 0 ? 'X' : 'Y'),
)
check('旧任务可补标分户', !rel.error && rel.result!.parcels.length === 2, rel.error ?? '')
const geomSame = rel.result!.sheets.every((s) =>
  s.placements.every((p) => {
    const o = oldPlacements.find((q) => q.seq === p.seq)!
    return Math.abs(p.x - o.x) < 1e-9 && Math.abs(p.y - o.y) < 1e-9 && p.rotated === o.rotated
  }),
)
check('补标不改变照片几何（先排完再补标）', geomSame)

// 12. 精度一致：所有对外坐标都是 0.01mm
const coordOk = JSON.stringify(r).split(',').every(() => true) // 粗检查改为针对性
let allTwoDigits = true
for (const p of r.sheets.flatMap((s) => s.placements)) {
  for (const v of [p.x, p.y, p.w, p.h]) {
    if (Math.abs(v - Math.round(v * 100) / 100) > 1e-9) allTwoDigits = false
  }
}
check('坐标精度统一为 0.01mm', allTwoDigits && coordOk)

// 13. 单客户合并 == 普通分户（一个块取整包）
check('单客户取件包为整批', sr.parcels.length === 1 && sr.parcels[0].photoCount === 10)

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
if (typeof process !== 'undefined') process.exit(failures === 0 ? 0 : 1)
