import { describe, expect, it } from 'vitest'
import { extractSeriesScope, parseCommand } from '../parse'

// Tuesday, June 9 2026 — the design's canonical day.
const NOW = new Date(2026, 5, 9, 9, 40)

describe('talk-to-schedule parser (the no-key floor)', () => {
  it('parses the acceptance-criterion sentence (acceptance #1)', () => {
    const out = parseCommand('block thursday morning for the deck, keep friday afternoon free', NOW)
    expect(out.kind).toBe('plan')
    expect(out.places).toHaveLength(1)
    expect(out.places![0]).toMatchObject({
      title: 'deck',
      tag: 'work',
      dayOffset: 2, // Tue → Thu
      startMin: 9 * 60,
      durationMin: 3 * 60,
      protected: true,
    })
    expect(out.frees).toHaveLength(1)
    expect(out.frees![0]).toMatchObject({ dayKey: '3', startMin: 13 * 60, endMin: 17 * 60 })
  })

  it('infers tags from the user’s own words', () => {
    expect(parseCommand('block 1h for a walk tomorrow', NOW).places![0].tag).toBe('private')
    expect(parseCommand('block 30m for dentist tomorrow', NOW).places![0].tag).toBe('health')
    expect(parseCommand('block an hour for rest tonight', NOW).kind).toBe('plan')
  })

  it('parses explicit times and durations', () => {
    const out = parseCommand('schedule review the spec tomorrow at 14:30', NOW)
    expect(out.places![0]).toMatchObject({ dayOffset: 1, startMin: 14 * 60 + 30 })
    const dur = parseCommand('block 90m for email triage today', NOW)
    expect(dur.places![0].durationMin).toBe(90)
  })

  it('keeps scheduling words out of titles', () => {
    const out = parseCommand('block 2h for spec review tomorrow at 9', NOW)
    expect(out.places![0]).toMatchObject({
      title: 'spec review',
      dayOffset: 1,
      startMin: 9 * 60,
      durationMin: 120,
    })
  })

  it('recognizes completions and moves', () => {
    expect(parseCommand('done with the deck', NOW)).toMatchObject({
      kind: 'complete',
      query: 'deck',
    })
    expect(parseCommand('move the deck to thursday at 9', NOW)).toMatchObject({
      kind: 'move',
      query: 'deck',
      toStartMin: 9 * 60,
    })
  })

  it('captures bare intentions for the when-&-where nudge', () => {
    expect(parseCommand('call the bank', NOW)).toMatchObject({
      kind: 'capture',
      title: 'call the bank',
    })
  })

  it('treats questions as chat', () => {
    expect(parseCommand('how is my week looking?', NOW).kind).toBe('chat')
  })

  it('recognizes clear / start-over asks with scope (mews + calendar events stay)', () => {
    expect(parseCommand('cleanup my calendar so that i could restart and plan', NOW)).toMatchObject(
      {
        kind: 'clear',
        scope: 'upcoming',
      }
    )
    expect(parseCommand('clear today', NOW)).toMatchObject({ kind: 'clear', scope: 'today' })
    expect(parseCommand('wipe this week and start fresh', NOW)).toMatchObject({
      kind: 'clear',
      scope: 'week',
    })
    expect(parseCommand('reset tomorrow please, the plan is wrong', NOW)).toMatchObject({
      kind: 'clear',
      scope: 'tomorrow',
    })
  })

  it('never turns conversation into tasks — greetings and acks are chat', () => {
    for (const text of ['hello pixie', 'hey', 'good morning', 'thanks', 'ok cool', 'how are you']) {
      expect(parseCommand(text, NOW).kind, text).toBe('chat')
    }
    // real intentions still capture
    expect(parseCommand('call the bank', NOW).kind).toBe('capture')
  })

  describe('edits (the user complaint: "put prod release for 45 mins, still has the full 1 hour")', () => {
    it('"make the prod release 45 mins" → edit durationMin 45', () => {
      const i = parseCommand('make the prod release 45 mins', NOW)
      expect(i).toMatchObject({ kind: 'edit', query: 'prod release', edit: { durationMin: 45 } })
    })

    it('"shorten the deck to 30m" → edit durationMin 30', () => {
      const i = parseCommand('shorten the deck to 30m', NOW)
      expect(i).toMatchObject({ kind: 'edit', query: 'deck', edit: { durationMin: 30 } })
    })

    it('"extend gym to 1.5h" → edit durationMin 90', () => {
      const i = parseCommand('extend gym to 1.5h', NOW)
      expect(i).toMatchObject({ kind: 'edit', query: 'gym', edit: { durationMin: 90 } })
    })

    it('"wake should be 6:00-6:30" → edit retimes the window', () => {
      const i = parseCommand('wake should be 6:00-6:30', NOW)
      expect(i).toMatchObject({ kind: 'edit', query: 'wake', edit: { startMin: 360, endMin: 390 } })
    })

    it('"make a plan for tomorrow" is NOT an edit', () => {
      const i = parseCommand('make a plan for tomorrow', NOW)
      expect(i.kind).not.toBe('edit')
    })
  })

  describe('name + time targeting and rename (#334 — "check name AND timestamp both")', () => {
    it('"rename the deck to q3 deck" → edit the title', () => {
      expect(parseCommand('rename the deck to q3 deck', NOW)).toMatchObject({
        kind: 'edit',
        query: 'deck',
        edit: { title: 'q3 deck' },
      })
    })

    it('a name+time rename pins the target with `at`', () => {
      expect(parseCommand('rename release at 19:45 to v1.2-rc', NOW)).toMatchObject({
        kind: 'edit',
        query: 'release',
        at: '19:45',
        edit: { title: 'v1.2-rc' },
      })
    })

    it('a name+time duration edit pins the target', () => {
      expect(parseCommand('make the release at 19:45 45 min', NOW)).toMatchObject({
        kind: 'edit',
        query: 'release',
        at: '19:45',
        edit: { durationMin: 45 },
      })
    })

    it('"done with the release at 19:45" pins which one is a mew', () => {
      expect(parseCommand('done with the release at 19:45', NOW)).toMatchObject({
        kind: 'complete',
        query: 'release',
        at: '19:45',
      })
    })

    it('a move reads the target time and the destination separately', () => {
      expect(parseCommand('move the release at 19:45 to friday', NOW)).toMatchObject({
        kind: 'move',
        query: 'release',
        at: '19:45',
        toDayKey: '3', // Tue → Fri
      })
    })
  })

  describe('targeted removal ("drop both and create afresh" must not wipe the day)', () => {
    it('"drop the prod release" → remove with the title query', () => {
      expect(parseCommand('drop the prod release', NOW)).toMatchObject({
        kind: 'remove',
        query: 'prod release',
      })
    })

    it('"remove both doc review blocks" strips the scaffolding and flags all', () => {
      expect(parseCommand('remove both doc review blocks', NOW)).toMatchObject({
        kind: 'remove',
        query: 'doc review',
        remove: { all: true },
      })
    })

    it('"cancel gym tomorrow" stays a removal, with time words stripped', () => {
      expect(parseCommand('cancel gym tomorrow', NOW)).toMatchObject({
        kind: 'remove',
        query: 'gym',
      })
    })

    it('a start time pins which one and stays out of the title (#105)', () => {
      const out = parseCommand('remove the sleep block 22:30-5', NOW)
      expect(out).toMatchObject({ kind: 'remove', query: 'sleep', remove: { at: '22:30' } })
      expect(out.query).not.toMatch(/22:30|:/) // the clock never leaks into the title
      expect(out.remove?.all).toBeFalsy() // a single pin is not "all"
    })

    it('a bare "drop the prod release" carries no opts — the executor will ask', () => {
      const out = parseCommand('drop the prod release', NOW)
      expect(out).toMatchObject({ kind: 'remove', query: 'prod release' })
      expect(out.remove).toBeUndefined()
    })
  })
})

