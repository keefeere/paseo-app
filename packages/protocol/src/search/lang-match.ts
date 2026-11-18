import {
  boundedEditDistance,
  fuzzyPolicyForToken,
  scoreMatch,
  transpositionDistance,
  tokenizeQuery,
  type MatchScore,
} from "./text-match.js";

/**
 * Language-tolerant matching for message text.
 *
 * `text-match` answers "did the user type the label", which is right for pickers over a
 * known list and wrong for transcripts: nobody recalls the exact inflection, the exact
 * word order, or the exact spelling of something they read weeks ago. This layer keeps
 * every tier of `text-match` and adds two stem tiers, so `який` finds `яка`, `максимально`
 * finds `максимальна`, and a mistyped word still lands.
 *
 * Stems are a suffix table, not a morphological analyzer. It is deliberately short and
 * asymmetric: a suffix that is wrong for one word only costs a rank, never a match,
 * because the exact tiers are always tried first.
 */

/** `text-match` tiers 0..3 pass through (exact, whole word, prefix, word start), remapped so
 * the stem tiers sit between word hits and inside-word hits. */
const TIER_EXACT = 0;
const TIER_WORD_START = 3;
/** Both sides reduced to the same stem. */
const TIER_STEM = 4;
/** One stem is a prefix of the other (`додавання` vs `додав`). */
const TIER_STEM_PREFIX = 5;
const TIER_SUBSTRING = 6;
const TIER_SUBSEQUENCE = 7;
const TIER_FUZZY = 8;

/** Longest first, so `ися` wins over `я` before a single letter is chopped off. */
const SLAVIC_SUFFIXES = [
  "ися",
  "ться",
  "ючи",
  "ючи",
  "ущи",
  "ати",
  "ети",
  "ити",
  "яти",
  "ами",
  "ями",
  "ах",
  "ях",
  "ов",
  "ев",
  "єв",
  "ив",
  "їв",
  "ин",
  "їн",
  "ий",
  "ій",
  "ый",
  "ая",
  "яя",
  "ая",
  "ие",
  "ые",
  "ии",
  "ши",
  "ше",
  "ши",
  "ти",
  "ті",
  "ть",
  "ť",
  "ся",
  "сь",
  "ли",
  "ло",
  "ла",
  "ле",
  "ни",
  "ну",
  "на",
  "но",
  "не",
  "ам",
  "ям",
  "ує",
  "ює",
  "у",
  "ю",
  "и",
  "і",
  "ы",
  "а",
  "я",
  "е",
  "о",
  "є",
  "ї",
  "ь",
  "ъ",
  "ш",
];

/** Applied to non-Cyrillic words; short enough to stay honest, `running` → `runn` → prefix of `run`. */
const LATIN_SUFFIXES = [
  "ingly",
  "izing",
  "ings",
  "ying",
  "ings",
  "ied",
  "ies",
  "ing",
  "ers",
  "edly",
  "ing",
  "ed",
  "es",
  "ly",
  "s",
];

/** Below this a stem is noise: `п` would match every word starting with `п`. */
const MIN_STEM_LENGTH = 2;

const CYRILLIC = /[\u0400-\u04FF]/u;

/**
 * Case- and apostrophe-folded form used for comparing. `й` folds to `і` because the two
 * alternate across the same paradigm (`який`/`якій`), and apostrophes are a spelling
 * artifact, not a letter (`п'ятый`).
 */
