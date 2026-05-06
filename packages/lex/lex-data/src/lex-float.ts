/**
 * Wrapper that tags a finite number as a float in the Lex data model.
 *
 * The Lex data model allows numbers to be encoded as either CBOR integers or
 * CBOR floats. When a value's runtime JS type alone cannot convey the intent
 * — because integer-valued floats (e.g. `65`) are indistinguishable from
 * integers at the `number` level — we wrap the value in {@link LexFloat} so
 * downstream consumers (CBOR encoder, JSON stringifier) know to emit it as a
 * float.
 *
 * Producers:
 * - {@link lexParse @atproto/lex-json#lexParse} wraps any JSON number whose
 *   source text contained `.` or `e`/`E`.
 * - Application code can wrap a number explicitly: `new LexFloat(65)`.
 *
 * Consumers:
 * - `encode` in `@atproto/lex-cbor` emits these as CBOR `float64` tokens.
 * - {@link lexStringify @atproto/lex-json#lexStringify} emits these with a
 *   forced decimal point (`65` → `"65.0"`).
 * - {@link FloatSchema @atproto/lex-schema} accepts these alongside plain
 *   numbers; {@link IntegerSchema} rejects them.
 */
export class LexFloat {
  constructor(readonly value: number) {}
}

/**
 * Type guard for {@link LexFloat} instances.
 */
export function isLexFloat(input: unknown): input is LexFloat {
  return input instanceof LexFloat
}
