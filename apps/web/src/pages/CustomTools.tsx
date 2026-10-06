import { useState } from 'react'
import { useApi, apiSend } from '../hooks/useApi'
import { PageHeader, SoftCard, Btn, EmptyState, Banner, FieldError } from '../components/shell'
import { ExperimentalBadge, FilledPrompt, PlainText } from '../components/tool-preview'

/**
 * Experimental custom tools (ticket 10).
 * Placeholders are `{{name}}`. Preview and test run ask the API to fill
 * the template and render the string as text. Nothing is executed, and
 * the API does not call OpenClaw from those routes.
 */

interface ToolInput {
  name: string
  label?: string
}

interface CustomTool {
  id: string
  name: string
  description: string
  promptTemplate: string
  inputs: ToolInput[]
  createdAt: string
  updatedAt: string
}

interface ToolList {
  tools: CustomTool[]
}

interface DraftInput {
  name: string
  label: string
}

const EMPTY_INPUTS: DraftInput[] = [{ name: '', label: '' }]

function draftInputs(inputs: ToolInput[]): DraftInput[] {
  if (inputs.length === 0) return [{ name: '', label: '' }]
  return inputs.map((input) => ({ name: input.name, label: input.label ?? '' }))
}

function payloadInputs(inputs: DraftInput[]): { name: string; label?: string }[] {
  return inputs
    .filter((input) => input.name.trim() || input.label.trim())
    .map((input) => {
      const label = input.label.trim()
      return label ? { name: input.name, label } : { name: input.name }
    })
}

