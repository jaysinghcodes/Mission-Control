import { createContext, useContext, type ReactNode } from 'react'
import { apiSend, useApi } from '../hooks/useApi'
import {
  assignSeatsInOrder,
  findByLabel,
  orderByPosition,
  presentAgent,
  type CrewSeat,
  type NamedAgent,
  type NamingMode,
  type NamingState,
  type Presented,
} from './crew'

export interface SettingsResp {
  namingMode: NamingMode | null
  crewMap: Record<string, string>
  seats: CrewSeat[]
  ts: number
}

interface NamingValue extends NamingState {
  ready: boolean
  error: string | null
  reload: () => void
  save: (body: { namingMode: NamingMode; crewMap?: Record<string, string> }) => Promise<string | null>
}

const EMPTY: NamingValue = {
  mode: null,
  map: {},
  seats: [],
  ready: false,
  error: null,
  reload: () => {},
  save: async () => 'Naming is not ready',
}

const Ctx = createContext<NamingValue>(EMPTY)

export function NamingProvider({ children }: { children: ReactNode }) {
  const query = useApi<SettingsResp>('/settings')
  const data = query.data
  const state: NamingState = {
    mode: data?.namingMode ?? null,
    map: data?.crewMap ?? {},
    seats: data?.seats ?? [],
  }

  async function save(body: { namingMode: NamingMode; crewMap?: Record<string, string> }): Promise<string | null> {
    const res = await apiSend<SettingsResp>('PUT', '/settings', body)
    if (!res.ok || !res.data) return res.error ?? 'Could not save the choice'
    query.mutate(() => res.data)
    return null
  }

  const value: NamingValue = {
    ...state,
    ready: Boolean(data),
    error: query.errorMessage,
    reload: () => { void query.refetch() },
    save,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNaming() {
  const value = useContext(Ctx)
  return {
    ...value,
    present: (agent: NamedAgent): Presented => presentAgent(agent, value),
    find: <T extends NamedAgent>(agents: readonly T[], label: string | null | undefined) => findByLabel(agents, label, value),
    order: <T extends { id: string; position?: number | null }>(agents: readonly T[]) => orderByPosition(agents),
    assign: assignSeatsInOrder,
  }
}
