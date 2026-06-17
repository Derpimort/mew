import { describe, expect, it } from 'vitest'
import { PREVIEW_GAP, sidePlacement, type Rect } from '../hoverPreview'

const STAGE = { width: 730, height: 560 }
const CARD = { width: 180, height: 120 }

function block(over: Partial<Rect>): Rect {
  return { left: 100, top: 100, width: 80, height: 30, ...over }
}

describe('sidePlacement — open toward the side with more room', () => {
  it('a left-edge block opens to its RIGHT, gap outside the block edge', () => {
    const b = block({ left: 40, width: 60 }) // hugging the left wall
    const p = sidePlacement(b, CARD, STAGE)
    expect(p.side).toBe('right')
    expect(p.x).toBe(40 + 60 + PREVIEW_GAP) // anchor.right + gap
  })

  it('a right-edge block opens to its LEFT, card sitting just before the block', () => {
    const b = block({ left: 620, width: 70 }) // 690 right edge, stage 730 wide
    const p = sidePlacement(b, CARD, STAGE)
    expect(p.side).toBe('left')
    expect(p.x).toBe(620 - PREVIEW_GAP - CARD.width) // anchor.left − gap − cardW
  })

  it('a tie (equal room) prefers the right side', () => {
    // center the block so left room == right room
    const w = 80
    const left = (STAGE.width - w) / 2
    const p = sidePlacement(block({ left, width: w }), CARD, STAGE)
    expect(p.side).toBe('right')
  })
})

describe('sidePlacement — never spill off-stage on X', () => {
  it('clamps a card whose gap is too small to ever leave the stage', () => {
    // block so far right that even opening left would push x negative without clamp
    const b = block({ left: 5, width: 10 }) // opens right (more room), tons of room — sanity
    const p = sidePlacement(b, CARD, STAGE)
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.x + CARD.width).toBeLessThanOrEqual(STAGE.width)
  })

  it('a wide card on a narrow left gap is pulled back inside, not off the left edge', () => {
    // narrow stage where left-opening would go negative
    const narrow = { width: 200, height: 560 }
    const b = block({ left: 150, width: 40 }) // right room 10, left room 150 → opens left
    const p = sidePlacement(b, CARD, narrow)
    expect(p.side).toBe('left')
    expect(p.x).toBeGreaterThanOrEqual(0) // clamped, never negative
  })
})

describe('sidePlacement — clamp Y so the card stays in view', () => {
  it('top-aligns to the block when there is room below', () => {
    const p = sidePlacement(block({ top: 80 }), CARD, STAGE)
    expect(p.y).toBe(80)
  })

  it('a block near the bottom pulls the card up so its bottom stays on-stage', () => {
    const p = sidePlacement(block({ top: 540, height: 20 }), CARD, STAGE)
    expect(p.y).toBeLessThan(540)
    expect(p.y + CARD.height).toBeLessThanOrEqual(STAGE.height)
  })

  it('a block taller than the stage still yields a fully visible card (Y-clamp)', () => {
    const tall = sidePlacement(block({ top: 0, height: 800 }), CARD, STAGE)
    expect(tall.y).toBeGreaterThanOrEqual(0)
    expect(tall.y + CARD.height).toBeLessThanOrEqual(STAGE.height)
  })

  it('never returns a negative Y even when anchored above the stage top', () => {
    const p = sidePlacement(block({ top: -50 }), CARD, STAGE)
    expect(p.y).toBeGreaterThanOrEqual(0)
  })
})
