/* game.js — Sidechain
 *
 * Guess a five-residue peptide. Feedback reports side-chain chemistry, not
 * letters: a class tier per position plus a Kyte–Doolittle hydropathy compass.
 *
 * Expects a global SIDECHAIN_DATA (see data/puzzles.json).
 * MIT licensed. Puzzle content CC BY 4.0.
 */
(function () {
  "use strict";

  var D = window.SIDECHAIN_DATA;
  var PUZZLES = D.puzzles;
  var CLASS_KEYS = Object.keys(D.classes);
  var NS = "sidechain:v1:";

  /* Guess limits are set from the solver calibration in
     pipeline/test_sidechain.py, not by feel:
       easy  classes + mass  mean 1.68, worst 3  -> 4
       core  mass only       mean 3.43, worst 5  -> 5
       hard  neither         mean 5.15, worst 8  -> 7                     */
  var MODES = {
    easy: { limit: 4, revealClasses: true,  revealMass: true,  label: "Easy" },
    core: { limit: 5, revealClasses: false, revealMass: true,  label: "Core" },
    hard: { limit: 7, revealClasses: false, revealMass: false, label: "Hard" }
  };

  var CMP = { up: "▲", down: "▼", same: "●" };
  var SHARE_TIER = { 2: "█", 1: "▒", 0: "░" };
  var SHARE_CMP = { 1: "↑", "-1": "↓", 0: "·" };

  /* ── safe storage ──────────────────────────────────────────────────── */

  var store = {
    get: function (k, fallback) {
      try {
        var raw = window.localStorage.getItem(NS + k);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (k, v) {
      try { window.localStorage.setItem(NS + k, JSON.stringify(v)); return true; }
      catch (e) { return false; }
    }
  };

  /* ── chemistry helpers ─────────────────────────────────────────────── */

  function classOf(r) { return D.residueClass[r]; }
  function kd(r) { return D.hydropathy[r]; }
  function resMass(r) { return D.residueMass[r]; }

  /** Whole-dalton peptide mass: residue masses plus one water. */
  function peptideMass(seq) {
    var m = 0;
    for (var i = 0; i < seq.length; i++) m += resMass(seq[i]);
    return m + (seq.length ? D.water : 0);
  }
  /** Running total for a partly typed row — no water until it is complete. */
  function partialMass(seq) {
    var m = 0;
    for (var i = 0; i < seq.length; i++) m += resMass(seq[i]);
    return m;
  }
  function classColor(key) { return "var(--c-" + key + ")"; }
  function classTint(key) { return "var(--t-" + key + ")"; }

  function cmpDir(guessR, targetR) {
    var d = kd(targetR) - kd(guessR);
    if (Math.abs(d) < 1e-9) return 0;
    return d > 0 ? 1 : -1;
  }

  /** Per-position feedback: tier 2 exact, 1 same class, 0 wrong class. */
  function evaluate(guess, target) {
    var out = [];
    for (var i = 0; i < 5; i++) {
      var g = guess[i], t = target[i];
      out.push({
        residue: g,
        tier: g === t ? 2 : (classOf(g) === classOf(t) ? 1 : 0),
        cmp: cmpDir(g, t)
      });
    }
    return out;
  }

  /* ── deterministic daily selection ─────────────────────────────────── */

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function localISODate(d) {
    var y = d.getFullYear(),
        m = String(d.getMonth() + 1).padStart(2, "0"),
        day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  /* Puzzles whose mass is so rare that showing it gives the answer away are
     kept out of the daily rotation. They remain available in practice mode. */
  var DAILY_POOL = PUZZLES.filter(function (p) { return p.dailyEligible !== false; });
  if (!DAILY_POOL.length) DAILY_POOL = PUZZLES;

  function puzzleForDate(iso) { return DAILY_POOL[hashStr(iso) % DAILY_POOL.length]; }

  /* ── game state ────────────────────────────────────────────────────── */

  var S = {
    mode: "core",
    practice: false,
    dateISO: localISODate(new Date()),
    puzzle: null,
    guesses: [],      // array of 5-char strings
    current: "",
    done: false,
    won: false,
    revealed: false
  };

  function stateKey() { return "state:" + S.mode + ":" + (S.practice ? "practice" : S.dateISO); }
  function statsKey() { return "stats:" + S.mode; }

  function blankStats() {
    return { played: 0, won: 0, streak: 0, maxStreak: 0, score: 0,
             dist: [0, 0, 0, 0, 0, 0, 0], lastDate: null };
  }

  function loadStats() {
    var s = store.get(statsKey(), null);
    if (!s || typeof s !== "object") return blankStats();
    var b = blankStats();
    for (var k in b) if (!(k in s)) s[k] = b[k];
    if (!Array.isArray(s.dist)) s.dist = b.dist;
    return s;
  }

  /* ── derived knowledge for the keyboard ────────────────────────────── */

  /** Residues still possible at each position, given every guess so far. */
  function possibleSets() {
    var alphabet = Object.keys(D.hydropathy);
    var sets = [];
    for (var p = 0; p < 5; p++) {
      var alive = {};
      alphabet.forEach(function (r) { alive[r] = true; });
      sets.push(alive);
    }
    S.guesses.forEach(function (g) {
      var fb = evaluate(g, S.puzzle.seq);
      for (var p = 0; p < 5; p++) {
        var f = fb[p], gr = g[p], alive = sets[p];
        Object.keys(alive).forEach(function (r) {
          if (!alive[r]) return;
          var ok;
          if (f.tier === 2) ok = (r === gr);
          else if (f.tier === 1) ok = (classOf(r) === classOf(gr) && r !== gr);
          else ok = (classOf(r) !== classOf(gr));
          if (ok && cmpDir(gr, r) !== f.cmp) ok = false;
          if (!ok) alive[r] = false;
        });
      }
    });
    return sets;
  }

  /** key state per residue: hot (uniquely pinned somewhere), dead, or live */
  function keyStates() {
    var sets = possibleSets(), out = {};
    var counts = sets.map(function (s) {
      return Object.keys(s).filter(function (r) { return s[r]; });
    });
    Object.keys(D.hydropathy).forEach(function (r) {
      var anywhere = false, pinned = false;
      for (var p = 0; p < 5; p++) {
        if (sets[p][r]) {
          anywhere = true;
          if (counts[p].length === 1) pinned = true;
        }
      }
      out[r] = !anywhere ? "dead" : (pinned ? "hot" : "live");
    });
    return out;
  }

  /* ── scoring ───────────────────────────────────────────────────────── */

  function chemistryStreak() {
    var bonus = 0;
    S.guesses.forEach(function (g) {
      var fb = evaluate(g, S.puzzle.seq);
      if (fb.every(function (f) { return f.tier >= 1; })) bonus += 25;
    });
    return bonus;
  }

  function roundScore() {
    if (!S.won) return 0;
    // relative to the mode's own limit, so a 5-guess core solve and a 7-guess
    // hard solve are both worth the floor of 100 rather than the limit leaking
    // a fixed constant into the score
    return 100 * (MODES[S.mode].limit + 1 - S.guesses.length) + chemistryStreak();
  }

  /* ── DOM ───────────────────────────────────────────────────────────── */

  var el = {};
  function $(id) { return document.getElementById(id); }

  function classStyle(key) {
    return "--tc:" + classColor(key) + ";--tt:" + classTint(key) + ";";
  }

  function renderMeta() {
    var n = PUZZLES.indexOf(S.puzzle) + 1;
    el.metaLeft.textContent = S.practice
      ? "Practice · #" + n
      : S.dateISO + " · #" + n;
    var left = MODES[S.mode].limit - S.guesses.length;
    el.metaRight.textContent = S.done
      ? (S.won ? "solved in " + S.guesses.length : "revealed")
      : left + (left === 1 ? " guess left" : " guesses left");

    // the target mass is the second deduction channel; hard mode withholds it
    if (MODES[S.mode].revealMass) {
      el.target.hidden = false;
      el.target.innerHTML = "<span>target</span><b>" +
        peptideMass(S.puzzle.seq) + "</b><span>Da</span>";
    } else {
      el.target.hidden = true;
    }
  }

  function renderHints() {
    el.hints.innerHTML = "";
    if (!MODES[S.mode].revealClasses) { el.hints.hidden = true; return; }
    el.hints.hidden = false;
    for (var i = 0; i < 5; i++) {
      var key = classOf(S.puzzle.seq[i]);
      var d = document.createElement("div");
      d.className = "hint";
      d.setAttribute("style", classStyle(key));
      d.textContent = D.classes[key].glyph;
      d.title = D.classes[key].label;
      el.hints.appendChild(d);
    }
    // keep the strip aligned with the board's reserved mass gutter
    el.hints.classList.toggle("with-mass", MODES[S.mode].revealMass);
  }

  function renderBoard(popIndex) {
    var limit = MODES[S.mode].limit;
    var showMass = MODES[S.mode].revealMass;
    var targetMass = peptideMass(S.puzzle.seq);
    el.board.innerHTML = "";
    el.board.classList.toggle("with-mass", showMass);
    for (var r = 0; r < limit; r++) {
      var row = document.createElement("div");
      row.className = "row";
      var submitted = r < S.guesses.length;
      var fb = submitted ? evaluate(S.guesses[r], S.puzzle.seq) : null;
      for (var c = 0; c < 5; c++) {
        var t = document.createElement("div");
        t.className = "tile";
        var aa = document.createElement("div");
        aa.className = "aa";
        var cm = document.createElement("div");
        cm.className = "cmp";

        if (submitted) {
          var f = fb[c];
          var key = classOf(f.residue);
          t.setAttribute("style", classStyle(key));
          t.classList.add(f.tier === 2 ? "exact" : f.tier === 1 ? "klass" : "miss");
          aa.textContent = f.residue;
          cm.textContent = f.cmp === 1 ? CMP.up : f.cmp === -1 ? CMP.down : CMP.same;
          t.setAttribute("aria-label",
            f.residue + " " + (D.names[f.residue] || "") + ", " +
            (f.tier === 2 ? "exact match" :
             f.tier === 1 ? "correct class, wrong residue" : "wrong class") +
            ", answer is " + (f.cmp === 1 ? "more" : f.cmp === -1 ? "less" : "equally") +
            " hydrophobic");
        } else if (r === S.guesses.length && c < S.current.length) {
          t.classList.add("typed");
          aa.textContent = S.current[c];
          if (popIndex === c) t.classList.add("pop");
        }
        t.appendChild(aa); t.appendChild(cm);
        row.appendChild(t);
      }

      if (showMass) {
        var mc = document.createElement("div");
        mc.className = "mass";
        if (submitted) {
          var gm = peptideMass(S.guesses[r]);
          var delta = targetMass - gm;
          mc.innerHTML = "<b>" + gm + "</b><i class=\"" +
            (delta === 0 ? "ok" : delta > 0 ? "under" : "over") + "\">" +
            (delta === 0 ? "✓" : (delta > 0 ? "+" : "−") + Math.abs(delta)) +
            "</i>";
          mc.setAttribute("aria-label", "guess mass " + gm + " daltons, " +
            (delta === 0 ? "exact match" :
             delta > 0 ? delta + " daltons too light" : Math.abs(delta) + " daltons too heavy"));
        } else if (r === S.guesses.length && S.current.length) {
          mc.classList.add("partial");
          mc.innerHTML = "<b>" + partialMass(S.current) + "</b><i>…</i>";
        }
        row.appendChild(mc);
      }
      el.board.appendChild(row);
    }
    if (popIndex != null) {
      window.setTimeout(function () {
        var p = el.board.querySelector(".pop");
        if (p) p.classList.remove("pop");
      }, 120);
    }
  }

  function renderPad() {
    var states = S.done ? null : keyStates();
    el.pad.innerHTML = "";
    CLASS_KEYS.forEach(function (key) {
      var spec = D.classes[key];
      var row = document.createElement("div");
      row.className = "krow";
      row.setAttribute("style", classStyle(key));

      var lab = document.createElement("div");
      lab.className = "klabel";
      lab.textContent = spec.glyph + " " + spec.label;
      row.appendChild(lab);

      var keys = document.createElement("div");
      keys.className = "kkeys";
      spec.residues.split("").forEach(function (r) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "key" + (states ? " " + states[r] : "");
        b.dataset.residue = r;
        b.innerHTML = "<span class=\"kr\">" + r + "</span>" +
          (MODES[S.mode].revealMass
            ? "<span class=\"km\">" + resMass(r) + "</span>" : "");
        b.title = D.names[r] + " · " + resMass(r) + " Da · KD " + kd(r).toFixed(1);
        b.setAttribute("aria-label", D.names[r] + ", " + resMass(r) + " daltons");
        keys.appendChild(b);
      });
      row.appendChild(keys);
      el.pad.appendChild(row);
    });

    var actions = document.createElement("div");
    actions.className = "actions";

    var del = document.createElement("button");
    del.type = "button"; del.id = "btn-delete"; del.textContent = "Delete";
    del.disabled = S.done || S.current.length === 0;

    var sub = document.createElement("button");
    sub.type = "button"; sub.id = "btn-submit";
    sub.className = "primary";
    sub.textContent = S.done ? "Result" : "Submit";
    sub.disabled = !S.done && S.current.length !== 5;

    actions.appendChild(del); actions.appendChild(sub);
    el.pad.appendChild(actions);
  }

  function render(popIndex) {
    renderMeta(); renderHints(); renderBoard(popIndex); renderPad();
  }

  /* ── toast ─────────────────────────────────────────────────────────── */

  var toastTimer = null;
  function toast(msg) {
    if (el.toast) el.toast.remove();
    var t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.textContent = msg;
    document.body.appendChild(t);
    el.toast = t;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      if (t.parentNode) t.remove();
      if (el.toast === t) el.toast = null;
    }, 1900);
  }

  /* ── sheets ────────────────────────────────────────────────────────── */

  function openSheet(build) {
    closeSheet();
    var scrim = document.createElement("div");
    scrim.className = "scrim";
    var sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");

    var close = document.createElement("button");
    close.type = "button";
    close.className = "icon-btn close";
    close.setAttribute("aria-label", "Close");
    close.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';
    close.addEventListener("click", closeSheet);
    sheet.appendChild(close);

    build(sheet);
    scrim.appendChild(sheet);
    scrim.addEventListener("mousedown", function (e) {
      if (e.target === scrim) closeSheet();
    });
    document.body.appendChild(scrim);
    el.scrim = scrim;
    close.focus();
  }

  function closeSheet() {
    if (el.scrim) { el.scrim.remove(); el.scrim = null; }
  }

  function peptideRow(seq) {
    var wrap = document.createElement("div");
    wrap.className = "peptide";
    seq.split("").forEach(function (r) {
      var s = document.createElement("span");
      s.setAttribute("style", classStyle(classOf(r)));
      s.textContent = r;
      wrap.appendChild(s);
    });
    return wrap;
  }

  function shareText() {
    var head = "Sidechain " + (S.practice ? "practice" : S.dateISO) +
      " · " + MODES[S.mode].label +
      (MODES[S.mode].revealMass ? " · " + peptideMass(S.puzzle.seq) + " Da" : "") +
      " · " + (S.won ? S.guesses.length : "X") + "/" + MODES[S.mode].limit;
    var lines = S.guesses.map(function (g) {
      return evaluate(g, S.puzzle.seq).map(function (f) {
        return SHARE_TIER[f.tier] + SHARE_CMP[String(f.cmp)];
      }).join("");
    });
    var chem = chemistryStreak();
    var tail = S.won ? "score " + roundScore() + (chem ? " (chem +" + chem + ")" : "") : "";
    return [head].concat(lines, tail ? [tail] : []).join("\n");
  }

  function revealSheet() {
    var p = S.puzzle;
    openSheet(function (sheet) {
      var h = document.createElement("h2");
      h.textContent = S.won ? "Solved — " + p.name : p.name;
      sheet.appendChild(h);

      var sub = document.createElement("p");
      sub.className = "sub";
      sub.textContent = S.won
        ? S.guesses.length + " of " + MODES[S.mode].limit + " guesses · score " + roundScore()
        : "Out of guesses";
      sheet.appendChild(sub);

      sheet.appendChild(peptideRow(p.seq));

      var mline = document.createElement("p");
      mline.className = "massline";
      mline.innerHTML = p.seq.split("").map(function (r) {
        return "<span>" + r + "<i>" + resMass(r) + "</i></span>";
      }).join("<em>+</em>") + "<em>+</em><span>H₂O<i>" + D.water +
        "</i></span><em>=</em><strong>" + peptideMass(p.seq) + " Da</strong>";
      sheet.appendChild(mline);

      var lead = document.createElement("p");
      lead.className = "lead";
      lead.textContent = p.blurb;
      sheet.appendChild(lead);

      var src = document.createElement("p");
      src.className = "srcline";
      src.innerHTML = "<strong>" + escapeHTML(p.source) + "</strong>";
      if (p.acc) {
        src.innerHTML += " · <a href=\"https://www.uniprot.org/uniprotkb/" +
          encodeURIComponent(p.acc) + "\" target=\"_blank\" rel=\"noopener\">" +
          escapeHTML(p.acc) + "</a>";
      }
      if (p.pos) src.innerHTML += " · residues " + p.pos + "–" + (p.pos + 4);
      var badge = document.createElement("span");
      badge.className = "prov " + p.verified;
      badge.textContent = p.verified === "uniprot" ? "sequence checked"
        : p.verified === "literature" ? "literature" : "engineered";
      badge.title = p.verified === "uniprot"
        ? "Located programmatically in the UniProt sequence."
        : p.verified === "literature"
          ? "Standard in the literature; position not machine-verified."
          : "Synthetic sequence — no UniProt entry exists.";
      src.appendChild(badge);
      sheet.appendChild(src);

      var box = document.createElement("div");
      box.className = "sharebox";
      box.textContent = shareText();
      sheet.appendChild(box);

      var acts = document.createElement("div");
      acts.className = "actions";
      var copy = document.createElement("button");
      copy.type = "button"; copy.className = "primary"; copy.textContent = "Copy result";
      copy.addEventListener("click", function () { copyShare(); });
      var stats = document.createElement("button");
      stats.type = "button"; stats.textContent = "Stats";
      stats.addEventListener("click", statsSheet);
      acts.appendChild(copy); acts.appendChild(stats);
      sheet.appendChild(acts);

      if (S.practice) {
        var again = document.createElement("div");
        again.className = "actions";
        var nb = document.createElement("button");
        nb.type = "button"; nb.textContent = "New practice puzzle";
        nb.addEventListener("click", function () { closeSheet(); newPractice(); });
        again.appendChild(nb);
        sheet.appendChild(again);
      }
    });
  }

  function copyShare() {
    var text = shareText();
    var done = function () { toast("Result copied"); };
    var fail = function () { toast("Copy failed — select the text instead"); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else { fallback(); }
    } catch (e) { fallback(); }

    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand && document.execCommand("copy");
        ta.remove();
        ok ? done() : fail();
      } catch (e2) { fail(); }
    }
  }

  function statsSheet() {
    var st = loadStats();
    openSheet(function (sheet) {
      var h = document.createElement("h2");
      h.textContent = "Statistics";
      sheet.appendChild(h);
      var sub = document.createElement("p");
      sub.className = "sub";
      sub.textContent = MODES[S.mode].label + " mode";
      sheet.appendChild(sub);

      var grid = document.createElement("div");
      grid.className = "statgrid";
      [["played", st.played], ["win %", st.played ? Math.round(100 * st.won / st.played) : 0],
       ["streak", st.streak], ["best", st.maxStreak]].forEach(function (pair) {
        var d = document.createElement("div");
        d.innerHTML = "<b>" + pair[1] + "</b><span>" + pair[0] + "</span>";
        grid.appendChild(d);
      });
      sheet.appendChild(grid);

      var maxv = Math.max.apply(null, st.dist.concat([1]));
      var dist = document.createElement("div");
      dist.className = "dist";
      var limit = MODES[S.mode].limit;
      for (var i = 1; i <= limit; i++) {
        var v = st.dist[i - 1] || 0;
        var row = document.createElement("div");
        row.className = "drow" + (S.won && S.guesses.length === i ? " hit" : "");
        var bw = document.createElement("div");
        bw.className = "barwrap";
        var bar = document.createElement("div");
        bar.className = "bar";
        bar.style.width = Math.max(8, Math.round(100 * v / maxv)) + "%";
        bar.textContent = v;
        bw.appendChild(bar);
        row.innerHTML = "<div>" + i + "</div>";
        row.appendChild(bw);
        dist.appendChild(row);
      }
      sheet.appendChild(dist);

      var total = document.createElement("p");
      total.className = "srcline";
      total.textContent = "Total score " + st.score +
        " · " + PUZZLES.length + " motifs in rotation";
      sheet.appendChild(total);
    });
  }

  function helpSheet() {
    openSheet(function (sheet) {
      var h = document.createElement("h2");
      h.textContent = "How to play";
      sheet.appendChild(h);
      var sub = document.createElement("p");
      sub.className = "sub";
      sheet.appendChild(sub);
      sub.textContent = "Chemistry, not letters";

      var p1 = document.createElement("p");
      p1.className = "lead";
      p1.textContent = "Guess the five-residue peptide. Nothing tells you which letters are right — the feedback describes the side-chain chemistry of each position instead.";
      sheet.appendChild(p1);

      var legend = document.createElement("div");
      legend.className = "legend";
      [["exact", "S", "Exact residue."],
       ["klass", "T", "Right chemical class, wrong residue. Here the answer is another polar residue."],
       ["miss", "L", "Wrong class entirely."]].forEach(function (row) {
        var r = document.createElement("div");
        r.className = "lrow";
        r.innerHTML = '<div class="swatch ' + row[0] + '">' + row[1] + "</div><div>" + row[2] + "</div>";
        legend.appendChild(r);
      });
      sheet.appendChild(legend);

      var p2 = document.createElement("p");
      p2.innerHTML = "Under each letter sits the <strong>hydropathy compass</strong>: " +
        CMP.up + " the true residue is more hydrophobic than your guess, " +
        CMP.down + " less, " + CMP.same + " the same, on the Kyte–Doolittle scale. " +
        "Without the compass this puzzle is close to unsolvable, so use it.";
      sheet.appendChild(p2);

      var ct = document.createElement("div");
      ct.className = "classtable";
      CLASS_KEYS.forEach(function (key) {
        var spec = D.classes[key];
        var row = document.createElement("div");
        row.className = "crow";
        row.setAttribute("style", classStyle(key));
        row.innerHTML = '<div class="g">' + spec.glyph + "</div><div>" +
          escapeHTML(spec.label) + '</div><div class="r">' +
          spec.residues.split("").join(" ") + "</div>";
        ct.appendChild(row);
      });
      sheet.appendChild(ct);

      var p25 = document.createElement("p");
      p25.innerHTML = "The second channel is <strong>mass</strong>. You are told the peptide's " +
        "mass in whole daltons before you start, every residue's mass is printed on its key, " +
        "and each guess reports its own mass and how far off it is. That turns the puzzle into " +
        "arithmetic you can actually close: 43 daltons light is a glycine that should have been " +
        "a valine.";
      sheet.appendChild(p25);

      var p26 = document.createElement("p");
      p26.innerHTML = "Whole daltons on purpose. Leucine and isoleucine are isomers with " +
        "<em>identical</em> mass, and lysine and glutamine both round to 128 — the same two " +
        "ambiguities that make real peptide mass spectrometry hard.";
      sheet.appendChild(p26);

      var p3 = document.createElement("p");
      p3.innerHTML = "<strong>Easy</strong> reveals the class of every position and gives four guesses. " +
        "<strong>Core</strong> gives you the mass and five. <strong>Hard</strong> withholds the mass " +
        "entirely and gives seven. Solve to see which real protein motif you just built.";
      sheet.appendChild(p3);

      var p4 = document.createElement("p");
      p4.className = "srcline";
      p4.textContent = "Scoring: 100 points per unused guess, plus 25 for every guess where all five positions were at least class-correct — reasoning beats luck.";
      sheet.appendChild(p4);
    });
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ── actions ───────────────────────────────────────────────────────── */

  function typeResidue(r) {
    if (S.done || S.current.length >= 5) return;
    S.current += r;
    render(S.current.length - 1);
    persist();
  }

  function deleteResidue() {
    if (S.done || !S.current.length) return;
    S.current = S.current.slice(0, -1);
    render();
    persist();
  }

  function submitGuess() {
    if (S.done) { revealSheet(); return; }
    if (S.current.length !== 5) { toast("Need five residues"); return; }
    var g = S.current;
    S.guesses.push(g);
    S.current = "";
    if (g === S.puzzle.seq) { S.done = true; S.won = true; }
    else if (S.guesses.length >= MODES[S.mode].limit) { S.done = true; S.won = false; }
    if (S.done) recordResult();
    render();
    persist();
    if (S.done) window.setTimeout(revealSheet, 420);
  }

  function recordResult() {
    if (S.practice) return;                  // practice never touches stats
    var st = loadStats();
    if (st.lastDate === S.dateISO) return;   // already counted today
    st.played += 1;
    if (S.won) {
      st.won += 1;
      st.dist[S.guesses.length - 1] = (st.dist[S.guesses.length - 1] || 0) + 1;
      st.score += roundScore();
      var yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      st.streak = (st.lastDate === localISODate(yesterday)) ? st.streak + 1 : 1;
      if (st.streak > st.maxStreak) st.maxStreak = st.streak;
    } else {
      st.streak = 0;
    }
    st.lastDate = S.dateISO;
    store.set(statsKey(), st);
  }

  function persist() {
    store.set(stateKey(), {
      id: S.puzzle.id, guesses: S.guesses, current: S.current,
      done: S.done, won: S.won
    });
  }

  function restore() {
    var saved = store.get(stateKey(), null);
    if (!saved || saved.id !== S.puzzle.id || !Array.isArray(saved.guesses)) return false;
    S.guesses = saved.guesses.filter(function (g) {
      return typeof g === "string" && g.length === 5;
    }).slice(0, MODES[S.mode].limit);
    S.current = typeof saved.current === "string" ? saved.current.slice(0, 5) : "";
    S.won = S.guesses.indexOf(S.puzzle.seq) >= 0;
    S.done = S.won || S.guesses.length >= MODES[S.mode].limit;
    if (S.done) S.current = "";
    return true;
  }

  function setMode(mode) {
    if (!MODES[mode] || mode === S.mode) return;
    S.mode = mode;
    store.set("mode", mode);
    S.guesses = []; S.current = ""; S.done = false; S.won = false;
    restore();
    render();
    document.querySelectorAll("[data-mode]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    });
  }

  function newPractice() {
    var next;
    do { next = PUZZLES[Math.floor(Math.random() * PUZZLES.length)]; }
    while (PUZZLES.length > 1 && next.id === S.puzzle.id);
    S.puzzle = next;
    S.guesses = []; S.current = ""; S.done = false; S.won = false;
    persist();
    render();
    toast("New practice puzzle");
  }

  /* ── input wiring ──────────────────────────────────────────────────── */

  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (el.scrim) {
      if (e.key === "Escape") { e.preventDefault(); closeSheet(); }
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); submitGuess(); return; }
    if (e.key === "Backspace") { e.preventDefault(); deleteResidue(); return; }
    var ch = (e.key || "").toUpperCase();
    if (ch.length === 1 && D.hydropathy[ch] != null) {
      e.preventDefault();
      typeResidue(ch);
    }
  }

  function boot() {
    el.board = $("board");
    el.hints = $("hints");
    el.pad = $("pad");
    el.metaLeft = $("meta-left");
    el.metaRight = $("meta-right");
    el.target = $("target");

    var params = new URLSearchParams(window.location.search);
    S.practice = params.has("practice");
    S.mode = MODES[store.get("mode", "core")] ? store.get("mode", "core") : "core";

    if (S.practice) {
      var saved = store.get("state:" + S.mode + ":practice", null);
      var byId = saved && PUZZLES.filter(function (p) { return p.id === saved.id; })[0];
      S.puzzle = byId || PUZZLES[Math.floor(Math.random() * PUZZLES.length)];
    } else {
      S.puzzle = puzzleForDate(S.dateISO);
    }

    restore();

    document.querySelectorAll("[data-mode]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === S.mode));
      b.addEventListener("click", function () { setMode(b.dataset.mode); });
    });
    $("btn-help").addEventListener("click", helpSheet);
    $("btn-stats").addEventListener("click", statsSheet);

    el.pad.addEventListener("click", function (e) {
      var k = e.target.closest("button");
      if (!k) return;
      if (k.dataset.residue) typeResidue(k.dataset.residue);
      else if (k.id === "btn-delete") deleteResidue();
      else if (k.id === "btn-submit") submitGuess();
    });

    document.addEventListener("keydown", onKeyDown);

    render();

    if (!store.get("seen-help", false)) {
      helpSheet();
      store.set("seen-help", true);
    } else if (S.done) {
      // leave the board visible; the player can reopen the result
    }

    window.__sidechain = {          // test hook, harmless in production
      state: S, evaluate: evaluate, shareText: shareText,
      possibleSets: possibleSets, keyStates: keyStates,
      peptideMass: peptideMass,
      type: typeResidue, submit: submitGuess, del: deleteResidue
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