function foldWord(word: string): string {
  const lower = word.toLocaleLowerCase().replace(/['’‘`ʼ]/gu, "");
  if (CYRILLIC.test(lower)) {
    return lower.replace(/ё/gu, "е").replace(/й/gu, "і");
  }
  return lower.normalize("NFD").replace(/[\u0300-\u036F]/gu, "");
}

/**
 * One stem, at most two suffixes deep, never shorter than `MIN_STEM_LENGTH`.
 * `який` and `яка` both reduce to `як`, which is the whole point of this file.
 */
export function stemToken(token: string): string {
  let stem = foldWord(token);
  const suffixes = CYRILLIC.test(token) ? SLAVIC_SUFFIXES : LATIN_SUFFIXES;
  for (let pass = 0; pass < 2; pass += 1) {
    const suffix = suffixes.find((candidate) => stem.endsWith(candidate));
    if (!suffix) break;
    // `class` → `clas` would break every other `class`; doubled letters are part of the word.
    if (suffix === "s" && stem.endsWith("ss")) break;
    const next = stem.slice(0, stem.length - suffix.length);
    if (next.length < MIN_STEM_LENGTH) break;
    stem = next;
  }
  return stem;
}

function remapTier(tier: number): number {
  if (tier <= TIER_WORD_START) return tier;
  if (tier === 4) return TIER_SUBSTRING;
  if (tier === 5) return TIER_SUBSEQUENCE;
  return TIER_FUZZY;
}

interface WordHit {
  score: MatchScore;
  /** Offset into the original text, so callers can mark it. */
  start: number;
  length: number;
}

function stemScore(token: string, word: string, start: number): WordHit | null {
  const tokenStem = stemToken(token);
  const wordStem = stemToken(word);
  if (tokenStem.length < MIN_STEM_LENGTH || wordStem.length < MIN_STEM_LENGTH) return null;
  if (tokenStem === wordStem) {
    return { score: { tier: TIER_STEM, offset: start }, start, length: word.length };
  }
  if (wordStem.startsWith(tokenStem) || tokenStem.startsWith(wordStem)) {
    return { score: { tier: TIER_STEM_PREFIX, offset: start }, start, length: word.length };
  }
  return null;
}

/**
 * Typo tier over Unicode words. `text-match` splits words on `[a-z0-9]`, so its fuzzy tier
 * never sees a Cyrillic word; the same edit-distance budget is applied here over
 * `\p{L}\p{N}` runs instead. Words and their leading slices are compared, so a typo early in a
 * long word lands without the length gap eating the budget.
 */
function scoreLangFuzzy(token: string, text: string): WordHit | null {
  const policy = fuzzyPolicyForToken(token);
  if (!policy || token.length <= policy.maxEdits) return null;
  const foldedToken = foldWord(token);
  let best: WordHit | null = null;
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = foldWord(match[0]);
    const start = match.index ?? 0;
    const candidates = new Set([
      word,
      word.slice(0, foldedToken.length),
      word.slice(0, foldedToken.length + policy.maxEdits),
    ]);
    for (const candidate of candidates) {
      const distance = policy.transpositionsOnly
        ? transpositionDistance(foldedToken, candidate)
        : boundedEditDistance(foldedToken, candidate, policy.maxEdits);
      if (distance === null) continue;
      const hit: WordHit = {
        score: { tier: TIER_FUZZY, offset: start, spread: distance },
        start,
        length: match[0].length,
      };
      if (!best || compareLangScores(hit.score, best.score) < 0) best = hit;
    }
  }
  return best;
}

/**
 * Where one token lands in a field, and how well. Whole-field exact hits first, because a
 * typed phrase should outrank any single word; then per-word exact/prefix hits, stems, typos.
 */
function bestTokenHit(token: string, text: string): WordHit | null {
  if (!token) return null;
  const direct = scoreMatch(token, text, { subsequence: true });
  if (direct && direct.tier <= TIER_WORD_START) {
    return { score: remapScore(direct), start: direct.offset, length: token.length };
  }

  let best: WordHit | null = null;
  const consider = (hit: WordHit | null): void => {
    if (hit && (!best || compareLangScores(hit.score, best.score) < 0)) best = hit;
  };
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0];
    const start = match.index ?? 0;
    const wordScore = scoreMatch(token, word, { subsequence: true });
    if (wordScore && wordScore.tier <= TIER_WORD_START) {
      consider({
        score: remapScore(wordScore),
        start: start + wordScore.offset,
        length: token.length,
      });
      continue;
    }
    consider(stemScore(token, word, start));
  }
  if (best) return best;
  if (direct) return { score: remapScore(direct), start: direct.offset, length: token.length };
  return scoreLangFuzzy(token, text);
}

/** Best score for one token against a free-text field. Offsets are positions in `text`. */
export function scoreLangToken(token: string, text: string): MatchScore | null {
  return bestTokenHit(token, text)?.score ?? null;
}

function remapScore(score: MatchScore): MatchScore {
  return { ...score, tier: remapTier(score.tier) };
}

/** Lower is better. Same shape as `compareMatchScores`; stems sort between word and substring hits. */
export function compareLangScores(a: MatchScore, b: MatchScore): number {
  return a.tier !== b.tier ? a.tier - b.tier : a.offset - b.offset;
}

/**
 * Same rule as `scoreTextFields`: every token has to land somewhere, and the aggregate is
 * the sum. Token order is free, so `рендері бюджетна` finds a message saying them the other
 * way round.
 */
export function scoreLangTokens(query: string, fields: readonly string[]): MatchScore | null {
  let tier = TIER_EXACT;
  let offset = 0;
  let spread = 0;
  for (const token of tokenizeQuery(query)) {
    let best: MatchScore | null = null;
    for (const field of fields) {
      const score = scoreLangToken(token, field);
      if (score && (!best || compareLangScores(score, best) < 0)) best = score;
    }
    if (!best) return null;
    tier += best.tier;
    offset += best.offset;
    spread += best.spread ?? token.length;
  }
  return { tier, offset, spread };
}

/**
 * Where each token landed, for marking a snippet. A word is marked whole when the hit came
 * from a stem or a typo, because the characters the user typed are not all in the text.
 */
export function langMatchRanges(query: string, text: string): { start: number; length: number }[] {
  const ranges: { start: number; length: number }[] = [];
  for (const token of tokenizeQuery(query)) {
    const hit = bestTokenHit(token, text);
    if (!hit) continue;
    ranges.push({ start: hit.start, length: hit.length });
  }
  return ranges.sort((a, b) => a.start - b.start);
}
