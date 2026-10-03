import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import NewTaskView from './views/NewTaskView.vue'
import LayoutView from './views/LayoutView.vue'
import CutView from './views/CutView.vue'
import ExportView from './views/ExportView.vue'
import PapersView from './views/PapersView.vue'
import SettingsView from './views/SettingsView.vue'
import MergeView from './views/MergeView.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'new', component: NewTaskView, meta: { title: '新建任务' } },
  { path: '/merge', name: 'merge-new', component: MergeView, meta: { title: '多客户合并拼版' } },
  { path: '/merge/:id', name: 'merge', component: MergeView, meta: { title: '合并拼版结果' } },
  { path: '/layout/:id', name: 'layout', component: LayoutView, meta: { title: '排样预览' } },
  { path: '/cut/:id', name: 'cut', component: CutView, meta: { title: '裁切步骤' } },
  { path: '/export/:id', name: 'export', component: ExportView, meta: { title: '导出' } },
  { path: '/papers', name: 'papers', component: PapersView, meta: { title: '相纸与照片尺寸库' } },
  { path: '/settings', name: 'settings', component: SettingsView, meta: { title: '裁切参数' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  const title = (to.meta.title as string) ?? ''
  document.title = title ? `${title} · 相纸拼版与裁切排版` : '相纸拼版与裁切排版'
})