describe('background + due grammar (attention model)', () => {
  it('round-trips the acceptance sentence: "swap iphone 3h in the background due 1pm"', () => {
    const out = parseCommand('swap iphone 3h in the background due 1pm', NOW)
    expect(out.kind).toBe('plan')
    expect(out.places).toHaveLength(1)
    expect(out.places![0]).toMatchObject({
      title: 'swap iphone',
      attention: 'background',
      due: 780,
      durationMin: 180,
    })
  })

  it('verb-led forms carry the cues too, with clean titles', () => {
    const out = parseCommand('block 2h for the data migration in the background due by 4pm', NOW)
    expect(out.places![0]).toMatchObject({
      title: 'data migration',
      attention: 'background',
      due: 16 * 60,
      durationMin: 120,
    })
  })

  it('"must finish by" reads as a due; no background cue stays focus', () => {
    const out = parseCommand('block 1h for the export, must finish by 3pm', NOW)
    expect(out.places![0]).toMatchObject({ title: 'export', due: 15 * 60 })
    expect(out.places![0].attention).toBeUndefined()
  })

  it('a bare verbless phrase without cues still becomes a capture, not a block', () => {
    expect(parseCommand('call the bank', NOW)).toMatchObject({ kind: 'capture' })
  })

  it('plain blocks stay exactly as before — no attention, no due', () => {
    const out = parseCommand('block thursday morning for the deck', NOW)
    expect(out.places![0].attention).toBeUndefined()
    expect(out.places![0].due).toBeUndefined()
  })
})

