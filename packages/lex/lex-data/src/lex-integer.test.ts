import { describe, expect, it } from 'vitest'
import { LexInteger, isLexInteger } from './lex-integer.js'

describe(LexInteger, () => {
  describe('valid inputs', () => {
    for (const { note, value } of [
      { note: 'positive integer', value: 42 },
      { note: 'zero', value: 0 },
      { note: 'negative integer', value: -7 },
      { note: 'MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER },
      { note: 'MIN_SAFE_INTEGER', value: Number.MIN_SAFE_INTEGER },
    ]) {
      it(`accepts ${note}`, () => {
        const wrapper = new LexInteger(value)
        expect(wrapper.value).toBe(value)
      })
    }
  })

  describe('invalid inputs', () => {
    for (const { note, value } of [
      { note: 'non-integer', value: 3.14 },
      { note: 'integer-valued float that lost precision', value: 1e21 },
      { note: 'NaN', value: NaN },
      { note: 'Infinity', value: Infinity },
      { note: '-Infinity', value: -Infinity },
    ]) {
      it(`rejects ${note} at construction`, () => {
        expect(() => new LexInteger(value)).toThrow(TypeError)
      })
    }
  })
})

describe(isLexInteger, () => {
  it('returns true for LexInteger instances', () => {
    expect(isLexInteger(new LexInteger(42))).toBe(true)
  })

  for (const { note, value } of [
    { note: 'bare integer', value: 42 },
    { note: 'bare float', value: 3.14 },
    { note: 'string', value: '42' },
    { note: 'null', value: null },
    { note: 'undefined', value: undefined },
    { note: 'plain object', value: { value: 42 } },
  ]) {
    it(`returns false for ${note}`, () => {
      expect(isLexInteger(value)).toBe(false)
    })
  }
})
