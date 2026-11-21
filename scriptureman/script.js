// Scripture Man: load questions, then draw them at random onto a 5x5 board.

// ---------- Sample questions ----------
const SAMPLE = [
  ["Who built the ark?", "Noah", "Genesis 6"],
  ["Who was swallowed by a great fish?", "Jonah", "Jonah 1:17"],
  ["Who defeated Goliath?", "David", "1 Samuel 17"],
  ["What is the first book of the Bible?", "Genesis", "Genesis 1:1"],
  ["Who was thrown into the lions' den?", "Daniel", "Daniel 6"],
  ["How many disciples did Jesus choose?", "12", "Luke 6:13"],
  ["In what town was Jesus born?", "Bethlehem", "Matthew 2:1"],
  ["Who led the Israelites out of Egypt?", "Moses", "Exodus 3"],
  ["Who was Moses' brother and spokesman?", "Aaron", "Exodus 4:14"],
  ["Which disciple betrayed Jesus?", "Judas Iscariot", "Matthew 26:14-16"],
  ["Who was the mother of Jesus?", "Mary", "Luke 1:30-31"],
  ["What did God create on the first day?", "Light", "Genesis 1:3"],
  ["Which disciple walked on water toward Jesus?", "Peter", "Matthew 14:29"],
  ["Who was sold into slavery by his brothers?", "Joseph", "Genesis 37:28"],
  ["Which judge lost his strength when his hair was cut?", "Samson", "Judges 16"],
  ["What is the last book of the Bible?", "Revelation", "Revelation 22"],
  ["Who climbed a sycamore tree to see Jesus?", "Zacchaeus", "Luke 19:4"],
  ["How many days and nights did it rain during the flood?", "40", "Genesis 7:12"],
  ["Who was the first man?", "Adam", "Genesis 2:7"],
  ["Which king is credited with writing many of the Psalms?", "David", "Psalms"]
].map(a => ({ question: a[0], answer: a[1], reference: a[2] }));

const COLS = "ABCDE";
const $ = id => document.getElementById(id);
const SETUP_SUBTITLE = "Load your questions, then draw them at random onto the board.";

let bank = [];   // questions loaded on the setup screen
let game = null; // state of the game in progress

// Every board cell id, A1 through E5.
const allCells = [];
for (let r = 1; r <= 5; r++) for (const c of COLS) allCells.push(c + r);

// ---------- Helpers ----------
function setStatus(msg, cls) {
  const s = $("status");
  s.textContent = msg;
  s.className = "status " + (cls || "");
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Parsing questions ----------

// Minimal CSV parser: handles quoted fields, doubled quotes, and CRLF line endings.
function parseCSV(t) {
  const rows = [];
  let r = [], c = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch == '"') {
        if (t[i + 1] == '"') { c += '"'; i++; }
        else q = false;
      } else c += ch;
    } else if (ch == '"') q = true;
    else if (ch == ",") { r.push(c); c = ""; }
    else if (ch == "\n" || ch == "\r") {
      if (ch == "\r" && t[i + 1] == "\n") i++;
      r.push(c); rows.push(r); r = []; c = "";
    } else c += ch;
  }
  if (c || r.length) { r.push(c); rows.push(r); }
  return rows.filter(x => x.some(v => v.trim()));
}

// Accepts "C3", "c 3", or "3C" and returns "C3"; anything else returns null.
function normCoord(v) {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  const m = s.match(/^([A-E])\s*([1-5])$/) || s.match(/^([1-5])\s*([A-E])$/);
  if (!m) return null;
  return /[A-E]/.test(m[1]) ? m[1] + m[2] : m[2] + m[1];
}

// Turns JSON or CSV text into a list of {question, answer, reference, coordinate}.
function parseQuestions(text) {
  text = text.trim().replace(/^﻿/, "");
  if (!text) throw new Error("Nothing to load.");

  let items;
  if (text[0] == "[" || text[0] == "{") {
    const j = JSON.parse(text);
    items = Array.isArray(j) ? j : (j.questions || []);
  } else {
    const rows = parseCSV(text);
    const head = rows[0].map(h => h.trim().toLowerCase());
    if (head.includes("question")) {
      items = rows.slice(1).map(r => {
        const o = {};
        head.forEach((h, i) => o[h] = (r[i] || "").trim());
        return o;
      });
    } else {
      // No header row: assume question, answer, reference, coordinate.
      items = rows.map(r => ({ question: r[0], answer: r[1], reference: r[2], coordinate: r[3] }));
    }
  }

  const out = items.map(o => ({
    question: String(o.question || "").trim(),
    answer: String(o.answer || "").trim(),
    reference: String(o.reference || o.ref || "").trim(),
    coordinate: normCoord(o.coordinate || o.coord)
  })).filter(o => o.question);

  if (!out.length) throw new Error("No questions found. Check the column names.");
  return out;
}

// ---------- Loading questions ----------
function accept(list, label) {
  let note = "";
  if (list.length > 25) {
    list = list.slice(0, 25);
    note = " Only the first 25 fit the board.";
  }
  bank = list;
  setStatus("Loaded " + list.length + " questions" + (label ? " from " + label : "") + "." + note, "good");
  $("start").disabled = false;
}

function tryLoad(text, label) {
  try {
    accept(parseQuestions(text), label);
  } catch (e) {
    bank = [];
    $("start").disabled = true;
    setStatus("Could not load: " + e.message, "err");
  }
}

