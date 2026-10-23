#!/usr/bin/env python3
"""
build_sidechain.py — generates data/puzzles.json for the Sidechain game.

Every natural motif is located inside a sequence fetched from UniProt and
stored verbatim below; the script computes the residue position itself and
FAILS LOUDLY if a motif is not found where claimed. Nothing is trusted to
recall.

Three provenance levels appear in the output:
  "uniprot"    — motif located programmatically in a stored UniProt sequence
  "literature" — motif is standard in the literature but the stored sequence
                 could not be retrieved cleanly; position not machine-checked
  "engineered" — synthetic sequence (affinity tag, protease site, linker);
                 no UniProt accession exists

Usage:  python3 pipeline/build_sidechain.py
"""
import json, os, sys, textwrap

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "puzzles.json")

# ─────────────────────────── chemistry constants ───────────────────────────

AA = "ACDEFGHIKLMNPQRSTVWY"

CLASSES = {
    "aliphatic":     {"residues": "AVLIM", "label": "Aliphatic",     "glyph": "■"},
    "aromatic":      {"residues": "FWY",   "label": "Aromatic",      "glyph": "◆"},
    "polar":         {"residues": "STNQC", "label": "Polar",         "glyph": "●"},
    "positive":      {"residues": "KRH",   "label": "Positive",      "glyph": "▲"},
    "negative":      {"residues": "DE",    "label": "Negative",      "glyph": "▼"},
    "conformational":{"residues": "GP",    "label": "Conformational","glyph": "◇"},
}

# Kyte & Doolittle (1982) hydropathy index
KD = {"A": 1.8, "R": -4.5, "N": -3.5, "D": -3.5, "C": 2.5, "Q": -3.5,
      "E": -3.5, "G": -0.4, "H": -3.2, "I": 4.5, "L": 3.8, "K": -3.9,
      "M": 1.9, "F": 2.8, "P": -1.6, "S": -0.8, "T": -0.7, "W": -0.9,
      "Y": -1.3, "V": 4.2}

# Average residue masses, rounded to whole daltons — a peptide's mass is the
# sum of these plus one water (18 Da). Integer precision is deliberate: it
# leaves Leu/Ile degenerate (they are isomers, genuinely identical by mass) and
# Lys/Gln colliding at 128, which are the two ambiguities that actually plague
# peptide mass spectrometry.
RESIDUE_MASS = {"G": 57, "A": 71, "S": 87, "P": 97, "V": 99, "T": 101,
                "C": 103, "L": 113, "I": 113, "N": 114, "D": 115, "Q": 128,
                "K": 128, "E": 129, "M": 131, "H": 137, "F": 147, "R": 156,
                "Y": 163, "W": 186}
WATER = 18

FULL_NAMES = {
    "A": "Alanine", "C": "Cysteine", "D": "Aspartate", "E": "Glutamate",
    "F": "Phenylalanine", "G": "Glycine", "H": "Histidine", "I": "Isoleucine",
    "K": "Lysine", "L": "Leucine", "M": "Methionine", "N": "Asparagine",
    "P": "Proline", "Q": "Glutamine", "R": "Arginine", "S": "Serine",
    "T": "Threonine", "V": "Valine", "W": "Tryptophan", "Y": "Tyrosine",
}

RESIDUE_CLASS = {}
for key, spec in CLASSES.items():
    for r in spec["residues"]:
        RESIDUE_CLASS[r] = key

assert set(RESIDUE_CLASS) == set(AA), "every residue must be classed exactly once"
assert sum(len(c["residues"]) for c in CLASSES.values()) == 20

