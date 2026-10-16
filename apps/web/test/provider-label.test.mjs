/**
 * Provider labels on System, and the empty state sentence.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

async function loadTs(rel) {
  const src = await readFile(new URL(rel, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
}

const { providerLabel } = await loadTs('../src/lib/provider-label.ts')

test('the six launch providers render by name', () => {
  assert.equal(providerLabel('openai'), 'OpenAI')
  assert.equal(providerLabel('anthropic'), 'Anthropic')
  assert.equal(providerLabel('deepseek'), 'DeepSeek')
  assert.equal(providerLabel('openrouter'), 'OpenRouter')
  assert.equal(providerLabel('google'), 'Gemini')
  assert.equal(providerLabel('gemini'), 'Gemini')
  assert.equal(providerLabel('ollama'), 'Ollama')
  assert.equal(providerLabel('custom-host'), 'custom-host')
})

test('System empty state is the exact sentence', async () => {
  const src = await readFile(new URL('../src/pages/System.tsx', import.meta.url), 'utf8')
  assert.match(src, /No providers found yet\. Run the bridge to detect them\./)
})
