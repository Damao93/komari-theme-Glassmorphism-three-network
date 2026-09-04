<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Badge } from '@/components/ui/badge'
import { CardX } from '@/components/ui/card-x'
import { ProgressThin } from '@/components/ui/progress-thin'
import { useAppStore } from '@/stores/app'
import { formatBytesWithConfig } from '@/utils/helper'

const props = defineProps<{
  nodeUuid: string
}>()

interface XuiTrafficUser {
  name: string
  enabled: boolean
  up: number
  down: number
  total: number
  quota: number
}

interface XuiTrafficUserDisplay extends XuiTrafficUser {
  rank: number
  rankLabel: string
  topPercentage: number
  totalPercentage: number
  quotaPercentage: number
  quotaStatus: 'success' | 'info' | 'warning' | 'error'
  quotaTextClass: string
}

const TEBIBYTE = 1024 ** 4
const GIBIBYTE = 1024 ** 3

const DEMO_USERS: readonly XuiTrafficUser[] = [
  { name: 'demo-alpha', enabled: true, up: 620 * GIBIBYTE, down: 1.85 * TEBIBYTE, total: 2.46 * TEBIBYTE, quota: 3 * TEBIBYTE },
  { name: 'demo-bravo', enabled: true, up: 360 * GIBIBYTE, down: 1.12 * TEBIBYTE, total: 1.47 * TEBIBYTE, quota: 0 },
  { name: 'demo-charlie', enabled: true, up: 210 * GIBIBYTE, down: 730 * GIBIBYTE, total: 940 * GIBIBYTE, quota: 2 * TEBIBYTE },
  { name: 'demo-delta', enabled: false, up: 80 * GIBIBYTE, down: 240 * GIBIBYTE, total: 320 * GIBIBYTE, quota: 1 * TEBIBYTE },
]

const appStore = useAppStore()
const apiUsers = ref<XuiTrafficUser[]>([])
const loading = ref(false)
const errorMessage = ref('')
const lastUpdatedAt = ref<Date | null>(null)

let refreshTimer: ReturnType<typeof setInterval> | undefined
let requestController: AbortController | undefined
let requestSequence = 0

const isDemo = computed(() => !appStore.xuiTrafficApiUrl && appStore.xuiTrafficDemoEnabled)

const users = computed<XuiTrafficUserDisplay[]>(() => {
  const source = isDemo.value ? DEMO_USERS : apiUsers.value
  const sorted = [...source].sort((left, right) => right.total - left.total)
  const topTotal = sorted[0]?.total ?? 0
  const allTotal = sorted.reduce((sum, user) => sum + user.total, 0)

  return sorted.map((user, index) => {
    const quotaPercentage = user.quota > 0 ? user.total / user.quota * 100 : 0
    return {
      ...user,
      rank: index + 1,
      rankLabel: index < 3 ? `Top${index + 1}` : `#${index + 1}`,
      topPercentage: topTotal > 0 ? user.total / topTotal * 100 : 0,
      totalPercentage: allTotal > 0 ? user.total / allTotal * 100 : 0,
      quotaPercentage,
      quotaStatus: getQuotaStatus(quotaPercentage, user.quota),
      quotaTextClass: getQuotaTextClass(quotaPercentage, user.quota),
    }
  })
})

const allTraffic = computed(() => users.value.reduce((sum, user) => sum + user.total, 0))

