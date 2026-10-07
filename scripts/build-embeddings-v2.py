#!/usr/bin/env python3
"""
Build the frozen v2 semantic table for Warmer + Bridge. Run ONCE; commit the
output; never regenerate in place. v1 stays on disk for the days that used it.

Why v2: GloVe (v1) scores words as close when they show up in the same
sentences, not when they mean the same thing. "can't afford to lose" made
lose -> afford a valid Bridge hop, and words like "now" linked to 700+ others,
so the bot's par ran through filler. Numberbatch is GloVe/word2vec retrofitted
onto ConceptNet's graph of what words actually mean, so neighbours are
synonyms and related concepts instead of sentence-mates.

Source: ConceptNet Numberbatch 19.08, English (CC BY-SA 4.0):
  https://conceptnet.s3.amazonaws.com/downloads/2019/numberbatch/numberbatch-en-19.08.txt.gz
The table this writes is a derivative, so it's CC BY-SA 4.0 too.

Pipeline:
  1. vocab = v1's vocab (GloVe frequency order, already filtered) minus the
     ~250 words Numberbatch has no vector for. Order kept, so "common" still
     means the most frequent words.
  2. centre, PCA 300 -> 128 dims (64 kept only ~65% of each word's true
     top-10; 128 keeps ~82%, for 3.8 MB instead of 1.9)
  3. L2-normalise, then int8 with one global scale, exactly like v1
  4. answers = v1's pool minus words without a vector, the DROP list, and
     anything that isn't a base-form noun or verb (see noun_or_verb).
     SEEMED and SEVENTH -> SUBURBAN made it obvious: adjectives and
     adverbs have mushy neighbourhoods (strangely, oddly, somewhat...)
     and are miserable to guess.

WordNet 3.0 (Princeton licence) for the part-of-speech check, unzipped:
  https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/wordnet.zip

usage: python3 scripts/build-embeddings-v2.py <numberbatch-en-19.08.txt.gz> <wordnet-dir>
"""
import collections, gzip, json, sys, pathlib
import numpy as np

DIMS, COMMON = 128, 10000
# Matches v1's density: median word links to ~58 others in the common graph,
# which playtesting already liked. See the printout.
BRIDGE_COS = 0.35
OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "semantic"

# Fine as guesses, bad as a daily secret or a Bridge endpoint: verb forms the
# v1 inflection check missed, names, and newswire job titles.
DROP = set("""
beaten begun blew bought broke brought built caught chose chosen dealt drawn drew driven drove fallen
fell felt fled flew flown fought gave gotten grew grown heard hung kept knew laid lost meant paid
proven risen sang sank seen sent shown sold sought spent spoke spoken stolen stood struck swept taken
taught thought threw thrown torn understood went wore written wrote
backs knows likes makes needs overs owns takes wants wells billions millions hundreds thousands thirds
seconds versus
afghan bobby brad catholic chad chile cooper dick dole ford google gore guinea harry homer intel japan
jimmy khan lynch maria martin matt mike miller morocco nick oxford pentagon peter protestant republican
democrat rick roger roman shanghai smith soviet communist terry tony turner villa wales welsh wright
northeastern northwestern southeastern southwestern holocaust
spokesman spokeswoman lawmaker chairman businessman
inter nobody yesterday plenty advisory mainstream stuff abortion assassination
""".split())


def noun_or_verb(wn_dir):
    """
    Keep a word only if WordNet lists it as a lemma (so not SEEMED, not
    DATES) and its sense-tagged usage leans noun/verb over adjective/adverb.
    Tag counts come from SemCor via index.sense; words nobody tagged fall
    back to "has any noun or verb sense at all".
    """
    poses = collections.defaultdict(set)
    for pos in ("noun", "verb", "adj", "adv"):
        for line in open(f"{wn_dir}/index.{pos}"):
            if not line.startswith(" "):  # licence header lines are indented
                poses[line.split()[0]].add(pos)
    kind = {"1": "n", "2": "v", "3": "a", "4": "r", "5": "a"}  # 5 = adjective satellite
    tags = collections.defaultdict(collections.Counter)
    for line in open(f"{wn_dir}/index.sense"):
        key, _, _, cnt = line.split()
        lemma, rest = key.split("%")
        tags[lemma][kind[rest[0]]] += int(cnt)

    def ok(w):
        if w not in poses:
            return False
        c = tags[w]
        nv, ar = c["n"] + c["v"], c["a"] + c["r"]
        if nv == ar == 0:
            return bool(poses[w] & {"noun", "verb"})
        return nv > ar

    return ok


def main():
    nb_path, wn_dir = sys.argv[1], sys.argv[2]
    keep = noun_or_verb(wn_dir)
    v1 = (OUT / "vocab.v1.txt").read_text().split()
    want = set(v1)
    got = {}
    with gzip.open(nb_path, "rt") as f:
        next(f)  # header: count dims
        for line in f:
            w, rest = line.split(" ", 1)
            if w in want:
                got[w] = np.asarray(rest.split(), dtype=np.float64)

    words = [w for w in v1 if w in got]
    X = np.stack([got[w] for w in words])
    X -= X.mean(0)
    _, _, Vt = np.linalg.svd(X, full_matrices=False)
    Y = X @ Vt[:DIMS].T
    Y /= np.linalg.norm(Y, axis=1, keepdims=True)
    scale = 127 / np.abs(Y).max()
    Q = np.clip(np.round(Y * scale), -127, 127).astype(np.int8)
    scale2 = float(scale * scale)
    bridge = int(BRIDGE_COS * scale2)

    vocab = set(words)
    answers = sorted(w for w in (OUT / "answers.v1.txt").read_text().split() if w in vocab and w not in DROP and keep(w))

    # report the graph the game will actually see (int maths, like the client)
    C = Q[:COMMON].astype(np.int32)
    deg = ((C @ C.T) >= bridge).sum(1) - 1
    print(f"vocab {len(words)} (dropped {len(v1) - len(words)}), answers {len(answers)}")
    print(f"common graph: median degree {np.median(deg):.0f}, p99 {np.percentile(deg, 99):.0f}, max {deg.max()}, isolated {(deg == 0).sum()}")

    (OUT / "vocab.v2.txt").write_text("\n".join(words) + "\n")
    (OUT / "embed.v2.bin").write_bytes(Q.tobytes())
    (OUT / "answers.v2.txt").write_text("\n".join(answers) + "\n")
    meta = {"n": len(words), "dims": DIMS, "common": COMMON, "scale2": round(scale2, 4), "bridge": bridge}
    (OUT / "meta.v2.json").write_text(json.dumps(meta) + "\n")
    print(meta)


if __name__ == "__main__":
    main()