# ───────────────── UniProt sequences, stored verbatim as fetched ─────────────────
# Retrieved from https://rest.uniprot.org/uniprotkb/<ACC>.fasta
SEQS = {
"P10599": "MVKQIESKTAFQEALDAAGDKLVVVDFSATWCGPCKMIKPFFHSLSEKYSNVIFLEVDVDDCQDVASECEVKCMPTFQFFKKGQKVGEFSGANKEKLEATINELV",
"P01112": "MTEYKLVVVGAGGVGKSALTIQLIQNHFVDEYDPTIEDSYRKQVVIDGETCLLDILDTAGQEEYSAMRDQYMRTGEGFLCVFAINNTKSFEDIHQYREQIKRVKDSDDVPMVLVGNKCDLAARTVESRQAQDLARSYGIPYIETSAKTRQGVEDAFYTLVREIRQHKLRKLNPPDESGPGCMSCKCVLS",
"P0DP23": "MADQLTEEQIAEFKEAFSLFDKDGDGTITTKELGTVMRSLGQNPTEAELQDMINEVDADGNGTIDFPEFLTMMARKMKDTDSEEEIREAFRVFDKDGNGYISAAELRHVMTNLGEKLTDEEVDEMIREADIDGDGQVNYEEFVQMMTAK",
"P00760": "MKTFIFLALLGAAVAFPVDDDDKIVGGYTCGANTVPYQVSLNSGYHFCGGSLINSQWVVSAAHCYKSGIQVRLGEDNINVVEGNEQFISASKSIVHPSYNSNTLNNDIMLIKLKSAASLNSRVASISLPTSCASAGTQCLISGWGNTKSSGTSYPDVLKCLKAPILSDSSCKSAYPGQITSNMFCAGYLEGGKDSCQGDSGGPVVCSGKLQGIVSWGSGCAQKNKPGVYTKVCNYVSWIKQTIASN",
"P00698": "MRSLLILVLCFLPLAALGKVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKFESNFNTQATNRNTDGSTDYGILQINSRWWCNDGRTPGSRNLCNIPCSALLSSDITASVNCAKKIVSDGNGMNAWVAWRNRCKGTDVQAWIRGCRL",
"P00441": "MATKAVCVLKGDGPVQGIINFEQKESNGPVKVWGSIKGLTEGLHGFHVHEFGDNTAGCTSAGPHFNPLSRKHGGPKDEERHVGDLGNVTADKDGVADVSIEDSVISLSGDHCIIGRTLVVHEKADDLGKGGNEESTKTGNAGSRLACGVIGIAQ",
"P02766": "MASHRLLLLCLAGLVFVSEAGPTGTGESKCPLMVKVLDAVRGSPAINVAVHVFRKAADDTWEPFASGKTSESGELHGLTTEEEFVEGIYKVEIDTKSYWKALGISPFHEHAEVVFTANDSGPRRYTIAALLSPYSYSTTAVVTNPKE",
"P69441": "MRIILLGAPGAGKGTQAQFIMEKYGIPQISTGDMLRAAVKSGSELGKQAKDIMDAGKLVTDELVIALVKERIAQEDCRNGFLLDGFPRTIPQADAMKEAGINVDYVLEFDVPDELIVDRIVGRRVHAPSGRVYHVKFNPPKVEGKDDVTGEELTTRKDDQEETVRKRLVEYHQMTAPLIGYYSKEAEAGNTKYAKVDGTKPVAEVRADLEKILG",
"P00918": "MSHHWGYGKHNGPEHWHKDFPIAKGERQSPVDIDTHTAKYDPSLKPLSVSYDQATSLRILNNGHAFNVEFDDSQDKAVLKGGPLDGTYRLIQFHFHWGSLDGQGSEHTVDKKKYAAELHLVHWNTKYGDFGKAVQQPDGLAVLGIFLKVGSAKPGLQKVVDVLDSIKTKGKSADFTNFDPRGLLPESLDYWTYPGSLTTPPLLECVTWIVLKEPISVSSEQVLKFRKLNFNGEGEPEELMVDNWRPAQPLKNRQIKASFK",
"P68871": "MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH",
"P69905": "MVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR",
"P01308": "MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN",
# P0CG48 is polyubiquitin-C: 76-residue ubiquitin repeated. Only the first
# monomer is stored; positions below are therefore monomer positions.
"P0CG48": "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG",
}

# ───────────────────────────── the motif corpus ─────────────────────────────
# (seq, name, source, accession-or-None, provenance, blurb)

