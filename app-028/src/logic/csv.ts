/** 导出 CSV（带 BOM，Excel 直接打开不乱码） */
import type { MergeResult, Paper, Sheet, Task } from './types'

/** 坐标精度统一为 0.01mm，与引擎 COORD_DIGITS 保持一致 */
const n2 = (v: number): number => Math.round(v * 100) / 100

export function toCsv(rows: Array<Array<string | number>>): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? '')
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(','),
    )
    .join('\r\n')
}

export function csvBlob(rows: Array<Array<string | number>>): Blob {
  return new Blob(['\uFEFF' + toCsv(rows)], { type: 'text/csv;charset=utf-8' })
}

export function cutListRows(
  task: Task,
  paper: Paper,
  sheets: Sheet[],
  sizeLabelOf: (seq: number) => string,
): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [
    ['相纸', `${paper.name} ${paper.wMm}x${paper.hMm}mm`],
    ['隙距 mm', task.gapMm],
    ['刀宽补偿 mm', task.kerfMm],
    ['安全边 mm', task.safeEdgeMm],
    ['相纸张数', sheets.length],
    [],
    ['相纸序号', '刀序', '方向', '坐标 mm', '起点 mm', '终点 mm', '长度 mm', '是否共边合并'],
  ]
  for (const s of sheets) {
    s.cutSteps.forEach((c, i) => {
      rows.push([
        s.index + 1,
        i + 1,
        c.axis === 'v' ? '竖切' : '横切',
        Math.round(c.at * 100) / 100,
        Math.round(c.from * 100) / 100,
        Math.round(c.to * 100) / 100,
        Math.round((c.to - c.from) * 100) / 100,
        c.merged ? '是' : '否',
      ])
    })
    rows.push([])
  }
  rows.push(['照片编号', '所在相纸', '尺寸', 'x mm', 'y mm', '宽 mm', '高 mm', '旋转'])
  for (const s of sheets) {
    for (const p of s.placements) {
      rows.push([
        p.seq,
        s.index + 1,
        sizeLabelOf(p.seq),
        n2(p.x),
        n2(p.y),
        n2(p.w),
        n2(p.h),
        p.rotated ? '90°' : '无',
      ])
    }
  }
  return rows
}

/**
 * 分户裁切清单：每个客户一张表（同一 CSV 内分段），只含该客户自己块内的刀。
 * 坐标统一 0.01mm；分界刀单列在最前（先沿分界刀把块裁下，再切块内照片）。
 */
