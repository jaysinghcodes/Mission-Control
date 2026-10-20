import { useState } from 'react'
import { NamingChoice } from '../components/NamingChoice'
import { ProviderStatus, type DetectedModel } from '../components/ProviderStatus'
import { TimezoneSelect } from '../components/TimezoneSelect'
import { Btn } from '../components/shell'
import { useApi } from '../hooks/useApi'
import { useNaming } from '../lib/naming'
import type { AgentsResp } from '../types'

/**
 * Shown once, until the operator finishes or skips.
 * Timezone, then names, then the detected provider.
 */

type Step = 'timezone' | 'naming' | 'provider'

interface ModelsResp { models?: DetectedModel[] }

export default function FirstRun() {
  const naming = useNaming()
  const agentsQ = useApi<AgentsResp>('/agents')
  const modelsQ = useApi<ModelsResp>('/models')
  const [step, setStep] = useState<Step>('timezone')
  const [zone, setZone] = useState(naming.timezone || naming.serverTimeZone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const agents = agentsQ.data?.agents ?? []
  const models = modelsQ.data?.models ?? []

  async function skip() {
    setBusy(true)
    setError(null)
    const message = await naming.save({ setupDone: true })
    setBusy(false)
    if (message) setError(message)
  }

  async function saveZone() {
    setBusy(true)
    setError(null)
    const message = await naming.save({ timezone: zone })
    setBusy(false)
    if (message) setError(message)
    else setStep('naming')
  }

  async function finish() {
    setBusy(true)
    setError(null)
    const message = await naming.save({ setupDone: true })
    setBusy(false)
    if (message) setError(message)
  }

  return (
    <div className="mc-scroll flex h-dvh min-h-0 flex-col items-center overflow-y-auto bg-mc-bg px-6 py-10">
      <div className="mc-card my-auto w-full max-w-2xl px-8 py-8" data-setup-step={step}>
        {step === 'timezone' && (
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-mc-faint">Step 1 of 3</p>
            <h1 className="mt-2 text-[28px] font-bold tracking-[-0.02em] text-mc-text">Choose a timezone</h1>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-mc-sub">
              Usage and memory count each day in this timezone. The server timezone is selected. You can change it later in Settings.
            </p>
            <div className="mt-6">
              <TimezoneSelect id="setup-timezone" value={zone} onChange={setZone} />
            </div>
            {error && <p className="mt-3 text-[13px] text-mc-orangetext">{error}</p>}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Btn kind="primary" onClick={() => void saveZone()} disabled={busy}>{busy ? 'Saving' : 'Continue'}</Btn>
              <Btn kind="ghost" onClick={() => void skip()} disabled={busy}>Skip setup</Btn>
            </div>
          </div>
        )}

        {step === 'naming' && (
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-mc-faint">Step 2 of 3</p>
            {!agentsQ.data && agentsQ.loading ? (
              <p className="mt-4 text-[14px] text-mc-sub">Loading agents</p>
            ) : (
              <div className="mt-2">
                <NamingChoice
                  agents={agents}
                  agentsReady={Boolean(agentsQ.data)}
                  initialMode={naming.mode}
                  initialMap={naming.map}
                  intro
                  submitLabel="Continue"
                  onSaved={() => setStep('provider')}
                />
              </div>
            )}
            {agentsQ.errorMessage && !agentsQ.data && (
              <p className="mt-3 text-[13px] text-mc-orangetext">Could not load agents ({agentsQ.errorMessage}).</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Btn kind="ghost" onClick={() => setStep('timezone')} disabled={busy}>Back</Btn>
              <Btn kind="ghost" onClick={() => void skip()} disabled={busy}>Skip setup</Btn>
            </div>
            {error && <p className="mt-3 text-[13px] text-mc-orangetext">{error}</p>}
          </div>
        )}

        {step === 'provider' && (
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-mc-faint">Step 3 of 3</p>
            <h1 className="mt-2 text-[28px] font-bold tracking-[-0.02em] text-mc-text">Confirm the provider</h1>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-mc-sub">
              This is the provider the bridge last reported. You can look again later in Settings.
            </p>
            <div className="mt-6">
              {!modelsQ.data && modelsQ.loading ? (
                <p className="text-[14px] text-mc-sub">Checking for a provider</p>
              ) : (
                <ProviderStatus models={models} />
              )}
            </div>
            {modelsQ.errorMessage && !modelsQ.data && (
              <p className="mt-3 text-[13px] text-mc-orangetext">Could not load providers ({modelsQ.errorMessage}).</p>
            )}
            {error && <p className="mt-3 text-[13px] text-mc-orangetext">{error}</p>}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {models.length > 0 ? (
                <Btn kind="primary" onClick={() => void finish()} disabled={busy}>{busy ? 'Saving' : 'Continue'}</Btn>
              ) : (
                <Btn kind="primary" onClick={() => void finish()} disabled={busy || (!modelsQ.data && modelsQ.loading)}>Skip</Btn>
              )}
              <Btn kind="ghost" onClick={() => setStep('naming')} disabled={busy}>Back</Btn>
              {models.length > 0 && (
                <Btn kind="ghost" onClick={() => void skip()} disabled={busy}>Skip setup</Btn>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
