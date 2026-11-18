import { useCallback, useState } from 'react'
import { modeForColumn, readSortMap, writeSortMap, type SortMode } from './ticket-sort'

/** Per browser column order. A blocked store keeps the defaults. */
export function useTicketSort() {
  const [map, setMap] = useState(() => readSortMap())
  const setMode = useCallback((column: string, mode: SortMode) => {
    setMap((prev) => {
      const next = { ...prev, [column]: mode }
      writeSortMap(next)
      return next
    })
  }, [])
  const modeFor = useCallback((column: string) => modeForColumn(map, column), [map])
  return { modeFor, setMode }
}
