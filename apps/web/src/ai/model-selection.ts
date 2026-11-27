// Used only before admission. Running and recovered turns stay on the model
// recorded by the server. Never fail over an already submitted request.
export function pickAssistantModel(
  models: readonly { id: string; imageInput: boolean; points: number | null }[],
  preferredIds: readonly (string | undefined)[],
  wantsImage: boolean,
): string {
  const priced = models.filter((model) => model.points !== null);
  const visual = wantsImage ? priced.filter((model) => model.imageInput) : [];
  const eligible = visual.length ? visual : priced;
  for (const id of preferredIds) {
    if (eligible.some((model) => model.id === id)) return id!;
  }
  return eligible.reduce<(typeof models)[number] | undefined>(
    (lowest, model) => !lowest || model.points! < lowest.points! ? model : lowest, undefined,
  )?.id ?? '';
}
