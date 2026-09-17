/* #254 — chip liveness is derived, never stored. These predicates are the one
   home for "is this chip still clickable?", shared by the store's pick guard
   and the session log's inert rendering — one reason to fail each. */

import { describe, expect, it } from 'vitest'
import { choicePicked, choicesActive, choicesSuperseded, typedChipLabel } from '../choices'
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

describe('typedChipLabel (#139)', () => {
  it("reads the live chips' own labels, case and punctuation aside", () => {
    const ask = mew('m1', CHOICES)
    expect(typedChipLabel([ask], 'the 18:30')).toEqual({ msgId: 'm1', choiceId: 'c2' })
    expect(typedChipLabel([ask], '  The 7:00.  ')).toEqual({ msgId: 'm1', choiceId: 'c1' })
    expect(typedChipLabel([ask], 'the  7:00')).toEqual({ msgId: 'm1', choiceId: 'c1' })
  })

  it('says nothing about anything else the owner types', () => {
    const ask = mew('m1', CHOICES)
    expect(typedChipLabel([ask], 'the 9:00')).toBeNull()
    expect(typedChipLabel([ask], 'remove the 7:00 one')).toBeNull() // not the whole message
    expect(typedChipLabel([ask], '')).toBeNull()
  })

  it('two chips reading the same way answer for neither', () => {
    /* no family ships duplicate labels today, and this is why it stays that
       way: an ambiguous answer must never be resolved by chip order */
    const twins = mew('m1', [
      { id: 'c1', label: 'tomorrow 9:00', reply: 'move the deck to tomorrow at 9:00' },
      { id: 'c2', label: 'tomorrow 9:00', reply: 'move the notes to tomorrow at 9:00' },
    ])
    expect(typedChipLabel([twins], 'tomorrow 9:00')).toBeNull()
  })

  it('the looser reading of one chip never beats another chip that reads EXACTLY (#139 slice 2)', () => {
    /* the order is the safety, not the rules: "8:30" is a loose reading of "the
       8:30" and the exact label of the other chip, so the exact one must win.
       No ask ships this shape today — it is constructed precisely because a
       future one might, and because order is what a reviewer cannot see. */
    const both = mew('m1', [
      { id: 'loose', label: 'the 8:30', reply: 'move the gym to 15:00 — the 8:30' },
      { id: 'exactly', label: '8:30', reply: 'move the gym to 15:00 — 8:30' },
    ])
    expect(typedChipLabel([both], '8:30')).toEqual({ msgId: 'm1', choiceId: 'exactly' })
    /* and the other way round: "the 8:30" is exact on the first chip */
    expect(typedChipLabel([both], 'the 8:30')).toEqual({ msgId: 'm1', choiceId: 'loose' })
  })

  it('a label read loosely still refuses when it points at more than one chip', () => {
    const twins = mew('m1', [
      { id: 'wed', label: 'the 8:30 (Wednesday)', reply: 'move it — wed' },
      { id: 'thu', label: 'the 8:30 (Thursday)', reply: 'move it — thu' },
    ])
    expect(typedChipLabel([twins], 'the 8:30')).toBeNull()
    expect(typedChipLabel([twins], '8:30')).toBeNull()
    /* each still answers to its own whole label */
    expect(typedChipLabel([twins], 'the 8:30 (thursday)')).toEqual({ msgId: 'm1', choiceId: 'thu' })
  })

  it('the looser readings a chip label carries', () => {
    const ask = mew('m1', [
      { id: 'a', label: 'the 18:30 (Wednesday)', reply: 'x' },
      { id: 'b', label: 'keep it as planned', reply: 'y' },
    ])
    /* bracket gone, article gone, both gone */
    expect(typedChipLabel([ask], 'the 18:30')).toEqual({ msgId: 'm1', choiceId: 'a' })
    expect(typedChipLabel([ask], '18:30 (wednesday)')).toEqual({ msgId: 'm1', choiceId: 'a' })
    expect(typedChipLabel([ask], '18:30')).toEqual({ msgId: 'm1', choiceId: 'a' })
    /* a plain label has no looser reading to find, and is unharmed */
    expect(typedChipLabel([ask], 'keep it as planned')).toEqual({ msgId: 'm1', choiceId: 'b' })
    expect(typedChipLabel([ask], 'keep it')).toBeNull()
  })

  it('only the newest chips, and only while they are live', () => {
    const older = mew('m1', CHOICES)
    const newer = mew('m2', [{ id: 'd1', label: 'do it', reply: 'go ahead' }])
    /* the older ask is superseded by the newer one, so its labels are spent */
    expect(typedChipLabel([older, newer], 'the 7:00')).toBeNull()
    expect(typedChipLabel([older, newer], 'do it')).toEqual({ msgId: 'm2', choiceId: 'd1' })
    const picked = mew('m3', [{ id: 'e1', label: 'do it', reply: 'go ahead', picked: true }])
    expect(typedChipLabel([picked], 'do it')).toBeNull()
    /* and a newer USER turn retires them too (#254's own law), which is exactly
       why the store asks this question BEFORE it posts the typed message: asked
       afterwards, the owner's own words would supersede the chips they name and
       no label could ever match */
    expect(typedChipLabel([newer, user('u1')], 'do it')).toBeNull()
  })
})
