import {
  BlobRef,
  LexFloat,
  Cid,
  LexArray,
  LexMap,
  LexValue,
  isLexFloat,
  isCid,
  isPlainObject,
  utf8FromBytes,
} from '@atproto/lex-data'
import { parseTypedBlobRef } from './blob.js'
import { encodeLexBytes, parseLexBytes } from './bytes.js'
import { JsonObject, JsonScalar, JsonValue } from './json.js'
import { encodeLexLink, parseLexLink } from './link.js'

/**
 * The shape produced by `JSON.parse` when run with
 * {@link floatPreservingReviver}. Identical to {@link JsonValue} except that
 * any number whose JSON source contained `.`, `e`, or `E` has been wrapped in
 * a {@link LexFloat}. Every {@link JsonValue} is also a `RevivedJsonValue`,
 * so existing call sites that pass plain `JsonValue` keep type-checking.
 */
export type RevivedJsonValue =
  | JsonScalar
  | LexFloat
  | RevivedJsonValue[]
  | { [_ in string]?: RevivedJsonValue }

/**
 * Object-shaped {@link RevivedJsonValue} — used internally by
 * {@link jsonToLex}'s map walker.
 */
type RevivedJsonObject = { [_ in string]?: RevivedJsonValue }

// The float-preserving reviver depends on the third argument added to
// `JSON.parse` revivers in ES2023 (V8 11.3 / Node 21+). On older runtimes the
// argument is missing, the reviver silently degrades to a no-op, and `65.0`
// collapses back to `65` — destroying the int/float distinction without any
// signal to the caller. Fail loudly at module load instead of at first float,
// so misconfigured deployments surface the problem at startup.
;(function assertJsonParseSourceContext(): void {
  let supported = false
  JSON.parse('1', (_key: string, value: unknown, context?: unknown) => {
    if (
      typeof context === 'object' &&
      context !== null &&
      typeof (context as { source?: unknown }).source === 'string'
    ) {
      supported = true
    }
    return value
  })
  if (!supported) {
    throw new Error(
      '@atproto/lex-json requires JSON.parse reviver source context (ES2023). ' +
        'Upgrade to Node.js 21+ or a runtime with V8 11.3+.',
    )
  }
})()

/**
 * Serialize a Lex value to a JSON string.
 *
 * This function serializes AT Protocol data model values to JSON, automatically
 * encoding special types:
 * - `Cid` instances are encoded as `{$link: string}`
 * - `Uint8Array` instances are encoded as `{$bytes: string}` (base64)
 *
 * @param input - The Lex value to stringify
 * @returns A JSON string representation of the value
 *
 * @example
 * ```typescript
 * import { lexStringify } from '@atproto/lex'
 *
 * // Stringify with CID and bytes encoding
 * const json = lexStringify({
 *   ref: someCid,
 *   data: new Uint8Array([72, 101, 108, 108, 111])
 * })
 * // json is '{"ref":{"$link":"bafyrei..."},"data":{"$bytes":"SGVsbG8="}}'
 * ```
 */
export function lexStringify(input: LexValue): string {
  // Fast path: if there are no {@link LexFloat} wrappers anywhere in the tree,
  // delegate to the native `JSON.stringify` after the usual Lex→JSON
  // conversion. The slow path is needed only because `JSON.stringify` cannot
  // emit `65.0` for a numeric value — and that textual decimal point is the
  // only way the AT Protocol JSON wire form carries the int/float distinction.
  //
  // The pre-pass walks the tree once but does no allocation and no string
  // building; the slow path walks the tree once *and* hand-rolls the JSON.
  // Most Lex values contain no floats, so paying the cheap walk to skip the
  // slow path is a net win. When floats are present we accept the second walk
  // — there is no in-place way to convert {@link LexFloat} to a JSON token
  // because `JSON.stringify` resolves toJSON to a number before serialising.
  if (!containsLexFloat(input)) {
    return JSON.stringify(lexToJson(input))
  }
  return lexStringifyValue(input)
}

function containsLexFloat(value: LexValue): boolean {
  if (isLexFloat(value)) return true
  if (value === null || typeof value !== 'object') return false
  if (ArrayBuffer.isView(value) || isCid(value)) return false
  if (Array.isArray(value)) {
    for (const item of value) if (containsLexFloat(item)) return true
    return false
  }
  for (const v of Object.values(value)) {
    if (v !== undefined && containsLexFloat(v as LexValue)) return true
  }
  return false
}