NATURAL = [
 ("WCGPC", "Thioredoxin redox active site", "Thioredoxin (human)", "P10599",
  "The two cysteines here swap between a free dithiol and an internal disulfide, and that cycle is how thioredoxin hands reducing power to other proteins. The rigid Cys-Gly-Pro-Cys spacing holds the pair at exactly the distance a disulfide needs."),

 ("GGVGK", "P-loop, small GTPase", "HRas (human)", "P01112",
  "This glycine-rich loop wraps the phosphates of bound GTP, and the glycines are there because anything with a side chain would collide with them. Mutations at the following residue, Gly12, lock Ras in its active state and are among the most common oncogenic changes in human cancer."),

 ("KCVLS", "CAAX prenylation box", "HRas (human)", "P01112",
  "The very end of Ras, where a farnesyl lipid is attached to the cysteine so the protein can stick to the inner face of the membrane. Cut this tail off and Ras still binds GTP perfectly but can no longer signal, because it is floating in the cytosol."),

 ("DKDGD", "EF-hand calcium loop", "Calmodulin (human)", "P0DP23",
  "A twelve-residue loop whose aspartates and backbone carbonyls cage a single Ca2+ ion. Calmodulin carries four of these, and filling them swings the protein open to expose a hydrophobic groove that grabs its targets."),

 ("SAAHC", "Catalytic triad — histidine", "Trypsinogen (bovine)", "P00760",
  "The histidine of the serine protease catalytic triad, which pulls a proton off the catalytic serine so it can attack the substrate. It sits far from the other two triad members in sequence and only meets them once the protein folds."),

 ("NNDIM", "Catalytic triad — aspartate", "Trypsinogen (bovine)", "P00760",
  "The buried aspartate that orients the triad histidine and stabilises it once it picks up a proton. It never touches the substrate; it exists to make the histidine a better base."),

 ("GDSGG", "Catalytic triad — serine", "Trypsinogen (bovine)", "P00760",
  "The nucleophilic serine that actually attacks the peptide bond, embedded in a Gly-Asp-Ser-Gly-Gly motif so conserved it is used to identify serine proteases from sequence alone. The flanking glycines leave the serine sterically exposed."),

 ("DDDDK", "Enterokinase activation site", "Trypsinogen (bovine)", "P00760",
  "Four aspartates and a lysine mark where enterokinase cuts trypsinogen to switch on trypsin. The same sequence is used as an engineered cleavage tag precisely because so little else in a proteome looks like it."),

 ("IVGGY", "New N-terminus after activation", "Trypsinogen (bovine)", "P00760",
  "The moment trypsinogen is cut, this isoleucine becomes a free N-terminus and buries itself in a pocket, snapping the active site into shape. Zymogen activation is a conformational switch triggered by a single new charge."),

 ("KFESN", "Lysozyme catalytic glutamate", "Lysozyme C (chicken)", "P00698",
  "Glu35 donates a proton to the glycosidic bond it is about to break, working as a general acid. Its unusually high pKa comes from sitting in a hydrophobic pocket, which is what keeps it protonated at working pH."),

 ("STDYG", "Lysozyme catalytic aspartate", "Lysozyme C (chicken)", "P00698",
  "Asp52 is the second half of lysozyme's catalytic pair, stabilising the positively charged intermediate that forms as the sugar ring is cleaved. It sits in a polar environment and stays deprotonated — the mirror image of Glu35 next door."),

 ("HVHEF", "Copper site, Cu/Zn superoxide dismutase", "SOD1 (human)", "P00441",
  "Two of the histidines that hold the catalytic copper, which cycles between Cu(I) and Cu(II) to dismutate superoxide. SOD1 runs close to the diffusion limit, which makes it one of the fastest enzymes known."),

 ("NVAVH", "Transthyretin amyloid hotspot", "Transthyretin (human)", "P02766",
  "The valine here is position 30 of mature transthyretin, and its replacement by methionine is the most common cause of hereditary transthyretin amyloidosis. A single hydrophobic swap destabilises the tetramer enough for the monomers to misfold."),

 ("GPTGT", "Transthyretin N-terminus", "Transthyretin (human)", "P02766",
  "The start of mature transthyretin after its signal peptide is removed. Glycine and threonine make a flexible, polar N-terminal arm that stays disordered even in the crystal structures."),

 ("PGAGK", "Walker A motif", "Adenylate kinase (E. coli)", "P69441",
  "The bacterial version of the phosphate-binding loop, doing the same job as the Ras P-loop with a different sequence. Comparing the two is a clean demonstration that structure is conserved far more tightly than sequence."),

 ("DGFPR", "Adenylate kinase LID hinge", "Adenylate kinase (E. coli)", "P69441",
  "Part of the mobile LID domain that clamps shut over bound nucleotide during catalysis. Adenylate kinase is a textbook case of induced fit — the closed and open structures differ by around 30 angstroms."),

 ("FHFHW", "Zinc site, carbonic anhydrase II", "Carbonic anhydrase 2 (human)", "P00918",
  "Two of the three histidines that hold the catalytic zinc, which lowers the pKa of a bound water molecule enough to strip a proton off it at neutral pH. The resulting hydroxide is what attacks CO2."),

 ("TPEEK", "Haemoglobin beta N-terminus", "Haemoglobin subunit beta (human)", "P68871",
  "Residue 6 of the beta chain is the glutamate that becomes valine in sickle cell disease. Swapping one charged residue for a hydrophobic one creates a sticky patch that lets deoxygenated haemoglobin polymerise into fibres."),

 ("LAHHF", "Proximal histidine region", "Haemoglobin subunit beta (human)", "P68871",
  "The proximal histidine bonds directly to the heme iron and is physically pulled when oxygen binds on the far side. That tug is transmitted through the helix and is the mechanical basis of cooperative oxygen binding."),

 ("VLSPA", "Haemoglobin alpha N-terminus", "Haemoglobin subunit alpha (human)", "P69905",
  "The alpha chain begins differently from beta despite the two folding almost identically. Comparing the first few residues of each is a quick way to see how far two sequences can drift while keeping one shape."),

 ("FVNQH", "Insulin B chain N-terminus", "Insulin (human)", "P01308",
  "The start of the B chain, part of the surface that lets insulin monomers assemble into hexamers around zinc. Engineered changes in this region are what make fast-acting insulin analogues dissociate more quickly."),

 ("GIVEQ", "Insulin A chain N-terminus", "Insulin (human)", "P01308",
  "The A chain begins here, immediately followed by the cysteines that disulfide-bond it to the B chain. Insulin is synthesised as a single chain and only becomes two once the connecting C-peptide is excised."),

 ("CCTSI", "Insulin intrachain disulfide", "Insulin (human)", "P01308",
  "Two adjacent cysteines, one bonding within the A chain and one reaching across to the B chain. Getting these pairings right is the hard part of producing insulin recombinantly."),

 ("MQIFV", "Ubiquitin N-terminus", "Polyubiquitin-C (human)", "P0CG48",
  "The opening strand of the beta-grasp fold, one of the most thermodynamically stable small domains known. Ubiquitin is so tolerant of heat and acid that boiling a lysate is a legitimate purification step."),

 ("FAGKQ", "Ubiquitin Lys48", "Polyubiquitin-C (human)", "P0CG48",
  "Chains built through this lysine are the canonical signal for proteasomal degradation. Four linked ubiquitins is roughly the threshold the proteasome recognises."),

 ("NIQKE", "Ubiquitin Lys63", "Polyubiquitin-C (human)", "P0CG48",
  "Chains through Lys63 do not mean destruction — they signal in DNA repair and NF-kB activation. Same protein, same modification, different lysine, opposite outcome."),

 ("RLRGG", "Ubiquitin C-terminal tail", "Polyubiquitin-C (human)", "P0CG48",
  "The flexible tail whose terminal glycine forms an isopeptide bond to a target lysine. E1, E2 and E3 enzymes all handle this same five-residue tail."),
]

