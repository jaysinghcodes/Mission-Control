/**
 * Group memory rows by the day the API already computed (America/Chicago).
 * Input is newest first. Days with no rows are not emitted. The same day
 * is not repeated when its rows are not adjacent.
 */

export function groupMemoryByDay<T extends { day: string }>(
  entries: T[],
): { day: string; entries: T[] }[] {
  const order: string[] = []
  const map = new Map<string, T[]>()
  for (const entry of entries) {
    if (!entry.day) continue
    const list = map.get(entry.day)
    if (list) {
      list.push(entry)
    } else {
      map.set(entry.day, [entry])
      order.push(entry.day)
    }
  }
  return order
    .map((day) => ({ day, entries: map.get(day) ?? [] }))
    .filter((group) => group.entries.length > 0)
}
