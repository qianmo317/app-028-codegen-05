<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SheetView from '../components/SheetView.vue'
import {
  allPapers,
  allSizes,
  createMergeJob,
  deleteMergeJob,
  getMergeJob,
  mergeJobs,
  mergePaperOf,
  runMerge,
  mergeSizeName,
} from '../store'
import { findPhotoSize, newId } from '../logic/library'
import { customerColorMap } from '../logic/colors'
import { csvBlob, mergeCutListRows, parcelRows } from '../logic/csv'
import { downloadBlob } from '../logic/image'
import { formatCents, formatPercent } from '../logic/units'
import type { HandoverPolicy, MergeItem, Paper } from '../logic/types'

const route = useRoute()
const router = useRouter()

const existingId = computed(() => String(route.params.id ?? ''))
const existing = computed(() => (existingId.value ? getMergeJob(existingId.value) : undefined))

/* ---------- 新建草稿 ---------- */
interface DraftCustomer {
  id: string
  name: string
}
interface DraftRow {
  key: string
  customerId: string
  sizeId: string
  copies: number
  rotateAllowed: boolean
  keepTogether: boolean
}

const draft = reactive({
  name: '',
  paperId: 'p12x18',
  customPaper: {
    id: 'custom',
    name: '自定义相纸',
    wMm: 305,
    hMm: 457,
    marginMm: 5,
    priceCents: 600,
    kind: 'sheet' as const,
  } as Paper,
  customers: [
    { id: newId('cust'), name: '客户甲' },
    { id: newId('cust'), name: '客户乙' },
  ] as DraftCustomer[],
  rows: [] as DraftRow[],
  gapMm: 0,
  kerfMm: 0.5,
  safeEdgeMm: 3,
  allowRotate: true,
  handoverPolicy: 'auto' as HandoverPolicy,
})

const error = ref('')
const hint = ref('')

const currentPaper = computed<Paper>(() =>
  draft.paperId === 'custom'
    ? draft.customPaper
    : allPapers.value.find((p) => p.id === draft.paperId) ?? allPapers.value[0],
)

const colorMap = computed(() => customerColorMap(draft.customers))
const colorOf = (cid?: string) =>
  cid ? colorMap.value.get(cid) ?? '#8a94a6' : '#8a94a6'

function addCustomer() {
  const n = draft.customers.length + 1
  draft.customers.push({ id: newId('cust'), name: `客户${['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'][n - 1] ?? n}` })
}
function removeCustomer(id: string) {
  draft.customers = draft.customers.filter((c) => c.id !== id)
  draft.rows = draft.rows.filter((r) => r.customerId !== id)
}
function addRow(customerId?: string) {
  const cid = customerId ?? draft.customers[0]?.id
  if (!cid) {
    error.value = '请先添加至少一个客户'
    return
  }
  const size = allSizes.value[0]
  draft.rows.push({
    key: newId('row'),
    customerId: cid,
    sizeId: size.id,
    copies: 1,
    rotateAllowed: size.rotateByDefault,
    keepTogether: false,
  })
}
function removeRow(key: string) {
  draft.rows = draft.rows.filter((r) => r.key !== key)
}

const totalQty = computed(() => draft.rows.reduce((a, r) => a + Math.max(0, r.copies), 0))

function buildItems(): MergeItem[] {
  // 同客户 + 同尺寸 + 同旋转/不拆散 合并为一个引擎条目
  const merged = new Map<string, MergeItem>()
  for (const r of draft.rows) {
    const s = findPhotoSize(allSizes.value, r.sizeId)
    if (!s || r.copies <= 0) continue
    const key = `${r.customerId}|${r.sizeId}|${r.rotateAllowed}|${r.keepTogether}`
    const cur = merged.get(key)
    if (cur) {
      cur.copies += r.copies
    } else {
      merged.set(key, {
        itemId: r.sizeId,
        customerId: r.customerId,
        copies: r.copies,
        photoW: s.wMm,
        photoH: s.hMm,
        allowRotate: r.rotateAllowed,
        keepTogether: r.keepTogether,
        sizeName: `${s.name} ${s.wMm}×${s.hMm}`,
      })
    }
  }
  return Array.from(merged.values())
}