LITERATURE = [
 ("GRGDS", "RGD integrin-binding motif", "Fibronectin (human)", "P02751",
  "The tripeptide integrins read when they grip the extracellular matrix, presented here on an exposed loop. RGD peptides are grafted onto biomaterials to persuade cells to adhere to them."),

 ("KLVFF", "Amyloid-beta aggregation core", "Amyloid-beta A4 protein (human)", "P05067",
  "The central hydrophobic cluster of amyloid-beta, and the stretch that drives the peptide into cross-beta fibrils. Peptides copying this sequence were among the first designed aggregation inhibitors."),

 ("HELTH", "HExxH zinc protease motif", "Thermolysin (Bacillus)", "P00800",
  "Two histidines separated by two arbitrary residues, both coordinating a catalytic zinc, with the glutamate activating the attacking water. The HExxH signature identifies metalloproteases across otherwise unrelated families."),

 ("KKKRK", "SV40 classical NLS", "Large T antigen (SV40)", "P03070",
  "A dense run of positive charge that importin-alpha reads as an instruction to carry the protein into the nucleus. It was the first nuclear localisation signal identified and is still the standard one to bolt onto engineered proteins."),
]

ENGINEERED = [
 ("HHHHH", "Polyhistidine tag",
  "Histidines chelate immobilised nickel, which is the entire basis of IMAC purification. The imidazole ring is the only side chain in the standard twenty that coordinates a divalent metal well at neutral pH."),

 ("DYKDD", "FLAG tag",
  "A short, highly charged epitope tag, deliberately hydrophilic so it stays on the protein surface and rarely disturbs folding. Its charge is also why FLAG-tagged proteins elute under mild conditions."),

 ("WSHPQ", "Strep-tag II",
  "Binds engineered streptavidin, and is competed off with biotin analogues under conditions gentle enough to keep complexes intact. The tryptophan does most of the binding work."),

 ("EQKLI", "Myc epitope tag",
  "A linear epitope from the c-Myc protein, used because a well-characterised monoclonal antibody recognises it reliably. Linear epitopes are preferred as tags because they do not require a folded context."),

 ("YPYDV", "HA epitope tag",
  "Taken from influenza haemagglutinin, and one of the smallest tags that still gives clean immunodetection. Its tyrosines make it easy to detect but also slightly more perturbing than FLAG."),

 ("NLYFQ", "TEV protease site",
  "Tobacco etch virus protease cuts after the glutamine, leaving almost no scar on the released protein. This is how an affinity tag is removed after it has done its job on the column."),

 ("LVPRG", "Thrombin cleavage site",
  "Thrombin cuts between the arginine and glycine, an older workhorse for tag removal. It is less specific than TEV, which is why internal cleavage of the target protein is a real risk."),

 ("LPETG", "Sortase A recognition motif",
  "Sortase cuts between threonine and glycine and ligates the remainder to an incoming polyglycine, making it a protein-ligation tool rather than just a protease. Bacteria use it to staple surface proteins to cell wall peptidoglycan."),

 ("DEVDG", "Caspase-3 cleavage site",
  "Caspase-3 cuts after the second aspartate, and this sequence is the basis of most apoptosis assays. Caspases are unusual among proteases in demanding an aspartate at the cut site."),

 ("IEGRG", "Factor Xa cleavage site",
  "Factor Xa cuts after the arginine, leaving no extra residues on the protein's new N-terminus. It comes from the blood clotting cascade, where this specificity controls prothrombin activation."),

 ("GGGGS", "Flexible peptide linker",
  "The standard flexible linker for fusion proteins and single-chain antibodies. Glycine supplies backbone freedom and serine keeps the stretch soluble, so the two joined domains can move independently."),

 ("EAAAK", "Rigid helical linker",
  "Forms a stable alpha helix through salt bridges between the glutamate and lysine, holding two fused domains at a fixed distance. Used when a flexible linker would let the domains interact when they should not."),
]

