<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Paper, Placement, Sheet } from '../logic/types'

const props = withDefaults(
  defineProps<{
    sheet: Sheet
    paper: Paper
    safeEdgeMm?: number
    scale?: number
    unit?: 'px' | 'mm'
    showCuts?: boolean
    showNumbers?: boolean
    showGrid?: boolean
    showSafeArea?: boolean
    showCutLabels?: boolean
    highlight?: number
    doneCount?: number
    draggable?: boolean
    invalid?: boolean
    headerText?: string
    footerText?: string
    thumbOf?: (p: Placement) => string | undefined
    labelOf?: (itemId: string) => string
    customerColorOf?: (customerId?: string) => string | undefined
    customerNameOf?: (customerId?: string) => string
    /** 多客户合并：该纸上的客户块（来自引擎推导，含整块含边角的精确边界） */
    blocks?: Array<{ id: string; customerId: string; x: number; y: number; w: number; h: number }>
    showBlocks?: boolean
    showBoundaryCuts?: boolean
  }>(),
  {
    safeEdgeMm: 3,
    scale: 2,
    unit: 'px',
    showCuts: true,
    showNumbers: true,
    showGrid: true,
    showSafeArea: true,
    showCutLabels: false,
    highlight: -1,
    doneCount: -1,
    draggable: false,
    invalid: false,
    headerText: '',
    footerText: '',
    thumbOf: undefined,
    labelOf: undefined,
    customerColorOf: undefined,
    customerNameOf: undefined,
    blocks: undefined,
    showBlocks: false,
    showBoundaryCuts: false,
  },
)

const emit = defineEmits<{
  (e: 'move', payload: { seq: number; x: number; y: number }): void
  (e: 'moveend', payload: { seq: number; x: number; y: number }): void
  (e: 'select', seq: number): void
}>()

const u = (mm: number) => (props.unit === 'mm' ? `${mm}mm` : `${mm * props.scale}px`)
const hair = computed(() => (props.unit === 'mm' ? '0.15mm' : '1px'))
const cutW = computed(() => (props.unit === 'mm' ? '0.22mm' : '1.5px'))
const textSm = computed(() => (props.unit === 'mm' ? '2.5mm' : '10px'))
const textXs = computed(() => (props.unit === 'mm' ? '2.1mm' : '9px'))

const inset = computed(() => props.paper.marginMm + props.safeEdgeMm)
const usableW = computed(() => Math.max(0, props.paper.wMm - 2 * inset.value))
const usableH = computed(() => Math.max(0, props.paper.hMm - 2 * inset.value))

const paperStyle = computed(() => ({
  width: u(props.paper.wMm),
  height: u(props.paper.hMm),
}))

const gridStyle = computed(() => {
  const t = hair.value
  const minor = u(10)
  const major = u(50)
  return {
    backgroundImage: [
      `repeating-linear-gradient(to right, #eef1f6 0 ${t}, transparent ${t} ${minor})`,
      `repeating-linear-gradient(to bottom, #eef1f6 0 ${t}, transparent ${t} ${minor})`,
      `repeating-linear-gradient(to right, #dde4ee 0 ${t}, transparent ${t} ${major})`,
      `repeating-linear-gradient(to bottom, #dde4ee 0 ${t}, transparent ${t} ${major})`,
    ].join(','),
  }
})

const safeStyle = computed(() => ({
  left: u(inset.value),
  top: u(inset.value),
  width: u(usableW.value),
  height: u(usableH.value),
  borderWidth: props.unit === 'mm' ? '0.15mm' : '1px',
}))

function phStyle(p: Placement) {
  const color = props.customerColorOf?.(p.customerId)
  return {
    left: u(p.x),
    top: u(p.y),
    width: u(p.w),
    height: u(p.h),
    borderWidth: props.unit === 'mm' ? '0.2mm' : '1px',
    borderColor: color ?? undefined,
    background: color ? `${color}22` : undefined,
  }
}

function customerTag(p: Placement) {
  return props.customerNameOf ? props.customerNameOf(p.customerId) : ''
}

/** 块矩形（多客户合并拼版时画出客户分界）；边界直接取引擎推导值，保证预览与导出一致 */
const blockRects = computed<BlockRect[]>(() => {
  if (!props.showBlocks || !props.blocks) return []
  return props.blocks.map((b) => ({
    id: b.id,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    customerId: b.customerId,
    color: props.customerColorOf?.(b.customerId),
  }))
})

interface BlockRect {
  id: string
  x: number
  y: number
  w: number
  h: number
  customerId: string
  color?: string
}

function blockStyle(b: BlockRect) {
  return {
    left: u(b.x),
    top: u(b.y),
    width: u(b.w),
    height: u(b.h),
    borderColor: b.color ?? '#e53935',
    borderWidth: props.unit === 'mm' ? '0.5mm' : '2.5px',
  }
}

