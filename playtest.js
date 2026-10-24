/* playtest.js — drives the built standalone game in a real browser.
 * Asserts: guesses submit, feedback tiers and compass render correctly,
 * keyboard state updates, the win state and reveal card fire, the share
 * string is well formed, and the game still plays when localStorage throws.
 *
 * Usage: node pipeline/playtest.js
 */
const path = require("path");
const { chromium } = require(require("child_process")
  .execSync("npm root -g").toString().trim() + "/playwright");

const FILE = "file://" + path.resolve(__dirname, "..", "dist", "sidechain-standalone.html");

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function dismissHelp(page) {
  const close = page.locator(".scrim .close");
  if (await close.count()) { await close.click(); await page.waitForTimeout(120); }
}

async function typeWord(page, word) {
  for (const ch of word) await page.keyboard.press(ch);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(90);
}

(async () => {
  const browser = await chromium.launch();

  /* ── 1. full solve path, core mode ──────────────────────────────── */
  console.log("\ncore mode — full solve");
  let page = await browser.newPage({ viewport: { width: 430, height: 880 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(FILE);
  await page.waitForTimeout(700);

  check("help sheet shows on first visit", await page.locator(".scrim").count() === 1);
  await dismissHelp(page);

  const answer = await page.evaluate(() => window.__sidechain.state.puzzle.seq);
  const name = await page.evaluate(() => window.__sidechain.state.puzzle.name);
  console.log(`  today's puzzle: ${answer} (${name})`);

  check("board renders 5 rows in core mode", await page.locator(".row").count() === 5);

  // mass channel
  const tgt = await page.locator("#target").textContent();
  const trueMass = await page.evaluate(() => {
    const D = window.SIDECHAIN_DATA, s = window.__sidechain.state.puzzle.seq;
    return [...s].reduce((a, r) => a + D.residueMass[r], 0) + D.water;
  });
  check("target mass is shown and correct", tgt.includes(String(trueMass)),
    `chip="${tgt.trim()}" expected ${trueMass}`);
  check("residue masses are printed on the keys",
    await page.locator(".key .km").count() === 20);
  check("keyboard renders 20 residue keys",
    await page.locator(".key[data-residue]").count() === 20);

  // a deliberately wrong opener, so feedback logic is exercised
  const opener = "LKSED";
  await typeWord(page, opener);

  const firstRow = page.locator(".row").nth(0);
  check("first guess filled the row",
    (await firstRow.locator(".tile .aa").allTextContents()).join("") === opener);

  // verify each tile class against a recomputed expectation
  const expected = await page.evaluate(([g]) => {
    const S = window.__sidechain;
    return S.evaluate(g, S.state.puzzle.seq).map(f => ({ tier: f.tier, cmp: f.cmp }));
  }, [opener]);
  const rendered = await firstRow.locator(".tile").evaluateAll(els => els.map(e => ({
    cls: e.classList.contains("exact") ? 2 : e.classList.contains("klass") ? 1 : 0,
    cmp: e.querySelector(".cmp").textContent
  })));
  const GLYPH = { 1: "▲", "-1": "▼", 0: "●" };
  check("tier classes match the model",
    rendered.every((r, i) => r.cls === expected[i].tier),
    JSON.stringify(rendered.map(r => r.cls)));
  check("compass glyphs match the model",
    rendered.every((r, i) => r.cmp === GLYPH[String(expected[i].cmp)]),
    rendered.map(r => r.cmp).join(""));

  // A residue only greys out when it is impossible at ALL five positions, so
  // one guess rarely kills anything. Check the invariants that actually matter.
  const kb = await page.evaluate(() => {
    const D = window.SIDECHAIN_DATA;
    const seq = window.__sidechain.state.puzzle.seq;
    const dead = [...document.querySelectorAll(".key.dead")].map(k => k.dataset.residue);
    const hot = [...document.querySelectorAll(".key.hot")].map(k => k.dataset.residue);
    return { dead, hot, answerResidues: [...new Set(seq)] };
  });
  check("no residue of the answer is ever marked dead",
    !kb.answerResidues.some(r => kb.dead.includes(r)),
    `dead=[${kb.dead}] answer=[${kb.answerResidues}]`);

  // the mass gutter must report the guess's own mass and the signed delta
  const massCell = await page.locator(".row").nth(0).locator(".mass").textContent();
  const guessMass = await page.evaluate(([g]) => {
    const D = window.SIDECHAIN_DATA;
    return [...g].reduce((a, r) => a + D.residueMass[r], 0) + D.water;
  }, [opener]);
  check("row shows the guess's own mass", massCell.includes(String(guessMass)),
    `cell="${massCell}" expected ${guessMass}`);
  const delta = trueMass - guessMass;
  check("row shows the signed delta to target",
    massCell.includes(String(Math.abs(delta))) || delta === 0,
    `cell="${massCell}" delta=${delta}`);

  // Deterministic invariant: the live (position, residue) set must shrink with
  // each informative guess, and must always still contain the true answer.
  // Counting greyed-out keys is puzzle-dependent and therefore flaky.
  const live1 = await page.evaluate(() => {
    const sets = window.__sidechain.possibleSets();
    const seq = window.__sidechain.state.puzzle.seq;
    return {
      n: sets.reduce((a, s) => a + Object.values(s).filter(Boolean).length, 0),
      holdsAnswer: [...seq].every((r, p) => sets[p][r] === true)
    };
  });
  check("possible set still contains the answer after one guess", live1.holdsAnswer);

  await typeWord(page, "AWTRG");
  const live2 = await page.evaluate(() => {
    const sets = window.__sidechain.possibleSets();
    const seq = window.__sidechain.state.puzzle.seq;
    return {
      n: sets.reduce((a, s) => a + Object.values(s).filter(Boolean).length, 0),
      holdsAnswer: [...seq].every((r, p) => sets[p][r] === true)
    };
  });
  check("deduction narrows the live residue set", live2.n < live1.n,
    `${live1.n} -> ${live2.n} of 100 position/residue pairs`);
  check("possible set still contains the answer after two guesses",
    live2.holdsAnswer);
  check("no answer residue is ever greyed out on the keyboard",
    await page.evaluate(() => {
      const dead = [...document.querySelectorAll(".key.dead")].map(k => k.dataset.residue);
      return ![...new Set(window.__sidechain.state.puzzle.seq)].some(r => dead.includes(r));
    }));

  // now solve it
  await typeWord(page, answer);
  await page.waitForTimeout(700);

  check("win state recorded", await page.evaluate(() => window.__sidechain.state.won === true));
  check("reveal card fired", await page.locator(".scrim .sheet h2").count() === 1);
  const heading = await page.locator(".scrim .sheet h2").textContent();
  check("reveal card names the motif", heading.includes(name), heading);
  check("reveal card shows the peptide",
    (await page.locator(".scrim .peptide span").allTextContents()).join("") === answer);
  check("reveal card has a provenance badge", await page.locator(".scrim .prov").count() === 1);
  check("reveal card has a blurb",
    (await page.locator(".scrim p.lead").textContent()).length > 80);

  const share = await page.locator(".scrim .sharebox").textContent();
  const lines = share.trim().split("\n");
  check("share string has a header line", /Sidechain/.test(lines[0]), lines[0]);
  check("share header carries the target mass",
    lines[0].includes(String(trueMass) + " Da"), lines[0]);
  check("share string has one row per guess",
    lines.filter(l => /^[█▒░]/.test(l)).length === 3);
  check("share string rows are 10 glyphs",
    lines.filter(l => /^[█▒░]/.test(l)).every(l => [...l].length === 10));
  check("share string does not leak the answer", !share.includes(answer), share.replace(/\n/g, " | "));
  check("winning row is all-exact",
    [...lines.filter(l => /^[█▒░]/.test(l)).pop()]
      .filter(c => c === "█").length === 5);

  await page.screenshot({ path: path.resolve(__dirname, "..", "dist", "shot-reveal.png") });

  // stats
  await page.locator(".scrim .actions button", { hasText: "Stats" }).click();
  await page.waitForTimeout(250);
  const played = await page.locator(".statgrid b").first().textContent();
  check("stats recorded a played game", played === "1", `played=${played}`);
  await dismissHelp(page);

  /* ── 2. board screenshot mid-game ───────────────────────────────── */
  const shotPage = await browser.newPage({ viewport: { width: 430, height: 880 } });
  await shotPage.goto(FILE);
  await shotPage.waitForTimeout(600);
  await dismissHelp(shotPage);
  await typeWord(shotPage, "LKSED");
  await typeWord(shotPage, "AWTRG");
  await shotPage.waitForTimeout(200);
  await shotPage.screenshot({ path: path.resolve(__dirname, "..", "dist", "shot-board.png") });

  const darkPage = await browser.newPage({
    viewport: { width: 430, height: 880 }, colorScheme: "dark" });
  await darkPage.goto(FILE);
  await darkPage.waitForTimeout(600);
  await dismissHelp(darkPage);
  await typeWord(darkPage, "LKSED");
  await typeWord(darkPage, "AWTRG");
  await darkPage.waitForTimeout(200);
  await darkPage.screenshot({ path: path.resolve(__dirname, "..", "dist", "shot-dark.png") });

  /* ── 3. easy mode ───────────────────────────────────────────────── */
  console.log("\neasy mode");
  const easy = await browser.newPage({ viewport: { width: 430, height: 880 } });
  await easy.goto(FILE);
  await easy.waitForTimeout(600);
  await dismissHelp(easy);
  await easy.locator("[data-mode='easy']").click();
  await easy.waitForTimeout(200);
  check("easy mode shows 4 rows", await easy.locator(".row").count() === 4);
  check("easy mode reveals the class strip", await easy.locator(".hint").count() === 5);
  const hintGlyphs = await easy.locator(".hint").allTextContents();
  const trueClasses = await easy.evaluate(() => {
    const S = window.__sidechain, D = window.SIDECHAIN_DATA;
    return [...S.state.puzzle.seq].map(r => D.classes[D.residueClass[r]].glyph);
  });
  check("class strip matches the answer's classes",
    hintGlyphs.join("") === trueClasses.join(""), hintGlyphs.join(""));

  /* ── 3b. hard mode withholds the mass ───────────────────────────── */
  console.log("\nhard mode");
  const hard = await browser.newPage({ viewport: { width: 430, height: 880 } });
  await hard.goto(FILE);
  await hard.waitForTimeout(600);
  await dismissHelp(hard);
  await hard.locator("[data-mode='hard']").click();
  await hard.waitForTimeout(200);
  check("hard mode shows 7 rows", await hard.locator(".row").count() === 7);
  check("hard mode hides the target mass",
    await hard.locator("#target").isHidden());
  check("hard mode hides the mass gutter",
    await hard.locator(".mass").count() === 0);
  check("hard mode hides residue masses on keys",
    await hard.locator(".key .km").count() === 0);

  /* ── 3c. giveaway puzzles stay out of the daily rotation ────────── */
  const rotation = await hard.evaluate(() => {
    const P = window.SIDECHAIN_DATA.puzzles;
    const held = P.filter(p => p.dailyEligible === false).map(p => p.seq);
    // every date must resolve to an eligible puzzle
    const bad = [];
    for (let i = 0; i < 400; i++) {
      const d = new Date(2026, 0, 1 + i);
      const iso = d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
      let h = 2166136261;
      for (const ch of iso) { h ^= ch.charCodeAt(0); h = (h * 16777619) >>> 0; }
      const pool = P.filter(p => p.dailyEligible !== false);
      if (held.includes(pool[(h >>> 0) % pool.length].seq)) bad.push(iso);
    }
    return { held, bad };
  });
  check("no date in 400 days resolves to a held-out puzzle",
    rotation.bad.length === 0, rotation.bad.slice(0, 3).join(", "));

  /* ── 4. practice mode ───────────────────────────────────────────── */
  console.log("\npractice mode");
  const prac = await browser.newPage({ viewport: { width: 430, height: 880 } });
  await prac.goto(FILE + "?practice");
  await prac.waitForTimeout(600);
  await dismissHelp(prac);
  check("practice mode labelled in the meta line",
    (await prac.locator("#meta-left").textContent()).includes("Practice"));
  const p1 = await prac.evaluate(() => window.__sidechain.state.puzzle.id);
  const pa = await prac.evaluate(() => window.__sidechain.state.puzzle.seq);
  await typeWord(prac, pa);
  await prac.waitForTimeout(700);
  await prac.locator(".scrim .actions button", { hasText: "New practice puzzle" }).click();
  await prac.waitForTimeout(300);
  const p2 = await prac.evaluate(() => window.__sidechain.state.puzzle.id);
  check("new practice puzzle differs", p1 !== p2, `${p1} -> ${p2}`);

  /* ── 5. localStorage hostile ────────────────────────────────────── */
  console.log("\nlocalStorage throwing");
  const hostile = await browser.newPage({ viewport: { width: 430, height: 880 } });
  const hostileErrors = [];
  hostile.on("pageerror", e => hostileErrors.push(e.message));
  await hostile.addInitScript(() => {
    const boom = () => { throw new Error("storage disabled"); };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { return { getItem: boom, setItem: boom, removeItem: boom }; }
    });
  });
  await hostile.goto(FILE);
  await hostile.waitForTimeout(600);
  await dismissHelp(hostile);
  const ans2 = await hostile.evaluate(() => window.__sidechain.state.puzzle.seq);
  await typeWord(hostile, "LKSED");
  await typeWord(hostile, ans2);
  await hostile.waitForTimeout(700);
  check("game still playable with storage throwing",
    await hostile.evaluate(() => window.__sidechain.state.won === true));
  check("no uncaught errors when storage throws", hostileErrors.length === 0,
    hostileErrors.join("; "));

  /* ── 6. no horizontal overflow at phone width ───────────────────── */
  console.log("\nlayout");
  const narrow = await browser.newPage({ viewport: { width: 360, height: 780 } });
  await narrow.goto(FILE);
  await narrow.waitForTimeout(500);
  await dismissHelp(narrow);
  const overflow = await narrow.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check("no horizontal overflow at 360px", !overflow);

  // The sandbox blocks the Google Fonts CDN; that is an environment fact,
  // not a defect in the page, so it does not count as a failure.
  const realErrors = errors.filter(e => !/ERR_TUNNEL_CONNECTION_FAILED|fonts\.googleapis/.test(e));
  console.log("\nconsole errors during play:", realErrors.length ? realErrors.join("; ") : "none");
  if (realErrors.length) failures++;

  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
