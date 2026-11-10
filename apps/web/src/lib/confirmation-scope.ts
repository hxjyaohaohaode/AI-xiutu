/** A modal confirms the snapshot the user saw; later context changes need a new decision. */
export async function confirmStableScope(
  read: () => Readonly<Record<string, unknown>>,
  ask: () => Promise<boolean>,
): Promise<'confirmed' | 'cancelled' | 'changed'> {
  const before = { ...read() };
  if (!(await ask())) return 'cancelled';
  const after = read();
  const keys = Object.keys(before);
  return keys.length === Object.keys(after).length &&
    keys.every((key) => before[key] === after[key])
    ? 'confirmed'
    : 'changed';
}
