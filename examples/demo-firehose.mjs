#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Based on
// https://gist.github.com/davepeck/8ada49d42d44a5632b540a4093225719
// (2026-04-29)

// Bluesky firehose decoder. No dependencies; Node 22+ for built-in WebSocket.
//
// Each WebSocket frame is two back-to-back DAG-CBOR values: a header map and
// a body map. For #commit frames the body has an `ops` array (one entry per
// record op) and a `blocks` byte string (a CARv1 archive of the new records).
// We pull the CID of the first `create` op out of `ops` and find the matching
// block in the CAR. The block's raw CBOR bytes are emitted as hex.
//
// We don't fully decode CBOR — there's a `skip` for items we don't care about
// and targeted readers for the few types that appear in the fields we want
// (text, bytes, arrays, maps, tag-42 CIDs, and null inside ops).
//
// Specs:
//   - DAG-CBOR:  https://ipld.io/specs/codecs/dag-cbor/spec/
//   - CARv1:     https://ipld.io/specs/transport/car/carv1/
//   - CID:       https://github.com/multiformats/cid
//   - Varint:    https://github.com/multiformats/unsigned-varint

// const FIREHOSE_URL = 'wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos';
//const FIREHOSE_URL = "ws://localhost:2583/xrpc/com.atproto.sync.subscribeRepos"
const FIREHOSE_URL = "ws://localhost:2470/xrpc/com.atproto.sync.subscribeRepos"

const TEXT_DECODER = new TextDecoder("utf-8", {
  fatal: true
})

// CIDs in DAG-CBOR are 36 bytes wrapped in a leading 0x00 multibase identity
// prefix, so the wrapper is 37 bytes. atproto only uses tag 42 for CIDs.
const CID_TAG = 42
const CID_LEN = 36

// ── byte cursor ────────────────────────────────────────────────────────────
// A Uint8Array plus an offset, with read(n) and readU8.

class Cursor {
  constructor(bytes) {
    this.bytes = bytes
    this.pos = 0
  }

  read(n) {
    if (this.pos + n > this.bytes.length) {
      throw new Error("unexpected end of input")
    }
    const slice = this.bytes.subarray(this.pos, this.pos + n)
    this.pos += n
    return slice
  }

  /// Read a single byte and advance the cursor.
  readU8() {
    return this.bytes[this.pos++]
  }

  /// Whether the eof of the data was reached.
  is_eof() {
    return this.pos >= this.bytes.length
  }
}

/// Get the unsigned LEB128 varint.
const readUvarint = (cursor) => {
  let result = 0
  let shift = 0
  while (true) {
    const byte = cursor.readU8()
    result |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      return result >>> 0
    }
    shift += 7
  }
}

/// Each item starts with an initial byte: top 3 bits are the major type,
/// bttom 5 bits are "additional info" (the length, or 24/25/26/27 to read
/// 1/2/4/8 more big-endian bytes for the length). We support definite-length
/// items only — the firehose is deterministic DAG-CBOR.
const readCborLen = (cursor, info) => {
  if (info < 24) {
    return info
  }
  if (info === 24) {
    return cursor.readU8()
  }
  if (info === 25) {
    return (cursor.readU8() << 8) | cursor.readU8()
  }
  if (info === 26) {
    const a = cursor.readU8(),
      b = cursor.readU8(),
      c = cursor.readU8(),
      d = cursor.readU8()
    return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
  }
  if (info === 27) {
    // 64-bit; not expected on any field we navigate
    let v = 0n
    for (let i = 0; i < 8; i++) {
      v = (v << 8n) | BigInt(cursor.readU8())
    }
    return Number(v)
  }
  throw new Error(`bad cbor info: ${info}`)
}

/// Skip exactly one CBOR item.
const skipCbor = (cursor) => {
  const initial = cursor.readU8()
  const major = initial >> 5
  const info = initial & 0x1f

  switch (major) {
    // uint, nint
    case 0:
    case 1:
      readCborLen(cursor, info)
      return
    // byte string, text string
    case 2:
    case 3:
      cursor.read(readCborLen(cursor, info))
      return
    // array
    case 4: {
      const len = readCborLen(cursor, info)
      for (let i = 0; i < len; i++) {
        skipCbor(cursor)
      }
      return
    }
    // map
    case 5: {
      const len = readCborLen(cursor, info)
      for (let i = 0; i < 2 * len; i++) {
        skipCbor(cursor)
      }
      return
    }
    // tag — read the tag number, then skip the tagged value
    case 6:
      readCborLen(cursor, info)
      skipCbor(cursor)
      return
    // simple values and floats: info encodes a fixed payload size
    case 7:
      if (info >= 24) {
        cursor.read(1 << (info - 24))
      }
      return
  }
}

