#!/usr/bin/env node
// Demo: build an atproto record whose lexicon declares two float fields, and
// verify end-to-end that integer-valued numbers at float fields are serialised
// as 8-byte IEEE-754 CBOR floats (rather than 1-byte CBOR integers).
//
// The lexicon lives only in this script — it is not published to the target
// PDS. Float intent crosses the wire through the JSON textual form: the
// client wraps float-typed fields in `LexFloat`, and the JSON serialiser
// emits those with a forced decimal point (`65.0`). The PDS's
// float-preserving reviver sees the `.` and re-wraps, so the CBOR encoder on
// the server emits float64 without needing the lexicon.
//
// Usage:
//
//   node examples/floats/demo.mjs \
//     <pds-url> <handle-or-email> <password>
//
// Example:
//
//   node examples/floats/demo.mjs \
//     https://bsky.social alice.bsky.social hunter2
//
// The script reports which encoding the server used by comparing the returned
// CID against a locally computed CID.

import { Client } from '@atproto/lex-client'
import { encode } from '@atproto/lex-cbor'
import { LexFloat, cidForCbor } from '@atproto/lex-data'
import { lexStringify } from '@atproto/lex-json'
import { PasswordSession } from '@atproto/lex-password-session'

// The PDS uses the source-aware `JSON.parse` reviver to wrap float-typed
// numbers. That third-argument form is ES2023 (V8 11.3 / Node 21+); on older
// runtimes the reviver silently degrades to a no-op and the server collapses
// `65.0` back to an integer, defeating the whole point of this demo.
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
    'Usage: node demo.mjs <pds-url> <handle-or-email> <password>',
  )
  process.exit(1)
}

// `humidity: 65` is the interesting case: an integer-valued number sitting at
// a float-typed field. Wrapping the value in `LexFloat` carries the int/float
// distinction through to the JSON wire (forced `.0`) and into CBOR (8-byte
// float64). Plain encoding would emit them as CBOR uint.
const record = {
  $type: 'cx.vmx.dev.tmp004.floats',
  temperature: 20,
  humidity: 65,
  sampleCount: 100,
  label: 'demo reading',
}

const hintedRecord = {
  ...record,
  temperature: new LexFloat(record.temperature),
  humidity: new LexFloat(record.humidity),
}

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')
}

function countByte(bytes, byte) {
  let n = 0
  for (const b of bytes) if (b === byte) n++
  return n
}

// ---------------------------------------------------------------------------
// 1. Encode the record locally, two ways.
// ---------------------------------------------------------------------------
const floatBytes = encode(hintedRecord)
const plainBytes = encode(record)

const floatCid = (await cidForCbor(floatBytes)).toString()
const plainCid = (await cidForCbor(plainBytes)).toString()

console.log('Record:')
console.log(JSON.stringify(record, null, 2))
console.log()
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
// 2. Log in to the target PDS and push the record via the atproto SDK.
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

// Preview the exact JSON body `client.createRecord` will send. `lex-client`
// builds the XRPC payload as `{ repo, collection, record, ... }` and
// serialises it with `lexStringify` (see `xrpcProcedureInput` in
// packages/lex/lex-client/src/xrpc.ts) — the same function used here, so
// this string is bit-exact with what goes over the wire.
const wireBody = lexStringify({
  repo: session.did,
  collection: hintedRecord.$type,
  record: hintedRecord,
})
console.log('Request body (application/json):')
console.log(`  ${wireBody}`)
console.log()

// Send the hinted record: the JSON serialiser emits float fields with a
// forced decimal point, so the PDS reviver tags them as floats before the
// record hits the CBOR encoder.
let serverResult
try {
  const response = await client.createRecord(hintedRecord)
  serverResult = response.body
} catch (err) {
  console.log()
  console.log(`Server rejected the write: ${err?.message ?? err}`)
  console.log(
    'Hint: if the record contains non-integer values (e.g. 3.14) and the PDS',
  )
  console.log(
    'does not know the lexicon, its fallback encoder will reject it.',
  )
  await session.logout().catch(() => {})
  process.exit(1)
}

console.log()
console.log(`Server wrote record: ${serverResult.uri}`)
console.log(`Server CID: ${serverResult.cid}`)

if (serverResult.cid === floatCid) {
  console.log()
  console.log(
    '✓ Server CID matches the float-hinted local encoding. The PDS parsed',
  )
  console.log(
    '  the decimal-pointed JSON numbers as floats and stored them as CBOR',
  )
  console.log('  float64.')
} else if (serverResult.cid === plainCid) {
  console.log()
  console.log(
    '• Server CID matches the plain local encoding. The PDS collapsed the',
  )
  console.log(
    '  float-hinted JSON back to integers before storing — it may be running',
  )
  console.log('  an older lex-json without the float-preserving reviver.')
} else {
  console.log()
  console.log(
    '? Server CID does not match either local encoding. The PDS may apply',
  )
  console.log('  additional transformations before storage.')
}

await session.logout().catch(() => {})
