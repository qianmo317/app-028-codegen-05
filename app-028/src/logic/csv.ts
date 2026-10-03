/** 导出 CSV（带 BOM，Excel 直接打开不乱码） */
import type { CustomerMergeReport, Paper, Sheet, Task } from './types'

export function customerCutRows(
  report: CustomerMergeReport,
  sizeLabelOf: (seq: number) => string,
): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [
    ['拆分原则', report.rule],
    ['分开排基线张数', report.baselineSheets],
    ['合并排样张数', report.mergedSheets],
    ['节省张数', report.savedSheets],
    ['分开排基线成本（元）', (report.baselineCents / 100).toFixed(2)],
    ['合并排样成本（元）', (report.mergedCents / 100).toFixed(2)],
    ['节省金额（元）', (report.savedCents / 100).toFixed(2)],
    [],
  ]
  if (report.handoffs.length) {
    rows.push(['独占纸', '客户', '空矩形 x/y/w/h mm', '是否让出', '判据'])
    for (const h of report.handoffs) {
      rows.push([h.sheetIndex + 1, h.customerName, `${h.freeX}/${h.freeY}/${h.freeW}/${h.freeH}`, h.handedOff ? '是' : '否', h.reason])
    }
    rows.push([])
  }
  for (const p of report.packages) {
    rows.push(['客户', p.customerName, '照片数', p.photoCount])
    rows.push(['块编号', '相纸', 'x mm', 'y mm', '宽 mm', '高 mm', '照片编号'])
    for (const b of p.blocks) {
      rows.push([
        b.id,
        b.sheetIndex + 1,
        b.x,
        b.y,
        b.w,
        b.h,
        b.placementSeqs.map((s) => `#${s}`).join(' '),
      ])
    }
    rows.push(['刀序(全局)', '相纸', '用途', '方向', '坐标 mm', '起点 mm', '终点 mm', '共边'])
    for (const c of p.cuts) {
      rows.push([
        c.stepIndex + 1,
        c.sheetIndex + 1,
        c.role === 'boundary' ? '分户边界' : c.role === 'shared' ? '分户+内部' : '客户内部',
        c.axis === 'v' ? '竖切' : '横切',
        c.at,
        c.from,
        c.to,
        c.merged ? '是' : '否',
      ])
    }
    rows.push(['照片编号', '尺寸', '块编号'])
    for (const b of p.blocks) {
      for (const seq of b.placementSeqs) rows.push([seq, sizeLabelOf(seq), b.id])
    }
    rows.push([])
  }
  return rows
}

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
  report?: CustomerMergeReport,
): Array<Array<string | number>> {
  const customerBySeq = new Map<number, string>()
  for (const b of report?.blocks ?? []) {
    for (const seq of b.placementSeqs) customerBySeq.set(seq, b.customerName)
  }
  const roleByStep = new Map<string, string>()
  for (const c of report?.cuts ?? []) {
    const key = `${c.sheetIndex}:${c.stepIndex}:${c.customerId}`
    roleByStep.set(key, c.role === 'boundary' ? '分户边界' : c.role === 'shared' ? '分户+内部' : '客户内部')
  }
  const rows: Array<Array<string | number>> = [
    ['相纸', `${paper.name} ${paper.wMm}x${paper.hMm}mm`],
    ['隙距 mm', task.gapMm],
    ['刀宽补偿 mm', task.kerfMm],
    ['安全边 mm', task.safeEdgeMm],
    ['相纸张数', sheets.length],
    [],
    report
      ? ['相纸序号', '刀序', '客户', '刀用途', '方向', '坐标 mm', '起点 mm', '终点 mm', '长度 mm', '是否共边合并']
      : ['相纸序号', '刀序', '方向', '坐标 mm', '起点 mm', '终点 mm', '长度 mm', '是否共边合并'],
  ]
  for (const s of sheets) {
    s.cutSteps.forEach((c, i) => {
      const base = [
        s.index + 1,
        i + 1,
        c.axis === 'v' ? '竖切' : '横切',
        Math.round(c.at * 100) / 100,
        Math.round(c.from * 100) / 100,
        Math.round(c.to * 100) / 100,
        Math.round((c.to - c.from) * 100) / 100,
        c.merged ? '是' : '否',
      ]
      if (!report) {
        rows.push(base)
        return
      }
      const related = report.cuts.filter((x) => x.sheetIndex === s.index && x.stepIndex === i)
      if (!related.length) {
        rows.push([s.index + 1, i + 1, '—', '废料/修边', ...base.slice(2)])
        return
      }
      for (const x of related) {
        rows.push([
          s.index + 1,
          i + 1,
          x.customerName,
          roleByStep.get(`${x.sheetIndex}:${x.stepIndex}:${x.customerId}`) ?? '客户内部',
          ...base.slice(2),
        ])
      }
    })
    rows.push([])
  }
  rows.push(
    report
      ? ['照片编号', '客户', '独立块', '所在相纸', '尺寸', 'x mm', 'y mm', '宽 mm', '高 mm', '旋转']
      : ['照片编号', '所在相纸', '尺寸', 'x mm', 'y mm', '宽 mm', '高 mm', '旋转'],
  )
  for (const s of sheets) {
    for (const p of s.placements) {
      const base = [
        p.seq,
        s.index + 1,
        sizeLabelOf(p.seq),
        Math.round(p.x * 100) / 100,
        Math.round(p.y * 100) / 100,
        Math.round(p.w * 100) / 100,
        Math.round(p.h * 100) / 100,
        p.rotated ? '90°' : '无',
      ]
      if (report) {
        const block = report.blocks.find((b) => b.placementSeqs.includes(p.seq))
        rows.push([p.seq, block?.customerName ?? customerBySeq.get(p.seq) ?? '', block?.id ?? '', ...base.slice(1)])
      } else {
        rows.push(base)
      }
    }
  }
  return rows
}