function cutStyle(c: Sheet['cutSteps'][number], index: number) {
  const active = props.highlight === index
  const done = props.doneCount >= 0 && index < props.doneCount
  const boundary = props.showBoundaryCuts && c.role === 'boundary'
  const color = boundary ? '#e53935' : active ? '#e53935' : done ? '#1a7f4b' : '#9aa6b4'
  const base: Record<string, string> = {
    background: color,
    zIndex: active || boundary ? '6' : '3',
  }
  if (boundary) {
    base.boxShadow = '0 0 0 1px rgba(229,57,53,0.25)'
  }
  if (c.axis === 'v') {
    base.left = u(c.at)
    base.top = u(c.from)
    base.width = boundary && props.unit === 'px' ? '3px' : cutW.value
    base.height = u(c.to - c.from)
  } else {
    base.top = u(c.at)
    base.left = u(c.from)
    base.height = boundary && props.unit === 'px' ? '3px' : cutW.value
    base.width = u(c.to - c.from)
  }
  return base
}

function cutLabelStyle(c: Sheet['cutSteps'][number]) {
  if (c.axis === 'v') {
    return {
      left: u(c.at),
      top: u((c.from + c.to) / 2),
      transform: 'translate(-50%, -50%)',
      fontSize: textXs.value,
    }
  }
  return {
    left: u((c.from + c.to) / 2),
    top: u(c.at),
    transform: 'translate(-50%, -50%)',
    fontSize: textXs.value,
  }
}

const dragSeq = ref(-1)
let startX = 0
let startY = 0
let originX = 0
let originY = 0

function onPointerDown(ev: PointerEvent, p: Placement) {
  if (!props.draggable || props.unit !== 'px') return
  ev.preventDefault()
  const el = ev.currentTarget as HTMLElement
  el.setPointerCapture(ev.pointerId)
  dragSeq.value = p.seq
  startX = ev.clientX
  startY = ev.clientY
  originX = p.x
  originY = p.y
  emit('select', p.seq)
}

function onPointerMove(ev: PointerEvent) {
  if (dragSeq.value < 0) return
  emit('move', {
    seq: dragSeq.value,
    x: originX + (ev.clientX - startX) / props.scale,
    y: originY + (ev.clientY - startY) / props.scale,
  })
}

function onPointerUp() {
  if (dragSeq.value < 0) return
  const p = props.sheet.placements.find((x) => x.seq === dragSeq.value)
  const seq = dragSeq.value
  dragSeq.value = -1
  if (p) emit('moveend', { seq, x: p.x, y: p.y })
}

const headerFontSize = computed(() => {
  const mm = Math.max(1.5, Math.min(4, props.paper.marginMm * 0.5))
  return props.unit === 'mm' ? `${mm}mm` : `${mm * props.scale}px`
})

const showDetail = computed(() => props.scale >= 1.6 || props.unit === 'mm')
</script>

<template>
  <div class="sheet-canvas" :style="paperStyle">
    <div class="sheet-grid" :style="gridStyle"></div>
    <div v-if="showSafeArea" class="sheet-safe" :style="safeStyle"></div>

    <div
      v-if="headerText"
      class="cut-label"
      :style="{
        left: '50%',
        top: u(paper.marginMm / 2),
        transform: 'translate(-50%, -50%)',
        fontSize: headerFontSize,
      }"
    >
      {{ headerText }}
    </div>
    <div
      v-if="footerText"
      class="cut-label"
      :style="{
        left: '50%',
        top: u(paper.hMm - paper.marginMm / 2),
        transform: 'translate(-50%, -50%)',
        fontSize: headerFontSize,
      }"
    >
      {{ footerText }}
    </div>

    <!-- 客户块分界（多客户合并拼版）：虚线框 = 独立能裁开的一块 -->
    <div
      v-for="b in blockRects"
      :key="`blk${b.id}`"
      class="customer-block"
      :style="blockStyle(b)"
    >
      <span class="block-tag" :style="{ fontSize: textXs, color: b.color }">{{ b.id }}</span>
    </div>

    <div
      v-for="p in sheet.placements"
      :key="p.seq"
      class="ph"
      :class="{ draggable, invalid, dragging: dragSeq === p.seq }"
      :style="phStyle(p)"
      @pointerdown="onPointerDown($event, p)"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <img v-if="thumbOf && thumbOf(p)" :src="thumbOf(p)" alt="" draggable="false" />
      <template v-if="showNumbers">
        <span class="ph-no" :style="{ fontSize: textSm }">#{{ p.seq }}</span>
        <span v-if="customerTag(p)" class="ph-cust" :style="{ fontSize: textXs, color: customerColorOf?.(p.customerId) }"
          >{{ customerTag(p) }}</span
        >
        <span v-if="showDetail" class="ph-dim" :style="{ fontSize: textXs }">
          {{ p.w.toFixed(0) }}×{{ p.h.toFixed(0) }}<template v-if="p.rotated">↻</template>
        </span>
      </template>
    </div>

    <template v-if="showCuts">
      <div
        v-for="(c, i) in sheet.cutSteps"
        :key="`c${i}`"
        class="cutline"
        :class="{ hl: highlight === i, done: doneCount >= 0 && i < doneCount }"
        :style="cutStyle(c, i)"
      ></div>
      <template v-if="showCutLabels">
        <div v-for="(c, i) in sheet.cutSteps" :key="`l${i}`" class="cut-label" :style="cutLabelStyle(c)">
          {{ i + 1 }}
        </div>
      </template>
    </template>
  </div>
</template>
