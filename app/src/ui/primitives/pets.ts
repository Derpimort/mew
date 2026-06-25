import type { PetId } from '../../domain/types'

/* Pet registry (PRD §3b) — the pet swaps only the accent pair; structure never changes.
   Swatch colors mirror the data-pet token registry in tokens.css.
   Lives apart from the component barrel so Fast Refresh stays clean
   (react-refresh/only-export-components). */
export const PETS: { id: PetId; name: string; c1: string; c2: string; who: string }[] = [
  { id: 'cat', name: 'Cat', c1: '#e9b96b', c2: '#d4c8a8', who: 'Pixie · golden british shorthair' },
  { id: 'dog', name: 'Dog', c1: '#e0975a', c2: '#cbb091', who: 'your good dog' },
  { id: 'fox', name: 'Fox', c1: '#e8825a', c2: '#d8a98f', who: 'a clever fox' },
  { id: 'bunny', name: 'Bunny', c1: '#dd9ab8', c2: '#c6b4d2', who: 'a soft rabbit' },
  { id: 'bird', name: 'Bird', c1: '#5fb6c0', c2: '#9fc9b2', who: 'a calm bird' },
]

export function petById(id: PetId) {
  return PETS.find((p) => p.id === id) ?? PETS[0]
}
