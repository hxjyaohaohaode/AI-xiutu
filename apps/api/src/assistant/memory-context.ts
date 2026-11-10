import type { AssistantMemory } from '@ai-xiutu/contracts';
import type { Queryable } from '@ai-xiutu/db';
import { textTokens } from '@ai-xiutu/assistant';

export function mandatoryMemory(item: AssistantMemory) {
  return item.category === 'constraint' || item.category === 'correction';
}

function terms(text: string) {
  const words =
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(
    words.flatMap((word) => {
      if (!/\p{Script=Han}/u.test(word)) return word.length > 1 ? [word] : [];
      const characters = Array.from(word);
      return characters.slice(1).map((character, index) => characters[index] + character);
    }),
  );
}

function relevance(query: Set<string>, title: string, content: string) {
  const titleTerms = terms(title),
    contentTerms = terms(content);
  let score = 0;
  for (const word of query) {
    if (titleTerms.has(word)) score += 4;
    if (contentTerms.has(word)) score += 1;
  }
  return score;
}

/** Retain constraints verbatim. Optional preferences use a bounded lexical
 * ranking over scoped, confirmed records without an external embedding call. */
export function selectAssistantMemories(items: AssistantMemory[], prompt: string) {
  const query = terms(prompt);
  const optional = items
    .filter((item) => !mandatoryMemory(item))
    .map((item) => ({ item, score: relevance(query, item.title, item.content) }))
    .sort((a, b) => b.score - a.score);
  const selected: AssistantMemory[] = [];
  let tokens = 0;
  for (const { item, score } of optional) {
    if (selected.length >= 6 || (score === 0 && selected.length >= 1)) break;
    const count = textTokens(item.title + '\n' + item.content);
    if (tokens + count > 1800) continue;
    selected.push(item);
    tokens += count;
  }
  return [...items.filter(mandatoryMemory), ...selected];
}

export async function rememberedResources(
  db: Queryable,
  actorId: string,
  spaceIds: string[],
  prompt: string,
  frozenIds?: string[],
  lock = false,
) {
  if (!spaceIds.length || frozenIds?.length === 0) return [];
  const rows = (
    await db.query<{
      id: string;
      version: number;
      title: string;
      note: string;
      tags: string[];
    }>(
      `SELECT a.id,m.version,COALESCE(m.title,a.name) AS title,m.note,m.tags
       FROM resource_memories m JOIN assets a ON a.id=m.asset_id
       JOIN projects p ON p.id=a.project_id
       JOIN memberships ms ON ms.space_id=p.space_id AND ms.user_id=$1
       WHERE m.user_id=$1 AND m.remembered=true AND p.space_id=ANY($2::uuid[])
         AND a.deleted_at IS NULL AND p.deleted_at IS NULL
         AND ($3::uuid[] IS NULL OR a.id=ANY($3::uuid[]))
       ORDER BY ${frozenIds ? 'a.id' : 'm.updated_at DESC,a.id'}
       LIMIT 100${lock ? ' FOR SHARE OF m' : ''}`,
      [actorId, spaceIds, frozenIds ?? null],
    )
  ).rows;
  if (frozenIds) return rows;
  const query = terms(prompt);
  return rows
    .map((item) => ({
      item,
      score: relevance(query, item.title, item.tags.join(' ') + ' ' + item.note),
    }))
    .sort((a, b) => b.score - a.score)
    .filter(({ score }, index) => score > 0 || index === 0)
    .slice(0, 4)
    .map(({ item }) => item);
}
