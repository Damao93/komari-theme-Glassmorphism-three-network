import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DEFAULT_CONFIG_PATH = '/run/secrets/xui-sources.json'
const DEFAULT_PORT = 3000
const DEFAULT_CACHE_TTL_SECONDS = 30
const DEFAULT_UPSTREAM_TIMEOUT_SECONDS = 10

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toNonNegativeNumber(value) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function parseClientStats(value) {
  if (Array.isArray(value))
    return value

  if (typeof value !== 'string')
    return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

export function normalizeXuiUsers(payload) {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.obj))
    throw new Error('3x-ui returned an unexpected response')

  const usersByName = new Map()

  for (const inbound of payload.obj) {
    if (!isRecord(inbound))
      continue

    const inboundEnabled = inbound.enable !== false
    for (const rawStat of parseClientStats(inbound.clientStats)) {
      if (!isRecord(rawStat))
        continue

      const name = typeof rawStat.email === 'string' ? rawStat.email.trim() : ''
      if (!name)
        continue

      const up = toNonNegativeNumber(rawStat.up)
      const down = toNonNegativeNumber(rawStat.down)
      const quota = toNonNegativeNumber(rawStat.total)
      const existing = usersByName.get(name) ?? {
        name,
        enabled: false,
        up: 0,
        down: 0,
        total: 0,
        quota: 0,
      }

      existing.enabled ||= inboundEnabled && rawStat.enable !== false
      existing.up += up
      existing.down += down
      existing.total += up + down
      existing.quota += quota
      usersByName.set(name, existing)
    }
  }

  return [...usersByName.values()].sort((left, right) => right.total - left.total)
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function validateSource(nodeUuid, value, allowInsecureUpstream) {
  if (!isRecord(value))
    throw new Error(`Source ${nodeUuid} must be an object`)

  if (typeof value.url !== 'string' || !value.url.trim())
    throw new Error(`Source ${nodeUuid} is missing url`)
  if (typeof value.token !== 'string' || !value.token.trim())
    throw new Error(`Source ${nodeUuid} is missing token`)

  const url = new URL(value.url)
  if (url.username || url.password)
    throw new Error(`Source ${nodeUuid} URL must not contain credentials`)
  if (url.protocol !== 'https:' && !(allowInsecureUpstream && url.protocol === 'http:'))
    throw new Error(`Source ${nodeUuid} must use HTTPS`)

  return {
    token: value.token.trim(),
    url: url.toString(),
  }
}

export async function loadSources(configPath, allowInsecureUpstream = false) {
  const rawConfig = await readFile(configPath, 'utf8')
  const parsedConfig = JSON.parse(rawConfig)
  if (!isRecord(parsedConfig) || Object.keys(parsedConfig).length === 0)
    throw new Error('xui-sources.json must contain at least one node source')

  return new Map(
    Object.entries(parsedConfig).map(([nodeUuid, source]) => [
      nodeUuid,
      validateSource(nodeUuid, source, allowInsecureUpstream),
    ]),
  )
}

function writeJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(data))
}

export function createRelayServer(options) {
  const {
    allowedOrigin,
    cacheTtlMs,
    sources,
    upstreamTimeoutMs,
  } = options
  const cache = new Map()
  const pendingRequests = new Map()

  async function fetchUsers(nodeUuid, source) {
    const cached = cache.get(nodeUuid)
    if (cached && cached.expiresAt > Date.now())
      return cached.users

    const pending = pendingRequests.get(nodeUuid)
    if (pending)
      return pending

    const request = (async () => {
      const upstreamResponse = await fetch(source.url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${source.token}`,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(upstreamTimeoutMs),
      })

      if (!upstreamResponse.ok)
        throw new Error(`3x-ui request failed with HTTP ${upstreamResponse.status}`)

      const users = normalizeXuiUsers(await upstreamResponse.json())
      cache.set(nodeUuid, {
        expiresAt: Date.now() + cacheTtlMs,
        users,
      })
      return users
    })()

    pendingRequests.set(nodeUuid, request)
    try {
      return await request
    }
    finally {
      pendingRequests.delete(nodeUuid)
    }
  }

  return createHttpServer(async (request, response) => {
    const origin = request.headers.origin
    if (allowedOrigin && origin === allowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', allowedOrigin)
      response.setHeader('Vary', 'Origin')
    }
    else if (allowedOrigin && origin && origin !== allowedOrigin) {
      writeJson(response, 403, { error: 'Origin is not allowed' })
      return
    }

    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Headers', 'Accept')
      response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      response.writeHead(204)
      response.end()
      return
    }

    const requestUrl = new URL(request.url ?? '/', 'http://relay.local')
    if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method !== 'GET' || requestUrl.pathname !== '/api/xui-traffic') {
      writeJson(response, 404, { error: 'Not found' })
      return
    }

    const nodeUuid = requestUrl.searchParams.get('node')?.trim() ?? ''
    const source = sources.get(nodeUuid)
    if (!nodeUuid || !source) {
      writeJson(response, 404, { error: 'No 3x-ui source is configured for this node' })
      return
    }

    try {
      writeJson(response, 200, { users: await fetchUsers(nodeUuid, source) })
    }
    catch {
      writeJson(response, 502, { error: 'Unable to read this node from 3x-ui' })
    }
  })
}

async function main() {
  const configPath = process.env.XUI_SOURCES_FILE || DEFAULT_CONFIG_PATH
  const port = readPositiveInteger(process.env.PORT, DEFAULT_PORT)
  const cacheTtlMs = readPositiveInteger(process.env.CACHE_TTL_SECONDS, DEFAULT_CACHE_TTL_SECONDS) * 1000
  const upstreamTimeoutMs = readPositiveInteger(process.env.UPSTREAM_TIMEOUT_SECONDS, DEFAULT_UPSTREAM_TIMEOUT_SECONDS) * 1000
  const allowInsecureUpstream = process.env.ALLOW_INSECURE_UPSTREAM === 'true'
  const sources = await loadSources(configPath, allowInsecureUpstream)
  const server = createRelayServer({
    allowedOrigin: process.env.ALLOWED_ORIGIN?.trim() || '',
    cacheTtlMs,
    sources,
    upstreamTimeoutMs,
  })

  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`3x-ui traffic relay listening on port ${port}\n`)
  })

  const shutdown = () => server.close(() => process.exit(0))
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
