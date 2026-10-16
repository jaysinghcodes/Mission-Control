/**
 * Display name for a provider id from models.snapshot.
 * Unknown ids stay as the bridge sent them.
 */
const LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
  google: 'Gemini',
  ollama: 'Ollama',
}

export function providerLabel(id: string): string {
  const key = id.trim().toLowerCase()
  if (!key) return id
  return LABELS[key] ?? id.trim()
}
