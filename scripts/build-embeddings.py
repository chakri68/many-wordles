#!/usr/bin/env python3
"""
Build the frozen v1 semantic table for Warmer + Bridge. Run ONCE; commit the
output; never regenerate in place (spec §3.1 rule 1 applies here too).

Source: GloVe 6B 100d (Wikipedia + Gigaword, Public Domain Dedication & License),
via the gensim-data mirror:
  https://github.com/RaRe-Technologies/gensim-data/releases/download/glove-wiki-gigaword-100/glove-wiki-gigaword-100.gz

Pipeline:
  1. vocab = first 30k GloVe tokens (frequency order) that are lowercase a-z,
     3-15 letters, and real words (SCOWL lowercase ∪ ENABLE)
  2. centre, PCA 100 -> 64 dims
  3. L2-normalise BEFORE quantising, then int8 with one global scale.
     Int8 dot products summed in Int32 rank exactly like cosine, with zero
     float drift across JS engines.
  4. answers = a frequency band of the vocab minus function words and
     inflections; used by Warmer (secret) and Bridge (endpoints).

Outputs (public/semantic/):
  vocab.v1.txt     one word per line, frequency order (first COMMON are "common")
  embed.v1.bin     int8, N x 64, row-major
  answers.v1.txt   answer pool, sorted
  meta.v1.json     {n, dims, common, scale2, bridge}  (bridge = int threshold)

usage: python3 scripts/build-embeddings.py <glove-wiki-gigaword-100.gz> <enable1.txt>
"""
import gzip, json, re, sys, pathlib
import numpy as np

N, DIMS, COMMON = 30000, 64, 10000
BRIDGE_COS = 0.5  # 0.6 was a slog in playtesting: median ~13 links per word
OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "semantic"

STOP = set("""
about above after again against also although always among another anyone anything anyway around
away back because been before being below between beyond both came cannot could despite did does
doing done down during each either else elsewhere enough even ever every first from further given
goes going gone have having here herself himself however instead into itself just know known last
later least less like made make many might more most much must myself near need neither never
nevertheless next none nothing often once only other others ought ours over perhaps quite rather
really said same says seem seems shall should since some something sometimes still such take than
that their them themselves then there these they thing things this those though three through thus
together told took toward towards under unless until upon used using very want well were what
whatever when where whether which while whom whose will with within without would year years your
yours yourself already almost along across behind besides likely whereas became become becomes four
five seven eight nine twenty thirty forty fifty sixty thousand million billion hundred second third
fourth monday tuesday wednesday thursday friday saturday sunday january february march april june
july august september october november december percent according including include includes
included told per via yet lets gets possibly probably actually certainly especially recently
anymore everybody everyone somebody someone latter former whom whose hence thereby therefore
bigger older younger larger smaller higher lower greater biggest largest oldest youngest
""".split())
# function words: hubs in embedding space (every Bridge path would route
# through "the"), useless as Warmer guesses. Not in the vocab at all.
FUNCTION = set("""
the and for are was were has had have his her hers him its not but they this that which who whom
would can could shall should will may might must also been being said what when where there their
theirs about into than then them these those some any more most other only after over such just
made many how while both before through between under each because during against same another
without within whether since until very even still well back out off our ours you your yours she
he it we us me my mine all any few nor own too don does did doing done here hers why its itself
ourselves themselves yourself yourselves himself herself one ones get got gets per via yet upon
""".split()) | STOP

# fine as guesses, not as a daily secret
EXCLUDE = set("""
terrorism terrorist terrorists rape raped rapist nazi nazis genocide suicide murder murdered killing
killings massacre slave slavery hell damn sexual sex porn
""".split())


def main():
    glove_path, enable_path = sys.argv[1], sys.argv[2]
    scowl = {l.strip() for l in open("/usr/share/dict/american-english", errors="ignore") if l.strip().islower()}
    lex = scowl | {l.strip() for l in open(enable_path)}

    words, vecs = [], []
    with gzip.open(glove_path, "rt") as f:
        next(f)  # word2vec header
        for line in f:
            w, *v = line.rstrip().split(" ")
            if re.fullmatch(r"[a-z]{3,15}", w) and w in lex and w not in FUNCTION:
                words.append(w)
                vecs.append(np.asarray(v, dtype=np.float64))
                if len(words) == N:
                    break

    X = np.stack(vecs)
    X -= X.mean(0)
    _, _, Vt = np.linalg.svd(X, full_matrices=False)
    Y = X @ Vt[:DIMS].T
    Y /= np.linalg.norm(Y, axis=1, keepdims=True)
    scale = 127 / np.abs(Y).max()
    Q = np.clip(np.round(Y * scale), -127, 127).astype(np.int8)
    scale2 = float(scale * scale)

    vocab = set(words)

    def inflected(w):
        if w.endswith("s") and not w.endswith("ss"):
            if w[:-1] in vocab or (w.endswith("es") and w[:-2] in vocab) or (w.endswith("ies") and w[:-3] + "y" in vocab):
                return True
        if w.endswith("ed") and (w[:-2] in vocab or w[:-1] in vocab):
            return True
        if w.endswith("ing") and (w[:-3] in vocab or w[:-3] + "e" in vocab or (len(w) > 5 and w[-4] == w[-5] and w[:-4] in vocab)):
            return True
        if w.endswith("ly"):
            return True
        return False

    band = words[150:5000]
    # secrets must be everyday lowercase words in SCOWL (drops paris, louis, …)
    answers = sorted(w for w in band if len(w) >= 4 and w in scowl and w not in STOP and w not in EXCLUDE and not inflected(w))

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "vocab.v1.txt").write_text("\n".join(words) + "\n")
    (OUT / "embed.v1.bin").write_bytes(Q.tobytes())
    (OUT / "answers.v1.txt").write_text("\n".join(answers) + "\n")
    meta = {"n": N, "dims": DIMS, "common": COMMON, "scale2": round(scale2, 4), "bridge": int(BRIDGE_COS * scale2)}
    (OUT / "meta.v1.json").write_text(json.dumps(meta) + "\n")
    print(meta, "answers", len(answers))


if __name__ == "__main__":
    main()
