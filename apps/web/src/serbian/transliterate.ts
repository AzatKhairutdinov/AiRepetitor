// Serbian Latin → Cyrillic, letter for letter by the standard table. Only Latin letters change:
// Russian Cyrillic text passes through as it is.

const DIGRAPHS: Readonly<Record<string, string>> = {
  lj: "љ",
  nj: "њ",
  dž: "џ",
};

const LETTERS: Readonly<Record<string, string>> = {
  a: "а",
  b: "б",
  c: "ц",
  č: "ч",
  ć: "ћ",
  d: "д",
  đ: "ђ",
  e: "е",
  f: "ф",
  g: "г",
  h: "х",
  i: "и",
  j: "ј",
  k: "к",
  l: "л",
  m: "м",
  n: "н",
  o: "о",
  p: "п",
  r: "р",
  s: "с",
  š: "ш",
  t: "т",
  u: "у",
  v: "в",
  z: "з",
  ž: "ж",
};

const isUpper = (ch: string) => ch !== ch.toLowerCase();

export function latinToCyrillic(text: string): string {
  const s = text.normalize("NFC");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const pair = s.slice(i, i + 2);
    const digraph = DIGRAPHS[pair.toLowerCase()];
    if (digraph) {
      // Lj, LJ → Љ; lj → љ.
      out += isUpper(pair[0]!) ? digraph.toUpperCase() : digraph;
      i++;
      continue;
    }
    const ch = s[i]!;
    const letter = LETTERS[ch.toLowerCase()];
    out += letter ? (isUpper(ch) ? letter.toUpperCase() : letter) : ch;
  }
  return out;
}