describe('remember — the floor learns standing rules', () => {
  it('"remember that gym is always at 7am" → structured time-default', () => {
    expect(parseCommand('remember that gym is always at 7am', NOW)).toEqual({
      kind: 'remember',
      pref: {
        kind: 'time-default',
        match: 'gym',
        value: 'starts 07:00',
        stated: 'gym is always at 7am',
      },
    })
  })

  it('duration, flexibility, and ordering shapes parse to their kinds', () => {
    expect(parseCommand('remember the standup always takes 15 min', NOW).pref).toMatchObject({
      kind: 'duration-default',
      match: 'standup',
      value: '15m',
    })
    expect(parseCommand('remember that the walk never moves', NOW).pref).toMatchObject({
      kind: 'flexibility',
      match: 'walk',
      value: 'never moves',
    })
    expect(parseCommand('remember review always comes before standup', NOW).pref).toMatchObject({
      kind: 'ordering',
      match: 'review',
      value: 'before standup',
    })
  })

  it('anything else lands as a verbatim fact', () => {
    const out = parseCommand('remember order lunch means the errand', NOW)
    expect(out.pref).toMatchObject({ kind: 'fact', value: 'order lunch means the errand' })
  })

  it('one-offs never become rules: "move gym to 8 today" stays a move', () => {
    expect(parseCommand('move gym to 8 today', NOW).kind).toBe('move')
  })

  it('"remember to <verb>" is a TODO, not a rule — it captures; "remember that" still rules', () => {
    expect(parseCommand('remember to call the bank', NOW)).toMatchObject({
      kind: 'capture',
      title: 'call the bank',
    })
    expect(parseCommand('remember that gym is always 7am', NOW)).toMatchObject({
      kind: 'remember',
      pref: { kind: 'time-default', match: 'gym', value: 'starts 07:00' },
    })
  })
})

describe('show insights — the read-only ask (#287)', () => {
  it('recognized in its plain forms, carrying no fields', () => {
    expect(parseCommand('show insights', NOW)).toEqual({ kind: 'insights' })
    expect(parseCommand('insights', NOW)).toEqual({ kind: 'insights' })
    expect(parseCommand('show me my insights?', NOW)).toEqual({ kind: 'insights' })
    expect(parseCommand('Show the insights.', NOW)).toEqual({ kind: 'insights' })
  })

  it('never becomes a capture, and prose around the word stays what it was', () => {
    expect(parseCommand('insights', NOW).kind).not.toBe('capture')
    /* questions about the week keep their chat path (templated replies) */
    expect(parseCommand("how's my week looking?", NOW).kind).toBe('chat')
    /* a real task that merely contains the word still captures */
    expect(parseCommand('write up the insights report', NOW).kind).toBe('capture')
  })
})