export default function CustomTools() {
  const { data, loading, errorMessage, refetch } = useApi<ToolList>('/custom-tools')
  const tools = data?.tools ?? []
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [promptTemplate, setPromptTemplate] = useState('')
  const [inputs, setInputs] = useState<DraftInput[]>(EMPTY_INPUTS)
  const [values, setValues] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<string | null>(null)
  const [runValues, setRunValues] = useState<Record<string, string>>({})
  const [runPrompt, setRunPrompt] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [running, setRunning] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const summary = !data
    ? (loading && !errorMessage ? 'Loading tools…' : 'Tools not loaded')
    : tools.length === 0
      ? 'No tools saved yet'
      : `${tools.length} saved ${tools.length === 1 ? 'tool' : 'tools'}`

  function resetForm() {
    setName('')
    setDescription('')
    setPromptTemplate('')
    setInputs(EMPTY_INPUTS.map((row) => ({ ...row })))
    setValues({})
    setPreview(null)
    setFieldError(null)
  }

  function openCreate() {
    setEditingId(null)
    setTestingId(null)
    setRunPrompt(null)
    setCreating(true)
    resetForm()
    setBanner(null)
  }

  function openEdit(tool: CustomTool) {
    setCreating(false)
    setTestingId(null)
    setRunPrompt(null)
    setEditingId(tool.id)
    setName(tool.name)
    setDescription(tool.description)
    setPromptTemplate(tool.promptTemplate)
    setInputs(draftInputs(tool.inputs))
    setValues({})
    setPreview(null)
    setFieldError(null)
    setBanner(null)
    setConfirmId(null)
  }

  function closeForm() {
    setCreating(false)
    setEditingId(null)
    setPreview(null)
    setFieldError(null)
  }

  function setInput(index: number, patch: Partial<DraftInput>) {
    setInputs((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    setPreview(null)
  }

  async function previewDraft() {
    if (previewing) return
    setPreviewing(true)
    setFieldError(null)
    const named = payloadInputs(inputs)
    const valueMap: Record<string, string> = {}
    for (const input of named) valueMap[input.name.trim()] = values[input.name] ?? values[input.name.trim()] ?? ''
    const r = await apiSend<{ prompt: string }>('POST', '/custom-tools/preview', {
      promptTemplate,
      inputs: named,
      values: valueMap,
    })
    setPreviewing(false)
    if (!r.ok) {
      setPreview(null)
      setFieldError(r.error ?? 'Could not preview')
      return
    }
    setBanner(null)
    setPreview(r.data?.prompt ?? '')
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setFieldError(null)
    const body = {
      name,
      description,
      promptTemplate,
      inputs: payloadInputs(inputs),
    }
    const r = editingId
      ? await apiSend<{ tool: CustomTool }>('PATCH', `/custom-tools/${editingId}`, body)
      : await apiSend<{ tool: CustomTool }>('POST', '/custom-tools', body)
    setSaving(false)
    if (!r.ok) {
      setFieldError(r.error ?? 'Could not save the tool')
      return
    }
    setBanner(null)
    closeForm()
    void refetch()
  }

  function openTest(tool: CustomTool) {
    setCreating(false)
    setEditingId(null)
    setPreview(null)
    setTestingId(tool.id)
    setRunPrompt(null)
    setRunValues({})
    setBanner(null)
    setConfirmId(null)
  }

  async function testRun(tool: CustomTool) {
    if (running) return
    setRunning(true)
    const valuesForRun: Record<string, string> = {}
    for (const input of tool.inputs) valuesForRun[input.name] = runValues[input.name] ?? ''
    const r = await apiSend<{ prompt: string }>('POST', `/custom-tools/${tool.id}/preview`, { values: valuesForRun })
    setRunning(false)
    if (!r.ok) {
      setRunPrompt(null)
      setBanner(r.error ?? 'Could not run the test')
      return
    }
    setBanner(null)
    setRunPrompt(r.data?.prompt ?? '')
  }

  async function remove(id: string) {
    if (deleting) return
    setDeleting(true)
    const r = await apiSend<{ deleted: string }>('DELETE', `/custom-tools/${id}`)
    setDeleting(false)
    if (!r.ok) {
      setBanner(r.error ?? 'Could not delete the tool')
      return
    }
    if (editingId === id) closeForm()
    if (testingId === id) {
      setTestingId(null)
      setRunPrompt(null)
    }
    setConfirmId(null)
    void refetch()
  }

  const formOpen = creating || editingId !== null
  const testing = tools.find((tool) => tool.id === testingId) ?? null

  return (
    <div>
      <PageHeader
        title="Custom tools"
        summary={summary}
        tools={<ExperimentalBadge />}
      />
      <p className="mb-4 text-[13px] text-mc-sub">
        Experimental. Placeholders use double braces, for example <span className="font-mono text-mc-text">{'{{topic}}'}</span>.
        Each placeholder needs an input with the same name. Preview and test run fill the template inside this app and call nothing else.
      </p>

      {errorMessage && (
        <Banner>Couldn&apos;t load tools ({errorMessage}). {data ? 'Showing the last loaded list.' : 'Retrying when you refresh.'}</Banner>
      )}
      {banner && <Banner onDismiss={() => setBanner(null)}>{banner}</Banner>}

      <div className="mb-4">
        <Btn kind="primary" onClick={openCreate}>New tool</Btn>
      </div>

      {formOpen && (
        <SoftCard className="mb-4 px-5 py-4">
          <div className="text-[15px] font-semibold">{editingId ? 'Edit tool' : 'New tool'}</div>
          <label className="mt-3 block text-[13px] font-semibold">
            Name
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setFieldError(null) }}
              aria-label="Tool name"
              className="mt-1 h-9 w-full max-w-md rounded-lg bg-mc-ctl px-3 text-[13px] font-normal outline-none"
            />
          </label>
          <label className="mt-3 block text-[13px] font-semibold">
            Description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label="Tool description"
              className="mt-1 h-9 w-full rounded-lg bg-mc-ctl px-3 text-[13px] font-normal outline-none"
            />
          </label>
          <label className="mt-3 block text-[13px] font-semibold">
            Prompt template
            <textarea
              value={promptTemplate}
              onChange={(e) => { setPromptTemplate(e.target.value); setPreview(null); setFieldError(null) }}
              aria-label="Prompt template"
              placeholder="Write a short brief about {{topic}} for {{audience}}."
              className="mt-1 h-28 w-full rounded-lg bg-mc-ctl px-3 py-2 font-mono text-[13px] font-normal outline-none"
            />
          </label>
          <p className="mt-1 text-[12.5px] text-mc-sub">
            Use <span className="font-mono text-mc-text">{'{{topic}}'}</span> for an input named topic. Letters, digits, and underscores only.
          </p>

          <div className="mt-4 text-[13px] font-semibold">Inputs</div>
          <div className="mt-2 space-y-2">
            {inputs.map((input, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <input
                  value={input.name}
                  onChange={(e) => setInput(index, { name: e.target.value })}
                  aria-label={`Input ${index + 1} name`}
                  placeholder="name"
                  className="h-9 w-40 rounded-lg bg-mc-ctl px-3 font-mono text-[13px] outline-none"
                />
                <input
                  value={input.label}
                  onChange={(e) => setInput(index, { label: e.target.value })}
                  aria-label={`Input ${index + 1} label`}
                  placeholder="Label (optional)"
                  className="h-9 w-48 rounded-lg bg-mc-ctl px-3 text-[13px] outline-none"
                />
                <Btn kind="plain" onClick={() => {
                  setInputs((rows) => rows.filter((_, i) => i !== index))
                  setPreview(null)
                }}>Remove</Btn>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <Btn kind="plain" onClick={() => setInputs((rows) => [...rows, { name: '', label: '' }])}>Add input</Btn>
          </div>

          <div className="mt-4 text-[13px] font-semibold">Preview values</div>
          <div className="mt-2 space-y-2">
            {payloadInputs(inputs).map((input) => (
              <label key={input.name} className="block text-[13px]">
                <PlainText text={input.label || input.name} />
                <input
                  value={values[input.name] ?? ''}
                  onChange={(e) => {
                    setValues((prev) => ({ ...prev, [input.name]: e.target.value }))
                    setPreview(null)
                  }}
                  aria-label={`Preview value for ${input.name}`}
                  className="mt-1 h-9 w-full max-w-md rounded-lg bg-mc-ctl px-3 text-[13px] font-normal outline-none"
                />
              </label>
            ))}
            {payloadInputs(inputs).length === 0 && (
              <p className="text-[12.5px] text-mc-sub">Add an input to fill a placeholder, or preview a template that has none.</p>
            )}
          </div>

          {fieldError && <FieldError>{fieldError}</FieldError>}

          {preview !== null && (
            <div className="mt-4">
              <div className="text-[13px] font-semibold">Preview</div>
              <div className="mt-2 rounded-lg bg-mc-inner px-3 py-3">
                <FilledPrompt text={preview} />
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Btn kind="outline" disabled={previewing} onClick={() => void previewDraft()}>{previewing ? 'Previewing…' : 'Preview'}</Btn>
            <Btn kind="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Btn>
            <Btn kind="plain" onClick={closeForm}>Cancel</Btn>
          </div>
        </SoftCard>
      )}

      {testing && (
        <SoftCard className="mb-4 px-5 py-4">
          <div className="text-[15px] font-semibold">Test run · <PlainText text={testing.name} /></div>
          <p className="mt-1 text-[12.5px] text-mc-sub">
            Fills the saved template and stops. This does not call OpenClaw or any other service.
          </p>
          <div className="mt-3 space-y-2">
            {testing.inputs.map((input) => (
              <label key={input.name} className="block text-[13px]">
                <PlainText text={input.label || input.name} />
                <input
                  value={runValues[input.name] ?? ''}
                  onChange={(e) => {
                    setRunValues((prev) => ({ ...prev, [input.name]: e.target.value }))
                    setRunPrompt(null)
                  }}
                  aria-label={`Test run value for ${input.name}`}
                  className="mt-1 h-9 w-full max-w-md rounded-lg bg-mc-ctl px-3 text-[13px] font-normal outline-none"
                />
              </label>
            ))}
          </div>
          {runPrompt !== null && (
            <div className="mt-4">
              <div className="text-[13px] font-semibold">Result</div>
              <div className="mt-2 rounded-lg bg-mc-inner px-3 py-3">
                <FilledPrompt text={runPrompt} />
              </div>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Btn kind="primary" disabled={running} onClick={() => void testRun(testing)}>{running ? 'Running…' : 'Test run'}</Btn>
            <Btn kind="plain" onClick={() => { setTestingId(null); setRunPrompt(null) }}>Close</Btn>
          </div>
        </SoftCard>
      )}

      {data && tools.length === 0 && !formOpen && (
        <EmptyState
          title="No custom tools yet"
          body="Create one with a prompt template. Use {{topic}} where a value should go, then preview it. A test run only fills that text."
        />
      )}

      {tools.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tools.map((tool) => (
            <SoftCard key={tool.id} className="px-4 py-4">
              <div className="text-[15px] font-semibold"><PlainText text={tool.name} /></div>
              <p className="mt-1 text-[13px] text-mc-sub">
                {tool.description ? <PlainText text={tool.description} /> : 'No description'}
              </p>
              <div className="mt-3 max-h-28 overflow-auto rounded-lg bg-mc-inner px-3 py-2">
                <FilledPrompt text={tool.promptTemplate} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn kind="outline" onClick={() => openTest(tool)}>Test run</Btn>
                <Btn kind="plain" onClick={() => openEdit(tool)}>Edit</Btn>
                {confirmId === tool.id ? (
                  <>
                    <Btn kind="primary" disabled={deleting} onClick={() => void remove(tool.id)}>{deleting ? 'Deleting…' : 'Confirm delete'}</Btn>
                    <Btn kind="plain" onClick={() => setConfirmId(null)}>Cancel</Btn>
                  </>
                ) : (
                  <Btn kind="plain" onClick={() => setConfirmId(tool.id)}>Delete</Btn>
                )}
              </div>
            </SoftCard>
          ))}
        </div>
      )}
    </div>
  )
}
