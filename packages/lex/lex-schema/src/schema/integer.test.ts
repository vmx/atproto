import { LexFloat, LexInteger } from '@atproto/lex-data'
import { assert, describe, expect, it } from 'vitest'
import { object } from './object.js'
import { integer } from './integer.js'
import { withDefault } from './with-default.js'

describe('IntegerSchema', () => {
  describe('basic validation', () => {
    const schema = integer()

    it('validates integers', () => {
      const result = schema.safeParse(42)
      expect(result.success).toBe(true)
    })

    it('validates zero', () => {
      const result = schema.safeParse(0)
      expect(result.success).toBe(true)
    })

    it('validates negative integers', () => {
      const result = schema.safeParse(-42)
      expect(result.success).toBe(true)
    })

    it('validates large integers', () => {
      const result = schema.safeParse(Number.MAX_SAFE_INTEGER)
      expect(result.success).toBe(true)
    })

    it('validates small integers', () => {
      const result = schema.safeParse(Number.MIN_SAFE_INTEGER)
      expect(result.success).toBe(true)
    })

    it('rejects floats', () => {
      const result = schema.safeParse(3.14)
      expect(result.success).toBe(false)
    })

    it('rejects strings', () => {
      const result = schema.safeParse('42')
      expect(result.success).toBe(false)
    })

    it('rejects booleans', () => {
      const result = schema.safeParse(true)
      expect(result.success).toBe(false)
    })

    it('rejects null', () => {
      const result = schema.safeParse(null)
      expect(result.success).toBe(false)
    })

    it('rejects undefined', () => {
      const result = schema.safeParse(undefined)
      expect(result.success).toBe(false)
    })

    it('rejects objects', () => {
      const result = schema.safeParse({})
      expect(result.success).toBe(false)
    })

    it('rejects arrays', () => {
      const result = schema.safeParse([42])
      expect(result.success).toBe(false)
    })

    it('rejects NaN', () => {
      const result = schema.safeParse(NaN)
      expect(result.success).toBe(false)
    })

    it('rejects Infinity', () => {
      const result = schema.safeParse(Infinity)
      expect(result.success).toBe(false)
    })

    it('rejects -Infinity', () => {
      const result = schema.safeParse(-Infinity)
      expect(result.success).toBe(false)
    })
  })

  describe('float-demotion guard', () => {
    // Regression coverage for the bug where a non-integer number at an
    // integer-typed field could slip through to the CBOR encoder and become
    // a float64 token. `IntegerSchema` must always reject these.
    const schema = integer()

    it('rejects a non-integer number', () => {
      const result = schema.safeParse(3.14)
      assert(!result.success)
      expect(result.reason.issues[0]).toMatchObject({
        code: 'invalid_type',
        expected: ['integer'],
      })
    })

    it('rejects a LexFloat', () => {
      expect(schema.safeParse(new LexFloat(3.14)).success).toBe(false)
    })

    it('rejects a LexFloat at an integer value', () => {
      // Even integer-valued LexFloats must be rejected — they encode as
      // CBOR float64.
      expect(schema.safeParse(new LexFloat(42)).success).toBe(false)
    })

    it('object schema propagates the rejection from a nested integer', () => {
      const schema = object({
        count: integer(),
        label: integer(),
      })
      const result = schema.safeParse({ count: 3.14, label: 5 })
      assert(!result.success)
      expect(result.reason.issues[0]).toMatchObject({
        code: 'invalid_type',
        path: ['count'],
        expected: ['integer'],
      })
    })
  })

  describe('LexInteger wrappers', () => {
    const schema = integer()

    it('accepts LexInteger wrapping a safe integer', () => {
      const result = schema.safeParse(new LexInteger(42))
      assert(result.success)
      expect(result.value).toBeInstanceOf(LexInteger)
      expect((result.value as LexInteger).value).toBe(42)
    })

    it('accepts LexInteger wrapping zero', () => {
      expect(schema.safeParse(new LexInteger(0)).success).toBe(true)
    })

    it('accepts LexInteger wrapping negative integers', () => {
      expect(schema.safeParse(new LexInteger(-7)).success).toBe(true)
    })

    it('preserves the wrapper through validation (no unwrap)', () => {
      const wrapped = new LexInteger(42)
      const result = schema.safeParse(wrapped)
      assert(result.success)
      expect(result.value).toBe(wrapped)
    })

    it('respects range constraints for LexInteger values', () => {
      const ranged = integer({ minimum: 0, maximum: 100 })
      expect(ranged.safeParse(new LexInteger(50)).success).toBe(true)
      expect(ranged.safeParse(new LexInteger(150)).success).toBe(false)
      expect(ranged.safeParse(new LexInteger(-1)).success).toBe(false)
    })
  })

  describe('default value', () => {
    const schema = withDefault(integer(), 10)

    it('uses default when undefined is provided', () => {
      const result = schema.safeParse(undefined)
      expect(result).toMatchObject({
        success: true,
        value: 10,
      })
    })

    it('does not use default when explicit value is provided', () => {
      const result = schema.safeParse(20)
      expect(result).toMatchObject({
        success: true,
        value: 20,
      })
    })

    it('does not use default when zero is provided', () => {
      const result = schema.safeParse(0)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBe(0)
      }
    })
  })

  describe('minimum constraint', () => {
    const schema = integer({ minimum: 10 })

    it('accepts values equal to minimum', () => {
      const result = schema.safeParse(10)
      expect(result.success).toBe(true)
    })

    it('accepts values greater than minimum', () => {
      const result = schema.safeParse(20)
      expect(result.success).toBe(true)
    })

    it('rejects values less than minimum', () => {
      const result = schema.safeParse(5)
      expect(result.success).toBe(false)
    })

    it('rejects zero when minimum is positive', () => {
      const result = schema.safeParse(0)
      expect(result.success).toBe(false)
    })

    it('rejects negative values when minimum is positive', () => {
      const result = schema.safeParse(-10)
      expect(result.success).toBe(false)
    })
  })

  describe('maximum constraint', () => {
    const schema = integer({ maximum: 100 })

    it('accepts values equal to maximum', () => {
      const result = schema.safeParse(100)
      expect(result.success).toBe(true)
    })

    it('accepts values less than maximum', () => {
      const result = schema.safeParse(50)
      expect(result.success).toBe(true)
    })

    it('rejects values greater than maximum', () => {
      const result = schema.safeParse(150)
      expect(result.success).toBe(false)
    })

    it('accepts zero when maximum is positive', () => {
      const result = schema.safeParse(0)
      expect(result.success).toBe(true)
    })

    it('accepts negative values when maximum is positive', () => {
      const result = schema.safeParse(-10)
      expect(result.success).toBe(true)
    })
  })

  describe('minimum and maximum constraints', () => {
    const schema = integer({ minimum: 10, maximum: 100 })

    it('accepts values within range', () => {
      const result = schema.safeParse(50)
      expect(result.success).toBe(true)
    })

    it('accepts minimum value', () => {
      const result = schema.safeParse(10)
      expect(result.success).toBe(true)
    })

    it('accepts maximum value', () => {
      const result = schema.safeParse(100)
      expect(result.success).toBe(true)
    })

    it('rejects values below minimum', () => {
      const result = schema.safeParse(5)
      expect(result.success).toBe(false)
    })

    it('rejects values above maximum', () => {
      const result = schema.safeParse(150)
      expect(result.success).toBe(false)
    })
  })

  describe('negative range constraints', () => {
    const schema = integer({ minimum: -100, maximum: -10 })

    it('accepts negative values within range', () => {
      const result = schema.safeParse(-50)
      expect(result.success).toBe(true)
    })

    it('accepts minimum negative value', () => {
      const result = schema.safeParse(-100)
      expect(result.success).toBe(true)
    })

    it('accepts maximum negative value', () => {
      const result = schema.safeParse(-10)
      expect(result.success).toBe(true)
    })

    it('rejects values below minimum', () => {
      const result = schema.safeParse(-150)
      expect(result.success).toBe(false)
    })

    it('rejects values above maximum', () => {
      const result = schema.safeParse(-5)
      expect(result.success).toBe(false)
    })

    it('rejects zero', () => {
      const result = schema.safeParse(0)
      expect(result.success).toBe(false)
    })

    it('rejects positive values', () => {
      const result = schema.safeParse(10)
      expect(result.success).toBe(false)
    })
  })

  describe('zero constraints', () => {
    const schema = integer({ minimum: 0, maximum: 0 })

    it('accepts zero', () => {
      const result = schema.safeParse(0)
      expect(result.success).toBe(true)
    })

    it('rejects positive values', () => {
      const result = schema.safeParse(1)
      expect(result.success).toBe(false)
    })

    it('rejects negative values', () => {
      const result = schema.safeParse(-1)
      expect(result.success).toBe(false)
    })
  })

  describe('combined with default value', () => {
    const schema = withDefault(integer({ minimum: 10, maximum: 100 }), 50)

    it('uses default when undefined is provided', () => {
      const result = schema.safeParse(undefined)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBe(50)
      }
    })

    it('validates explicit values with constraints', () => {
      const result = schema.safeParse(75)
      expect(result.success).toBe(true)
    })

    it('rejects explicit values outside constraints', () => {
      const result = schema.safeParse(5)
      expect(result.success).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('handles minimum of 0', () => {
      const schema = integer({ minimum: 0 })
      expect(schema.safeParse(0).success).toBe(true)
      expect(schema.safeParse(-1).success).toBe(false)
      expect(schema.safeParse(1).success).toBe(true)
    })

    it('handles maximum of 0', () => {
      const schema = integer({ maximum: 0 })
      expect(schema.safeParse(0).success).toBe(true)
      expect(schema.safeParse(1).success).toBe(false)
      expect(schema.safeParse(-1).success).toBe(true)
    })

    it('handles very large ranges', () => {
      const schema = integer({
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      })
      expect(schema.safeParse(Number.MIN_SAFE_INTEGER).success).toBe(true)
      expect(schema.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true)
      expect(schema.safeParse(0).success).toBe(true)
    })

    it('allows unconstrained schema', () => {
      const schema = integer()
      expect(schema.safeParse(Number.MIN_SAFE_INTEGER).success).toBe(true)
      expect(schema.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true)
      expect(schema.safeParse(0).success).toBe(true)
      expect(schema.safeParse(-999999).success).toBe(true)
      expect(schema.safeParse(999999).success).toBe(true)
    })
  })
})
