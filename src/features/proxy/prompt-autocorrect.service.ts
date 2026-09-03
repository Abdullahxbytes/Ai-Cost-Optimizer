import nspell from 'nspell';

type HunspellDictionary = { aff: Uint8Array; dic: Uint8Array };
type DictionaryModule = { default: HunspellDictionary };

const WORD_PATTERN = /[A-Za-z][A-Za-z'-]{2,}/g;
const MAX_WORD_LENGTH = 32;
const COMMON_TYPO_CORRECTIONS: Record<string, string> = {
  adn: 'and',
  recieve: 'receive',
  teh: 'the',
  thier: 'their',
};
let spellcheckerPromise: Promise<ReturnType<typeof nspell>> | undefined;

function loadDictionaryModule(): Promise<DictionaryModule> {
  // dictionary-en is ESM while CostFlow's backend is CommonJS. Keeping the
  // native dynamic import intact lets Node load it without changing the app's
  // module system.
  const importModule = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<DictionaryModule>;
  return importModule('dictionary-en');
}

function getSpellchecker(): Promise<ReturnType<typeof nspell>> {
  spellcheckerPromise ??= loadDictionaryModule().then(({ default: dictionary }) =>
    nspell(dictionary.aff, dictionary.dic)
  );
  return spellcheckerPromise;
}

function isProtectedToken(text: string, start: number, end: number, word: string): boolean {
  const before = text[start - 1] ?? '';
  const after = text[end] ?? '';
  return (
    word.length > MAX_WORD_LENGTH ||
    /^[A-Z]{2,}$/.test(word) ||
    /[.@/:_\\#=+-]/.test(before) ||
    /[.@/:_\\#=+-]/.test(after)
  );
}

function isSingleEditOrTransposition(source: string, candidate: string): boolean {
  if (source === candidate) return true;
  if (Math.abs(source.length - candidate.length) > 1) return false;

  if (source.length === candidate.length) {
    const differences = [...source].reduce<number[]>((positions, character, index) => {
      if (character !== candidate[index]) positions.push(index);
      return positions;
    }, []);
    if (differences.length === 1) return true;
    if (differences.length !== 2 || differences[1] !== differences[0] + 1) return false;
    const [first, second] = differences;
    return source[first] === candidate[second] && source[second] === candidate[first];
  }

  const [shorter, longer] = source.length < candidate.length ? [source, candidate] : [candidate, source];
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longIndex += 1;
  }
  return true;
}

function preserveCase(source: string, replacement: string): string {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

/**
 * Applies only unambiguous one-edit spelling corrections. URLs, emails,
 * identifiers, code-like tokens, acronyms, and long words are left intact.
 */
export async function autocorrectPromptText(text: string): Promise<string> {
  const spellchecker = await getSpellchecker();
  return text.replace(WORD_PATTERN, (word, offset: number, input: string) => {
    if (isProtectedToken(input, offset, offset + word.length, word) || spellchecker.correct(word)) {
      return word;
    }

    const normalized = word.toLowerCase();
    const knownCorrection = COMMON_TYPO_CORRECTIONS[normalized];
    if (knownCorrection) return preserveCase(word, knownCorrection);

    const corrections = [...new Set(spellchecker
      .suggest(normalized)
      .filter((candidate) => isSingleEditOrTransposition(normalized, candidate.toLowerCase())))];
    return corrections.length === 1 ? preserveCase(word, corrections[0]) : word;
  });
}
