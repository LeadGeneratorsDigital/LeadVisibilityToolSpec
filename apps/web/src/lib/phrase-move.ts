export interface MovablePhrase {
  id: string;
  buyer_group_id: string | null;
  sort_order: number;
}

/**
 * Where a phrase goes when it is put under another heading (null = no heading): to the end of
 * that heading's phrases. Null when it is already there, so choosing the same heading writes nothing.
 */
export function planPhraseMove(phrases: MovablePhrase[], phraseId: string, target: string | null): { buyerGroupId: string | null; sortOrder: number } | null {
  const phrase = phrases.find((p) => p.id === phraseId);
  if (!phrase || phrase.buyer_group_id === target) return null;
  const last = phrases.filter((p) => p.buyer_group_id === target).reduce((max, p) => Math.max(max, p.sort_order), 0);
  return { buyerGroupId: target, sortOrder: last + 1 };
}
