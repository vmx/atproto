import * as http from 'node:http'
import { AddressInfo } from 'node:net'
import { LexFloat } from '@atproto/lex-data'
import { l } from '@atproto/lex-schema'
import { createServer as createXrpcServer } from '../src'
import { closeServer, createServer } from './_util'

// Verifies that the schema-aware xrpc-server path threads
// `floatPreservingReviver` into body-parser's `json()`, so that a JSON source
// like `65.0` lands in the handler as a `LexFloat(65)` rather than collapsing
// to a bare integer.

const procedure = l.procedure(
  'io.example.floatPing',
  l.params(),
  l.payload(
    'application/json',
    l.object({
      value: l.float(),
    }),
  ),
  l.payload('application/json', l.object({ ok: l.boolean() })),
)

describe('schema-aware xrpc-server preserves float intent at JSON ingress', () => {
  let s: http.Server
  let url: string
  let received: unknown

  beforeAll(async () => {
    const server = createXrpcServer()
    server.add(procedure, async ({ input }) => {
      received = input.body.value
      return { encoding: 'application/json', body: { ok: true } }
    })
    s = await createServer(server)
    const { port } = s.address() as AddressInfo
    url = `http://localhost:${port}`
  })

  afterAll(async () => {
    if (s) await closeServer(s)
  })

  test('wraps JSON `65.0` as LexFloat(65)', async () => {
    received = undefined
    const res = await fetch(`${url}/xrpc/io.example.floatPing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"value":65.0}',
    })
    expect(res.status).toBe(200)
    expect(received).toBeInstanceOf(LexFloat)
    expect((received as LexFloat).value).toBe(65)
  })

  test('leaves JSON `65` as a bare number', async () => {
    received = undefined
    const res = await fetch(`${url}/xrpc/io.example.floatPing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"value":65}',
    })
    expect(res.status).toBe(200)
    expect(received).toBe(65)
  })

  test('wraps JSON `1e2` as LexFloat(100)', async () => {
    received = undefined
    const res = await fetch(`${url}/xrpc/io.example.floatPing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"value":1e2}',
    })
    expect(res.status).toBe(200)
    expect(received).toBeInstanceOf(LexFloat)
    expect((received as LexFloat).value).toBe(100)
  })
})
