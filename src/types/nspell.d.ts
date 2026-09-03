declare module 'nspell' {
  export interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
  }

  export default function nspell(aff: Uint8Array, dic: Uint8Array): NSpell;
}
