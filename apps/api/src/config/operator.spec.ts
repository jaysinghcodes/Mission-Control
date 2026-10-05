import { DEFAULT_OPERATOR_NAME, operatorName } from './operator';

/**
 * operatorName() unit tests — the API's only source for the default
 * assignee. Pins the neutral first-run fallback (ticket 3: a fresh clone
 * must not show any personal names).
 */
describe('operatorName', () => {
  it('falls back to the neutral default when OPERATOR_NAME is unset', () => {
    expect(operatorName({})).toBe(DEFAULT_OPERATOR_NAME);
    expect(DEFAULT_OPERATOR_NAME).toBe('Operator');
  });

  it.each(['', '   ', '\t\n'])(
    'treats a blank OPERATOR_NAME (%p, as copied from .env.example) as unset',
    (value) => {
      expect(operatorName({ OPERATOR_NAME: value })).toBe('Operator');
    },
  );

  it('uses the configured name, trimmed', () => {
    expect(operatorName({ OPERATOR_NAME: '  Ada Lovelace ' })).toBe(
      'Ada Lovelace',
    );
  });

  it('clamps very long values to 80 characters', () => {
    expect(operatorName({ OPERATOR_NAME: 'x'.repeat(500) })).toHaveLength(80);
  });
});