describe('conversational referents — grammar → sentinel (#320)', () => {
  it('deictic "it/that/this" with no other noun becomes the @referent sentinel', () => {
    expect(parseCommand('done with it', NOW)).toMatchObject({
      kind: 'complete',
      query: '@referent',
    })
    expect(parseCommand('delete that', NOW)).toMatchObject({ kind: 'remove', query: '@referent' })
    expect(parseCommand('drop that one', NOW)).toMatchObject({ kind: 'remove', query: '@referent' })
  })

  it('relative time shifts move the referent by signed minutes', () => {
    expect(parseCommand('move it 30 min earlier', NOW)).toEqual({
      kind: 'move',
      query: '@referent',
      relStartMin: -30,
    })
    expect(parseCommand('push it back an hour', NOW)).toEqual({
      kind: 'move',
      query: '@referent',
      relStartMin: 60,
    })
    expect(parseCommand('move it half an hour later', NOW)).toMatchObject({ relStartMin: 30 })
    expect(parseCommand('move the deck 15 min later', NOW)).toEqual({
      kind: 'move',
      query: 'deck',
      relStartMin: 15,
    })
  })

  it('a placement verb with a direction word stays a plan, never a relative move', () => {
    expect(parseCommand('block gym an hour later today', NOW).kind).toBe('plan')
  })

  it('"make it 45" / "make that 90 min" is an absolute duration on the referent', () => {
    expect(parseCommand('make it 45', NOW)).toEqual({
      kind: 'edit',
      query: '@referent',
      edit: { durationMin: 45 },
    })
    expect(parseCommand('make that 90 min', NOW)).toEqual({
      kind: 'edit',
      query: '@referent',
      edit: { durationMin: 90 },
    })
  })

  it('relative durations parse against the referent (longer/shorter/another/by)', () => {
    expect(parseCommand('make it longer', NOW)).toEqual({
      kind: 'edit',
      query: '@referent',
      edit: { relDurationMin: 15 },
    })
    expect(parseCommand('make it shorter', NOW)).toMatchObject({ edit: { relDurationMin: -15 } })
    expect(parseCommand('give it another 30', NOW)).toEqual({
      kind: 'edit',
      query: '@referent',
      edit: { relDurationMin: 30 },
    })
    expect(parseCommand('extend it by an hour', NOW)).toMatchObject({
      edit: { relDurationMin: 60 },
    })
    expect(parseCommand('shorten it by 15', NOW)).toMatchObject({ edit: { relDurationMin: -15 } })
    expect(parseCommand('make it 45 min longer', NOW)).toMatchObject({
      edit: { relDurationMin: 45 },
    })
  })

  it('positional targets encode as @after/@before/@next/@at sentinels', () => {
    expect(parseCommand('move the block after lunch to 4pm', NOW)).toEqual({
      kind: 'move',
      query: '@after:lunch',
      toDayKey: undefined,
      toStartMin: 16 * 60,
    })
    expect(parseCommand('move the one before the meeting to 2pm', NOW)).toMatchObject({
      kind: 'move',
      query: '@before:meeting',
      toStartMin: 14 * 60,
    })
    expect(parseCommand('move my next block to 3pm', NOW)).toMatchObject({
      kind: 'move',
      query: '@next',
      toStartMin: 15 * 60,
    })
    expect(parseCommand('move the 3pm to 4pm', NOW)).toMatchObject({
      kind: 'move',
      query: '@at:900',
      toStartMin: 16 * 60,
    })
  })

  it('"start it at 2 instead" retimes the referent to an absolute start', () => {
    expect(parseCommand('start it at 2 instead', NOW)).toEqual({
      kind: 'move',
      query: '@referent',
      toStartMin: 14 * 60,
    })
  })

  it('a NAMED target still resolves the ordinary way (no sentinel, no regression)', () => {
    expect(parseCommand('make the release 45 mins', NOW)).toEqual({
      kind: 'edit',
      query: 'release',
      edit: { durationMin: 45 },
    })
    expect(parseCommand('move the deck to thursday at 9', NOW)).toMatchObject({
      kind: 'move',
      query: 'deck',
    })
    expect(parseCommand('done with the walk', NOW)).toMatchObject({
      kind: 'complete',
      query: 'walk',
    })
  })
})

describe('recurring-edit scope words on the keyless floor (#343)', () => {
  it('lifts the scope word off the top and strips it from the remainder', () => {
    expect(extractSeriesScope('remove the gym just this one')).toEqual({
      scope: 'this',
      text: 'remove the gym',
    })
    expect(extractSeriesScope('standup should be 10:00-10:30 this and following')).toEqual({
      scope: 'following',
      text: 'standup should be 10:00-10:30',
    })
    expect(extractSeriesScope('drop the gym from now on')).toMatchObject({ scope: 'following' })
    expect(extractSeriesScope('make the gym 45 min across the whole series')).toMatchObject({
      scope: 'series',
    })
  })

  it('leaves a bare "all" alone — the remove grammar already reads it as the series', () => {
    expect(extractSeriesScope('remove all the gym').scope).toBeUndefined()
    expect(extractSeriesScope('block thursday for the deck').scope).toBeUndefined()
  })

  it('attaches seriesScope to a remove intent, with the scope phrase out of the query', () => {
    const out = parseCommand('remove the gym just this one', NOW)
    expect(out).toMatchObject({ kind: 'remove', query: 'gym', seriesScope: 'this' })
    expect(out.query).not.toMatch(/this one/)
  })

  it('attaches seriesScope to an edit intent and still parses the edit cleanly', () => {
    const out = parseCommand('standup should be 10:00-10:30 across the whole series', NOW)
    expect(out).toMatchObject({
      kind: 'edit',
      query: 'standup',
      seriesScope: 'series',
      edit: { startMin: 10 * 60, endMin: 10 * 60 + 30 },
    })
  })

  it('does not attach a scope to a non-edit/remove ask (only edit/remove carry it)', () => {
    // "just this one" strips but has nowhere to land on a plan ask — no seriesScope
    expect(parseCommand('block thursday for the deck', NOW).seriesScope).toBeUndefined()
  })
})

