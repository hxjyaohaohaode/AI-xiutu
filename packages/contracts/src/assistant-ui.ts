import { z } from 'zod';
const title = z.string().trim().min(1).max(120);
export const assistantWorkspaceSchema = z
  .object({
    title,
    sections: z
      .array(
        z.discriminatedUnion('type', [
          z
            .object({
              type: z.literal('candidates'),
              title,
              candidateIndices: z.array(z.number().int().min(0).max(11)).min(1).max(12),
            })
            .strict(),
          z
            .object({
              type: z.literal('parameters'),
              title,
              candidateIndex: z.number().int().min(0).max(11),
            })
            .strict(),
          z
            .object({
              type: z.literal('clarification'),
              title,
              question: z.string().min(1).max(800),
              choices: z.array(z.string().trim().min(1).max(300)).min(2).max(6),
            })
            .strict(),
          z.object({ type: z.literal('budget'), title }).strict(),
          z
            .object({
              type: z.literal('references'),
              title,
              assetIds: z.array(z.uuid()).min(1).max(8),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(8),
  })
  .strict();
export type AssistantWorkspace = z.infer<typeof assistantWorkspaceSchema>;
/** The model supplies presentation only. IDs, candidate types, permissions and
 * commands are resolved against the authoritative run and editor state. */
export function validateAssistantWorkspace(
  raw: unknown,
  candidates: { kind: 'edit' | 'generation' }[],
  referenceIds: string[],
): AssistantWorkspace {
  const spec = assistantWorkspaceSchema.parse(raw);
  for (const section of spec.sections) {
    if (
      section.type === 'candidates' &&
      (new Set(section.candidateIndices).size !== section.candidateIndices.length ||
        section.candidateIndices.some((index) => !candidates[index]))
    )
      throw new Error('UI_CANDIDATE_REFERENCE');
    if (section.type === 'parameters' && candidates[section.candidateIndex]?.kind !== 'edit')
      throw new Error('UI_PARAMETER_REFERENCE');
    if (section.type === 'references' && section.assetIds.some((id) => !referenceIds.includes(id)))
      throw new Error('UI_RESOURCE_REFERENCE');
  }
  return spec;
}
