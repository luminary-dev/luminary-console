// Shared test helpers. Not a test file: vitest only collects *.test.ts(x).

/** Read one element of a list, failing the test where the element is missing
 *  rather than several lines later on a property of undefined.
 *
 *  Under noUncheckedIndexedAccess every `list[0]` is `T | undefined`, which is
 *  the truth: a test that indexes past the end has already failed, and it
 *  should say so with the index and the length rather than with
 *  "cannot read properties of undefined". */
export function atIndex<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(
      `expected an element at index ${index}, but the list holds ${items.length}`,
    );
  }
  return item;
}
