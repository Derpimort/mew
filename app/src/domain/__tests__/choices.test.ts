/* #254 — chip liveness is derived, never stored. These predicates are the one
   home for "is this chip still clickable?", shared by the store's pick guard
   and the session log's inert rendering — one reason to fail each. */

import { describe, expect, it } from 'vitest'
import { choicePicked, choicesActive, choicesSuperseded } from '../choices'
import type { ChatMessage } from '../types'

const mew = (id: string, choices?: ChatMessage['choices']): ChatMessage => ({
  id,
  role: 'mew',
  body: 'which one?',
  ts: 1,
  ...(choices ? { choices } : {}),
})
const user = (id: string): ChatMessage => ({ id, role: 'user', body: 'hello', ts: 2 })

const CHOICES = [
  { id: 'c1', label: 'the 7:00', reply: 'remove gym 7:00' },
  { id: 'c2', label: 'the 18:30', reply: 'remove gym 18:30' },
]

describe('choicePicked', () => {
  it('is false while nothing was picked, true once any option was', () => {
    expect(choicePicked(mew('m1', CHOICES))).toBe(false)
    expect(choicePicked(mew('m1', [CHOICES[0], { ...CHOICES[1], picked: true }]))).toBe(true)
  })

  it('a message without choices has nothing picked', () => {
    expect(choicePicked(mew('m1'))).toBe(false)
  })
})

describe('choicesSuperseded', () => {
  it('live while only mew messages follow', () => {
    const chat = [mew('m1', CHOICES), mew('m2')]
    expect(choicesSuperseded(chat, 'm1')).toBe(false)
  })

  it('superseded the moment a newer user message lands', () => {
    const chat = [mew('m1', CHOICES), user('u1')]
    expect(choicesSuperseded(chat, 'm1')).toBe(true)
  })

  it('an earlier user message does not supersede', () => {
    const chat = [user('u0'), mew('m1', CHOICES)]
    expect(choicesSuperseded(chat, 'm1')).toBe(false)
  })

  it('a message not in the chat is treated as superseded (never clickable)', () => {
    expect(choicesSuperseded([user('u0')], 'ghost')).toBe(true)
  })
})

describe('choicesActive', () => {
  it('active: options exist, none picked, nothing newer from the user', () => {
    const msg = mew('m1', CHOICES)
    expect(choicesActive([msg], msg)).toBe(true)
  })

  it('inert after a pick', () => {
    const msg = mew('m1', [{ ...CHOICES[0], picked: true }, CHOICES[1]])
    expect(choicesActive([msg], msg)).toBe(false)
  })

  it('inert after a superseding user message', () => {
    const msg = mew('m1', CHOICES)
    expect(choicesActive([msg, user('u1')], msg)).toBe(false)
  })

  it('a plain mew message is never active', () => {
    const msg = mew('m1')
    expect(choicesActive([msg], msg)).toBe(false)
  })
})
