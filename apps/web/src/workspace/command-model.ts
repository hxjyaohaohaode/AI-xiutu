export type CommandAvailability = { id: string; disabled?: boolean };

/** A disabled result remains discoverable but is never a keyboard destination. */
export function moveCommand(
  commands: readonly CommandAvailability[],
  current: number,
  direction: 1 | -1,
): number {
  if (!commands.length) return -1;
  const start =
    current >= 0 && current < commands.length ? current : direction === 1 ? -1 : commands.length;
  for (let step = 1; step <= commands.length; step++) {
    const index = (start + direction * step + commands.length) % commands.length;
    if (!commands[index]!.disabled) return index;
  }
  return -1;
}

/** IDs survive filtering, reordering and capability refreshes without selecting another action. */
export function currentCommand(
  commands: readonly CommandAvailability[],
  id: string | null,
): number {
  const existing = commands.findIndex((command) => command.id === id && !command.disabled);
  return existing >= 0 ? existing : moveCommand(commands, -1, 1);
}

export function filterCommands<
  T extends { label: string; description: string; keywords?: string; section: string },
>(commands: readonly T[], query: string): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter((command) =>
    terms.every((term) =>
      `${command.label} ${command.description} ${command.keywords ?? ''} ${command.section}`
        .toLocaleLowerCase()
        .includes(term),
    ),
  );
}
