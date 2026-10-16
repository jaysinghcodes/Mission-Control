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
import { setOfflineWindowMs } from './sample-roster'
import { setActiveTimeZone } from './zone-day'

export interface SettingsResp {
  namingMode: NamingMode | null
  crewMap: Record<string, string>
  seats: CrewSeat[]
  timezone: string
  serverTimeZone: string
  timezoneSaved: boolean
  setupDone: boolean
  offlineAfterMs: number
  ts: number
}

export interface SettingsWrite {
  namingMode?: NamingMode
  crewMap?: Record<string, string>
  timezone?: string | null
  setupDone?: boolean
}

interface NamingValue extends NamingState {
  ready: boolean
  error: string | null
  timezone: string
  serverTimeZone: string
  setupDone: boolean
  offlineAfterMs: number
  reload: () => void
  save: (body: SettingsWrite) => Promise<string | null>
}

const EMPTY: NamingValue = {
  mode: null,
  map: {},
  seats: [],
  ready: false,
  error: null,
  timezone: 'UTC',
  serverTimeZone: 'UTC',
  setupDone: false,
  offlineAfterMs: 10 * 60 * 1000,
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
  if (data?.timezone) setActiveTimeZone(data.timezone)
  if (data?.offlineAfterMs) setOfflineWindowMs(data.offlineAfterMs)

  async function save(body: SettingsWrite): Promise<string | null> {
    const res = await apiSend<SettingsResp>('PUT', '/settings', body)
    if (!res.ok || !res.data) return res.error ?? 'Could not save the choice'
    if (res.data.timezone) setActiveTimeZone(res.data.timezone)
    if (res.data.offlineAfterMs) setOfflineWindowMs(res.data.offlineAfterMs)
    query.mutate(() => res.data)
    return null
  }

  const value: NamingValue = {
    ...state,
    ready: Boolean(data),
    error: query.errorMessage,
    timezone: data?.timezone ?? 'UTC',
    serverTimeZone: data?.serverTimeZone ?? data?.timezone ?? 'UTC',
    setupDone: Boolean(data?.setupDone),
    offlineAfterMs: data?.offlineAfterMs ?? 10 * 60 * 1000,
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