function lexStringifyValue(value: LexValue): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'string':
      return JSON.stringify(value)
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`Non-finite number in Lex value: ${value}`)
      }
      return String(value)
    case 'object':
      break
    default:
      throw new TypeError(`Invalid Lex value: ${typeof value}`)
  }
  if (isLexFloat(value)) return formatLexFloat(value)
  if (isCid(value)) return JSON.stringify(encodeLexLink(value))
  if (ArrayBuffer.isView(value)) return JSON.stringify(encodeLexBytes(value))
  if (Array.isArray(value)) {
    let out = '['
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out += ','
      out += lexStringifyValue(value[i])
    }
    return out + ']'
  }
  if (isPlainObject(value)) {
    let out = '{'
    let first = true
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined) continue
      if (!first) out += ','
      first = false
      out += JSON.stringify(key) + ':' + lexStringifyValue(v as LexValue)
    }
    return out + '}'
  }
  throw new TypeError('Invalid Lex value')
}

function formatLexFloat(wrapper: LexFloat): string {
  const n = wrapper.value
  if (!Number.isFinite(n)) {
    throw new TypeError(`Non-finite number in LexFloat: ${n}`)
  }
  const s = String(n)
  // `Number.prototype.toString` already emits `.` for non-integer values and
  // `e` for very small/large magnitudes. Only integer-valued floats need the
  // explicit `.0` to preserve the float distinction through JSON.parse.
  return /[.eE]/.test(s) ? s : s + '.0'
}

/**
 * Options for parsing JSON to Lex values.
 */
export type LexParseOptions = {
  /**
   * When enabled, forbids the presence of invalid Lex values such as:
   * - Non-integer numbers (only safe integers are valid in the Lex data model)
   * - Malformed `$link` objects
   * - Malformed `$bytes` objects
   * - Objects with invalid or empty `$type` properties
   * - Invalid {@link BlobRef} (`$type: 'blob'`) objects
   *
   * When disabled (default), invalid special objects are left as plain objects.
   *
   * @default false
   */
  strict?: boolean
}

/**
 * Parses a JSON string into Lex values.
 *
 * This function parses JSON and automatically decodes AT Protocol special types:
 * - `{$link: string}` objects are decoded to `Cid` instances
 * - `{$bytes: string}` objects are decoded to `Uint8Array` instances
 * - `{$type: 'blob'}` objects are validated
 *
 * @typeParam T - Type cast for the resulting Lex value. Use when you want to specify the expected structure of the parsed data.
 * @param input - The JSON string to parse
 * @param options - Parsing options (e.g., strict mode)
 * @returns The parsed Lex value
 * @throws {SyntaxError} If the input is not valid JSON
 * @throws {TypeError} If strict mode is enabled and invalid Lex values are found
 *
 * @example
 * ```typescript
 * import { lexParse } from '@atproto/lex'
 *
 * // Parse JSON with $link and $bytes decoding
 * const parsed = lexParse<{
 *   ref: Cid
 *   data: Uint8Array
 * }>(`{
 *   "ref": { "$link": "bafyrei..." },
 *   "data": { "$bytes": "SGVsbG8sIHdvcmxkIQ==" }
 * }`)
 *
 * // Parse a single CID
 * const someCid = lexParse<Cid>('{"$link": "bafyrei..."}')
 *
 * // Parse binary data
 * const someBytes = lexParse<Uint8Array>('{"$bytes": "SGVsbG8sIHdvcmxkIQ=="}')
 * ```
 */
export function lexParse<T extends LexValue = LexValue>(
  input: string,
  options: LexParseOptions = { strict: false },
): T {
  // Preserve the int/float distinction that is present in the JSON source text
  // but lost by a naive `JSON.parse`. Numbers whose source contained `.`, `e`,
  // or `E` are wrapped in {@link LexFloat}; plain digit-only numbers pass
  // through as JS numbers. The context-aware third argument of the reviver was
  // added in ES2023 (V8 11.3 / Node 21+) and asserted at module load.
  return jsonToLex(
    JSON.parse(input, floatPreservingReviver) as RevivedJsonValue,
    options,
  ) as T
}

type JsonParseContext = { readonly source: string }

