#!/usr/bin/env node
// Demo: same float round-trip as `demo.mjs`, but driven by an actual lexicon
// JSON file and using the higher-level `@atproto/lex` `Client.create(schema,
// input)` API.
//
// The user passes plain JS numbers — no `LexFloat` anywhere. The schema is
// loaded from disk, then `client.create` runs the input through
// `schema.parse(...)`, which walks the schema tree and coerces bare numbers
// at float-typed paths into `LexFloat` instances. From there the existing
// pipeline (`lexStringify` emits `65.0`, the PDS reviver re-wraps, the CBOR
// encoder writes float64) takes over.
//
// Usage:
//
//   node examples/floats/demo-lex.mjs \
//     <pds-url> <handle-or-email> <password>

import fs from 'node:fs'
import { Client } from '@atproto/lex'
import { encode } from '@atproto/lex-cbor'
import { cidForCbor } from '@atproto/lex-data'
import {
  LexiconIterableIndexer,
  LexiconSchemaBuilder,
  lexiconDocumentSchema,
} from '@atproto/lex-document'
import { lexStringify } from '@atproto/lex-json'
import { PasswordSession } from '@atproto/lex-password-session'

// Same Node-21 floor as `demo.mjs` — the float-preserving JSON reviver needs
// the ES2023 three-arg reviver (`context.source`).
const [nodeMajor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 21) {
  console.error(
    `This demo requires Node.js 21+ (running ${process.versions.node}).`,
  )
  process.exit(1)
}

const [pdsUrl, identifier, password] = process.argv.slice(2)
if (!pdsUrl || !identifier || !password) {
  console.error(
    'Usage: node demo-lex.mjs <pds-url> <handle-or-email> <password>',
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. Load and validate the lexicon document.
// ---------------------------------------------------------------------------
const lexiconUrl = new URL(
  './lexicons/cx/vmx/dev/tmp004/floats.json',
  import.meta.url,
)
const lexiconDoc = lexiconDocumentSchema.parse(
  JSON.parse(fs.readFileSync(lexiconUrl, 'utf8')),
)
console.log(`Loaded lexicon ${lexiconDoc.id} from ${lexiconUrl.pathname}`)
console.log(JSON.stringify(lexiconDoc, null, 2))
console.log()

// ---------------------------------------------------------------------------
// 2. Build a runtime RecordSchema directly from the lexicon document. No
//    codegen step — the JSON file is the only source of truth.
// ---------------------------------------------------------------------------
const indexer = new LexiconIterableIndexer([lexiconDoc])
const recordSchema = await LexiconSchemaBuilder.build(
  indexer,
  `${lexiconDoc.id}#main`,
)

// ---------------------------------------------------------------------------
// 3. The input. Plain JS numbers — `humidity: 65` and `temperature: 20` are
//    integer-valued numbers sitting at float-typed fields. The schema's
//    parse-mode coercion (run by `client.create`) wraps them in `LexFloat`
//    automatically, so they hit the JSON wire as `65.0` / `20.0`.
// ---------------------------------------------------------------------------
const input = {
  temperature: 20,
  humidity: 65,
  sampleCount: 100,
  label: 'demo reading',
}

console.log('Input (plain JS numbers, no LexFloat):')
console.log(JSON.stringify(input, null, 2))
console.log()

// ---------------------------------------------------------------------------
// 4. Compute the two reference CIDs locally so we can compare against what
//    the server returns. `schema.coerce(...)` is the same wire-form
//    transformation `client.create` runs internally (when
//    `validateRequest: false`, the default — coerce always, validate on
//    opt-in). It wraps bare numbers at float-typed paths in `LexFloat`
//    while leaving everything else alone.
// ---------------------------------------------------------------------------
const coercedRecord = recordSchema.coerce({
  $type: lexiconDoc.id,
  ...input,
})

const plainRecord = recordSchema.build(input) // build = no coercion

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')
}

function countByte(bytes, byte) {
  let n = 0
  for (const b of bytes) if (b === byte) n++
  return n
}

const floatBytes = encode(coercedRecord)
const plainBytes = encode(plainRecord)

const floatCid = (await cidForCbor(floatBytes)).toString()
const plainCid = (await cidForCbor(plainBytes)).toString()

console.log(`Schema-aware bytes  (${floatBytes.length} bytes):`)
console.log(`  ${hex(floatBytes)}`)
console.log(
  `  0xfb (CBOR float64) markers: ${countByte(floatBytes, 0xfb)} (expected 2)`,
)
console.log(`  CID: ${floatCid}`)
console.log()
console.log(`Plain bytes         (${plainBytes.length} bytes):`)
console.log(`  ${hex(plainBytes)}`)
console.log(
  `  0xfb (CBOR float64) markers: ${countByte(plainBytes, 0xfb)} (expected 0)`,
)
console.log(`  CID: ${plainCid}`)
console.log()

// ---------------------------------------------------------------------------
// 5. Log in to the PDS and push the record via `Client.create(schema, input)`.
//    The user passes the input as-is — `client.create` runs `schema.parse`
//    internally to coerce float fields before sending.
// ---------------------------------------------------------------------------
let session
try {
  session = await PasswordSession.login({
    service: pdsUrl,
    identifier,
    password,
  })
} catch (err) {
  console.log(`Login failed: ${err?.message ?? err}`)
  process.exit(1)
}
console.log(`Logged in as ${session.handle} (${session.did})`)

const client = new Client(session)

// Preview the JSON body that will go on the wire. `lexStringify` is what the
// XRPC layer uses, so this string is bit-exact with the request body.
const wireBody = lexStringify({
  repo: session.did,
  collection: lexiconDoc.id,
  record: coercedRecord,
})
console.log('Request body (application/json):')
console.log(`  ${wireBody}`)
console.log()

let serverResult
try {
  serverResult = await client.create(recordSchema, input)
} catch (err) {
  console.log()
  console.log(`Server rejected the write: ${err?.message ?? err}`)
  await session.logout().catch(() => {})
  process.exit(1)
}

console.log()
console.log(`Server wrote record: ${serverResult.uri}`)
console.log(`Server CID: ${serverResult.cid}`)

if (serverResult.cid === floatCid) {
  console.log()
  console.log(
    '✓ Server CID matches the schema-aware local encoding. The schema',
  )
  console.log(
    '  coerced the bare JS numbers to floats, the PDS parsed them as such,',
  )
  console.log('  and they were stored as CBOR float64.')
} else if (serverResult.cid === plainCid) {
  console.log()
  console.log(
    '• Server CID matches the plain local encoding. Something in the chain',
  )
  console.log(
    '  collapsed the floats back to integers — likely an older lex-json',
  )
  console.log('  without the float-preserving reviver on the PDS.')
} else {
  console.log()
  console.log(
    '? Server CID does not match either local encoding. The PDS may apply',
  )
  console.log('  additional transformations before storage.')
}

await session.logout().catch(() => {})
