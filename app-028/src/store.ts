/** 全局状态（Vue 自带 ref / computed / watch，不引入任何状态库） */
import { computed, ref, watch } from 'vue'
import {
  BUILTIN_PAPERS,
  BUILTIN_PHOTO_SIZES,
  BUILTIN_TEMPLATES,
  groupsFromTask,
  newId,
  optionsFromTask,
  resolvePaper,
} from './logic/library'
import { pack, sheetsFromPlacements } from './logic/packer'
import { buildCustomerReport, isMergeTask, placementsSignature, UNASSIGNED_CUSTOMER_ID } from './logic/customers'
import { loadJSON, saveJSON } from './logic/storage'
import type {
  Leftover,
  Paper,
  PaperTemplate,
  PhotoRef,
  PhotoSize,
  Placement,
  Settings,
  Sheet,
  Task,
} from './logic/types'

const KEY = {
  customPapers: 'ppis.customPapers.v1',
  customSizes: 'ppis.customSizes.v1',
  settings: 'ppis.settings.v1',
  tasks: 'ppis.tasks.v1',
  leftovers: 'ppis.leftovers.v1',
}

export const DEFAULT_SETTINGS: Settings = {
  gapMm: 0,
  kerfMm: 0.5,
  safeEdgeMm: 3,
  allowRotate: true,
  exportDpi: 300,
}

export const customPapers = ref<Paper[]>(loadJSON<Paper[]>(KEY.customPapers, []))
export const customSizes = ref<PhotoSize[]>(loadJSON<PhotoSize[]>(KEY.customSizes, []))
export const settings = ref<Settings>({ ...DEFAULT_SETTINGS, ...loadJSON(KEY.settings, {}) })
export const tasks = ref<Task[]>(loadJSON<Task[]>(KEY.tasks, []))
export const leftovers = ref<Leftover[]>(loadJSON<Leftover[]>(KEY.leftovers, []))

watch(customPapers, (v) => saveJSON(KEY.customPapers, v), { deep: true })
watch(customSizes, (v) => saveJSON(KEY.customSizes, v), { deep: true })
watch(settings, (v) => saveJSON(KEY.settings, v), { deep: true })
watch(tasks, (v) => saveJSON(KEY.tasks, v), { deep: true })
watch(leftovers, (v) => saveJSON(KEY.leftovers, v), { deep: true })

export const allPapers = computed<Paper[]>(() => [...BUILTIN_PAPERS, ...customPapers.value])
export const allSizes = computed<PhotoSize[]>(() => [...BUILTIN_PHOTO_SIZES, ...customSizes.value])
export const templates = computed<PaperTemplate[]>(() => BUILTIN_TEMPLATES)

/** 照片文件只在本机内存里保留，绝不写入存储、绝不上传 */
const photoCache = new Map<string, { url: string; ref: PhotoRef }>()
/** 内存照片变化计数（Map 本身不是响应式的，用它触发重绘） */
export const photoVersion = ref(0)

export function photoKey(itemId: string, copyIndex: number): string {
  return `${itemId}#${copyIndex}`
}

export function setItemPhoto(key: string, url: string, ref: PhotoRef): void {
  const old = photoCache.get(key)
  if (old) URL.revokeObjectURL(old.url)
  photoCache.set(key, { url, ref })
  photoVersion.value++
}

export function getItemPhoto(key: string): { url: string; ref: PhotoRef } | undefined {
  return photoCache.get(key)
}

export function clearItemPhoto(key: string): void {
  const old = photoCache.get(key)
  if (old) URL.revokeObjectURL(old.url)
  photoCache.delete(key)
  photoVersion.value++
}

/** 每张照片（placement）对应第几张底片 */
export function copyIndexMap(sheets: Sheet[]): Map<number, number> {
  const counter = new Map<string, number>()
  const out = new Map<number, number>()
  for (const s of sheets) {
    for (const p of s.placements) {
      const n = counter.get(p.itemId) ?? 0
      out.set(p.seq, n)
      counter.set(p.itemId, n + 1)
    }
  }
  return out
}

/** placement -> 本机照片（key + objectURL），未导入照片时返回 undefined */
export function makePhotoResolver(task: Task, sheets: Sheet[]) {
  const map = copyIndexMap(sheets)
  const repeat = new Map(task.items.map((i) => [i.id, i.repeatSamePhoto]))
  return (p: Placement): { key: string; url: string } | undefined => {
    const ci = repeat.get(p.itemId) === false ? map.get(p.seq) ?? 0 : 0
    const k = photoKey(p.itemId, ci)
    const ph = getItemPhoto(k)
    return ph ? { key: k, url: ph.url } : undefined
  }
}