# ────────────────────────────── assembly ──────────────────────────────

def peptide_mass(seq):
    """Whole-dalton peptide mass: residue masses plus one water."""
    return sum(RESIDUE_MASS[r] for r in seq) + WATER


# A puzzle whose residue-mass total is rare starts the player from a tiny
# candidate pool, so revealing the mass effectively hands them the answer.
# GGGGS, for instance, is one of only five 5-mers in the whole 20^5 space at
# its mass. Such puzzles stay in the corpus but are kept out of the daily
# rotation; they are still served in practice mode and in Hard, where no mass
# is shown.
DAILY_MIN_POOL = 50


def mass_pool_sizes(length=5):
    """How many peptides of `length` share each possible residue-mass total."""
    counts = {0: 1}
    for _ in range(length):
        nxt = {}
        for total, n in counts.items():
            for m in RESIDUE_MASS.values():
                nxt[total + m] = nxt.get(total + m, 0) + n
        counts = nxt
    return counts


POOLS = mass_pool_sizes()


def mass_pool(seq):
    return POOLS.get(sum(RESIDUE_MASS[r] for r in seq), 0)


def slugify(text):
    keep = [c.lower() if c.isalnum() else "-" for c in text]
    slug = "".join(keep)
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-")[:48]


def build():
    puzzles, errors = [], []
    seen = set()

    def add(entry):
        if entry["seq"] in seen:
            errors.append(f"duplicate sequence {entry['seq']}")
            return
        seen.add(entry["seq"])
        puzzles.append(entry)

    for seq, name, source, acc, blurb in NATURAL:
        if any(c not in AA for c in seq) or len(seq) != 5:
            errors.append(f"{seq}: not a valid 5-residue peptide")
            continue
        full = SEQS.get(acc)
        if full is None:
            errors.append(f"{seq}: no stored sequence for {acc}")
            continue
        idx = full.find(seq)
        if idx < 0:
            errors.append(f"{seq}: NOT FOUND in {acc} — refusing to ship")
            continue
        if full.find(seq, idx + 1) >= 0:
            # not fatal, but the cited position is then ambiguous
            errors.append(f"note: {seq} occurs more than once in {acc}; citing first")
        add({"id": slugify(f"{acc}-{name}"), "seq": seq, "name": name,
             "source": source, "acc": acc, "pos": idx + 1,
             "mass": peptide_mass(seq),
             "massPool": mass_pool(seq),
             "dailyEligible": mass_pool(seq) >= DAILY_MIN_POOL,
             "verified": "uniprot", "blurb": blurb})

    for seq, name, source, acc, blurb in LITERATURE:
        add({"id": slugify(f"{acc}-{name}"), "seq": seq, "name": name,
             "source": source, "acc": acc, "pos": None,
             "mass": peptide_mass(seq),
             "massPool": mass_pool(seq),
             "dailyEligible": mass_pool(seq) >= DAILY_MIN_POOL,
             "verified": "literature", "blurb": blurb})

    for seq, name, blurb in ENGINEERED:
        add({"id": slugify(f"eng-{name}"), "seq": seq, "name": name,
             "source": "Engineered sequence", "acc": None, "pos": None,
             "mass": peptide_mass(seq),
             "massPool": mass_pool(seq),
             "dailyEligible": mass_pool(seq) >= DAILY_MIN_POOL,
             "verified": "engineered", "blurb": blurb})

    return puzzles, errors