const lastUpdatedText = computed(() => {
  if (!lastUpdatedAt.value)
    return ''
  return lastUpdatedAt.value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeTrafficValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return 0
  return Math.max(0, value)
}

function normalizeUser(value: unknown, index: number): XuiTrafficUser | null {
  if (!isRecord(value))
    return null

  const up = normalizeTrafficValue(value.up)
  const down = normalizeTrafficValue(value.down)
  const reportedTotal = normalizeTrafficValue(value.total)

  return {
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : `用户 ${index + 1}`,
    enabled: value.enabled === true,
    up,
    down,
    total: reportedTotal > 0 ? reportedTotal : up + down,
    quota: normalizeTrafficValue(value.quota),
  }
}

function getQuotaStatus(percentage: number, quota: number): XuiTrafficUserDisplay['quotaStatus'] {
  if (quota <= 0 || percentage < 60)
    return 'success'
  if (percentage < 80)
    return 'info'
  if (percentage < 95)
    return 'warning'
  return 'error'
}

function getQuotaTextClass(percentage: number, quota: number): string {
  if (quota <= 0)
    return 'text-muted-foreground'
  if (percentage >= 95)
    return 'text-red-500'
  if (percentage >= 80)
    return 'text-orange-500'
  if (percentage >= 60)
    return 'text-yellow-500'
  return 'text-green-600'
}

function getRankBadgeClass(rank: number): string {
  if (rank === 1)
    return 'border-amber-500/25 bg-amber-500/10 text-amber-600'
  if (rank === 2)
    return 'border-slate-500/25 bg-slate-500/10 text-slate-600 dark:text-slate-300'
  if (rank === 3)
    return 'border-orange-500/25 bg-orange-500/10 text-orange-600'
  return 'text-muted-foreground'
}

function formatTraffic(value: number): string {
  return formatBytesWithConfig(value, appStore.byteDecimals)
}

function buildApiUrl(apiUrl: string): string {
  const url = new URL(apiUrl, window.location.origin)
  url.searchParams.set('node', props.nodeUuid)
  return url.toString()
}

function clearPolling(): void {
  if (refreshTimer !== undefined) {
    clearInterval(refreshTimer)
    refreshTimer = undefined
  }
  requestController?.abort()
  requestController = undefined
}

async function fetchTrafficUsers(): Promise<void> {
  const apiUrl = appStore.xuiTrafficApiUrl
  if (!apiUrl)
    return

  const sequence = ++requestSequence
  requestController?.abort()
  requestController = new AbortController()
  loading.value = apiUsers.value.length === 0
  errorMessage.value = ''

  try {
    const response = await fetch(buildApiUrl(apiUrl), {
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: requestController.signal,
    })
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`)

    const payload: unknown = await response.json()
    if (!isRecord(payload) || !Array.isArray(payload.users))
      throw new Error('响应格式无效')

    const normalizedUsers = payload.users
      .map((user, index) => normalizeUser(user, index))
      .filter((user): user is XuiTrafficUser => user !== null)

    if (sequence !== requestSequence)
      return

    apiUsers.value = normalizedUsers
    lastUpdatedAt.value = new Date()
  }
  catch (error) {
    if (sequence !== requestSequence || (error instanceof DOMException && error.name === 'AbortError'))
      return
    errorMessage.value = error instanceof Error ? error.message : '未知错误'
  }
  finally {
    if (sequence === requestSequence)
      loading.value = false
  }
}

function restartPolling(): void {
  clearPolling()
  requestSequence += 1
  apiUsers.value = []
  lastUpdatedAt.value = null
  errorMessage.value = ''
  loading.value = false

  if (!appStore.xuiTrafficApiUrl)
    return

  void fetchTrafficUsers()
  refreshTimer = setInterval(() => {
    void fetchTrafficUsers()
  }, appStore.xuiTrafficRefreshInterval * 1000)
}

watch(
  () => [appStore.xuiTrafficApiUrl, appStore.xuiTrafficRefreshInterval, props.nodeUuid] as const,
  restartPolling,
  { immediate: true },
)

onBeforeUnmount(clearPolling)
</script>

<template>
  <div>
    <CardX
      size="small"
      class="bg-background/50 border-none rounded-md hover:bg-background transition-all"
      content-class="space-y-3"
    >
      <template #header>
        <div class="flex min-w-0 items-center gap-2">
          <Icon icon="tabler:users-group" :width="16" :height="16" class="shrink-0 text-muted-foreground" />
          <span class="truncate font-medium">3x-ui 用户流量</span>
          <Badge v-if="isDemo" variant="outline" class="border-amber-500/25 bg-amber-500/10 text-amber-600">
            演示数据
          </Badge>
          <Badge v-else-if="errorMessage" variant="destructive">
            更新失败
          </Badge>
        </div>
      </template>

      <template #header-extra>
        <div v-if="users.length" class="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
          <span>{{ users.length }} 位用户</span>
          <span class="hidden sm:inline">共 {{ formatTraffic(allTraffic) }}</span>
          <span v-if="lastUpdatedText" class="hidden md:inline">{{ lastUpdatedText }} 更新</span>
        </div>
      </template>

      <div v-if="loading" class="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Icon icon="tabler:loader-2" :width="18" :height="18" class="animate-spin" />
        正在读取用户流量
      </div>

      <div v-else-if="!users.length" class="flex min-h-28 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <Icon :icon="errorMessage ? 'tabler:alert-circle' : 'tabler:database-off'" :width="22" :height="22" />
        <span v-if="errorMessage">无法读取脱敏中转 API：{{ errorMessage }}</span>
        <span v-else-if="!appStore.xuiTrafficApiUrl">尚未配置脱敏中转 API URL，演示模式已关闭</span>
        <span v-else>API 暂无用户流量数据</span>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="user in users"
          :key="`${user.rank}-${user.name}`"
          class="rounded-md bg-slate-500/5 p-3 hover:bg-background transition-colors"
        >
          <div class="flex min-w-0 items-center gap-2">
            <Badge variant="outline" class="tabular-nums" :class="getRankBadgeClass(user.rank)">
              {{ user.rankLabel }}
            </Badge>
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ user.name }}</span>
            <Badge
              :variant="user.enabled ? 'outline' : 'secondary'"
              :class="user.enabled ? 'border-emerald-500/25 text-emerald-600' : 'text-muted-foreground'"
            >
              {{ user.enabled ? '启用' : '停用' }}
            </Badge>
            <span class="shrink-0 text-xs text-muted-foreground tabular-nums">
              占全部 {{ user.totalPercentage.toFixed(1) }}%
            </span>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div class="min-w-0 rounded-md bg-background/50 p-2">
              <div class="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Icon icon="tabler:arrow-up" :width="12" :height="12" class="text-green-600" />
                上传
              </div>
              <div class="mt-1 truncate text-xs font-medium tabular-nums">
                {{ formatTraffic(user.up) }}
              </div>
            </div>
            <div class="min-w-0 rounded-md bg-background/50 p-2">
              <div class="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Icon icon="tabler:arrow-down" :width="12" :height="12" class="text-blue-600" />
                下载
              </div>
              <div class="mt-1 truncate text-xs font-medium tabular-nums">
                {{ formatTraffic(user.down) }}
              </div>
            </div>
            <div class="col-span-2 min-w-0 rounded-md bg-background/50 p-2">
              <div class="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>已用 / 配额</span>
                <span v-if="user.quota > 0" class="tabular-nums" :class="user.quotaTextClass">
                  {{ user.quotaPercentage.toFixed(1) }}%
                </span>
                <span v-else>∞ / 不限流量</span>
              </div>
              <div class="mt-1 truncate text-xs font-medium tabular-nums" :class="user.quotaTextClass">
                {{ formatTraffic(user.total) }} / {{ user.quota > 0 ? formatTraffic(user.quota) : '∞' }}
              </div>
            </div>
          </div>

          <div class="mt-3 space-y-1">
            <div class="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>相对于当前 Top1 使用量</span>
              <span class="tabular-nums">{{ user.topPercentage.toFixed(1) }}%</span>
            </div>
            <ProgressThin :percentage="user.topPercentage" :status="user.quotaStatus" :height="4" />
          </div>
        </div>
      </div>
    </CardX>
  </div>
</template>
