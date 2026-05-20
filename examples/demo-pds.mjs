#!/usr/bin/env node
// Demo: post a record with mixed integer and float values to a live PDS,
// using the high-level `@atproto/lex` SDK.
//
// The local-encoding side of the int/float story is covered by
// `demo-encoding.mjs`; this script just shows that the same record
// round-trips through a real server.
//
// Usage:
//
//   node examples/floats/demo-pds.mjs <pds-url> <handle-or-email> <password>

import fs from 'node:fs'
import { Client } from '@atproto/lex'
import { LexFloat, LexInteger } from '@atproto/lex-data'
import {
  LexiconIterableIndexer,
  LexiconSchemaBuilder,
  lexiconDocumentSchema,
} from '@atproto/lex-document'
import { PasswordSession } from '@atproto/lex-password-session'

const [nodeMajor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 22) {
  console.error(
    `This demo requires Node.js 22+ (running ${process.versions.node}).`,
  )
  process.exit(1)
}

const [pdsUrl, identifier, password] = process.argv.slice(2)
if (!pdsUrl || !identifier || !password) {
  console.error(
    'Usage: node demo-pds.mjs <pds-url> <handle-or-email> <password>',
  )
  process.exit(1)
}

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

const input = {
  // Schema-typed.
  temperature: 20,
  humidity: 65.5,
  sampleCount: 100,
  label: 'demo reading',
  // Off-schema, default behaviour.
  extraIntegral: 7,
  extraFractional: 3.14,
  // Off-schema, explicit producer-side intent.
  forcedFloat: new LexFloat(42),
  forcedInteger: new LexInteger(99),
}

let session
try {
  session = await PasswordSession.login({
    service: pdsUrl,
    identifier,
    password,
  })
  console.log(`Logged in as ${session.handle} (${session.did})`)
} catch {
  const email = `${identifier}@example.com`
  session = await PasswordSession.createAccount(
    { handle: identifier, email, password },
    { service: pdsUrl },
  )
  console.log(`Created account ${session.handle} (${session.did})`)
}

const client = new Client(session)
const result = await client.create(recordSchema, input)
console.log(`Wrote record: ${result.uri}`)
console.log(`CID: ${result.cid}`)

await session.logout().catch(() => {})
