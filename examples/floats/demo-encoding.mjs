#!/usr/bin/env node
// Demo: how AT Protocol decides between integer and float for each numeric
// field, walking through three categories side-by-side. No PDS, no networking
// — the script just prints the resulting JSON wire form and CBOR bytes.
//
// Categories exercised, all in one record:
//
//   1. Schema-typed fields. The lexicon at `lexicons/cx/vmx/dev/tmp004/floats.json`
//      declares `temperature` and `humidity` as `float`, and `sampleCount` as
//      `integer`. `recordSchema.coerce(...)` walks the input through the
//      schema; bare numbers at float-typed paths are wrapped in `LexFloat`,
//      so even an integer-valued `temperature: 20` is emitted as `20.0` and
//      stored as CBOR float64.
//
//   2. Off-schema fields with default behaviour. Properties not declared by
//      the lexicon pass through `coerce` unchanged. The CBOR encoder then
//      decides per-value: an integer-valued JS number becomes a CBOR uint, a
//      non-integer JS number becomes a CBOR float64. So `extraIntegral: 7`
//      is a uint while `extraFractional: 3.14` is a float64.
//
//   3. Off-schema fields with manual coercion. Two wrapper classes carry
//      explicit producer-side intent through to the encoder:
//        - `new LexFloat(n)`   forces float encoding even for an
//                              integer-valued number (`42` → `42.0` / float64).
//        - `new LexInteger(n)` asserts at construction time that `n` is a
//                              safe integer; throws otherwise. Encoded as a
//                              CBOR uint/negint, identical to a bare integer.
//
// Usage:
//
//   node examples/floats/demo-encoding.mjs

import fs from 'node:fs'
import { encode } from '@atproto/lex-cbor'
import { LexFloat, LexInteger, isLexFloat, isLexInteger } from '@atproto/lex-data'
import {
  LexiconIterableIndexer,
  LexiconSchemaBuilder,
  lexiconDocumentSchema,
} from '@atproto/lex-document'
import { lexStringify } from '@atproto/lex-json'

// The float-preserving JSON reviver in `@atproto/lex-json` needs the ES2023
// three-arg `JSON.parse` reviver (`context.source`). On older runtimes the
// reviver silently degrades, so the lex-json package fails loudly at module
// load. Catch the version mismatch up-front with a clearer message.
const [nodeMajor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 25) {
  console.error(
    `This demo requires Node.js 25+ (running ${process.versions.node}).`,
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. Load the lexicon and build a runtime RecordSchema.
// ---------------------------------------------------------------------------
const lexiconUrl = new URL(
  './lexicons/cx/vmx/dev/tmp004/floats.json',
  import.meta.url,
)
const lexiconDoc = lexiconDocumentSchema.parse(
  JSON.parse(fs.readFileSync(lexiconUrl, 'utf8')),
)
const indexer = new LexiconIterableIndexer([lexiconDoc])
const recordSchema = await LexiconSchemaBuilder.build(
  indexer,
  `${lexiconDoc.id}#main`,
)

const properties = lexiconDoc.defs.main.record.properties
const propertyList = Object.entries(properties)
  .map(([name, def]) => `${name} (${def.type})`)
  .join(', ')

console.log(`Loaded lexicon ${lexiconDoc.id}`)
console.log(`  schema-typed fields: ${propertyList}`)
console.log()

// ---------------------------------------------------------------------------
// 2. Construct the input. One record, every category visible.
// ---------------------------------------------------------------------------
const input = {
  $type: lexiconDoc.id,

  // Schema-typed: lexicon picks the encoding.
  temperature: 20, //   float-typed → schema wraps in LexFloat → 20.0
  humidity: 65.5, //    float-typed → already non-integer → 65.5
  sampleCount: 100, //  integer-typed → uint
  label: 'demo reading',

  // Off-schema, default behaviour: input shape picks the encoding.
  extraIntegral: 7, //     bare integral number    → CBOR uint
  extraFractional: 3.14, // bare non-integer       → CBOR float64

  // Off-schema, manual coercion: producer overrides the default.
  forcedFloat: new LexFloat(42), //     integer-valued, but forced to float64
  forcedInteger: new LexInteger(99), // asserted integer, encoded as uint
}

// `coerce` runs each schema-typed field through its validator (wrapping bare
// numbers at float paths in `LexFloat`); off-schema fields pass through
// untouched. See packages/lex/lex-schema/src/schema/object.ts.
const record = recordSchema.coerce(input)

// ---------------------------------------------------------------------------
// 3. JSON wire form. `lexStringify` emits `LexFloat` with a forced decimal
//    point — that decimal is what carries float intent across an HTTP body.
// ---------------------------------------------------------------------------
const describeField = (key, value) => {
  const schemaProp = properties[key]
  if (schemaProp) return `schema-driven (${schemaProp.type}-typed)`
  if (isLexFloat(value)) return `off-schema, new LexFloat(${value.value})`
  if (isLexInteger(value)) return `off-schema, new LexInteger(${value.value})`
  return Number.isSafeInteger(value)
    ? 'off-schema, integral JS number'
    : 'off-schema, non-integer JS number'
}

console.log('Input (as JS values):')
console.log(input)
console.log()
console.log('JSON wire form (lexStringify):')
console.log(`  ${lexStringify(record)}`)
console.log()
console.log('  Decimals indicate float wire form:')
for (const [key, value] of Object.entries(record)) {
  if (key === '$type') continue
  if (
    typeof value !== 'number' &&
    !isLexFloat(value) &&
    !isLexInteger(value)
  ) {
    continue
  }
  console.log(`    ${key}: ${lexStringify(value)} — ${describeField(key, value)}`)
}
console.log()

// ---------------------------------------------------------------------------
// 4. CBOR bytes. Every `0xfb` marker is the start of an 8-byte float64. We
//    expect exactly four — temperature, humidity, extraFractional, forcedFloat.
// ---------------------------------------------------------------------------
const cbor = encode(record)

console.log(`CBOR encoding (${cbor.length} bytes):`)
console.log(`  https://cbor.nemo157.com/#type=hex&value=${cbor.toHex()}`)
console.log()

// ---------------------------------------------------------------------------
// 5. Failure path: `new LexInteger(...)` rejects non-integral input at
//    construction. Demonstrated separately so the success path above stays
//    clean.
// ---------------------------------------------------------------------------
console.log('new LexInteger(...) rejects non-integral input:')
try {
  new LexInteger(3.14)
} catch (err) {
  console.log(`  ${err.constructor.name}: ${err.message}`)
}
