import { describe, expect, it } from 'vitest'
import { LexFloat, isLexFloat } from './lex-float.js'

describe(LexFloat, () => {
  describe('valid inputs', () => {
    for (const { note, value } of [
      { note: 'positive non-integer', value: 3.14 },
      { note: 'negative non-integer', value: -2.5 },
      { note: 'integer-valued number', value: 42 },
      { note: 'zero', value: 0 },
      { note: 'large magnitude', value: 1e21 },
    ]) {
      it(`accepts ${note}`, () => {
        const wrapper = new LexFloat(value)
        expect(wrapper.value).toBe(value)
      })
    }
  })

  describe('invalid inputs', () => {
    for (const { note, value } of [
      { note: 'NaN', value: NaN },
      { note: 'Infinity', value: Infinity },
      { note: '-Infinity', value: -Infinity },
    ]) {
      it(`rejects ${note} at construction`, () => {
        expect(() => new LexFloat(value)).toThrow(TypeError)
      })
    }
  })
})

describe(isLexFloat, () => {
  it('returns true for LexFloat instances', () => {
    expect(isLexFloat(new LexFloat(3.14))).toBe(true)
  })

  for (const { note, value } of [
    { note: 'bare integer', value: 42 },
    { note: 'bare float', value: 3.14 },
    { note: 'string', value: '3.14' },
    { note: 'null', value: null },
    { note: 'undefined', value: undefined },
    { note: 'plain object', value: { value: 3.14 } },
  ]) {
    it(`returns false for ${note}`, () => {
      expect(isLexFloat(value)).toBe(false)
    })
  }
})