def main():
    puzzles, errors = build()

    fatal = [e for e in errors if not e.startswith("note:")]
    for e in errors:
        print(("  ! " if not e.startswith("note:") else "  · ") + e, file=sys.stderr)
    if fatal:
        sys.exit(f"\n{len(fatal)} fatal problem(s); no output written.")

    payload = {
        "schemaVersion": 1,
        "generator": "pipeline/build_sidechain.py",
        "license": "CC BY 4.0",
        "classes": {k: {"label": v["label"], "residues": v["residues"],
                        "glyph": v["glyph"]} for k, v in CLASSES.items()},
        "residueClass": RESIDUE_CLASS,
        "hydropathy": KD,
        "residueMass": RESIDUE_MASS,
        "water": WATER,
        "dailyMinPool": DAILY_MIN_POOL,
        "names": FULL_NAMES,
        "puzzles": puzzles,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(payload, fh, indent=1, sort_keys=False)

    # Browser-loadable twin, so the game works from file:// with no fetch().
    js_out = OUT[:-5] + ".js"
    with open(js_out, "w") as fh:
        fh.write("/* generated by pipeline/build_sidechain.py — do not edit */\n")
        fh.write("window.SIDECHAIN_DATA = ")
        json.dump(payload, fh, separators=(",", ":"), sort_keys=False)
        fh.write(";\n")

    counts = {}
    for p in puzzles:
        counts[p["verified"]] = counts.get(p["verified"], 0) + 1
    ineligible = [p for p in puzzles if not p["dailyEligible"]]
    print(f"\nwrote {len(puzzles)} puzzles -> {os.path.relpath(OUT)}")
    if ineligible:
        print(f"  held out of daily rotation (mass pool < {DAILY_MIN_POOL}): " +
              ", ".join(f"{p['seq']} ({p['massPool']})" for p in ineligible))
    for k in ("uniprot", "literature", "engineered"):
        print(f"  {k:12s} {counts.get(k, 0)}")


if __name__ == "__main__":
    main()
