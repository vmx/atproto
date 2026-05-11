import { assert, describe, expect, it } from 'vitest'
import {
  LexFloat,
  LexInteger,
  LexValue,
  isLexMap,
  parseCid,
} from '@atproto/lex-data'
import { decode, decodeAll, encode } from '../src/index.js'

describe('encode', () => {
  it('encodes data to CBOR format', () => {
    expect(encode({ hello: 'world' })).toEqual(
      Uint8Array.from([
        0xa1, 0x65, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x65, 0x77, 0x6f, 0x72, 0x6c,
        0x64,
      ]),
    )
  })

  it('encodes finite non-integer numbers as CBOR float64', () => {
    // Bare finite numbers are valid LexValues; the encoder routes
    // non-integer values to the cborg default (8-byte float64) rather than
    // throwing.
    const bytes = encode({ value: 3.14 })
    expect(decode(bytes)).toStrictEqual({ value: 3.14 })
    // 0xfb is the CBOR major type tag for 8-byte float.
    expect(bytes).toContain(0xfb)
  })

  describe('LexInteger wrappers', () => {
    it('encodes a positive LexInteger as CBOR uint (identical to bare)', () => {
      const wrapped = encode({ value: new LexInteger(99) })
      const bare = encode({ value: 99 })
      expect(wrapped).toEqual(bare)
      expect(decode(wrapped)).toStrictEqual({ value: 99 })
    })

    it('encodes zero as CBOR uint', () => {
      const wrapped = encode({ value: new LexInteger(0) })
      const bare = encode({ value: 0 })
      expect(wrapped).toEqual(bare)
    })

    it('encodes a negative LexInteger as CBOR negint (identical to bare)', () => {
      const wrapped = encode({ value: new LexInteger(-5) })
      const bare = encode({ value: -5 })
      expect(wrapped).toEqual(bare)
      expect(decode(wrapped)).toStrictEqual({ value: -5 })
    })

    it('does not produce float64 markers for LexInteger', () => {
      const bytes = encode({ value: new LexInteger(99) })
      expect(bytes).not.toContain(0xfb)
    })

    it('encodes LexInteger and LexFloat distinctly at the same numeric value', () => {
      const asInt = encode({ value: new LexInteger(42) })
      const asFloat = encode({ value: new LexFloat(42) })
      expect(asInt).not.toEqual(asFloat)
      // The float-wrapped form must carry the float64 tag.
      expect(asFloat).toContain(0xfb)
      expect(asInt).not.toContain(0xfb)
    })
  })

  it('throws when encoding NaN or Infinity', () => {
    expect(() => encode({ value: NaN })).toThrow()
    expect(() => encode({ value: Infinity })).toThrow()
    expect(() => encode({ value: -Infinity })).toThrow()
  })

  it('Supports encoding "undefined" values', () => {
    expect(encode({ value: undefined })).toStrictEqual(encode({}))
    expect(encode({ a: 1, value: undefined })).toStrictEqual(encode({ a: 1 }))
    expect(encode({ foo: { bar: undefined } })).toStrictEqual(
      encode({ foo: {} }),
    )
  })

  it('throws when encoding Maps with non-string keys', () => {
    expect(() =>
      // @ts-expect-error
      encode({
        foo: new Map<any, any>([
          [42, 'value'],
          ['key', 'value2'],
        ]),
      }),
    ).toThrow()
  })
})

describe('decode', () => {
  it('decodes CBOR data to original format', () => {
    const bytes = Uint8Array.from([
      0xa1, 0x65, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x65, 0x77, 0x6f, 0x72, 0x6c,
      0x64,
    ])
    expect(decode(bytes)).toEqual({ hello: 'world' })
  })
})

describe('identity', () => {
  for (const vector of [
    null,
    parseCid('bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a'),
    [
      parseCid('bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a'),
      parseCid('bafyreigoxt64qghytzkr6ik7qvtzc7lyytiq5xbbrokbxjows2wp7vmo6q'),
      parseCid('bafyreiaizynclnqiolq7byfpjjtgqzn4sfrsgn7z2hhf6bo4utdwkin7ke'),
      parseCid('bafyreifd4w4tcr5tluxz7osjtnofffvtsmgdqcfrfi6evjde4pl27lrjpy'),
    ],
    new Uint8Array(Buffer.from('hello world')),
    true,
    false,
    0,
    42,
    -1,
    '',
    'hello world',
    [],
    [1, 2, 3],
    {},
    { a: 1, b: 'two', c: true },
    {
      nested: {
        array: { value: [1, 2, 3] },
        object: { key: 'value' },
        cid: parseCid(
          'bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a',
        ),
        bytes: new Uint8Array(Buffer.from('byte array')),
      },
    },
  ] as LexValue[]) {
    it(JSON.stringify(vector), () => {
      const cbor = encode(vector)
      const decoded = decode(cbor)
      expect(decoded).toEqual(vector)
      expect(encode(decoded)).toEqual(cbor)
    })
  }
})

describe('ipld decode multi', () => {
  it('decodes concatenated dag-cbor messages', async () => {
    const one = {
      a: 123,
      b: parseCid(
        'bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a',
      ),
    }
    const two = {
      c: new Uint8Array([1, 2, 3]),
      d: parseCid(
        'bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a',
      ),
    }
    const encoded = Buffer.concat([encode(one), encode(two)])
    const decoded = Array.from(decodeAll(encoded))
    expect(decoded.length).toBe(2)
    expect(decoded[0]).toEqual(one)
    expect(decoded[1]).toEqual(two)
  })

  it('parses safe ints as number', async () => {
    const one = {
      test: Number.MAX_SAFE_INTEGER,
    }
    const encoded = encode(one)
    const { length, 0: first } = Array.from(decodeAll(encoded))
    expect(length).toBe(1)
    assert(isLexMap(first))
    expect(Number.isInteger(first.test)).toBe(true)
  })
})
