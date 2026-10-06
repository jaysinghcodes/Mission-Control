/**
 * Prompt templates for experimental custom tools (ticket 10).
 *
 * Placeholder syntax is double braces and an identifier: `{{topic}}`.
 * The identifier is letters, digits, and underscores, and it must start
 * with a letter or underscore. Spaces inside the braces are not a
 * placeholder. Each placeholder needs an input with the same name.
 *
 * Filling a template is string replacement only. Values are inserted
 * once and are not scanned again, so a value of `{{other}}` stays
 * literal text. Nothing in this file opens a network connection.
 */

export interface ToolInput {
  name: string;
  label?: string;
}

export class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolValidationError';
  }
}

const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;
const TEMPLATE_MAX = 8000;
const INPUT_NAME_MAX = 40;
const LABEL_MAX = 80;
const MAX_INPUTS = 20;

/** `{{topic}}` — the only placeholder syntax this builder accepts. */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BRACE = /\{\{([^{}]*)\}\}/g;

export function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') throw new ToolValidationError('name is required');
  const name = raw.trim();
  if (!name) throw new ToolValidationError('name is required');
  if (name.length > NAME_MAX) {
    throw new ToolValidationError(`name must be ${NAME_MAX} characters or fewer`);
  }
  return name;
}

export function normalizeDescription(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new ToolValidationError('description must be text');
  const description = raw.trim();
  if (description.length > DESCRIPTION_MAX) {
    throw new ToolValidationError(`description must be ${DESCRIPTION_MAX} characters or fewer`);
  }
  return description;
}

export function normalizeTemplate(raw: unknown): string {
  if (typeof raw !== 'string') throw new ToolValidationError('prompt template is empty');
  const template = raw.trim();
  if (!template) throw new ToolValidationError('prompt template is empty');
  if (template.length > TEMPLATE_MAX) {
    throw new ToolValidationError(`prompt template must be ${TEMPLATE_MAX} characters or fewer`);
  }
  return template;
}

export function normalizeInputs(raw: unknown): ToolInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ToolValidationError('inputs must be an array');
  if (raw.length > MAX_INPUTS) {
    throw new ToolValidationError(`a tool can have at most ${MAX_INPUTS} inputs`);
  }
  const inputs: ToolInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ToolValidationError('each input needs a name');
    }
    const rec = item as { name?: unknown; label?: unknown };
    if (typeof rec.name !== 'string') throw new ToolValidationError('each input needs a name');
    const name = rec.name.trim();
    if (!name) throw new ToolValidationError('each input needs a name');
    if (!IDENT.test(name) || name.length > INPUT_NAME_MAX) {
      throw new ToolValidationError(
        `input name "${name}" must use letters, digits, and underscores, and start with a letter or underscore`,
      );
    }
    if (seen.has(name)) throw new ToolValidationError(`duplicate input name "${name}"`);
    seen.add(name);
    const input: ToolInput = { name };
    if (rec.label !== undefined && rec.label !== null && rec.label !== '') {
      if (typeof rec.label !== 'string') throw new ToolValidationError('input label must be text');
      const label = rec.label.trim();
      if (label.length > LABEL_MAX) {
        throw new ToolValidationError(`input label must be ${LABEL_MAX} characters or fewer`);
      }
      if (label) input.label = label;
    }
    inputs.push(input);
  }
  return inputs;
}

/**
 * Every `{{name}}` in the template must have an input of that name.
 * A brace pair that is not an identifier is also refused, so `{{topic}}`
 * with a space or a hyphen cannot silently skip substitution.
 */
export function assertPlaceholdersMatch(template: string, inputs: ToolInput[]): void {
  const defined = new Set(inputs.map((input) => input.name));
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const match of template.matchAll(BRACE)) {
    const inner = match[1] ?? '';
    if (!IDENT.test(inner)) {
      throw new ToolValidationError(
        `placeholder {{${inner}}} is not a valid input name — use letters, digits, and underscores, like {{topic}}`,
      );
    }
    if (!defined.has(inner) && !seen.has(inner)) {
      seen.add(inner);
      missing.push(inner);
    }
  }
  const stripped = template.replace(BRACE, '');
  if (stripped.includes('{{')) {
    throw new ToolValidationError('prompt template has an unclosed {{ placeholder');
  }
  if (missing.length === 1) {
    throw new ToolValidationError(`placeholder {{${missing[0]}}} has no matching input`);
  }
  if (missing.length > 1) {
    throw new ToolValidationError(
      `placeholders ${missing.map((name) => `{{${name}}}`).join(', ')} have no matching input`,
    );
  }
}

/**
 * Substitute `{{name}}` with the string for that input. Missing names
 * become an empty string. The replacement is not scanned for further
 * placeholders, and `$` in a value is not treated as a replacement pattern.
 */
export function fillPrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_match, name: string) => {
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : '';
  });
}

/** Values for a dry run. Only the tool's own inputs are read. Non-strings are 400. */
export function valuesFor(inputs: ToolInput[], raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) {
    return Object.fromEntries(inputs.map((input) => [input.name, '']));
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolValidationError('values must be an object of text fields');
  }
  const rec = raw as Record<string, unknown>;
  const map: Record<string, string> = {};
  for (const input of inputs) {
    if (!Object.prototype.hasOwnProperty.call(rec, input.name) || rec[input.name] === undefined) {
      map[input.name] = '';
      continue;
    }
    const value = rec[input.name];
    if (typeof value !== 'string') {
      throw new ToolValidationError(`value for ${input.name} must be text`);
    }
    map[input.name] = value;
  }
  return map;
}