function submit() {
  error.value = ''
  hint.value = ''
  if (draft.customers.length < 2) {
    error.value = '合并拼版至少需要两个客户（单客户请直接用「新建任务」）'
    return
  }
  if (draft.customers.some((c) => !c.name.trim())) {
    error.value = '每个客户都要有名称（取件包按名称拆分）'
    return
  }
  if (!draft.rows.length) {
    error.value = '请先添加各客户的照片清单'
    return
  }
  if (draft.rows.some((r) => r.copies <= 0)) {
    error.value = '照片数量必须大于 0'
    return
  }
  const job = createMergeJob({
    name: draft.name || `${draft.customers.map((c) => c.name).join('＋')} 合并拼版`,
    paperId: draft.paperId,
    customPaper: draft.paperId === 'custom' ? { ...draft.customPaper } : undefined,
    customers: draft.customers.map((c) => ({ ...c })),
    items: buildItems(),
    gapMm: draft.gapMm,
    kerfMm: draft.kerfMm,
    safeEdgeMm: draft.safeEdgeMm,
    allowRotate: draft.allowRotate,
    handoverPolicy: draft.handoverPolicy,
  })
  const err = runMerge(job)
  if (err) {
    error.value = err
    return
  }
  router.push(`/merge/${job.id}`)
}

/* ---------- 结果 ---------- */
const job = computed(() => existing.value)
const result = computed(() => job.value?.result)
const paper = computed(() => (job.value ? mergePaperOf(job.value) : currentPaper.value))

const resultColorMap = computed(() =>
  job.value ? customerColorMap(job.value.customers) : new Map<string, string>(),
)
const resultColorOf = (cid?: string) =>
  cid ? resultColorMap.value.get(cid) ?? '#8a94a6' : '#8a94a6'
const resultNameOf = (cid?: string) =>
  job.value?.customers.find((c) => c.id === cid)?.name ?? '未标注客户'

function blocksOfSheet(sheetIndex: number) {
  return result.value?.blocks.filter((b) => b.sheetIndex === sheetIndex) ?? []
}

function rerun() {
  if (!job.value) return
  error.value = ''
  const err = runMerge(job.value)
  if (err) error.value = err
}

function exportCutLists() {
  if (!job.value || !result.value) return
  const rows = mergeCutListRows(job.value.name, paper.value, result.value, (itemId) =>
    mergeSizeName(itemId),
  )
  downloadBlob(csvBlob(rows), `${job.value.name}-分户裁切清单.csv`)
  hint.value = '按客户分开的裁切清单 CSV 已导出'
}

function exportParcels() {
  if (!job.value || !result.value) return
  downloadBlob(csvBlob(parcelRows(result.value)), `${job.value.name}-分户取件包.csv`)
  hint.value = '分户取件包（每人用了哪张纸的哪一块、各几张）CSV 已导出'
}

function windowPrint() {
  window.print()
}

function openJob(id: string) {
  router.push(`/merge/${id}`)
}
</script>

