import { useApi } from '../hooks/useApi'
import { NamingChoice } from '../components/NamingChoice'
import type { AgentsResp } from '../types'

/**
 * Shown once, before a naming mode is saved. Crew seats come from the API.
 */
export default function FirstRun() {
  const agentsQ = useApi<AgentsResp>('/agents')
  const agents = agentsQ.data?.agents ?? []

  return (
    <div className="mc-scroll grid min-h-dvh place-items-center bg-mc-bg px-6 py-10">
      <div className="mc-card w-full max-w-2xl px-8 py-8">
        {!agentsQ.data && agentsQ.loading ? (
          <p className="text-[14px] text-mc-sub">Loading agents</p>
        ) : (
          <NamingChoice
            agents={agents}
            initialMode={null}
            initialMap={{}}
            intro
            submitLabel="Continue"
          />
        )}
        {agentsQ.errorMessage && !agentsQ.data && (
          <p className="mt-3 text-[13px] text-mc-orangetext">Could not load agents ({agentsQ.errorMessage}).</p>
        )}
      </div>
    </div>
  )
}