document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => {
  document.querySelectorAll("[data-tab]").forEach(x => x.classList.toggle("on", x === b));
  ["sample", "file", "paste", "url"].forEach(t => $("t-" + t).classList.toggle("hidden", t !== b.dataset.tab));
  if (b.dataset.tab == "sample") accept(SAMPLE.slice(), "the sample set");
});

$("file").onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => tryLoad(r.result, f.name);
  r.onerror = () => setStatus("Could not read that file.", "err");
  r.readAsText(f);
};

$("loadPaste").onclick = () => tryLoad($("paste").value, "pasted text");

$("loadUrl").onclick = async () => {
  const u = $("url").value.trim();
  if (!u) return setStatus("Enter a link first.", "err");
  setStatus("Fetching...");
  try {
    const r = await fetch(u);
    if (!r.ok) throw new Error("HTTP " + r.status);
    tryLoad(await r.text(), "the link");
  } catch (e) {
    setStatus("Could not fetch that link (" + e.message + "). If this page is running in a preview, outside requests are blocked: download the sheet as CSV and use Upload file.", "err");
  }
};

// ---------- Game ----------
function startGame() {
  // Keep each question's chosen cell unless another question already took it,
  // then give the rest random free cells.
  const used = new Set();
  const qs = bank.map(q => ({ ...q }));
  qs.forEach(q => {
    if (q.coordinate && !used.has(q.coordinate)) used.add(q.coordinate);
    else q.coordinate = null;
  });
  const free = shuffle(allCells.filter(c => !used.has(c)));
  qs.forEach(q => { if (!q.coordinate) q.coordinate = free.pop(); });

  game = { order: shuffle(qs), i: -1, drawn: {}, cur: null, spinning: false };

  $("setup").classList.add("hidden");
  $("end").classList.add("hidden");
  $("game").classList.remove("hidden");
  $("sub").textContent = "Draw a question, answer it, and claim its square.";
  $("idle").classList.remove("hidden");
  $("active").classList.add("hidden");
  renderBoard();
}

function renderBoard() {
  let h = "<div></div>";
  for (const c of COLS) h += '<div class="hd">' + c + "</div>";
  for (let r = 1; r <= 5; r++) {
    h += '<div class="hd">' + r + "</div>";
    for (const c of COLS) {
      const id = c + r;
      const isCur = game.cur && game.cur.coordinate == id;
      const showCur = isCur && !game.spinning;
      const isDone = game.drawn[id] && !isCur;
      let cls = "cell";
      if (showCur) cls += " cur";
      else if (isDone) cls += " done";
      h += '<div class="' + cls + '">' + ((showCur || isDone) ? id : "") + "</div>";
    }
  }
  $("board").innerHTML = h;
  $("prog").textContent = "Question " + Math.max(game.i + 1, 0) + " of " + game.order.length;
}

// Flashes random coordinates in el, then calls done. Skipped for reduced motion.
function spin(el, done) {
  if (matchMedia("(prefers-reduced-motion:reduce)").matches) { done(); return; }
  let n = 0;
  const t = setInterval(() => {
    el.textContent = COLS[Math.floor(Math.random() * 5)] + (1 + Math.floor(Math.random() * 5));
    if (++n >= 14) { clearInterval(t); done(); }
  }, 60);
}

$("draw").onclick = () => {
  game.i++;
  const q = game.cur = game.order[game.i];
  game.drawn[q.coordinate] = true;
  game.spinning = true;

  $("coord").textContent = "";
  $("qtext").textContent = "";
  $("ansbox").classList.add("hidden");
  $("reveal").disabled = true;
  $("next").disabled = true;
  $("atext").textContent = q.answer || "(no answer provided)";
  $("aref").textContent = q.reference;
  $("idle").classList.add("hidden");
  $("active").classList.remove("hidden");
  renderBoard();

  spin($("coord"), () => {
    game.spinning = false;
    $("coord").textContent = q.coordinate;
    $("qtext").textContent = q.question;
    $("reveal").disabled = false;
    $("next").disabled = false;
    $("next").textContent = game.i >= game.order.length - 1 ? "Finish game" : "Next question";
    renderBoard();
  });
};

$("reveal").onclick = () => {
  $("ansbox").classList.remove("hidden");
  $("reveal").disabled = true;
};

$("next").onclick = () => {
  game.cur = null;
  if (game.i >= game.order.length - 1) return finish();
  $("active").classList.add("hidden");
  $("idle").classList.remove("hidden");
  renderBoard();
};

function finish() {
  $("game").classList.add("hidden");
  $("end").classList.remove("hidden");
  $("final").textContent = "All " + game.order.length + " questions drawn";
  $("list").innerHTML = game.order.map(q =>
    '<div class="res"><span>' + q.coordinate + " &nbsp;" + esc(q.question) + "</span><b>" + esc(q.answer) + "</b></div>"
  ).join("");
  $("sub").textContent = "Game over.";
}

$("start").onclick = startGame;
$("again").onclick = startGame;
$("reload").onclick = () => {
  $("end").classList.add("hidden");
  $("setup").classList.remove("hidden");
  $("sub").textContent = SETUP_SUBTITLE;
};

accept(SAMPLE.slice(), "the sample set");