// Read the next CBOR item's initial byte, assert its major type, return the
// length/value field. The workhorse behind every typed reader below.
const expectMajor = (cursor, major, label) => {
  const initial = cursor.readU8()
  if (initial >> 5 !== major) {
    throw new Error(`expected ${label}`)
  }
  return readCborLen(cursor, initial & 0x1f)
}

const readCborText = (cursor) => {
  return TEXT_DECODER.decode(cursor.read(expectMajor(cursor, 3, "text")))
}
const readCborBytes = (cursor) => {
  return cursor.read(expectMajor(cursor, 2, "bytes"))
}
const readCborMapLen = (cursor) => {
  return expectMajor(cursor, 5, "map")
}
const readCborArrayLen = (cursor) => {
  return expectMajor(cursor, 4, "array")
}

/// tag-42 CID → 36 raw CID bytes.
const readCborCid = (cursor) => {
  if (expectMajor(cursor, 6, "tag") !== CID_TAG) {
    throw new Error("unsupported CBOR tag")
  }
  const wrapped = readCborBytes(cursor)
  if (wrapped.length !== CID_LEN + 1 || wrapped[0] !== 0x00) {
    throw new Error("only DAG-CBOR CIDs are supported")
  }
  return wrapped.subarray(1)
}

/// True if the next byte is CBOR null (0xf6). Consumes it on match.
const tryCborNull = (cursor) => {
  if (cursor.bytes[cursor.pos] !== 0xf6) {
    return false
  }
  cursor.pos++
  return true
}

/// Returns true if the frame header has `t == '#commit'`.
const isCommitHeader = (cursor) => {
  let isCommit = false
  for (let i = readCborMapLen(cursor); i > 0; i--) {
    const key = readCborText(cursor)
    if (key === "t") {
      isCommit = readCborText(cursor) === "#commit"
    } else {
      skipCbor(cursor)
    }
  }
  return isCommit
}

/// First op with action='create' in an ops array. Returns its CID or null.
const readCreateCid = (cursor) => {
  let createCid = null
  for (let i = readCborArrayLen(cursor); i > 0; i--) {
    let action = null,
      cid = null
    for (let j = readCborMapLen(cursor); j > 0; j--) {
      const key = readCborText(cursor)
      if (key === "action") {
        action = readCborText(cursor)
      } else if (key === "cid") {
        cid = tryCborNull(cursor) ? null : readCborCid(cursor)
      } else {
        skipCbor(cursor)
      }
    }
    if (createCid === null && action === "create" && cid !== null) {
      createCid = cid
    }
  }
  return createCid
}

/// From a #commit body, return { createCid, blocks } or null.
const readCommitBody = (cursor) => {
  let createCid = null,
    blocks = null
  for (let i = readCborMapLen(cursor); i > 0; i--) {
    const key = readCborText(cursor)
    if (key === "ops") {
      createCid = readCreateCid(cursor)
    } else if (key === "blocks") {
      blocks = readCborBytes(cursor)
    } else {
      skipCbor(cursor)
    }
  }
  return createCid && blocks
    ? {
        createCid,
        blocks
      }
    : null
}

const cidEqual = (a, b) => {
  for (let i = 0; i < CID_LEN; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

const findCarBlock = (carBytes, targetCid) => {
  const cursor = new Cursor(carBytes)
  cursor.read(readUvarint(cursor)) // skip CAR header

  while (!cursor.is_eof()) {
    const len = readUvarint(cursor)
    const cid = cursor.read(CID_LEN)
    const data = cursor.read(len - CID_LEN)
    if (cidEqual(cid, targetCid)) {
      return data
    }
  }
  return null
}

const decodeFrame = (bytes) => {
  const cursor = new Cursor(bytes)
  if (!isCommitHeader(cursor)) {
    return null
  }
  const body = readCommitBody(cursor)
  if (!body) {
    return null
  }
  return findCarBlock(body.blocks, body.createCid)
}

const toHex = (data) => {
  return Array.from(data, (dd) => dd.toString(16).padStart(2, "0")).join("")
}

const run = async () => {
  const ws = new WebSocket(FIREHOSE_URL)
  ws.binaryType = "arraybuffer"

  ws.addEventListener("message", (event) => {
    try {
      const block = decodeFrame(new Uint8Array(event.data))
      if (block) {
        process.stdout.write(`${toHex(block)}\n`)
      }
    } catch (err) {
      process.stderr.write(`frame decode error: ${err.message}\n`)
    }
  })

  ws.addEventListener("error", (event) => {
    process.stderr.write(`websocket error: ${event.message ?? event.type}\n`)
  })

  ws.addEventListener("close", (event) => {
    process.stderr.write(`websocket closed: ${event.code} ${event.reason}\n`)
    process.exit(event.wasClean ? 0 : 1)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run()
}