/**
 * `JSON.parse` reviver that wraps any number whose JSON source text contained
 * `.`, `e`, or `E` in a {@link LexFloat}. Digit-only numbers pass through as
 * bare JS numbers.
 *
 * Exported so body parsers that do their own `JSON.parse` (e.g. an HTTP
 * framework's JSON middleware) can opt into the same int/float-distinction
 * preservation that {@link lexParse} applies internally.
 *
 * @remarks The third argument is ES2023 — Node 21+ / V8 11.3+. The module-load
 * runtime assertion above guarantees the runtime supplies it; the parameter
 * stays optional only so the function shape matches the 2-arg reviver type
 * expected by `JSON.parse`-style APIs (e.g. body-parser's `json()`).
 */
export function floatPreservingReviver(
  _key: string,
  value: unknown,
  context?: JsonParseContext,
): unknown {
  if (typeof value === 'number' && context && /[.eE]/.test(context.source)) {
    return new LexFloat(value)
  }
  return value
}

/**
 * Parses a JSON string from a byte array into Lex values.
 */
export function lexParseJsonBytes(
  bytes: Uint8Array,
  options?: LexParseOptions,
): LexValue {
  // @NOTE see ./json-bytes-decoder.bench.ts for performance comparison of
  // implementation that uses a decoder class that operates directly on bytes
  // vs. the current implementation that first decodes bytes to string and then
  // parses JSON. For more common cases, it seems that the trivial
  // implementation works better than the decoder based solution, while having a
  // small overhead for slower cases (~2% difference). Because of this, we keep
  // the trivial implementation:
  return lexParse(utf8FromBytes(bytes), options)
}

/**
 * Converts a parsed JSON representation of Lexicon value to a {@link LexValue}.
 *
 * This function transforms already-parsed JSON objects into Lex values by
 * decoding AT Protocol special types:
 * - `{$link: string}` objects are converted to `Cid` instances
 * - `{$bytes: string}` objects are converted to `Uint8Array` instances
 *
 * Use this when you have a JavaScript object (e.g., from `JSON.parse()`) and
 * need to convert it to the Lex data model. For parsing JSON strings directly,
 * use {@link lexParse} instead.
 *
 * @param value - The JSON value to convert
 * @param options - Parsing options (e.g., strict mode)
 * @returns The converted Lex value
 * @throws {TypeError} If strict mode is enabled and invalid Lex values are found
 * @throws {TypeError} If the value contains unsupported types (e.g., undefined at top level)
 *
 * @example
 * ```typescript
 * import { jsonToLex } from '@atproto/lex'
 *
 * // Convert parsed JSON to Lex values
 * const lex = jsonToLex({
 *   ref: { $link: 'bafyrei...' },  // Converted to Cid
 *   data: { $bytes: 'SGVsbG8sIHdvcmxkIQ==' }  // Converted to Uint8Array
 * })
 * ```
 */
export function jsonToLex(
  value: RevivedJsonValue,
  options: LexParseOptions = { strict: false },
): LexValue {
  switch (typeof value) {
    case 'object': {
      if (value === null) return null
      if (isLexFloat(value)) return value
      if (Array.isArray(value)) return jsonArrayToLex(value, options)
      return (
        parseSpecialJsonObject(value, options) ??
        jsonObjectToLexMap(value, options)
      )
    }
    case 'number':
      if (Number.isSafeInteger(value)) return value
      if (options.strict === false) return value
      throw new TypeError(`Invalid non-integer number: ${value}`)
    case 'boolean':
    case 'string':
      return value
    default:
      throw new TypeError(`Invalid JSON value: ${typeof value}`)
  }
}

function jsonArrayToLex(
  input: RevivedJsonValue[],
  options: LexParseOptions,
): LexValue[] {
  // Lazily copy value
  let copy: LexValue[] | undefined
  for (let i = 0; i < input.length; i++) {
    const inputItem = input[i]
    const item = jsonToLex(inputItem, options)
    if (item !== inputItem) {
      copy ??= Array.from(input) as LexValue[]
      copy[i] = item
    }
  }
  return (copy ?? input) as LexValue[]
}

function jsonObjectToLexMap(
  input: RevivedJsonObject,
  options: LexParseOptions,
): LexMap {
  // Lazily copy value
  let copy: LexMap | undefined = undefined
  for (const [key, jsonValue] of Object.entries(input)) {
    // Prevent prototype pollution
    if (key === '__proto__') {
      throw new TypeError('Invalid key: __proto__')
    }

    // Ignore (strip) undefined values
    if (jsonValue === undefined) {
      copy ??= { ...input } as LexMap
      delete copy[key]
      continue
    }

    const value = jsonToLex(jsonValue, options)
    if (value !== jsonValue) {
      copy ??= { ...input } as LexMap
      copy[key] = value
    }
  }
  return (copy ?? input) as LexMap
}