describe('granular ops — resize / duplicate / relative-move (#335)', () => {
  describe('resize (duration-only, keeps the start)', () => {
    it('"make the deck 30 min longer" → a NAMED relative resize (+30), not an absolute edit', () => {
      // the bug this fixes: durEdit would drop "longer" and set 30 absolute
      expect(parseCommand('make the deck 30 min longer', NOW)).toMatchObject({
        kind: 'resize',
        query: 'deck',
        resize: { relDurationMin: 30 },
      })
    })

    it('bare "make the deck shorter" defaults to −15', () => {
      expect(parseCommand('make the deck shorter', NOW)).toMatchObject({
        kind: 'resize',
        query: 'deck',
        resize: { relDurationMin: -15 },
      })
    })

    it('"shorten the review by 15" / "extend the standup by 20" → signed relative resize', () => {
      expect(parseCommand('shorten the review by 15', NOW)).toMatchObject({
        kind: 'resize',
        query: 'review',
        resize: { relDurationMin: -15 },
      })
      expect(parseCommand('extend the standup by 20', NOW)).toMatchObject({
        kind: 'resize',
        query: 'standup',
        resize: { relDurationMin: 20 },
      })
    })

    it('"resize standup to 45" → an absolute resize', () => {
      expect(parseCommand('resize standup to 45', NOW)).toMatchObject({
        kind: 'resize',
        query: 'standup',
        resize: { durationMin: 45 },
      })
    })

    it('a name+time handle pins which one to resize', () => {
      expect(parseCommand('make the release at 19:45 30 min longer', NOW)).toMatchObject({
        kind: 'resize',
        query: 'release',
        at: '19:45',
        resize: { relDurationMin: 30 },
      })
    })

    it('a scope word carries through to the resize (recurring)', () => {
      expect(parseCommand('make the gym 15 min longer across the whole series', NOW)).toMatchObject(
        {
          kind: 'resize',
          query: 'gym',
          seriesScope: 'series',
          resize: { relDurationMin: 15 },
        }
      )
    })

    it('no regression: referent "make it longer" and absolute "make the release 45 mins" stay edits', () => {
      expect(parseCommand('make it longer', NOW).kind).toBe('edit')
      expect(parseCommand('make the release 45 mins', NOW)).toMatchObject({
        kind: 'edit',
        query: 'release',
        edit: { durationMin: 45 },
      })
      // "shorten X to N" is absolute → stays an edit, not a resize-by
      expect(parseCommand('shorten the deck to 30m', NOW)).toMatchObject({
        kind: 'edit',
        edit: { durationMin: 30 },
      })
    })
  })

  describe('duplicate (copy to another day/time)', () => {
    it('"duplicate the deck to friday" → copy with a day offset (Tue→Fri = 3)', () => {
      expect(parseCommand('duplicate the deck to friday', NOW)).toMatchObject({
        kind: 'duplicate',
        query: 'deck',
        duplicate: { toDayOffset: 3 },
      })
    })

    it('"copy the standup to tomorrow" → toDayOffset 1', () => {
      expect(parseCommand('copy the standup to tomorrow', NOW)).toMatchObject({
        kind: 'duplicate',
        query: 'standup',
        duplicate: { toDayOffset: 1 },
      })
    })

    it('a source name+time and a destination time are read separately', () => {
      expect(parseCommand('clone the release at 19:45 to monday', NOW)).toMatchObject({
        kind: 'duplicate',
        query: 'release',
        at: '19:45',
        duplicate: { toDayOffset: 6 }, // Tue → next Mon
      })
      expect(parseCommand('duplicate the deck to friday at 9', NOW)).toMatchObject({
        kind: 'duplicate',
        query: 'deck',
        duplicate: { toDayOffset: 3, toStartMin: 9 * 60 },
      })
    })

    it('"copy the deck" with no destination carries an empty target (executor auto-places)', () => {
      const out = parseCommand('copy the deck', NOW)
      expect(out).toMatchObject({ kind: 'duplicate', query: 'deck' })
      expect(out.duplicate).toEqual({})
    })

    it('a referent source works too: "duplicate it to friday"', () => {
      expect(parseCommand('duplicate it to friday', NOW)).toMatchObject({
        kind: 'duplicate',
        query: '@referent',
        duplicate: { toDayOffset: 3 },
      })
    })
  })

  describe('relative-move (no absolute time)', () => {
    it('bare "push the deck later" → relmove later (no amount)', () => {
      expect(parseCommand('push the deck later', NOW)).toMatchObject({
        kind: 'relmove',
        query: 'deck',
        relmove: { direction: 'later' },
      })
    })

    it('"move it earlier" → relmove earlier on the referent', () => {
      expect(parseCommand('move it earlier', NOW)).toMatchObject({
        kind: 'relmove',
        query: '@referent',
        relmove: { direction: 'earlier' },
      })
    })

    it('"move the deck to the next free slot" → relmove next_free', () => {
      expect(parseCommand('move the deck to the next free slot', NOW)).toMatchObject({
        kind: 'relmove',
        query: 'deck',
        relmove: { direction: 'next_free' },
      })
    })

    it('"push the deck to the next day" / "bump the report a day later" → relmove next_day', () => {
      expect(parseCommand('push the deck to the next day', NOW)).toMatchObject({
        kind: 'relmove',
        query: 'deck',
        relmove: { direction: 'next_day' },
      })
      expect(parseCommand('bump the report a day later', NOW)).toMatchObject({
        kind: 'relmove',
        query: 'report',
        relmove: { direction: 'next_day' },
      })
    })

    it('no regression: an amount keeps it a move, an absolute destination stays a move', () => {
      expect(parseCommand('move the deck 15 min later', NOW)).toMatchObject({
        kind: 'move',
        query: 'deck',
        relStartMin: 15,
      })
      expect(parseCommand('move the deck to thursday at 9', NOW).kind).toBe('move')
    })
  })
})

