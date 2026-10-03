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
  photo?: PhotoRef
  /** 多客户合并拼版时所属客户；缺省 = 未标注客户（旧任务兼容，可先排完再补标） */
  customerId?: string
}

/** 实际照片矩形（mm，含旋转后的宽高） */
export interface Placement {
  itemId: string
  sheetIndex: number
  x: number
  y: number
  w: number
  h: number
  rotated: boolean
  seq: number
  /** 多客户合并拼版：所属客户；单客户任务缺省 */
  customerId?: string
  /** 多客户合并拼版：落在该客户的第几块（独立可裁开区域），形如 "P1-A" */
  blockId?: string
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
  /** 多客户合并拼版：这一刀是客户分界刀（先切）还是客户块内部刀（分户后再切） */
  role?: 'boundary' | 'internal'
  /** 该刀两侧涉及的客户 id（内部刀只有一个客户；分界刀为被分开的客户） */
  customerIds?: string[]
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

/* ============ 多客户合并拼版 ============ */

/** 余料让给下一客户的策略 */
export type HandoverPolicy = 'auto' | 'none'

/** 一个客户在合并拼版中的清单条目 */
export interface MergeItem {
  itemId: string
  customerId: string
  copies: number
  photoW: number
  photoH: number
  allowRotate: boolean
  keepTogether: boolean
  sizeName?: string
}

/** 一个客户的一块「独立能裁开」的区域（guillotine 子树的单客户极大节点） */
export interface CustomerBlock {
  id: string
  customerId: string
  sheetIndex: number
  /** 块矩形（mm，整纸坐标） */
  x: number
  y: number
  w: number
  h: number
  photoCount: number
  photoAreaMm2: number
  /** 块内含客户自己照片之间的边角料（仍随块归该客户） */
  wasteAreaMm2: number
  placementSeqs: number[]
}

/** 一次余料让渡记录（让/不让都记一条，给出判据与卡点） */
export interface HandoverRecord {
  sheetIndex: number
  /** 让渡的矩形（mm，整纸坐标） */
  x: number
  y: number
  w: number
  h: number
  fromCustomerId: string
  toCustomerId?: string
  granted: boolean
  /** 判定依据 / 卡点说明 */
  reason: string
  /** 让渡是否真正被新客户用掉（granted 后可能整块仍空着） */
  used: boolean
}

/** 每个客户的分户取件包 */
export interface CustomerParcel {
  customerId: string
  customerName: string
  photoCount: number
  photoAreaMm2: number
  /** 该客户占用的块数（可能 > 张数：同一张纸被切成多块时会出现多块） */
  blockCount: number
  /** 该客户落在哪些相纸上（去重后的相纸序号） */
  sheetIndexes: number[]
  blocks: CustomerBlock[]
}

/** 用了哪张纸的哪一块、各几张（分户结果明细行） */
export interface ParcelUsageRow {
  customerId: string
  customerName: string
  sheetIndex: number
  blockId: string
  photos: number
  x: number
  y: number
  w: number
  h: number
}

export interface MergeCompare {
  /** 分开排（同算法、禁止让渡）的纸张数与成本 */
  separateSheets: number
  separateCents: number
  /** 合并拼版的纸张数与成本 */
  mergedSheets: number
  mergedCents: number
  savedSheets: number
  savedCents: number
  savedRate: number
  /** 分开排时每个客户各用几张纸 */
  separateByCustomer: Array<{ customerId: string; sheets: number; cents: number }>
}

export interface MergeStats {
  totalPhotos: number
  sheetCount: number
  customerCount: number
  blockCount: number
  handoverGranted: number
  handoverRefused: number
  avgUtilization: number
  elapsedMs: number
}

export interface MergeResult {
  /** 兼容既有预览/导出：每张纸的 placements（已带 customerId/blockId）与带角色的 cutSteps */
  sheets: Sheet[]
  parcels: CustomerParcel[]
  blocks: CustomerBlock[]
  usages: ParcelUsageRow[]
  handovers: HandoverRecord[]
  compare: MergeCompare
  stats: MergeStats
}

export interface MergeJob {
  id: string
  name: string
  paperId: string
  customPaper?: Paper
  customers: Array<{ id: string; name: string }>
  items: MergeItem[]
  gapMm: number
  kerfMm: number
  safeEdgeMm: number
  allowRotate: boolean
  handoverPolicy: HandoverPolicy
  createdAt: number
  result?: MergeResult
  /** 真排不下时整批停下的异常原因（点名客户） */
  error?: string
}
