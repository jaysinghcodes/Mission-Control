import { escapeLike } from './escape-like';

/** QA-1 polish item 8: LIKE wildcards in user text must match literally. */
describe('escapeLike', () => {
  it.each([
    ['plain text', 'plain text'],
    ['100%', '100\\%'],
    ['a_b', 'a\\_b'],
    ['%%', '\\%\\%'],
    // Backslash is escaped first, so it cannot "eat" our wildcard escape.
    ['c:\\tmp_1', 'c:\\\\tmp\\_1'],
    ['\\%', '\\\\\\%'],
  ])('%p → %p', (input, expected) => {
    expect(escapeLike(input)).toBe(expected);
  });
});
