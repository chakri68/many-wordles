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
  4. answers = v1's pool minus words without a vector and the DROP list

usage: python3 scripts/build-embeddings-v2.py <numberbatch-en-19.08.txt.gz>
"""
import gzip, json, sys, pathlib
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
""".split())


def main():
    nb_path = sys.argv[1]
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
    answers = sorted(w for w in (OUT / "answers.v1.txt").read_text().split() if w in vocab and w not in DROP)

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
