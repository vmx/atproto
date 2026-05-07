/**
 * Wrapper that asserts a number is a safe integer at construction time and
 * carries that intent through encoding.
 *
 * Mirror of {@link LexFloat}. Where {@link LexFloat} exists because the JS
 * type system cannot distinguish an integer-valued float (`1.0`) from an
 * integer (`1`), {@link LexInteger} exists for the symmetric producer-side
 * concern: catching a non-integral value at the line of source code that
 * intended it to be an integer. Without the wrapper, the CBOR encoder would
 * silently promote `3.14` to a float64 token rather than rejecting it.
 *
 * Producers:
 * - Application code wraps a value explicitly: `new LexInteger(99)`. The
 *   constructor throws `TypeError` if the value is not a safe integer.
 *
 * Consumers:
 * - `encode` in `@atproto/lex-cbor` emits these as CBOR `uint`/`negint`
 *   tokens, identical to a bare integer.
 * - {@link lexStringify @atproto/lex-json#lexStringify} emits these as plain
 *   integer JSON tokens (no decimal point).
 * - {@link IntegerSchema @atproto/lex-schema} accepts these alongside plain
 *   integer numbers.
 */
export class LexInteger {
  constructor(readonly value: number) {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(
        `LexInteger requires a safe integer, got ${value}`,
      )
    }
  }
}

/**
 * Type guard for {@link LexInteger} instances.
 */
export function isLexInteger(input: unknown): input is LexInteger {
  return input instanceof LexInteger
}
