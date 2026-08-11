/* Drag-to-reschedule interaction hook (#158) — owns the press→drag→drop gesture
   for the week grid: threshold arming, live drop tracking, conflict set, the
   ghost footprint, Escape abort, and the bounce on a rejected drop. All the
   geometry is pure (dragGeometry.ts); all mutation goes through the store's
   dragMove (the executor law). The view just wires the returned handlers/refs to
   the DOM and renders the ghost — keeping WeekColumns a thin skin. */

import { useEffect, useRef, useState } from 'react'
import type { Block } from '../../domain/types'
import { useMew } from '../../state/store'
import { isBackground, isFixedTime } from '../../domain/week'
import {
  type ColRect,
  type DragState,
  dropTarget,
  ghostConflicts,
  isMoved,
  isResized,
  resizeTo,
  startDrag,
  startResize,
} from './dragGeometry'

/* a press only becomes a drag past this many px — below it a click still pins,
   so direct manipulation never steals the pin/preview interaction. */
const DRAG_THRESHOLD = 4
/* same transparency rule the domain uses (conflictsWith / findFreeSlot): an
   optional block holds no slot unless it's fixed-time; a background block never
   holds the slot. Kept identical so the live ghost glow matches a real drop. */
const transparent = (b: Block): boolean => (!!b.optional && !isFixedTime(b)) || isBackground(b)

export interface GridDrag {
  /** live drag, or null when idle — the view dims the source + renders the ghost */
  drag: DragState | null
  /** the ghost's grid-relative horizontal footprint (full target column) */
  ghostBox: { left: number; width: number } | null
  /** ids of blocks the candidate drop would overlap — painted with a warning glow */
  dragClash: Set<string>
  /** the block bouncing back after a rejected drop (external/conflict) */
  bouncedId: string | null
  /** attach to the grid container — column rects + ghost coords are read from it */
  gridRef: React.RefObject<HTMLDivElement | null>
  /** call on a block's onMouseDown to arm a potential drag (move) */
  beginPress: (b: Block, e: React.MouseEvent) => void
  /** call on an edge handle's onMouseDown to arm a potential resize */
  beginResize: (b: Block, edge: 'top' | 'bottom', e: React.MouseEvent) => void
  /** true on the click that trails a real drag — the view swallows exactly one */
  consumeSuppressedClick: () => boolean
}

/** Drives the week-grid drag. `H` is the column height (px); `onArm` fires the
    instant a press promotes to a real drag (the view clears any hover preview). */
