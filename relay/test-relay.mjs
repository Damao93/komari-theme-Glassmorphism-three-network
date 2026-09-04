import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { createRelayServer, normalizeXuiUsers } from './server.mjs'

const UNEXPECTED_RESPONSE_PATTERN = /unexpected response/

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Server did not expose a TCP address')
  return `http://127.0.0.1:${address.port}`
}

test('normalizes, merges, and sorts client traffic without leaking extra fields', () => {
  const users = normalizeXuiUsers({
    success: true,
    obj: [
      {
        enable: true,
        clientStats: [
          { email: 'alice', enable: true, up: 100, down: 300, total: 1000, id: 'secret-id' },
          { email: 'bob', enable: false, up: '25', down: '25', total: 0 },
        ],
      },
      {
        enable: true,
        clientStats: JSON.stringify([
          { email: 'alice', enable: true, up: 50, down: 50, total: 500 },
        ]),
      },
    ],
  })

  assert.deepEqual(users, [
    { name: 'alice', enabled: true, up: 150, down: 350, total: 500, quota: 1500 },
    { name: 'bob', enabled: false, up: 25, down: 25, total: 50, quota: 0 },
  ])
  assert.equal('id' in users[0], false)
})

test('rejects unsuccessful 3x-ui responses', () => {
  assert.throws(
    () => normalizeXuiUsers({ success: false, obj: [] }),
    UNEXPECTED_RESPONSE_PATTERN,
  )
})

test('selects the 3x-ui source by Komari node UUID', async () => {
  const upstream = createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer server-only-token')
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      success: true,
      obj: [{ clientStats: [{ email: 'node-user', up: 10, down: 20, total: 100 }] }],
    }))
  })
  const upstreamUrl = await listen(upstream)
  const relay = createRelayServer({
    allowedOrigin: '',
    cacheTtlMs: 30_000,
    sources: new Map([
      ['node-a', { url: upstreamUrl, token: 'server-only-token' }],
    ]),
    upstreamTimeoutMs: 5_000,
  })
  const relayUrl = await listen(relay)

  try {
    const response = await fetch(`${relayUrl}/api/xui-traffic?node=node-a`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      users: [{ name: 'node-user', enabled: true, up: 10, down: 20, total: 30, quota: 100 }],
    })

    const unknownResponse = await fetch(`${relayUrl}/api/xui-traffic?node=node-b`)
    assert.equal(unknownResponse.status, 404)
  }
  finally {
    relay.close()
    upstream.close()
  }
})