/** 生成「placement -> 本机缩略图 URL」的解析函数 */
export function makeThumbResolver(task: Task, sheets: Sheet[]) {
  const resolve = makePhotoResolver(task, sheets)
  return (p: Placement): string | undefined => resolve(p)?.url
}

export function getTask(id: string): Task | undefined {
  return tasks.value.find((t) => t.id === id)
}

export function createTask(partial: Partial<Task> = {}): Task {
  const task: Task = {
    id: newId('task'),
    name: partial.name ?? `拼版任务 ${tasks.value.length + 1}`,
    paperId: partial.paperId ?? 'p5x7',
    customPaper: partial.customPaper,
    items: partial.items ?? [],
    gapMm: partial.gapMm ?? settings.value.gapMm,
    kerfMm: partial.kerfMm ?? settings.value.kerfMm,
    safeEdgeMm: partial.safeEdgeMm ?? settings.value.safeEdgeMm,
    allowRotate: partial.allowRotate ?? settings.value.allowRotate,
    mergeCustomers: partial.mergeCustomers,
    customerReport: undefined,
    headerText: partial.headerText ?? '',
    footerText: partial.footerText ?? '',
    createdAt: Date.now(),
  }
  tasks.value.unshift(task)
  return task
}

export function deleteTask(id: string): void {
  tasks.value = tasks.value.filter((t) => t.id !== id)
}

export function touch(): void {
  tasks.value = tasks.value.slice()
}

/** 执行排样；返回错误提示（无错误时返回 undefined） */
export function runPack(task: Task): string | undefined {
  const paper = resolvePaper(task, allPapers.value)
  const groups = groupsFromTask(task, allSizes.value)
  if (!groups.length) {
    task.result = undefined
    task.customerReport = undefined
    return '照片清单为空，请先添加照片尺寸与数量'
  }
  const merged = isMergeTask(task)
  const baseOptions = optionsFromTask(task, paper)
  let baselineSheets = 0
  let baselineCents = 0
  let baselineArea = 0
  const usedAreaAll = groups.reduce((acc, g) => acc + g.copies * g.photoW * g.photoH, 0)

  if (merged) {
    const customerIds = Array.from(new Set(groups.map((g) => g.customerId ?? UNASSIGNED_CUSTOMER_ID))).sort()
    for (const customer of customerIds) {
      const customerGroups = groups.filter((g) => (g.customerId ?? UNASSIGNED_CUSTOMER_ID) === customer)
      const alone = pack(customerGroups, { ...baseOptions })
      if (alone.error) {
        task.result = undefined
        task.customerReport = undefined
        return alone.error
      }
      baselineSheets += alone.result.sheets.length
      baselineArea += alone.result.sheets.length * paper.wMm * paper.hMm
    }
    baselineCents = baselineSheets * paper.priceCents
  }

  const out = pack(groups, { ...baseOptions, customerMode: merged })
  if (out.error) {
    task.result = undefined
    task.customerReport = undefined
    return out.error
  }
  task.result = out.result
  task.manual = undefined
  task.mergeCustomers = merged
  task.customerReport = buildCustomerReport(task, paper, out.result.sheets, {
    merged,
    baselineSheets: merged ? baselineSheets : out.result.sheets.length,
    baselineCents: merged ? baselineCents : out.result.sheets.length * paper.priceCents,
    baselineUtilization: merged
      ? baselineArea > 0
        ? usedAreaAll / baselineArea
        : 0
      : out.result.stats.avgUtilization,
  })
  touch()
  return undefined
}

/** 当前生效的相纸版面：手工微调优先于自动排样 */
export function sheetsOf(task: Task): Sheet[] {
  if (task.manual) {
    const paper = resolvePaper(task, allPapers.value)
    const count = Math.max(1, task.result?.sheets.length ?? 1)
    return sheetsFromPlacements(task.manual.placements, optionsFromTask(task, paper), count).sheets
  }
  return task.result?.sheets ?? []
}

export function manualPlacementsOf(task: Task): Placement[] {
  if (task.manual) return task.manual.placements
  return (task.result?.sheets ?? []).flatMap((s) => s.placements)
}

/** 当前清单/预览/导出共用的分户结果；旧任务补标后按同一几何口径即时重建 */
export function customerReportOf(task: Task) {
  if (!task.result) return undefined
  const paper = resolvePaper(task, allPapers.value)
  const sheets = sheetsOf(task)
  const current = task.customerReport
  if (current && current.signature === placementsSignature(sheets)) return current
  const merged = isMergeTask(task)
  const report = buildCustomerReport(task, paper, sheets, {
    merged,
    baselineSheets: current?.baselineSheets ?? sheets.length,
    baselineCents: current?.baselineCents ?? sheets.length * paper.priceCents,
    baselineUtilization: current?.baselineUtilization ?? task.result.stats.avgUtilization,
  })
  task.customerReport = report
  task.mergeCustomers = merged
  return report
}

