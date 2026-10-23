# Sidechain

Browser games for undergraduate biochemistry, each with a scaffolded high-school
mode. Python precomputes puzzle data offline; the frontend is static JavaScript
with no build step and no dependencies.

**Sidechain** — a daily five-residue peptide puzzle. The feedback reports
side-chain chemistry rather than letters: a class tier per position plus a
Kyte–Doolittle hydropathy compass. Solving reveals the real protein motif you
just built.


## Quick start

```bash
python3 pipeline/build_sidechain.py     # -> data/puzzles.json and data/puzzles.js
python3 pipeline/test_sidechain.py      # structural checks + solver calibration
python3 pipeline/build_artifact.py      # -> dist/ single-file builds
```

Then open `sidechain/index.html` directly, or `dist/sidechain-standalone.html`
for a single self-contained file. `pipeline/test_sidechain.py` needs numpy;
nothing else needs anything.

To run the browser playtest:

```bash
npm install playwright && npx playwright install chromium
node pipeline/playtest.js
```

## Layout

```
pipeline/
  build_sidechain.py    # motif corpus -> data/puzzles.{json,js}
  test_sidechain.py     # regression + solver calibration
  build_artifact.py     # inlines repo files into dist/
  playtest.js           # headless browser playtest
data/
  puzzles.json          # canonical data
  puzzles.js            # same payload as a window global, so file:// works
sidechain/
  index.html  game.js  style.css
shared/
  tokens.css            # palette and type tokens for the whole suite
```

## How the game works

Six side-chain classes partition the twenty standard residues:

| Class | Residues |
|---|---|
| Aliphatic | A V L I M |
| Aromatic | F W Y |
| Polar | S T N Q C |
| Positive | K R H |
| Negative | D E |
| Conformational | G P |

Each guessed position returns one of three tiers — exact residue, correct class
with the wrong residue, or wrong class — plus a compass showing whether the true
residue is more or less hydrophobic than the one guessed.

The second deduction channel is **mass**. The peptide's mass in whole daltons is
shown before play, every residue's mass is printed on its key, and each guess
reports its own mass and the signed delta to target. This is what turns the
endgame from guessing into arithmetic: 43 daltons light is a glycine that should
have been a valine.

Whole-dalton precision is deliberate. Leucine and isoleucine are isomers with
identical mass, and lysine and glutamine both round to 128 — the same two
ambiguities that make real peptide mass spectrometry hard. Exact masses to two
decimal places were measured and rejected: they collapse the candidate set to a
single peptide after two guesses, ending the puzzle before it starts.

Every mechanic here was measured before it shipped, with a solver that plays a
fixed opener and then guesses uniformly among still-consistent candidates over
the full 20^5 space. The metric that matters is not how fast the solver wins but
**how many candidates remain after two guesses**, because that decides whether
the third guess is deduction or a coin flip.

| Channels | Mean guesses | Candidates alive @2 |
|---|---|---|
| Class only, no compass | 6.82 | — |
| Class + compass | 5.15 | 371 |
| \+ net charge | 4.86 | 160 |
| \+ side-chain heavy atoms | 3.98 | 10 |
| \+ **integer mass** | 3.43 | **2** |
| \+ exact mass (2dp) | 3.16 | 1 |

The compass is load-bearing: without it, 15% of puzzles go unsolved in eight
guesses. Integer mass is the sweet spot — narrowed but not solved. Exact mass and
per-guess exact deltas both collapse to one candidate and were rejected.

Shortening the peptide is the wrong lever for an easier mode — a four-residue
variant only drops the solver mean to 4.85. Easy mode instead reveals the class
of every position up front.

The three modes and their calibrated limits:

| Mode | Channels | Solver mean | Worst | Limit |
|---|---|---|---|---|
| Easy | classes + mass | 1.73 | 3 | 4 |
| Core | mass | 3.44 | 5 | 5 |
| Hard | neither | 5.20 | 7 | 7 |

One consequence of the mass channel: a puzzle whose residue-mass total is rare
starts the player from a tiny candidate pool. `GGGGS` is one of only five 5-mers
in the entire space at its mass, so revealing the mass hands it over. Such
puzzles stay in the corpus and remain available in practice mode and Hard, but
`build_sidechain.py` marks them `dailyEligible: false` and the daily rotation
skips them. The threshold is 50 candidates.

`pipeline/test_sidechain.py` re-runs that calibration against the shipped puzzle
set on every invocation, so adding motifs or changing the class table cannot
silently make the game unsolvable.

## Motif provenance

Every puzzle carries a provenance level, shown on its reveal card:

- **`uniprot`** — the motif was located programmatically inside a UniProt
  sequence stored verbatim in `build_sidechain.py`, and the build fails if it is
  not found. The cited residue range is computed, never recalled.
- **`literature`** — standard in the literature, but the sequence could not be
  retrieved cleanly at build time, so the position is not machine-checked.
- **`engineered`** — synthetic sequences (affinity tags, protease sites,
  linkers). No UniProt entry exists for these.

Current corpus: 43 motifs — 27 `uniprot`, 4 `literature`, 12 `engineered`.
The spec targets 120 before launch; below about 60 the daily rotation becomes
obvious.

## Scoring

- 100 points per unused guess, relative to the mode's own limit
- plus 25 per guess in which all five positions were at least class-correct

The second term is the game's point. A player can reach the answer in six
guesses by brute force or in six guesses without ever picking a wrong class; the
second player understands the chemistry, and the score says so.

## Licence

Code MIT (`LICENSE`). Puzzle content, motif descriptions and reveal-card text
CC BY 4.0.
