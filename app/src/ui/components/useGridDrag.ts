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
  startDrag,
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
  /** call on a block's onMouseDown to arm a potential drag */
  beginPress: (b: Block, e: React.MouseEvent) => void
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

  const beginPress = (b: Block, e: React.MouseEvent) => {
    /* external (calendar) blocks bounce on drop, but the grab itself is allowed
       so the gesture feels live and chat can explain — acceptance is "returns to
       origin", not "can't pick up". A plain click still works for every block. */
    pressRef.current = { startX: e.clientX, startY: e.clientY, armed: false }
    const el = e.currentTarget as HTMLElement
    const grabOffsetPx = e.clientY - el.getBoundingClientRect().top
    // snapshot every day column's on-screen box now — widths vary (the selected
    // day is 2.3×), so the day hit-test reads real rects, not a uniform stride
    const grid = gridRef.current
    if (grid) {
      colRectsRef.current = [...grid.querySelectorAll<HTMLElement>('[data-daykey]')].map((col) => {
        const r = col.getBoundingClientRect()
        return { dayKey: col.dataset.daykey!, left: r.left, right: r.right }
      })
    }
    pressSeedRef.current = startDrag(b, grabOffsetPx)
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
      const t = dropTarget(cur, e.clientX, gr.top, e.clientY, H, colRectsRef.current)
      const next: DragState = { ...cur, toDayKey: t.dayKey, toStartMin: t.startMin }
      dragRef.current = next
      setDrag(next)
      setDragClash(new Set(ghostConflicts(blocksRef.current, next, transparent).map((bl) => bl.id)))
      // ghost spans the FULL target column (grid-relative) so a multi-lane drop
      // reads as landing across every occupied lane, not just lane 0
      const col = colRectsRef.current.find((c) => c.dayKey === t.dayKey)
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
      if (!isMoved(cur)) return // dropped home → no-op, no chat
      const outcome = dragMoveRef.current(cur.id, cur.toDayKey, cur.toStartMin)
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
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [H])

  const consumeSuppressedClick = (): boolean => {
    if (!suppressClickRef.current) return false
    suppressClickRef.current = false
    return true
  }

  return { drag, ghostBox, dragClash, bouncedId, gridRef, beginPress, consumeSuppressedClick }
}