describe('remember — energy-fit standing rules (#321)', () => {
  it('"remember batch my admin" → the canonical admin-batch ordering rule', () => {
    expect(parseCommand('remember batch my admin', NOW)).toEqual({
      kind: 'remember',
      pref: { kind: 'ordering', match: 'admin', value: 'batch', stated: 'batch my admin' },
    })
  })

  it('"remember keep admin quick and dusted" → the same batch rule', () => {
    expect(parseCommand('remember keep admin quick and dusted', NOW).pref).toMatchObject({
      kind: 'ordering',
      match: 'admin',
      value: 'batch',
    })
  })

  it('"remember I do deep work anytime" → the deep-work flexibility rule', () => {
    expect(parseCommand('remember I do deep work anytime', NOW).pref).toMatchObject({
      kind: 'flexibility',
      match: 'deep work',
      value: 'anytime',
    })
  })

  it('"remember don\'t gate my mornings" → the same deep-work flexibility rule', () => {
    expect(parseCommand("remember don't gate my mornings", NOW).pref).toMatchObject({
      kind: 'flexibility',
      match: 'deep work',
      value: 'anytime',
    })
  })
})

describe('inbox capture lead-ins (#348)', () => {
  it('“add X to my list/inbox” captures just X', () => {
    expect(parseCommand('add milk to my list', NOW)).toMatchObject({
      kind: 'capture',
      title: 'milk',
    })
    expect(parseCommand('add call the bank to my inbox', NOW)).toMatchObject({
      kind: 'capture',
      title: 'call the bank',
    })
  })
  it('“remind me to/about X” captures just X (strips the lead-in)', () => {
    expect(parseCommand('remind me to call the plumber', NOW)).toMatchObject({
      kind: 'capture',
      title: 'call the plumber',
    })
    expect(parseCommand('remind me about the renewal', NOW)).toMatchObject({
      kind: 'capture',
      title: 'renewal', // cleanTitle strips the leading article
    })
  })
  it('never swallows a timed plan or a list readout', () => {
    // no "…to my list" tail → a timed ask stays the plan path, not the inbox
    expect(parseCommand('add lunch at 1pm', NOW).kind).not.toBe('capture')
    // a read-only readout is never a capture
    expect(parseCommand('list my blocks', NOW).kind).toBe('list')
  })
})