/**
 * Converts a Lex value to a JSON-compatible value.
 *
 * This function transforms Lex data model values into plain JavaScript objects
 * suitable for JSON serialization:
 * - `Cid` instances are converted to `{$link: string}` objects
 * - `Uint8Array` instances are converted to `{$bytes: string}` objects (base64)
 *
 * Use this when you need to convert Lex values to plain objects (e.g., for
 * custom serialization or inspection). For direct JSON string output, use
 * {@link lexStringify} instead.
 *
 * @param value - The Lex value to convert
 * @returns The JSON-compatible value
 * @throws {TypeError} If the value contains unsupported types
 *
 * @example
 * ```typescript
 * import { lexToJson } from '@atproto/lex'
 *
 * // Convert Lex values to JSON-compatible objects
 * const obj = lexToJson({
 *   ref: someCid,      // Converted to { $link: string }
 *   data: someBytes    // Converted to { $bytes: string }
 * })
 * ```
 */
export function lexToJson(value: LexValue): JsonValue {
  switch (typeof value) {
    case 'object':
      if (value === null) {
        return value
      } else if (isLexFloat(value)) {
        // Lossy: the int/float distinction carried by {@link LexFloat} cannot
        // be represented in a plain {@link JsonValue}. Callers that need the
        // distinction preserved on the wire must use {@link lexStringify}
        // instead, which handles `LexFloat` directly at the text level.
        return value.value
      } else if (Array.isArray(value)) {
        return lexArrayToJson(value)
      } else if (isCid(value)) {
        return encodeLexLink(value)
      } else if (ArrayBuffer.isView(value)) {
        return encodeLexBytes(value)
      } else {
        return encodeLexMap(value)
      }
    case 'boolean':
    case 'string':
    case 'number':
      return value
    default:
      throw new TypeError(`Invalid Lex value: ${typeof value}`)
  }
}

function lexArrayToJson(input: LexArray): JsonValue[] {
  // Lazily copy value
  let copy: JsonValue[] | undefined
  for (let i = 0; i < input.length; i++) {
    const inputItem = input[i]
    const item = lexToJson(inputItem)
    if (item !== inputItem) {
      copy ??= Array.from(input) as JsonValue[]
      copy[i] = item
    }
  }
  return copy ?? (input as JsonValue[])
}

function encodeLexMap(input: LexMap): JsonObject {
  // Lazily copy value
  let copy: JsonObject | undefined = undefined
  for (const [key, lexValue] of Object.entries(input)) {
    // Prevent prototype pollution
    if (key === '__proto__') {
      throw new TypeError('Invalid key: __proto__')
    }

    // Ignore (strip) undefined values
    if (lexValue === undefined) {
      copy ??= { ...input } as JsonObject
      delete copy[key]
      continue
    }

    const jsonValue = lexToJson(lexValue!)
    if (jsonValue !== lexValue) {
      copy ??= { ...input } as JsonObject
      copy[key] = jsonValue
    }
  }
  return copy ?? (input as JsonObject)
}

/**
 * @internal
 */
export function parseSpecialJsonObject(
  input: LexMap,
  options: LexParseOptions,
): Cid | Uint8Array | BlobRef | undefined {
  // Hot path: use hints to avoid parsing when possible

  if (input.$link !== undefined) {
    const cid = parseLexLink(input)
    if (cid) return cid
    if (options.strict) throw new TypeError(`Invalid $link object`)
  } else if (input.$bytes !== undefined) {
    const bytes = parseLexBytes(input)
    if (bytes) return bytes
    if (options.strict) throw new TypeError(`Invalid $bytes object`)
  } else if (input.$type !== undefined) {
    // @NOTE Since blobs are "just" regular lex objects with a special shape,
    // and because an object that does not conform to the blob shape would still
    // result in undefined being returned, we only attempt to parse blobs when
    // the strict option is enabled.
    if (options.strict) {
      if (input.$type === 'blob') {
        const blob = parseTypedBlobRef(input, options)
        if (blob) return blob
        throw new TypeError(`Invalid blob object`)
      } else if (typeof input.$type !== 'string') {
        throw new TypeError(`Invalid $type property (${typeof input.$type})`)
      } else if (input.$type.length === 0) {
        throw new TypeError(`Empty $type property`)
      }
    }
  }

  // @NOTE We ignore legacy blob representation here. They can be handled at the
  // application level if needed.

  return undefined
}
