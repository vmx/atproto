import { LexFloat } from '@atproto/lex-data'
import { describe, expect, it } from 'vitest'
import * as com from './lexicons/com.js'

describe('float', () => {
  it('Applies float range constraint', () => {
    com.example.floatRange.$parse({
      $type: 'com.example.floatRange',
      float: 0.5,
    })
    expect(() =>
      com.example.floatRange.$parse({
        $type: 'com.example.floatRange',
        float: -0.1,
      }),
    ).toThrow('float too small (minimum 0, got -0.1) at $.float')
    expect(() =>
      com.example.floatRange.$parse({
        $type: 'com.example.floatRange',
        float: 1.1,
      }),
    ).toThrow('float too big (maximum 1, got 1.1) at $.float')
  })

  it('Accepts integer-valued numbers', () => {
    com.example.floatRange.$parse({
      $type: 'com.example.floatRange',
      float: 0,
    })
    com.example.floatRange.$parse({
      $type: 'com.example.floatRange',
      float: 1,
    })
  })

  it('Accepts LexFloat-wrapped values', () => {
    com.example.floatRange.$parse({
      $type: 'com.example.floatRange',
      float: new LexFloat(0.5),
    })
    com.example.floatRange.$parse({
      $type: 'com.example.floatRange',
      float: new LexFloat(0),
    })
  })

  it('Rejects NaN', () => {
    expect(() =>
      com.example.floatRange.$parse({
        $type: 'com.example.floatRange',
        float: NaN,
      }),
    ).toThrow()
  })

  it('Rejects Infinity', () => {
    expect(() =>
      com.example.floatRange.$parse({
        $type: 'com.example.floatRange',
        float: Infinity,
      }),
    ).toThrow()
  })
})
