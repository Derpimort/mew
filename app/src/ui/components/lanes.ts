/* Overlap lanes — greedy interval-graph coloring. Items in an overlapping
   cluster split the available space; everything in a cluster shares the same
   lane count so optional events sit beside hard blocks, not under them. */

export interface LaneSlot {
  lane: number
  lanes: number
}

export function layoutLanes<T>(
  items: T[],
  start: (t: T) => number,
  end: (t: T) => number,
  id: (t: T) => string
): Map<string, LaneSlot> {
  const sorted = [...items].sort((a, b) => start(a) - start(b) || end(a) - end(b))
  const res = new Map<string, LaneSlot>()
  const active: { end: number; lane: number }[] = []
  let cluster: string[] = []
  let clusterLanes = 0

  const closeCluster = () => {
    for (const cid of cluster) res.get(cid)!.lanes = clusterLanes
    cluster = []
    clusterLanes = 0
  }

  for (const item of sorted) {
    const s = start(item)
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].end <= s) active.splice(i, 1)
    }
    if (active.length === 0 && cluster.length) closeCluster()
    const used = new Set(active.map((a) => a.lane))
    let lane = 0
    while (used.has(lane)) lane++
    active.push({ end: end(item), lane })
    cluster.push(id(item))
    clusterLanes = Math.max(clusterLanes, lane + 1)
    res.set(id(item), { lane, lanes: 1 })
  }
  if (cluster.length) closeCluster()
  return res
}
