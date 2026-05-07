import { LexFloat, isLexFloat } from '@atproto/lex-data'
import { Schema, ValidationContext } from '../core.js'
import { memoizedOptions } from '../util/memoize.js'

/**
 * Configuration options for float schema validation.
 *
 * @property minimum - Minimum allowed value (inclusive)
 * @property maximum - Maximum allowed value (inclusive)
 */
export type FloatSchemaOptions = {
  minimum?: number
  maximum?: number
}

/**
 * Schema for validating floating-point number values with optional range
 * constraints.
 *
 * Accepts any finite JavaScript number (including values that are mathematically
 * integers, such as `1.0`). Rejects `NaN`, `Infinity`, and `-Infinity`.
 *
 * Numbers wrapped in {@link LexFloat} carry the int/float distinction through
 * encoding so an integer-valued float (e.g. `65`) is emitted as a CBOR
 * `float64` rather than as a CBOR uint.
 *
 * @example
 * ```ts
 * const schema = new FloatSchema({ minimum: 0, maximum: 1 })
 * const result = schema.validate(0.5)
 * ```
 */
export class FloatSchema extends Schema<number> {
  readonly type = 'float' as const

  constructor(readonly options?: FloatSchemaOptions) {
    super()
  }

  validateInContext(input: unknown, ctx: ValidationContext) {
    // `LexFloat` is the schema's natural shape: a JSON number whose source
    // text contained `.` or `e`/`E` and therefore carries explicit float
    // intent. Plain finite JS numbers are also accepted for ergonomics — a
    // lexicon-aware producer might hand us an integer-valued float directly.
    const numeric = isLexFloat(input) ? input.value : input
    if (!isFiniteNumber(numeric)) {
      return ctx.issueUnexpectedType(input, 'float')
    }

    if (this.options?.minimum != null && numeric < this.options.minimum) {
      return ctx.issueTooSmall(input, 'float', this.options.minimum, numeric)
    }

    if (this.options?.maximum != null && numeric > this.options.maximum) {
      return ctx.issueTooBig(input, 'float', this.options.maximum, numeric)
    }

    // In parse mode, wrap bare numbers in `LexFloat` so the JSON serialiser
    // emits the float-tagged form (`65.0`). Validate mode returns the input
    // unchanged — wrapping there would trip the "value changed" guard in
    // ValidationContext and fail the validation.
    if (ctx.options.mode === 'parse' && !isLexFloat(input)) {
      return ctx.success(new LexFloat(numeric))
    }

    return ctx.success(input)
  }
}

function isFiniteNumber(input: unknown): input is number {
  return typeof input === 'number' && Number.isFinite(input)
}

/**
 * Creates a float schema with optional minimum and maximum constraints.
 *
 * Validates that the input is a finite JavaScript number (rejecting `NaN` and
 * `Infinity`) and optionally falls within a specified range.
 *
 * Unlike {@link integer}, this schema accepts values with a fractional part.
 * It also accepts mathematically integral values (such as `1` or `1.0`).
 * Wrapping the value in {@link LexFloat} preserves the float intent through
 * downstream encoders.
 *
 * @param options - Optional configuration for minimum and maximum values
 * @returns A new {@link FloatSchema} instance
 *
 * @example
 * ```ts
 * // Basic float
 * const temperatureSchema = l.float()
 *
 * // Probability in [0, 1]
 * const probabilitySchema = l.float({ minimum: 0, maximum: 1 })
 *
 * // Non-negative rating
 * const ratingSchema = l.float({ minimum: 0, maximum: 5 })
 * ```
 */
export const float = /*#__PURE__*/ memoizedOptions(function (
  options?: FloatSchemaOptions,
) {
  return new FloatSchema(options)
})
