/* #90 — the give-room ask reads both wordings: the chip's new "hour-plus work"
   and the pre-#90 "deep-work" a chip already in the chat history still speaks. */

import { describe, expect, it } from 'vitest'
import { parseCommand } from '../parse'

const now = new Date(2026, 5, 9, 9, 0)

describe('#90 — "give my … blocks room" reads every wording of the class', () => {
  it.each([
    ['give my hour-plus work blocks room', 'deep'],
    ['give my deep-work blocks room', 'deep'],
    ['give my admin blocks room', 'admin'],
    ['give my health blocks room', 'health'],
  ])('%s → giveRoom(%s)', (text, focusClass) => {
    expect(parseCommand(text, now)).toEqual({ kind: 'giveRoom', focusClass })
  })
})
