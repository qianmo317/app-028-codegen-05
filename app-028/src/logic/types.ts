/** 数据模型（对应规格书 §7） */

export type PaperKind = 'sheet' | 'roll'

export interface Paper {
  id: string
  name: string
  wMm: number
  hMm: number
  marginMm: number
  priceCents: number
  kind: PaperKind
}

export interface PhotoSize {
  id: string
  name: string
  wMm: number
  hMm: number
  rotateByDefault: boolean
}

/** 本机读取的照片文件信息（只读尺寸与方向，不上传） */
export interface PhotoRef {
  name: string
  wPx: number
  hPx: number
  landscape: boolean
}

export interface Item {
  id: string
  sizeId: string
  qty: number
  rotateAllowed: boolean
  /** true = 同一张照片重复排；false = 一张照片只出现一次（每张各需一张底片） */
  repeatSamePhoto: boolean
  /** true = 该尺寸的照片尽量不拆散，排在同一张相纸上 */
  keepTogether: boolean
  /** 客户标记；旧任务为空表示尚未补标 */
  customerId?: string
  photo?: PhotoRef
}

/** 实际照片矩形（mm，含旋转后的宽高） */
export interface Placement {
  itemId: string
  customerId?: string
  sheetIndex: number
  x: number
  y: number
  w: number
  h: number
  rotated: boolean
  seq: number
}

export type CutAxis = 'v' | 'h'

/** 贯通切割线；axis='v' 时 at 为 x，from/to 为 y 区间 */
export interface CutStep {
  sheetIndex: number
  axis: CutAxis
  at: number
  from: number
  to: number
  /** 该步由共边合并而来 */
  merged: boolean
}

export interface Sheet {
  index: number
  placements: Placement[]
  cutSteps: CutStep[]
  /** 合并前的切割步数（用于共边合并的对比断言） */
  rawCutCount: number
  usedAreaMm2: number
  sheetAreaMm2: number
  utilization: number
  wasteRects: WasteRect[]
}

export interface WasteRect {
  x: number
  y: number
  w: number
  h: number
}

export interface PackStats {
  totalPhotos: number
  sheets: number
  avgUtilization: number
  elapsedMs: number
  keepTogetherBroken: string[]
}

export interface PackResult {
  sheets: Sheet[]
  stats: PackStats
}

/** 一个客户在一张纸上可直接裁开的独立矩形取件块 */
export interface CustomerBlock {
  id: string
  sheetIndex: number
  customerId: string
  customerName: string
  /** 切块外边界（含 kerf/gap 补偿），坐标精度统一到 0.01mm */
  x: number
  y: number
  w: number
  h: number
  placementSeqs: number[]
  photoCount: number
}

export interface CustomerCutRecord {
  blockId: string
  customerId: string
  customerName: string
  sheetIndex: number
  stepIndex: number
  axis: CutAxis
  at: number
  from: number
  to: number
  merged: boolean
  /** boundary = 分户边界；internal = 客户包内部照片刀；shared = 共边刀同时承担两者 */
  role: 'boundary' | 'internal' | 'shared'
}

export interface CustomerSheetUse {
  sheetIndex: number
  blockIds: string[]
  blocks: CustomerBlock[]
  photoCount: number
}

export interface CustomerPackage {
  customerId: string
  customerName: string
  color: string
  photoCount: number
  sheets: CustomerSheetUse[]
  blocks: CustomerBlock[]
  cuts: CustomerCutRecord[]
}

export interface CustomerMergeReport {
  merged: boolean
  signature: string
  customerIds: string[]
  customerNames: Record<string, string>
  colors: Record<string, string>
  blocks: CustomerBlock[]
  packages: CustomerPackage[]
  cuts: CustomerCutRecord[]
  baselineSheets: number
  mergedSheets: number
  baselineCents: number
  mergedCents: number
  savedSheets: number
  savedCents: number
  baselineUtilization: number
  mergedUtilization: number
  rule: string
  /** 每张纸/边角是否让出给下一个客户的判据与结果 */
  handoffs: CustomerHandoff[]
}

export interface CustomerHandoff {
  sheetIndex: number
  customerId: string
  customerName: string
  handedOff: boolean
  reason: string
  fittedCustomers: string[]
  /** 客户独占时剩余的可切矩形（取切割树最大空叶，0.01mm） */
  freeX: number
  freeY: number
  freeW: number
  freeH: number
}

export interface CostReport {
  paperName: string
  sheets: number
  totalCents: number
  perPhotoCents: number
  totalPhotoCount: number
  /** 本方案浪费率 */
  wasteRate: number
  /** 不排样逐张打印的浪费率 */
  naiveWasteRate: number
  naiveTotalCents: number
  savedCents: number
}

export interface Task {
  id: string
  name: string
  paperId: string
  /** 自定义相纸（paperId 为 'custom' 时生效） */
  customPaper?: Paper
  items: Item[]
  gapMm: number
  kerfMm: number
  safeEdgeMm: number
  allowRotate: boolean
  /** true = 多客户合并拼版；旧任务缺省时由客户数量自动判断 */
  mergeCustomers?: boolean
  customerReport?: CustomerMergeReport
  headerText: string
  footerText: string
  createdAt: number
  /** 手工微调过的排样（存在时优先于自动排样结果） */
  manual?: {
    placements: Placement[]
    valid: boolean
    message: string
    validationMs: number
    stepCount: number
  }
  result?: PackResult
}

export interface Leftover {
  id: string
  name: string
  wMm: number
  hMm: number
  marginMm: number
  priceCents: number
  createdAt: number
  usedCount: number
}

export interface Settings {
  gapMm: number
  kerfMm: number
  safeEdgeMm: number
  allowRotate: boolean
  exportDpi: number
}

export interface PaperTemplate {
  id: string
  name: string
  paperId: string
  items: Array<{
    sizeId: string
    qty: number
    rotateAllowed: boolean
    keepTogether: boolean
  }>
}
