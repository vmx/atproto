import { LexFloat } from '@atproto/lex-data'
import { assert, describe, expect, it } from 'vitest'
import { float } from './float.js'

describe('FloatSchema', () => {
  describe('basic validation', () => {
    const schema = float()

    it('validates non-integer numbers', () => {
      expect(schema.safeParse(3.14).success).toBe(true)
    })

    it('validates integer values', () => {
      expect(schema.safeParse(42).success).toBe(true)
    })

    it('validates zero', () => {
      expect(schema.safeParse(0).success).toBe(true)
    })

    it('validates negative floats', () => {
      expect(schema.safeParse(-2.5).success).toBe(true)
    })

    it('rejects NaN', () => {
      expect(schema.safeParse(NaN).success).toBe(false)
    })

    it('rejects Infinity', () => {
      expect(schema.safeParse(Infinity).success).toBe(false)
    })

    it('rejects -Infinity', () => {
      expect(schema.safeParse(-Infinity).success).toBe(false)
    })

    it('rejects strings', () => {
      expect(schema.safeParse('3.14').success).toBe(false)
    })

    it('rejects null', () => {
      expect(schema.safeParse(null).success).toBe(false)
    })

    it('rejects undefined', () => {
      expect(schema.safeParse(undefined).success).toBe(false)
    })
  })

  describe('LexFloat wrappers', () => {
    const schema = float()

    it('accepts LexFloat wrapping a finite number', () => {
      expect(schema.safeParse(new LexFloat(3.14)).success).toBe(true)
    })

    it('accepts LexFloat wrapping an integer-valued number', () => {
      expect(schema.safeParse(new LexFloat(42)).success).toBe(true)
    })

    it('rejects LexFloat wrapping NaN', () => {
      expect(schema.safeParse(new LexFloat(NaN)).success).toBe(false)
    })

    it('respects range constraints for LexFloat values', () => {
      const ranged = float({ minimum: 0, maximum: 1 })
      expect(ranged.safeParse(new LexFloat(0.5)).success).toBe(true)
      expect(ranged.safeParse(new LexFloat(1.5)).success).toBe(false)
    })
  })

  describe('parse-mode coercion', () => {
    const schema = float()

    it('wraps bare numbers in LexFloat in parse mode', () => {
      const result = schema.safeParse(65)
      assert(result.success)
      expect(result.value).toBeInstanceOf(LexFloat)
      expect((result.value as LexFloat).value).toBe(65)
    })

    it('wraps non-integer bare numbers in parse mode', () => {
      const result = schema.safeParse(3.14)
      assert(result.success)
      expect(result.value).toBeInstanceOf(LexFloat)
      expect((result.value as LexFloat).value).toBe(3.14)
    })

    it('returns existing LexFloat instances unchanged in parse mode', () => {
      const wrapped = new LexFloat(0.5)
      const result = schema.safeParse(wrapped)
      assert(result.success)
      expect(result.value).toBe(wrapped)
    })

    it('returns input unchanged in validate mode', () => {
      const result = schema.safeValidate(65)
      assert(result.success)
      expect(result.value).toBe(65)
    })

    it('still rejects NaN in parse mode', () => {
      expect(schema.safeParse(NaN).success).toBe(false)
    })

    it('respects range constraints in parse mode', () => {
      const ranged = float({ minimum: 0, maximum: 1 })
      expect(ranged.safeParse(1.5).success).toBe(false)
    })
  })

  describe('coerce-mode behaviour', () => {
    const schema = float()

    it('wraps bare numbers in LexFloat just like parse', () => {
      const result = schema.safeCoerce(65)
      assert(result.success)
      expect(result.value).toBeInstanceOf(LexFloat)
      expect((result.value as LexFloat).value).toBe(65)
    })

    it('returns existing LexFloat instances unchanged', () => {
      const wrapped = new LexFloat(0.5)
      const result = schema.safeCoerce(wrapped)
      assert(result.success)
      expect(result.value).toBe(wrapped)
    })

    it('passes invalid input through instead of failing', () => {
      // Coerce mode swallows validation issues — `'broken'` is a string,
      // not a number, but coerce returns it as-is.
      const result = schema.safeCoerce('broken')
      assert(result.success)
      expect(result.value).toBe('broken')
    })

    it('passes NaN through instead of failing', () => {
      const result = schema.safeCoerce(NaN)
      assert(result.success)
      expect(Number.isNaN(result.value)).toBe(true)
    })

    it('passes out-of-range values through unchanged', () => {
      const ranged = float({ minimum: 0, maximum: 1 })
      const result = ranged.safeCoerce(1.5)
      assert(result.success)
      // The bare number is not wrapped because the range check tripped first
      // and the coerce-mode soft-failure returns the input.
      expect(result.value).toBe(1.5)
    })
  })

  describe('range constraints', () => {
    const schema = float({ minimum: 0, maximum: 1 })

    it('accepts values within range', () => {
      expect(schema.safeParse(0.5).success).toBe(true)
    })

    it('accepts boundary values', () => {
      expect(schema.safeParse(0).success).toBe(true)
      expect(schema.safeParse(1).success).toBe(true)
    })

    it('rejects values below minimum', () => {
      expect(schema.safeParse(-0.1).success).toBe(false)
    })

    it('rejects values above maximum', () => {
      expect(schema.safeParse(1.1).success).toBe(false)
    })

    it('labels too-small issues with type "float"', () => {
      const result = schema.safeParse(-0.1)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason.issues[0]).toMatchObject({
          code: 'too_small',
          type: 'float',
        })
      }
    })

    it('labels too-big issues with type "float"', () => {
      const result = schema.safeParse(1.1)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason.issues[0]).toMatchObject({
          code: 'too_big',
          type: 'float',
        })
      }
    })
  })
})