export function mergeCutListRows(
  jobName: string,
  paper: Paper,
  result: MergeResult,
  sizeLabelOf: (itemId: string) => string,
): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [
    ['合并拼版任务', jobName],
    ['相纸', `${paper.name} ${paper.wMm}x${paper.hMm}mm`],
    ['相纸张数', result.stats.sheetCount],
    ['客户数', result.stats.customerCount],
    [],
  ]

  // 总览：每个客户用了哪张纸的哪一块、各几张
  rows.push(['== 分户总览 =='])
  rows.push(['客户', '相纸序号', '块编号', '照片张数', '块 x mm', '块 y mm', '块宽 mm', '块高 mm'])
  for (const u of result.usages) {
    rows.push([u.customerName, u.sheetIndex + 1, u.blockId, u.photos, n2(u.x), n2(u.y), n2(u.w), n2(u.h)])
  }
  rows.push([])

  // 合并 vs 分开 的省纸/省钱对比
  const c = result.compare
  rows.push(['== 合并 vs 分开 =='])
  rows.push(['方案', '相纸张数', '材料成本（元）'])
  rows.push(['各客户分开排', c.separateSheets, (c.separateCents / 100).toFixed(2)])
  rows.push(['合并拼版', c.mergedSheets, (c.mergedCents / 100).toFixed(2)])
  rows.push(['节省', c.savedSheets, (c.savedCents / 100).toFixed(2)])
  for (const sc of c.separateByCustomer) {
    const name = result.parcels.find((p) => p.customerId === sc.customerId)?.customerName ?? sc.customerId
    rows.push([`分开排·${name}`, sc.sheets, (sc.cents / 100).toFixed(2)])
  }
  rows.push([])

  // 每个客户独立的裁切清单
  for (const parcel of result.parcels) {
    rows.push([`== 客户：${parcel.customerName}（共 ${parcel.photoCount} 张，${parcel.blockCount} 块）==`])
    rows.push(['相纸序号', '块编号', '刀序', '类别', '方向', '坐标 mm', '起点 mm', '终点 mm', '长度 mm'])
    let stepNo = 0
    for (const block of parcel.blocks) {
      const sheet = result.sheets.find((s) => s.index === block.sheetIndex)
      if (!sheet) continue
      // 先列该块的分界刀：role=boundary 且刀线压在块的某条边上、刀长与该边相交
      const seen = new Set<string>()
      for (const cut of sheet.cutSteps) {
        if (cut.role !== 'boundary' || !cutOnBlockEdge(cut.axis, cut.at, cut.from, cut.to, block)) continue
        const key = `${cut.axis}@${cut.at}`
        if (seen.has(key)) continue
        seen.add(key)
        stepNo++
        rows.push([
          block.sheetIndex + 1,
          block.id,
          stepNo,
          '分界刀（先切）',
          cut.axis === 'v' ? '竖切' : '横切',
          n2(cut.at),
          n2(cut.from),
          n2(cut.to),
          n2(cut.to - cut.from),
        ])
      }
      // 再列块内部刀：刀线严格穿过块内部、刀长落在块范围内（分界后这些刀才下）
      for (const cut of sheet.cutSteps) {
        if (cut.role === 'boundary') continue
        if (!cutInsideBlock(cut.axis, cut.at, cut.from, cut.to, block)) continue
        stepNo++
        rows.push([
          block.sheetIndex + 1,
          block.id,
          stepNo,
          '块内刀',
          cut.axis === 'v' ? '竖切' : '横切',
          n2(cut.at),
          n2(cut.from),
          n2(cut.to),
          n2(cut.to - cut.from),
        ])
      }
    }
    rows.push(['块编号', '照片编号', '尺寸', 'x mm', 'y mm', '宽 mm', '高 mm', '旋转'])
    for (const block of parcel.blocks) {
      const sheet = result.sheets.find((s) => s.index === block.sheetIndex)
      for (const p of sheet?.placements ?? []) {
        if (p.blockId !== block.id) continue
        rows.push([
          block.id,
          p.seq,
          sizeLabelOf(p.itemId),
          n2(p.x),
          n2(p.y),
          n2(p.w),
          n2(p.h),
          p.rotated ? '90°' : '无',
        ])
      }
    }
    rows.push([])
  }
  return rows
}

type BlockShape = { x: number; y: number; w: number; h: number }
const EPS2 = 0.01

/** 分界刀：刀线压在块的一条边上，且刀长与该边有交叠（先沿它把整块裁下） */
function cutOnBlockEdge(
  axis: 'v' | 'h',
  at: number,
  from: number,
  to: number,
  b: BlockShape,
): boolean {
  if (axis === 'v') {
    const onEdge = Math.abs(at - b.x) < EPS2 || Math.abs(at - (b.x + b.w)) < EPS2
    return onEdge && Math.min(to, b.y + b.h) - Math.max(from, b.y) > EPS2
  }
  const onEdge = Math.abs(at - b.y) < EPS2 || Math.abs(at - (b.y + b.h)) < EPS2
  return onEdge && Math.min(to, b.x + b.w) - Math.max(from, b.x) > EPS2
}

/** 块内刀：刀线严格穿过块内部，刀长落在块范围内（分界之后再切） */
function cutInsideBlock(
  axis: 'v' | 'h',
  at: number,
  from: number,
  to: number,
  b: BlockShape,
): boolean {
  if (axis === 'v') {
    return (
      at > b.x + EPS2 &&
      at < b.x + b.w - EPS2 &&
      from >= b.y - EPS2 &&
      to <= b.y + b.h + EPS2
    )
  }
  return (
    at > b.y + EPS2 &&
    at < b.y + b.h - EPS2 &&
    from >= b.x - EPS2 &&
    to <= b.x + b.w + EPS2
  )
}

/** 分户取件包清单（每客户一行汇总 + 明细块） */
export function parcelRows(result: MergeResult): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [
    ['客户', '照片张数', '块数', '涉及相纸', '照片面积 mm²', '相纸序号（去重）'],
  ]
  for (const p of result.parcels) {
    rows.push([
      p.customerName,
      p.photoCount,
      p.blockCount,
      p.sheetIndexes.length,
      n2(p.photoAreaMm2),
      p.sheetIndexes.map((i) => i + 1).join(' '),
    ])
  }
  return rows
}