export function useGridDrag(H: number, onArm: () => void): GridDrag {
  const dragMove = useMew((s) => s.dragMove)
  const blocks = useMew((s) => s.blocks)

  const [drag, setDrag] = useState<DragState | null>(null)
  const [ghostBox, setGhostBox] = useState<{ left: number; width: number } | null>(null)
  const [dragClash, setDragClash] = useState<Set<string>>(new Set())
  const [bouncedId, setBouncedId] = useState<string | null>(null)

  const gridRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const pressRef = useRef<{ startX: number; startY: number; armed: boolean } | null>(null)
  const pressSeedRef = useRef<DragState | null>(null)
  const colRectsRef = useRef<ColRect[]>([])
  const suppressClickRef = useRef(false)

  /* the listener effect mounts once; everything it reads that can change between
     frames is held in a ref, kept fresh by the effect below — so it never
     re-subscribes and never reads a stale closure. */
  const blocksRef = useRef(blocks)
  const dragMoveRef = useRef(dragMove)
  const onArmRef = useRef(onArm)
  useEffect(() => {
    blocksRef.current = blocks
    dragMoveRef.current = dragMove
    onArmRef.current = onArm
  })

  // snapshot every day column's on-screen box now — widths vary (the selected
  // day is 2.3×), so the day hit-test reads real rects, not a uniform stride
  const captureColumns = () => {
    const grid = gridRef.current
    if (!grid) return
    colRectsRef.current = [...grid.querySelectorAll<HTMLElement>('[data-daykey]')].map((col) => {
      const r = col.getBoundingClientRect()
      return { dayKey: col.dataset.daykey!, left: r.left, right: r.right }
    })
  }

  const beginPress = (b: Block, e: React.MouseEvent) => {
    /* external (calendar) blocks bounce on drop, but the grab itself is allowed
       so the gesture feels live and chat can explain — acceptance is "returns to
       origin", not "can't pick up". A plain click still works for every block. */
    /* claim the press for the gesture: without this a grid press can start a
       text selection, and a later press over selected tile text starts a
       NATIVE drag session — mousemove/mouseup stop mid-gesture and the drag
       freezes armed (seen on CI runners; onDragStart below is the backstop).
       preventDefault also suppresses mousedown's click-to-focus, so restore
       it by hand — the roving tab stop (#303) must still follow a click. */
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.focus({ preventScroll: true })
    pressRef.current = { startX: e.clientX, startY: e.clientY, armed: false }
    const grabOffsetPx = e.clientY - el.getBoundingClientRect().top
    captureColumns()
    pressSeedRef.current = startDrag(b, grabOffsetPx)
  }

  const beginResize = (b: Block, edge: 'top' | 'bottom', e: React.MouseEvent) => {
    // the handle sits inside the block — claim the press so it resizes, never
    // also starting a move (beginPress) or pinning the card underneath
    e.stopPropagation()
    if (e.button !== 0) return
    e.preventDefault() // same claim as beginPress — an edge drag must not select text
    // the handle isn't focusable; hand focus to its tile like the default would have
    ;(e.currentTarget as HTMLElement).closest<HTMLElement>('.nxb-blk')?.focus({
      preventScroll: true,
    })
    pressRef.current = { startX: e.clientX, startY: e.clientY, armed: false }
    captureColumns()
    pressSeedRef.current = startResize(b, edge)
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const press = pressRef.current
      const seed = pressSeedRef.current
      if (!press || !seed) return
      if (!press.armed) {
        const far = Math.hypot(e.clientX - press.startX, e.clientY - press.startY) >= DRAG_THRESHOLD
        if (!far) return
        press.armed = true
        onArmRef.current()
        setDrag(seed)
      }
      const grid = gridRef.current
      if (!grid) return
      const gr = grid.getBoundingClientRect()
      const cur = dragRef.current ?? seed
      let next: DragState
      if (cur.mode === 'resize') {
        // an edge follows the cursor; the day and the anchored edge stay put
        const r = resizeTo(cur, e.clientY, gr.top, H)
        next = { ...cur, toStartMin: r.toStartMin, durationMin: r.durationMin }
      } else {
        const t = dropTarget(cur, e.clientX, gr.top, e.clientY, H, colRectsRef.current)
        next = { ...cur, toDayKey: t.dayKey, toStartMin: t.startMin }
      }
      dragRef.current = next
      setDrag(next)
      /* honest glow: red means the drop WILL bounce. A move bounces only off the
         blocks it can't schedule around (external/fixed + held); every other
         overlap is own-flexible work the move drifts (#324), so it stays calm. A
         resize moves nothing, so any overlap in its new span bounces it. Mirrors
         the store's gate (moveBlockedBy / conflictsWith) minus prefs. */
      const overlaps = ghostConflicts(blocksRef.current, next, transparent)
      const willBounce =
        next.mode === 'resize' ? overlaps : overlaps.filter((b) => isFixedTime(b) || b.protected)
      setDragClash(new Set(willBounce.map((bl) => bl.id)))
      // ghost spans the FULL target column (grid-relative) so a multi-lane drop
      // reads as landing across every occupied lane, not just lane 0
      const col = colRectsRef.current.find((c) => c.dayKey === next.toDayKey)
      if (col) setGhostBox({ left: col.left - gr.left + 4, width: col.right - col.left - 8 })
    }
    const reset = () => {
      dragRef.current = null
      setDrag(null)
      setGhostBox(null)
      setDragClash(new Set())
    }
    const finishPress = () => {
      pressRef.current = null
      pressSeedRef.current = null
    }
    const onUp = () => {
      const cur = dragRef.current
      const armed = pressRef.current?.armed === true
      finishPress()
      if (!armed || !cur) {
        reset() // never crossed threshold → a click; the block's onClick pins it
        return
      }
      suppressClickRef.current = true // swallow the click that trails a real drag
      reset()
      const changed = cur.mode === 'resize' ? isResized(cur) : isMoved(cur)
      if (!changed) return // dropped home → no-op, no chat
      // one door for both gestures: a resize passes its new length, a move omits
      // it (byte-unchanged move behaviour). The store validates + commits.
      const outcome =
        cur.mode === 'resize'
          ? dragMoveRef.current(cur.id, cur.toDayKey, cur.toStartMin, cur.durationMin)
          : dragMoveRef.current(cur.id, cur.toDayKey, cur.toStartMin)
      if (outcome === 'conflict' || outcome === 'external') {
        // bounce: the store left the week untouched; pulse the origin block
        const bouncedFor = cur.id
        setBouncedId(bouncedFor)
        window.setTimeout(() => setBouncedId((prev) => (prev === bouncedFor ? null : prev)), 360)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      // Escape aborts a drag mid-flight without mutation (acceptance)
      if (e.key === 'Escape' && (dragRef.current || pressRef.current)) {
        e.preventDefault()
        finishPress()
        reset()
      }
    }
    const onDragStart = (e: DragEvent) => {
      // backstop: a native drag (pre-existing selection, an image under the
      // press) would swallow mousemove/mouseup mid-gesture — the grid press
      // owns this pointer sequence
      if (pressRef.current) e.preventDefault()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    window.addEventListener('dragstart', onDragStart)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('dragstart', onDragStart)
    }
  }, [H])

  const consumeSuppressedClick = (): boolean => {
    if (!suppressClickRef.current) return false
    suppressClickRef.current = false
    return true
  }

  return {
    drag,
    ghostBox,
    dragClash,
    bouncedId,
    gridRef,
    beginPress,
    beginResize,
    consumeSuppressedClick,
  }
}
