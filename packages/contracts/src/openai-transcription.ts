import { z } from 'zod';

const languageCode = z.string().regex(/^[a-z]{2}$/);
export const fileTranscriptionOptionsSchema = z
  .object({
    language: languageCode.optional(),
    prompt: z.string().trim().min(1).max(800).optional(),
    temperature: z.number().min(0).max(1).optional(),
    keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(32).optional(),
    languages: z.array(languageCode).min(1).max(16).optional(),
    timestamps: z.enum(['word', 'segment', 'both']).optional(),
  })
  .strict()
  .refine((value) => !(value.language && value.languages));
export type FileTranscriptionOptions = z.infer<typeof fileTranscriptionOptionsSchema>;

export function supportsFileTranscriptionOptions(model: string, options: FileTranscriptionOptions) {
  return (
    (model !== 'gpt-4o-transcribe-diarize' || !options.prompt) &&
    (model === 'gpt-transcribe' || !(options.keywords || options.languages)) &&
    (model === 'whisper-1' || !options.timestamps)
  );
}
