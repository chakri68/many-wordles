#!/usr/bin/env python3
"""
Build the frozen v1 word lists. Run ONCE; the output is committed and never
regenerated in place (spec §3.1 rule 1). Not part of the build.

Sources (all open):
  - SCOWL-derived /usr/share/dict/american-english (Debian `wamerican`)
    -> "common" words. Proper nouns are capitalised there, so lowercase == not a name.
  - ENABLE (public domain) -> the bulk of valid guesses.
  - Norvig's count_1w.txt (Google web unigram counts) -> frequency ranking only;
    nothing from it ships.

usage: python3 scripts/build-wordlists.py <enable1.txt> <count_1w.txt> [scowl-file]
"""
import sys, re, pathlib

ANSWERS_TARGET = 2300
OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "words"

# Answers that are technically common but make bad daily puzzles. Allowed as guesses.
EXCLUDE = set("""
nigga negro whore bitch slut sluts dyked dykes fagot faggy homos penis vulva
pussy rapes raped rapist cunts twats wanks boobs titty porno pubes nazis
""".split())

def five(words):
    return {w for w in words if re.fullmatch(r"[a-z]{5}", w)}

def main():
    enable_path, counts_path = sys.argv[1], sys.argv[2]
    scowl_path = sys.argv[3] if len(sys.argv) > 3 else "/usr/share/dict/american-english"

    enable = {l.strip() for l in open(enable_path)}
    scowl_all = {l.strip() for l in open(scowl_path, encoding="utf-8", errors="ignore")}
    lexicon = enable | {w for w in scowl_all if w.islower()}

    freq = {}
    for line in open(counts_path):
        w, c = line.split("\t")
        freq[w] = int(c)

    allowed = five(enable) | five(w for w in scowl_all if w.islower())

    def inflected(w):
        # plural / 3rd-person -s, and past-tense -ed, when the stem is a real word
        if w.endswith("s") and not w.endswith("ss"):
            if w[:-1] in lexicon or (w.endswith("es") and w[:-2] in lexicon):
                return True
            if w.endswith("ies") and w[:-3] + "y" in lexicon:
                return True
        if w.endswith("ed") and (w[:-2] in lexicon or w[:-1] in lexicon):
            return True
        return False

    common = five(w for w in scowl_all if w.islower()) & five(enable)
    pool = [w for w in common if not inflected(w) and w not in EXCLUDE and freq.get(w, 0) > 0]
    pool.sort(key=lambda w: -freq[w])
    answers = sorted(pool[:ANSWERS_TARGET])

    assert set(answers) <= allowed
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "answers.v1.txt").write_text("\n".join(answers) + "\n")
    (OUT / "allowed.v1.txt").write_text("\n".join(sorted(allowed)) + "\n")
    deny = OUT / "denylist.txt"
    if not deny.exists():
        deny.write_text("")
    print(f"answers={len(answers)} allowed={len(allowed)}")

if __name__ == "__main__":
    main()