<template>
  <!-- 已保存结果页 -->
  <div v-if="job" class="stack">
    <div class="row">
      <h1 style="margin: 0">合并拼版 · {{ job.name }}</h1>
      <span class="badge brand">{{ result?.stats.customerCount ?? 0 }} 个客户</span>
      <span class="badge">{{ result?.stats.sheetCount ?? 0 }} 张相纸</span>
      <div class="spacer"></div>
      <button class="btn" @click="router.push('/merge')">← 新建合并</button>
      <button class="btn small danger" @click="deleteMergeJob(job.id); router.push('/merge')">
        删除
      </button>
    </div>

    <div v-if="job.error" class="note danger">
      <strong>整批已停止：</strong>{{ job.error }}
    </div>
    <div v-if="hint" class="note ok">{{ hint }}</div>

    <template v-if="result">
      <!-- 客户图例（清单/预览/导出共用同一套标记与配色） -->
      <div class="card">
        <h3>客户标记</h3>
        <div class="row" style="gap: 18px; flex-wrap: wrap">
          <div v-for="c in job.customers" :key="c.id" class="row tight">
            <span
              class="cust-dot"
              :style="{ background: resultColorOf(c.id), borderColor: resultColorOf(c.id) }"
            ></span>
            <strong>{{ c.name }}</strong>
          </div>
        </div>
        <div class="card-sub">
          虚线框 = 该客户「独立能裁开」的一块；红色粗线 = 客户分界刀（先切），灰/绿线 = 块内部刀
        </div>
      </div>

      <!-- 取舍说明：拆单依据 + 让渡判据 -->
      <div class="grid cols-2">
        <div class="card">
          <h3>拆单依据（二选一，已固定）</h3>
          <div class="note">
            分户<strong>以合并后实际要切的切割步骤为准</strong>：先沿客户分界刀把每张纸切成单客户块，再在各块内切照片。
            另一条「按各客户自己的排样分户」<strong>算不出不同的取件包</strong>——各客户独立排样从未发生在这批合并相纸上，
            纸上并不存在那些切割线；照片是混排在同一批纸上的，按一套没有下刀的线无法把纸物理拆成各客户的包。
          </div>
        </div>
        <div class="card">
          <h3>
            边角余料让渡
            <label class="row tight" style="margin-left: auto">
              <select v-model="job.handoverPolicy" @change="rerun">
                <option value="auto">允许让给下一客户（更省纸）</option>
                <option value="none">客户不共纸（各占整纸）</option>
              </select>
            </label>
          </h3>
          <div class="card-sub">
            判据：余料放得下后一客户的剩余照片、且分界刀能整边贯通（块仍独立可裁开）才让出；
            否则不让并在下方「让渡记录」写明卡点。让/不让都可复算两人各自的取件包。
          </div>
        </div>
      </div>

      <!-- 省纸 / 省钱对比 -->
      <div class="card">
        <h3>合并 vs 各客户分开排</h3>
        <div class="kv">
          <dt>分开排合计用纸</dt>
          <dd>{{ result.compare.separateSheets }} 张 · {{ formatCents(result.compare.separateCents) }}</dd>
          <dt>合并拼版用纸</dt>
          <dd>{{ result.compare.mergedSheets }} 张 · {{ formatCents(result.compare.mergedCents) }}</dd>
          <dt>节省</dt>
          <dd>
            <strong>{{ result.compare.savedSheets }} 张纸 · {{ formatCents(result.compare.savedCents) }}</strong>
            （{{ formatPercent(result.compare.savedRate) }}）
          </dd>
          <dt>合并后平均利用率</dt>
          <dd>{{ formatPercent(result.stats.avgUtilization) }}</dd>
        </div>
        <table class="data" style="margin-top: 10px">
          <thead>
            <tr><th>客户</th><th class="num">分开排用纸</th><th class="num">分开排成本</th></tr>
          </thead>
          <tbody>
            <tr v-for="sc in result.compare.separateByCustomer" :key="sc.customerId">
              <td>
                <span class="cust-dot" :style="{ background: resultColorOf(sc.customerId) }"></span>
                {{ resultNameOf(sc.customerId) }}
              </td>
              <td class="num">{{ sc.sheets }} 张</td>
              <td class="num">{{ formatCents(sc.cents) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分户取件包：每人用了哪张纸的哪一块、各几张 -->
      <div class="card">
        <h3>分户取件包（拆回各自的包）</h3>
        <div class="card-sub">每个客户的照片都落在独立能裁开的块里；块编号与预览虚线框、导出 CSV 完全一致</div>
        <div class="grid cols-3" style="margin-top: 8px">
          <div v-for="p in result.parcels" :key="p.customerId" class="parcel">
            <div class="row tight">
              <span class="cust-dot" :style="{ background: resultColorOf(p.customerId) }"></span>
              <strong>{{ p.customerName }}</strong>
              <span class="badge">{{ p.photoCount }} 张 · {{ p.blockCount }} 块</span>
            </div>
            <table class="data">
              <tbody>
                <tr v-for="b in p.blocks" :key="b.id">
                  <td>
                    第{{ b.sheetIndex + 1 }}张 ·
                    <span class="mono" :style="{ color: resultColorOf(p.customerId) }">{{ b.id }}</span>
                  </td>
                  <td class="num">{{ b.photoCount }} 张</td>
                  <td class="num mono" style="color: var(--ink-3); font-size: 11px">
                    {{ b.w.toFixed(1) }}×{{ b.h.toFixed(1) }}mm
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 预览：每张相纸，块/客户标记/分界刀 -->
      <div class="card">
        <h3>排样预览（同一批连排结果可复现）</h3>
        <div v-for="s in result.sheets" :key="s.index" class="sheet-preview-row">
          <div class="row tight" style="margin-bottom: 6px">
            <span class="badge">第 {{ s.index + 1 }} 张</span>
            <span class="badge">{{ s.cutSteps.length }} 刀</span>
            <span class="badge">分界刀 {{ s.cutSteps.filter((c) => c.role === 'boundary').length }}</span>
            <span class="badge">利用率 {{ formatPercent(s.utilization) }}</span>
          </div>
          <div class="sheet-wrap">
            <SheetView
              :sheet="s"
              :paper="paper"
              :safe-edge-mm="job.safeEdgeMm"
              :scale="Math.max(0.45, Math.min(1.4, 560 / paper.wMm))"
              :blocks="blocksOfSheet(s.index)"
              show-blocks
              show-boundary-cuts
              :customer-color-of="resultColorOf"
              :customer-name-of="resultNameOf"
            />
          </div>
        </div>
      </div>

      <!-- 让渡记录：让/不让 + 各自取件包可算 -->
      <div class="card">
        <h3>让渡记录（让/不让判据与卡点）</h3>
        <div v-if="!result.handovers.length" class="note">本批没有跨客户让渡（各客户都另起一张或正好填满）</div>
        <table v-else class="data">
          <thead>
            <tr>
              <th>相纸</th><th>余料 mm</th><th>从</th><th>给</th><th>结果</th><th>判据 / 卡点</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(h, hi) in result.handovers" :key="hi">
              <td>第{{ h.sheetIndex + 1 }}张</td>
              <td class="num mono">{{ h.w.toFixed(1) }}×{{ h.h.toFixed(1) }}</td>
              <td>{{ resultNameOf(h.fromCustomerId) }}</td>
              <td>{{ h.toCustomerId ? resultNameOf(h.toCustomerId) : '—' }}</td>
              <td>
                <span class="badge" :class="h.granted ? 'ok' : ''">{{ h.granted ? (h.used ? '让出且使用' : '让出未用') : '不让' }}</span>
              </td>
              <td style="font-size: 12px">{{ h.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 导出 -->
      <div class="card no-print">
        <h3>导出按客户分开的裁切清单</h3>
        <div class="row">
          <button class="btn primary" @click="exportCutLists">导出分户裁切清单 CSV</button>
          <button class="btn" @click="exportParcels">导出分户取件包 CSV</button>
          <button class="btn" @click="windowPrint()">打印视图</button>
        </div>
        <div class="card-sub">
          CSV 坐标统一 0.01mm，与预览坐标一致；每客户一段，先列分界刀（先切下整块）再列块内刀。
        </div>
      </div>
    </template>
  </div>

  <!-- 新建 / 列表 -->
  <div v-else class="stack">
    <div class="row">
      <h1 style="margin: 0">多客户合并拼版</h1>
      <span class="badge brand">几个客户凑一批纸，排完再拆回各自取件包</span>
      <div class="spacer"></div>
      <button class="btn" @click="router.push('/')">← 单客户任务</button>
    </div>

    <div v-if="error" class="note danger">{{ error }}</div>
    <div v-if="hint" class="note ok">{{ hint }}</div>

    <div class="grid sidebar">
      <div class="stack">
        <div class="card">
          <h3>① 相纸与裁切参数</h3>
          <label class="field">
            相纸
            <select v-model="draft.paperId">
              <option v-for="p in allPapers" :key="p.id" :value="p.id">
                {{ p.name }} · {{ p.wMm }}×{{ p.hMm }}mm · {{ formatCents(p.priceCents) }}/张
              </option>
              <option value="custom">自定义相纸…</option>
            </select>
          </label>
          <div v-if="draft.paperId === 'custom'" class="grid cols-2">
            <label class="field">宽 mm<input v-model.number="draft.customPaper.wMm" type="number" min="10" step="0.1" /></label>
            <label class="field">高 mm<input v-model.number="draft.customPaper.hMm" type="number" min="10" step="0.1" /></label>
            <label class="field">纸边留白 mm<input v-model.number="draft.customPaper.marginMm" type="number" min="0" step="0.5" /></label>
            <label class="field">单价（分）<input v-model.number="draft.customPaper.priceCents" type="number" min="0" step="10" /></label>
          </div>
          <div class="kv">
            <dt>尺寸</dt><dd>{{ currentPaper.wMm }} × {{ currentPaper.hMm }} mm</dd>
            <dt>单张成本</dt><dd>{{ formatCents(currentPaper.priceCents) }}</dd>
          </div>
          <label class="field">隙距 gapMm：{{ draft.gapMm }} mm
            <input v-model.number="draft.gapMm" type="range" min="0" max="10" step="0.5" />
          </label>
          <label class="field">刀宽补偿 kerfMm：{{ draft.kerfMm }} mm
            <input v-model.number="draft.kerfMm" type="range" min="0" max="3" step="0.1" />
          </label>
          <label class="field">安全边 safeEdgeMm：{{ draft.safeEdgeMm }} mm
            <input v-model.number="draft.safeEdgeMm" type="range" min="0" max="20" step="0.5" />
          </label>
          <label class="check"><input v-model="draft.allowRotate" type="checkbox" />允许整体旋转 90°</label>
          <label class="field">边角余料策略
            <select v-model="draft.handoverPolicy">
              <option value="auto">允许让给下一客户（更省纸，块仍独立可裁开）</option>
              <option value="none">客户不共纸（各占整纸，用于对比/保守）</option>
            </select>
          </label>
        </div>

        <div class="card">
          <h3>已保存合并任务（{{ mergeJobs.length }}）</h3>
          <div v-if="!mergeJobs.length" class="note">暂无合并任务</div>
          <table v-else class="data">
            <thead><tr><th>任务</th><th class="num">客户</th><th class="num">张数</th><th class="num">节省</th><th></th></tr></thead>
            <tbody>
              <tr v-for="j in mergeJobs" :key="j.id">
                <td>{{ j.name }}</td>
                <td class="num">{{ j.customers.length }}</td>
                <td class="num">{{ j.result?.stats.sheetCount ?? '—' }}</td>
                <td class="num">{{ j.result ? `${j.result.compare.savedSheets} 张` : (j.error ? '停止' : '—') }}</td>
                <td>
                  <div class="row tight">
                    <button class="btn small" @click="openJob(j.id)">打开</button>
                    <button class="btn small danger" @click="deleteMergeJob(j.id)">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <h3>
            ② 客户
            <button class="btn small" @click="addCustomer">+ 添加客户</button>
          </h3>
          <div class="card-sub">客户名称即取件包名称；颜色标记在清单、预览、导出三处一致</div>
          <div v-for="c in draft.customers" :key="c.id" class="row tight customer-row">
            <span class="cust-dot" :style="{ background: colorOf(c.id) }"></span>
            <input v-model="c.name" type="text" style="max-width: 180px" />
            <button class="btn small" @click="addRow(c.id)">+ 加照片</button>
            <button class="btn small danger" :disabled="draft.customers.length <= 1" @click="removeCustomer(c.id)">删除</button>
          </div>
        </div>

        <div class="card">
          <h3>
            ③ 照片清单
            <span class="badge">共 {{ totalQty }} 张</span>
          </h3>
          <div v-if="!draft.rows.length" class="note">还没有照片，在某个客户上点「+ 加照片」</div>
          <table v-else class="data">
            <thead>
              <tr><th>客户</th><th>照片尺寸</th><th class="num">数量</th><th>旋转</th><th>不拆散</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="r in draft.rows" :key="r.key">
                <td>
                  <span class="cust-dot" :style="{ background: colorOf(r.customerId) }"></span>
                  <select v-model="r.customerId">
                    <option v-for="c in draft.customers" :key="c.id" :value="c.id">{{ c.name }}</option>
                  </select>
                </td>
                <td>
                  <select v-model="r.sizeId">
                    <option v-for="s in allSizes" :key="s.id" :value="s.id">
                      {{ s.name }} {{ s.wMm }}×{{ s.hMm }}mm
                    </option>
                  </select>
                </td>
                <td><input v-model.number="r.copies" type="number" min="1" step="1" style="width: 70px" /></td>
                <td><input v-model="r.rotateAllowed" type="checkbox" /></td>
                <td><input v-model="r.keepTogether" type="checkbox" title="该客户的这款照片尽量不拆散" /></td>
                <td><button class="btn small danger" @click="removeRow(r.key)">删除</button></td>
              </tr>
            </tbody>
          </table>
          <div class="row" style="margin-top: 10px">
            <button class="btn small" @click="addRow()">+ 添加一行</button>
            <label class="field" style="max-width: 240px; margin-left: 12px">
              任务名称
              <input v-model="draft.name" type="text" placeholder="可留空自动命名" />
            </label>
          </div>
        </div>

        <div class="card">
          <h3>④ 合并排样并拆单</h3>
          <div class="note">
            排样保证每个客户的照片各自落在独立能裁开的块（先分界、后块内切）；
            真排不下会整批停下并点名客户，不出半成品。
          </div>
          <button class="btn primary" @click="submit">合并排样 → 预览分户与导出</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cust-dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  flex: 0 0 auto;
}
.customer-row {
  margin: 6px 0;
}
.parcel {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px;
  background: #fff;
}
.sheet-preview-row {
  margin-bottom: 18px;
}
</style>
