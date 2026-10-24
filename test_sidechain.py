#!/usr/bin/env python3
"""
test_sidechain.py — regression tests for the Sidechain puzzle set.

Re-runs the calibration from the spec against the ACTUAL shipped puzzles, so
that adding motifs or changing the class table cannot silently make the game
unsolvable at the configured guess limit.

Usage:  python3 pipeline/test_sidechain.py
"""
import itertools, json, os, sys
import numpy as np

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "..", "data", "puzzles.json")

# (label, guess limit, classes revealed, mass revealed)
MODES = [("easy", 4, True,  True),
         ("core", 5, False, True),
         ("hard", 7, False, False)]
OPENER = "LKSED"          # one residue from five of the six classes
GIVEAWAY_POOL = 50        # below this, revealing the mass gives the answer away

d = json.load(open(DATA))
AA = "".join(sorted(d["hydropathy"]))
idx = {a: i for i, a in enumerate(AA)}
cls = np.array([list(d["classes"]).index(d["residueClass"][a]) for a in AA])
kd = np.array([d["hydropathy"][a] for a in AA])
mass = np.array([d["residueMass"][a] for a in AA])
L = 5

failures = []


def check(label, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


print("\nstructural checks")
check("every residue classed exactly once", len(d["residueClass"]) == 20)
check("hydropathy table complete", len(d["hydropathy"]) == 20)
check("class residue sets partition the alphabet",
      sorted("".join(c["residues"] for c in d["classes"].values())) == sorted(AA))
check("all puzzles are 5 residues",
      all(len(p["seq"]) == 5 for p in d["puzzles"]))
check("all puzzle residues are standard",
      all(set(p["seq"]) <= set(AA) for p in d["puzzles"]))
check("no duplicate sequences",
      len({p["seq"] for p in d["puzzles"]}) == len(d["puzzles"]))
check("every puzzle has a blurb of two sentences or more",
      all(p["blurb"].count(".") >= 2 for p in d["puzzles"]))
check("uniprot-verified puzzles carry a position",
      all(p["pos"] for p in d["puzzles"] if p["verified"] == "uniprot"))
check("at least 40 puzzles", len(d["puzzles"]) >= 40,
      f"{len(d['puzzles'])} present")
check("residue mass table complete", len(d["residueMass"]) == 20)
check("stored puzzle mass matches the residue sum",
      all(p["mass"] == sum(d["residueMass"][r] for r in p["seq"]) + d["water"]
          for p in d["puzzles"]))
check("Leu and Ile are mass-degenerate (isomers)",
      d["residueMass"]["L"] == d["residueMass"]["I"])
check("Lys and Gln collide at whole-dalton resolution",
      d["residueMass"]["K"] == d["residueMass"]["Q"])

# ───────────────────────────── solver calibration ─────────────────────────────

space = np.array(list(itertools.product(range(20), repeat=L)), dtype=np.int8)
MSUM = mass[space].sum(1)


def feedback(g, t):
    tier = np.where(g == t, 2, np.where(cls[g] == cls[t], 1, 0))
    sign = np.sign(np.round(kd[t] - kd[g], 6)).astype(int)
    return tier, sign


def consistent(cand, g, tier, sign):
    ok = np.ones(len(cand), dtype=bool)
    for p in range(L):
        c = cand[:, p]
        if tier[p] == 2:
            ok &= c == g[p]
        elif tier[p] == 1:
            ok &= (cls[c] == cls[g[p]]) & (c != g[p])
        else:
            ok &= cls[c] != cls[g[p]]
        ok &= np.sign(np.round(kd[c] - kd[g[p]], 6)).astype(int) == sign[p]
    return ok


def starting_pool(target, easy, with_mass):
    sel = np.ones(len(space), dtype=bool)
    if with_mass:
        sel &= (MSUM == mass[target].sum())
    if easy:
        sel &= np.all(cls[space] == cls[target], axis=1)
    return space[sel]


def play(target, rng, easy, with_mass, maxg=10):
    cand = starting_pool(target, easy, with_mass)
    opener = np.array([idx[a] for a in OPENER])
    for n in range(1, maxg + 1):
        if len(cand) == 0:
            return None
        guess = opener if (n == 1 and not easy) else cand[rng.integers(len(cand))]
        if np.array_equal(guess, target):
            return n
        tier, sign = feedback(guess, target)
        cand = cand[consistent(cand, guess, tier, sign)]
        if len(cand) == 0:
            return None
    return None


targets = [np.array([idx[a] for a in p["seq"]], dtype=np.int8) for p in d["puzzles"]]
rng = np.random.default_rng(11)

for label, limit, easy, with_mass in MODES:
    print(f"\n{label} mode — solver over all {len(targets)} shipped puzzles, 5 trials each")
    res = [play(t, rng, easy, with_mass) for t in targets for _ in range(5)]
    solved = [r for r in res if r]
    within = [r for r in solved if r <= limit]
    mean = float(np.mean(solved))
    worst = max(solved)
    print(f"  mean {mean:.2f} guesses · worst {worst} · "
          f"{len(within)}/{len(res)} within the {limit}-guess limit")
    check(f"{label}: solver mean below the limit", mean < limit,
          f"mean {mean:.2f} vs limit {limit}")
    check(f"{label}: at least 90% solved within the limit",
          len(within) / len(res) >= 0.90,
          f"{100 * len(within) / len(res):.0f}%")

# A puzzle whose total mass is very rare starts from a tiny candidate pool and
# is effectively a freebie. Worth knowing about when curating new motifs.
print("\nmass-pool audit (core mode)")
pools = [(p["seq"], int((MSUM == sum(d["residueMass"][r] for r in p["seq"])).sum()))
         for p in d["puzzles"]]
tiny = [x for x in pools if x[1] < GIVEAWAY_POOL]
sizes = [x[1] for x in pools]
print(f"  starting pool: median {int(np.median(sizes))}, "
      f"min {min(sizes)} ({min(pools, key=lambda x: x[1])[0]}), max {max(sizes)}")
flagged = {s for s, n in tiny}
held = {p["seq"] for p in d["puzzles"] if not p.get("dailyEligible", True)}
if tiny:
    print("  below threshold: " +
          ", ".join(f"{s}={n}" for s, n in sorted(tiny, key=lambda x: x[1])))
check("every giveaway puzzle is held out of the daily rotation",
      flagged <= held, f"flagged={sorted(flagged)} held={sorted(held)}")
check("nothing is held out unnecessarily", held <= flagged,
      f"held={sorted(held)} flagged={sorted(flagged)}")
check("the daily rotation is still large enough",
      len(d["puzzles"]) - len(held) >= 40,
      f"{len(d['puzzles']) - len(held)} in rotation")

print()
if failures:
    sys.exit(f"{len(failures)} check(s) failed: {', '.join(failures)}")
print("all checks passed")
