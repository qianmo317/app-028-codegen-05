/**
 * 客户标记的唯一配色来源：清单 / 预览 / 导出三处都通过它取色，保证颜色一致。
 * 未标注客户（旧任务）统一为中性灰。
 */
const PALETTE = [
  '#1f6feb', // 蓝
  '#1a7f4b', // 绿
  '#d97706', // 琥珀
  '#b02a8b', // 品红
  '#0e7490', // 青
  '#b42318', // 砖红
  '#6d28d9', // 紫
  '#4d7c0f', // 草绿
]

export const UNASSIGNED_COLOR = '#8a94a6'

export function customerColor(customerId: string | undefined, index = -1): string {
  if (!customerId) return UNASSIGNED_COLOR
  if (index >= 0) return PALETTE[index % PALETTE.length]
  // 由 id 稳定散列到调色板（同一客户在三处都得到同一颜色）
  let h = 0
  for (let i = 0; i < customerId.length; i++) {
    h = (h * 31 + customerId.charCodeAt(i)) >>> 0
  }
  return PALETTE[h % PALETTE.length]
}

/** 一组客户的 id → 颜色（按给定顺序，保证颜色与清单顺序对齐） */
export function customerColorMap(
  customers: Array<{ id: string }>,
): Map<string, string> {
  const m = new Map<string, string>()
  customers.forEach((c, i) => m.set(c.id, customerColor(c.id, i)))
  return m
}
