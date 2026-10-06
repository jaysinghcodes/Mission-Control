import {
  ToolValidationError,
  assertPlaceholdersMatch,
  fillPrompt,
  normalizeInputs,
  normalizeTemplate,
  valuesFor,
} from './prompt-template';

describe('prompt template', () => {
  it('fills every occurrence and does not rescan inserted text', () => {
    expect(fillPrompt('{{topic}} / {{topic}}', { topic: 'alpha' })).toBe('alpha / alpha');
    expect(fillPrompt('See {{topic}}', { topic: '{{audience}}' })).toBe('See {{audience}}');
    expect(fillPrompt('Cost {{topic}}', { topic: '$& $$' })).toBe('Cost $& $$');
  });

  it('keeps script markup as characters', () => {
    const prompt = fillPrompt('About {{topic}}', { topic: '<script>alert(1)</script>' });
    expect(prompt).toBe('About <script>alert(1)</script>');
  });

  it('refuses a placeholder that has no input', () => {
    expect(() => assertPlaceholdersMatch('Hello {{topic}}', [])).toThrow(ToolValidationError);
    expect(() => assertPlaceholdersMatch('Hello {{topic}}', [])).toThrow(
      'placeholder {{topic}} has no matching input',
    );
  });

  it('accepts a template whose placeholders all have inputs', () => {
    const inputs = normalizeInputs([
      { name: 'topic', label: 'Topic' },
      { name: 'audience' },
    ]);
    expect(() => assertPlaceholdersMatch('Write about {{topic}} for {{audience}}.', inputs)).not.toThrow();
  });

  it('treats a blank template as empty', () => {
    expect(() => normalizeTemplate('   ')).toThrow('prompt template is empty');
    expect(() => normalizeTemplate(undefined)).toThrow('prompt template is empty');
  });

  it('reads only string values for declared inputs', () => {
    const inputs = normalizeInputs([{ name: 'topic' }]);
    expect(valuesFor(inputs, { topic: '<b>x</b>', extra: 1 })).toEqual({ topic: '<b>x</b>' });
    expect(() => valuesFor(inputs, { topic: 4 })).toThrow('value for topic must be text');
    expect(valuesFor(inputs, undefined)).toEqual({ topic: '' });
  });
});
