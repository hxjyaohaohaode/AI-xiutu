import { z } from 'zod';
const title = z.string().trim().min(1).max(120);

export const assistantProjectFileSchema = z.object({
  title,
  format: z.enum(['docx', 'pptx', 'xlsx']),
  body: z.string().trim().min(1).max(16000),
}).strict();
export type AssistantProjectFile = z.infer<typeof assistantProjectFileSchema>;

export const assistantProjectFileInput = z.object({
  title,
  format: assistantProjectFileSchema.shape.format,
  sections: z.array(z.object({
    heading: z.string().trim().min(1).max(120).regex(/^[^\r\n]+$/),
    text: z.string().trim().min(1).max(2500),
  }).strict()).max(12),
  table: z.object({
    columns: z.array(z.string().trim().min(1).max(80).regex(/^[^\r\n]+$/)).min(2).max(12),
    rows: z.array(z.array(z.union([
      z.string().max(120).regex(/^[^\r\n]*$/), z.number().finite(),
    ])).min(2).max(12)).min(1).max(40),
  }).strict().nullable(),
}).strict();

export function buildAssistantProjectFile(raw: unknown): AssistantProjectFile {
  const { title, format, sections, table } = assistantProjectFileInput.parse(raw);
  if (format === 'xlsx' ? !table || sections.length !== 0 : !sections.length)
    throw new Error('PROJECT_FILE_STRUCTURE');
  if (table && table.rows.some(row => row.length !== table.columns.length))
    throw new Error('PROJECT_FILE_COLUMNS');
  if (format === 'xlsx' && table) {
    const rows = [table.columns, ...table.rows].map(row => row.map(cell =>
      typeof cell === 'number' ? String(cell) : '"' + cell.replaceAll('"', '""') + '"',
    ).join('\t'));
    return assistantProjectFileSchema.parse({
      title, format, body: ['```sheet-tsv', ...rows, '```'].join('\n'),
    });
  }
  const body = sections.map(section => `# ${section.heading}\n\n${section.text}`);
  if (table) {
    const line = (cells: (string | number)[]) =>
      '| ' + cells.map(cell => String(cell).replaceAll('\\', '\\\\').replaceAll('|', '\\|')).join(' | ') + ' |';
    body.push([line(table.columns), line(table.columns.map(() => '---')), ...table.rows.map(line)].join('\n'));
  }
  return assistantProjectFileSchema.parse({ title, format, body: body.join('\n\n') });
}
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