/** 旧任务补标：不强制重排，按既有贯通刀路重新计算独立客户块；若要重新凑边角，再点重排 */
export function assignCustomers(
  task: Task,
  assignments: Array<{ itemId?: string; seq?: number; customerId: string; scope: 'item' | 'photo'; onlyUnassigned?: boolean }>,
): void {
  // 把补标固化到当前生效版面：自动结果也转为一份可继续微调的手工版面
  const source = manualPlacementsOf(task).map((p) => ({ ...p }))
  for (const p of source) {
    if (!p.customerId) {
      p.customerId = task.items.find((i) => i.id === p.itemId)?.customerId ?? UNASSIGNED_CUSTOMER_ID
    }
  }
  for (const a of assignments) {
    const customer = a.customerId.trim() || UNASSIGNED_CUSTOMER_ID
    if (a.scope === 'item') {
      for (const item of task.items) {
        if (!a.itemId || item.id === a.itemId) {
          if (a.onlyUnassigned && (item.customerId ?? '').trim()) continue
          item.customerId = customer
        }
      }
    }
    for (const p of source) {
      if (a.scope === 'photo') {
        if (a.seq === undefined || p.seq !== a.seq) continue
      } else if (a.itemId && p.itemId !== a.itemId) continue
      else if (a.onlyUnassigned && (p.customerId ?? '').trim()) continue
      p.customerId = customer
    }
  }
  const paper = resolvePaper(task, allPapers.value)
  const count = Math.max(1, task.result?.sheets.length ?? 1)
  const rebuilt = sheetsFromPlacements(source, optionsFromTask(task, paper), count)
  const stepCount = rebuilt.sheets.reduce((acc, s) => acc + s.cutSteps.length, 0)
  task.manual = {
    placements: source,
    valid: rebuilt.errors.length === 0,
    message: rebuilt.errors.length ? rebuilt.errors[0] : `旧任务补标后沿用原刀路：${stepCount} 刀全部贯通`,
    validationMs: 0,
    stepCount,
  }
  customerReportOf(task)
  touch()
}

/** 写入手工微调结果并做增量校验（不重新排样） */
export function setManual(task: Task, placements: Placement[]): void {
  const paper = resolvePaper(task, allPapers.value)
  const count = Math.max(1, task.result?.sheets.length ?? 1)
  const t0 = performance.now()
  const { sheets, errors } = sheetsFromPlacements(placements, optionsFromTask(task, paper), count)
  const ms = performance.now() - t0
  const stepCount = sheets.reduce((acc, s) => acc + s.cutSteps.length, 0)
  task.manual = {
    placements,
    valid: errors.length === 0,
    message: errors.length
      ? errors[0]
      : `guillotine 校验通过：${stepCount} 刀全部贯通，用时 ${ms.toFixed(1)}ms`,
    validationMs: Math.round(ms * 100) / 100,
    stepCount,
  }
  touch()
}

export function resetManual(task: Task): void {
  task.manual = undefined
  touch()
}

export function addCustomPaper(p: Omit<Paper, 'id'>): Paper {
  const paper: Paper = { ...p, id: newId('paper') }
  customPapers.value = [...customPapers.value, paper]
  return paper
}

export function addCustomSize(s: Omit<PhotoSize, 'id'>): PhotoSize {
  const size: PhotoSize = { ...s, id: newId('size') }
  customSizes.value = [...customSizes.value, size]
  return size
}

export function removeCustomPaper(id: string): void {
  customPapers.value = customPapers.value.filter((p) => p.id !== id)
}

export function removeCustomSize(id: string): void {
  customSizes.value = customSizes.value.filter((s) => s.id !== id)
}

export function addLeftover(l: Omit<Leftover, 'id' | 'createdAt' | 'usedCount'>): Leftover {
  const item: Leftover = {
    ...l,
    id: newId('leftover'),
    createdAt: Date.now(),
    usedCount: 0,
  }
  leftovers.value = [item, ...leftovers.value]
  return item
}

export function removeLeftover(id: string): void {
  leftovers.value = leftovers.value.filter((l) => l.id !== id)
}

export function markLeftoverUsed(id: string): void {
  leftovers.value = leftovers.value.map((l) =>
    l.id === id ? { ...l, usedCount: l.usedCount + 1 } : l,
  )
}
