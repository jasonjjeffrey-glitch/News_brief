/* Daily Ideas v2 — shared app for the GitHub and Claude versions.
   window.APP_MODE = "github" | "claude" (set in the HTML). */
(function(){
const MODE = window.APP_MODE || "github";
const BOOKS = window.BOOKS;
const OWNER = "jasonjjeffrey-glitch", PREPO = "News_brief_log", PFILE = "progress.json";
const KEY = "dailyIdeas.v2", OLDKEY = "dailyIdeas.v1", TOKKEY = "dailyIdeas.ghToken";
const INTERVALS = [1, 3, 7, 21, 60];          // days until next review for boxes 1..5
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- state ---------------- */
let S = blank();
function blank(){ return { v: 2, books: {}, days: [], srs: {}, notes: {}, explains: {}, updated: 0 }; }
function ls(k, v){ try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch(e){ return null; } }

/* upgrade any older progress (v1: books[id] = {read, done, quizScore}) */
function upgrade(p){
  if (!p) return blank();
  const out = Object.assign(blank(), p);
  out.books = {};
  for (const k in (p.books || {})){
    const b = p.books[k] || {};
    if (b.sess === undefined){                    // v1 record: keep the score, reopen as a deep dive
      out.books[k] = { sess: 0, done: false, legacyDone: !!b.done, quizScore: b.quizScore || 0, scores: [0,0,0] };
    } else out.books[k] = Object.assign({ sess: 0, done: false, legacyDone: false, quizScore: 0, scores: [0,0,0] }, b);
  }
  out.days = [...new Set(p.days || [])].sort();
  out.srs = p.srs || {}; out.notes = p.notes || {}; out.explains = p.explains || {};
  out.v = 2; delete out.quiz;
  return out;
}
/* merge two progress records without losing anything */
function newer(a, b){ if (!a) return b; if (!b) return a; return (b.at || 0) > (a.at || 0) ? b : a; }
function merge(a, b){
  a = upgrade(a); b = upgrade(b);
  const m = blank();
  m.days = [...new Set([...a.days, ...b.days])].sort();
  const ids = new Set([...Object.keys(a.books), ...Object.keys(b.books)]);
  ids.forEach(k => {
    const x = a.books[k] || {}, y = b.books[k] || {};
    const sx = x.scores || [0,0,0], sy = y.scores || [0,0,0];
    m.books[k] = { sess: Math.max(x.sess || 0, y.sess || 0), done: !!(x.done || y.done), legacyDone: !!(x.legacyDone || y.legacyDone),
      quizScore: Math.max(x.quizScore || 0, y.quizScore || 0), scores: [0,1,2].map(i => Math.max(sx[i] || 0, sy[i] || 0)) };
  });
  ["srs", "notes", "explains"].forEach(f => {
    const keys = new Set([...Object.keys(a[f]), ...Object.keys(b[f])]);
    keys.forEach(k => { m[f][k] = newer(a[f][k], b[f][k]); });
  });
  m.updated = Math.max(a.updated || 0, b.updated || 0);
  return m;
}
function loadLocal(){
  try {
    const r = ls(KEY); if (r) { S = upgrade(JSON.parse(r)); return; }
    const o = ls(OLDKEY); if (o) S = upgrade(JSON.parse(o));
  } catch(e){}
}
function save(){ S.updated = Date.now(); ls(KEY, JSON.stringify(S)); remote.push(); }

/* ---------------- dates ---------------- */
const dstr = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const today = () => dstr(new Date());
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return dstr(d); };
function markToday(){ const t = today(); if (!S.days.includes(t)) { S.days.push(t); S.days.sort(); } }
function streak(){ const set = new Set(S.days); let n = 0; const d = new Date(); if (!set.has(dstr(d))) d.setDate(d.getDate() - 1); while (set.has(dstr(d))) { n++; d.setDate(d.getDate() - 1); } return n; }

/* ---------------- books ---------------- */
const book = id => BOOKS.find(b => b.id === id);
const prog = id => S.books[id] || (S.books[id] = { sess: 0, done: false, legacyDone: false, quizScore: 0, scores: [0,0,0] });
const peek = id => S.books[id] || { sess: 0, done: false, legacyDone: false, quizScore: 0, scores: [0,0,0] };
function currentBook(){
  const inProg = BOOKS.find(b => { const p = peek(b.id); return p.sess > 0 && !p.done; });
  if (inProg) return inProg;
  return BOOKS.find(b => !peek(b.id).done) || null;
}
function status(b){
  const p = peek(b.id);
  if (p.done) return ["Done", "done"];
  if (p.sess > 0) return ["Day " + (p.sess + 1) + " of 3", "part"];
  if (p.legacyDone) return ["Deep dive ready", "part"];
  return ["Not started", ""];
}
const qid = (b, s, i) => b.id + "." + s + "." + i;

/* ---------------- spaced review ---------------- */
function grade(id, right){
  const c = S.srs[id] || { box: 0 };
  const box = right ? Math.min((c.box || 0) + 1, 5) : 0;
  S.srs[id] = { box, due: right ? addDays(INTERVALS[box - 1]) : addDays(1), at: Date.now() };
}
function dueList(){
  const t = today(), out = [];
  for (const id in S.srs){ if (S.srs[id] && S.srs[id].due <= t){ const [bid, s, i] = id.split("."); const b = book(bid); if (b && b.s[+s] && b.s[+s].q[+i]) out.push({ id, b, s: +s, q: b.s[+s].q[+i] }); } }
  return out;
}

/* ---------------- read aloud ---------------- */
const synth = window.speechSynthesis;
let voice = null, autoRead = false;
function pickVoice(){ if (!synth) return; const v = synth.getVoices();
  voice = v.find(x => x.lang === "en-GB" && /natural|premium|enhanced|serena|daniel|kate|google uk/i.test(x.name)) || v.find(x => x.lang === "en-GB") || v.find(x => /^en/.test(x.lang)) || null; }
if (synth){ pickVoice(); synth.onvoiceschanged = pickVoice; }
function speak(text, onend){
  if (!synth){ toast("Read-aloud isn't available here"); return; }
  synth.cancel(); const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice; u.lang = voice ? voice.lang : "en-GB"; u.rate = 0.98;
  u.onend = () => { setSpeak(false); if (onend) onend(); }; u.onerror = () => setSpeak(false);
  synth.speak(u); setSpeak(true);
}
function stopSpeak(){ autoRead = false; if (synth) synth.cancel(); setSpeak(false); }
function setSpeak(on){ const b = $("#speakBtn"); if (b){ b.classList.toggle("on", on || autoRead); b.textContent = (on || autoRead) ? "■ Stop" : "🔊 Listen"; } }

/* ---------------- render: main tabs ---------------- */
function render(){
  const st = streak(); $("#streakPill").textContent = "🔥 " + st + (st === 1 ? " day" : " days");
  const h = new Date().getHours(); $("#hello").textContent = (h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening") + ", Jason";
  renderToday(); renderLibrary(); renderReviewTab();
}
function renderToday(){
  const due = dueList().length, b = currentBook(), doneToday = S.days.includes(today());
  let html = "";
  if (due) html += `<div class="panel"><div class="label">Spaced review</div><p style="margin:0 0 12px">${due} question${due === 1 ? "" : "s"} due today. Reviewing them helps fix the ideas in your memory.</p><button class="btn" data-act="review">Review now (~${Math.max(1, Math.round(due * 0.4))} min)</button></div>`;
  if (b){
    const p = peek(b.id), s = b.s[p.sess];
    html += `<div class="panel"><div class="label">${doneToday ? "Today done ✓ · Bonus session" : "Today's session"} · ${b.topic}</div>
     <div style="display:flex;gap:14px;align-items:center;margin:6px 0 10px">
       <div class="cover" style="background:${b.color};width:64px;height:88px;font-size:11px">${esc(b.title)}</div>
       <div><h2 style="font-size:22px">${esc(b.title)}</h2><div class="muted small">${esc(b.author)} · ${b.year}</div>
       <div class="small" style="margin-top:6px"><b>Day ${p.sess + 1} of 3:</b> ${esc(s.t)}</div>
       <div class="muted small">${s.c.length} cards · 3 questions · explain it back · ~7 min</div></div>
     </div>
     <div class="bar"><i style="width:${Math.round(p.sess / 3 * 100)}%"></i></div>
     <div class="row" style="margin-top:14px"><button class="btn" data-act="start" data-id="${b.id}">${p.sess ? "Continue" : "Start"}</button><button class="btn ghost" data-act="listen" data-id="${b.id}">🔊 Listen</button></div></div>`;
  } else html += `<div class="panel"><div class="label">All books done</div><p style="margin:0">You've finished every deep dive. Keep up your spaced review, and ask Claude for more books.</p></div>`;
  const done = BOOKS.filter(x => peek(x.id).done).length;
  const quick = BOOKS.filter(x => peek(x.id).legacyDone && !peek(x.id).done).length;
  html += `<div class="panel"><div class="label">Your tally</div>
    <div class="tally"><div><b>${done}</b><span class="small muted">deep dives done</span></div><div><b>${BOOKS.length - done}</b><span class="small muted">to go</span></div><div><b>${due}</b><span class="small muted">reviews due</span></div></div>
    ${quick ? `<p class="small muted" style="margin:10px 0 0">${quick} book${quick === 1 ? "" : "s"} finished in the quick version, now ready as deep dives.</p>` : ""}
    <div class="week" id="week"></div></div>
    <div class="panel"><div class="label">How it works</div><p class="small muted" style="margin:0;line-height:1.6">Each book is 3 short daily sessions: cards, 3 recall questions, then explain the main idea in your own words. Questions come back for spaced review after 1, 3, 7 and 21 days (sooner if you missed them). Each finished book gets a summary sheet in the Library.</p></div>`;
  $("#v-today").innerHTML = html;
  const w = $("#week"), set = new Set(S.days);
  for (let i = 6; i >= 0; i--){ const d = new Date(); d.setDate(d.getDate() - i);
    w.insertAdjacentHTML("beforeend", `<div class="day"><div class="dot ${set.has(dstr(d)) ? "on" : ""}">${set.has(dstr(d)) ? "✓" : ""}</div>${"SMTWTFS"[d.getDay()]}</div>`); }
}
let filter = "All";
function renderLibrary(){
  const topics = ["All", ...new Set(BOOKS.map(b => b.topic))];
  $("#v-library").innerHTML = `<div class="chips">${topics.map(t => `<button class="chip ${t === filter ? "on" : ""}" data-act="filter" data-t="${t}">${t}</button>`).join("")}</div>
   <div class="panel" style="padding:6px 18px">${BOOKS.filter(b => filter === "All" || b.topic === filter).map(b => { const [t, c] = status(b);
     return `<div class="book" data-act="book" data-id="${b.id}"><div class="cover" style="background:${b.color}">${esc(b.title)}</div><div style="flex:1;min-width:0"><div class="t">${esc(b.title)}</div><div class="small muted">${esc(b.author)} · ${b.topic}</div></div><span class="pill ${c}">${t}</span></div>`; }).join("")}</div>`;
}
function renderReviewTab(){
  const due = dueList().length, total = Object.keys(S.srs).length;
  const mastered = Object.values(S.srs).filter(c => c && c.box >= 4).length;
  $("#reviewPanel").innerHTML = `<div class="label">Spaced review</div>
    <div class="tally"><div><b>${due}</b><span class="small muted">due now</span></div><div><b>${total}</b><span class="small muted">in rotation</span></div><div><b>${mastered}</b><span class="small muted">well learned</span></div></div>
    <p class="small muted" style="margin:12px 0">Questions from your sessions come back after 1, 3, 7 and 21 days. Miss one and it comes back tomorrow.</p>
    <button class="btn" data-act="review" ${due ? "" : "disabled"}>${due ? "Start review" : "Nothing due today"}</button>`;
}

/* ---------------- book page & summary sheet ---------------- */
function openPage(html){ stopSpeak(); $("#reader").classList.add("open"); document.body.style.overflow = "hidden"; $("#bars").innerHTML = ""; $("#stage").innerHTML = `<div class="idea" style="min-height:auto">${html}</div>`; $("#rfoot").innerHTML = ""; }
function bookPage(id){
  const b = book(id), p = peek(id);
  openPage(`<div class="label">${b.topic} · ${esc(b.author)}</div><h2>${esc(b.title)}</h2><p class="muted" style="font-size:15px">${esc(b.big)}</p>
   ${p.legacyDone && !p.done ? `<p class="small" style="color:var(--accent)">You finished the quick version (quiz ${p.quizScore}/3). The deep dive has 3 sessions.</p>` : ""}
   <div>${b.s.map((s, i) => `<div class="sess"><div class="num ${i < p.sess || p.done ? "done" : ""}">${i < p.sess || p.done ? "✓" : i + 1}</div><div style="flex:1"><b>Day ${i + 1}:</b> ${esc(s.t)}<div class="small muted">${s.c.length} cards${p.scores && p.scores[i] ? " · quiz " + p.scores[i] + "/3" : ""}</div></div>
     ${i <= p.sess || p.done ? `<button class="btn sm ${i === p.sess && !p.done ? "" : "ghost"}" data-act="sess" data-id="${id}" data-s="${i}">${i === p.sess && !p.done ? "Start" : "Redo"}</button>` : ""}</div>`).join("")}</div>
   <button class="btn ghost" style="margin-top:14px" data-act="sheet" data-id="${id}">📄 Summary sheet</button>`);
  $("#rfoot").innerHTML = `<button class="btn ghost" data-act="close">Close</button>`;
}
function sheet(id){
  const b = book(id), p = peek(id);
  const ex = b.s.map((s, i) => S.explains[id + "." + i]).filter(Boolean);
  const note = (S.notes[id] && S.notes[id].text) || "";
  openPage(`<div class="sheet"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="label" style="margin:0">Summary sheet</div><button class="speak" id="speakBtn">🔊 Listen</button></div>
   <h2 style="margin-top:6px">${esc(b.title)}</h2><div class="muted small">${esc(b.author)} · ${b.year}</div>
   <h3>The big idea</h3><p style="margin:0;line-height:1.55">${esc(b.big)}</p>
   <h3>The model</h3><div class="model" style="margin-top:0">${esc(b.model)}</div>
   <h3>Key ideas</h3><ul>${b.points.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
   ${ex.length ? `<h3>In your words</h3><ul>${b.s.map((s, i) => { const e = S.explains[id + "." + i]; return e && e.text ? `<li><b>Day ${i + 1}:</b> ${esc(e.text)}</li>` : ""; }).join("")}</ul>` : ""}
   <h3>Your notes</h3><textarea id="noteBox" placeholder="Add your own notes, examples or actions…">${esc(note)}</textarea>
   ${p.done ? "" : `<p class="small muted">Finish all 3 days to complete this book.</p>`}</div>`);
  $("#speakBtn").onclick = () => { if (synth && synth.speaking) stopSpeak(); else speak(b.title + ". The big idea: " + b.big + " The model: " + b.model + " Key ideas: " + b.points.join(" ")); };
  $("#rfoot").innerHTML = `<div class="row"><button class="btn ghost" data-act="book" data-id="${id}">Back</button><button class="btn" id="saveNote">Save notes</button></div>`;
  $("#saveNote").onclick = () => { S.notes[id] = { text: $("#noteBox").value.trim(), at: Date.now() }; save(); toast("Notes saved"); };
}

/* ---------------- session flow: cards → recall → explain → done ---------------- */
let cur = null, si = 0, idx = 0, qi = 0, score = 0;
function bars(n, i){ $("#bars").innerHTML = Array.from({ length: n }, (_, k) => `<i class="${k <= i ? "on" : ""}"></i>`).join(""); }
function openReader(){ $("#reader").classList.add("open"); document.body.style.overflow = "hidden"; }
function closeReader(){ stopSpeak(); $("#reader").classList.remove("open"); document.body.style.overflow = ""; render(); }
function startSession(id, s, listen){
  cur = book(id); si = s; idx = 0; openReader(); showCard();
  if (listen){ autoRead = true; readCurrent(); }
}
const cardText = c => c[0] + ". " + c[1] + " Try this: " + c[2];
function readCurrent(){
  const s = cur.s[si];
  speak((idx === 0 ? cur.title + ", day " + (si + 1) + ": " + s.t + ". " : "") + cardText(s.c[idx]), () => {
    if (!autoRead) return;
    if (idx < s.c.length - 1){ idx++; showCard(); readCurrent(); } else { autoRead = false; startRecall(); }
  });
}
function showCard(){
  const s = cur.s[si], c = s.c[idx], total = s.c.length + 2; bars(total, idx);
  $("#stage").innerHTML = `<div class="idea" id="idea"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="label" style="margin:0">${esc(cur.title)} · Day ${si + 1} · ${idx + 1}/${s.c.length}</div><button class="speak" id="speakBtn">🔊 Listen</button></div>
    <h2>${esc(c[0])}</h2><p>${esc(c[1])}</p><div class="try"><b>Try this:</b> ${esc(c[2])}</div></div>`;
  setSpeak(synth && synth.speaking);
  $("#speakBtn").onclick = e => { e.stopPropagation(); if ((synth && synth.speaking) || autoRead) stopSpeak(); else { autoRead = true; readCurrent(); } };
  const last = idx === s.c.length - 1;
  $("#rfoot").innerHTML = `<div class="row"><button class="btn ghost" ${idx === 0 ? "disabled" : ""} id="prevB">Back</button><button class="btn" id="nextB">${last ? "Recall check" : "Next"}</button></div>`;
  const next = () => { stopSpeak(); if (!last){ idx++; showCard(); } else startRecall(); };
  const prev = () => { stopSpeak(); if (idx > 0){ idx--; showCard(); } };
  $("#nextB").onclick = next; $("#prevB").onclick = prev; swipe($("#idea"), next, prev);
}
function swipe(el, next, prev){ let x0 = null; el.addEventListener("touchstart", e => x0 = e.touches[0].clientX, { passive: true });
  el.addEventListener("touchend", e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (dx < -60) next(); else if (dx > 60) prev(); x0 = null; }); }

function startRecall(){ qi = 0; score = 0; showQ(); }
function showQ(){
  const s = cur.s[si], q = s.q[qi]; bars(s.c.length + 2, s.c.length);
  renderMCQ(`Recall · ${qi + 1} of 3`, q, right => {
    if (right) score++; grade(qid(cur, si, qi), right);
    return qi === 2 ? ["Explain it back", startExplain] : ["Next question", () => { qi++; showQ(); }];
  });
}
function renderMCQ(label, q, after){
  const [text, opts, ans, why] = q;
  $("#stage").innerHTML = `<div class="idea"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="label" style="margin:0">${label}</div><button class="speak" id="speakBtn">🔊 Listen</button></div>
    <h2 style="font-size:21px">${esc(text)}</h2>${opts.map((o, k) => `<button class="opt" data-k="${k}">${esc(o)}</button>`).join("")}<div class="explain" id="exp"></div></div>`;
  $("#speakBtn").onclick = () => { if (synth && synth.speaking) stopSpeak(); else speak(text + " " + opts.map((o, k) => "Option " + (k + 1) + ": " + o + ".").join(" ")); };
  $("#rfoot").innerHTML = "";
  document.querySelectorAll(".opt").forEach(b => b.onclick = () => {
    stopSpeak(); const k = +b.dataset.k, right = k === ans;
    document.querySelectorAll(".opt").forEach(x => { x.disabled = true; if (+x.dataset.k === ans) x.classList.add("right"); });
    if (!right) b.classList.add("wrong");
    $("#exp").innerHTML = `<b>${right ? "Right." : "Not quite."}</b> ${esc(why)}`;
    const [lbl, fn] = after(right);
    $("#rfoot").innerHTML = `<button class="btn" id="qNext">${lbl}</button>`; $("#qNext").onclick = fn;
  });
}
let recog = null;
function startExplain(){
  const s = cur.s[si], [prompt, model] = s.x, prev = S.explains[cur.id + "." + si];
  bars(s.c.length + 2, s.c.length + 1);
  const canMic = !!(window.SpeechRecognition || window.webkitSpeechRecognition) && MODE === "github";
  $("#stage").innerHTML = `<div class="idea"><div class="label">Explain it back</div><h2 style="font-size:21px">${esc(prompt)}</h2>
    <p class="small muted" style="margin:0">Write it in your own words, as if telling a friend. Saying it yourself is what makes it stick.</p>
    <textarea id="exBox" placeholder="Type your answer…">${esc(prev && prev.text || "")}</textarea>
    ${canMic ? `<button class="btn ghost sm" id="micB">🎤 Speak instead</button>` : ""}
    <div id="modelArea"></div></div>`;
  if (canMic) $("#micB").onclick = toggleMic;
  $("#rfoot").innerHTML = `<button class="btn" id="showM">Compare with model answer</button>`;
  $("#showM").onclick = () => {
    stopMic();
    $("#modelArea").innerHTML = `<div class="model"><b>Model answer:</b> ${esc(model)}</div><p class="small" style="margin:12px 0 0"><b>How did you do?</b></p>
      <div class="rate"><button class="btn ghost sm" data-r="2">Got it</button><button class="btn ghost sm" data-r="1">Partly</button><button class="btn ghost sm" data-r="0">Missed it</button></div>`;
    $("#rfoot").innerHTML = "";
    document.querySelectorAll("[data-r]").forEach(b => b.onclick = () => {
      const r = +b.dataset.r;
      S.explains[cur.id + "." + si] = { text: $("#exBox").value.trim(), rating: r, at: Date.now() };
      // a weak explanation brings this session's questions back sooner
      if (r < 2) cur.s[si].q.forEach((q, i) => { const c = S.srs[qid(cur, si, i)]; if (c) { c.due = addDays(1); c.at = Date.now(); } });
      finishSession();
    });
  };
}
function toggleMic(){
  if (recog){ stopMic(); return; }
  const R = window.SpeechRecognition || window.webkitSpeechRecognition; recog = new R();
  recog.lang = "en-GB"; recog.interimResults = false; recog.continuous = true;
  const box = $("#exBox"), base = box.value;
  let said = "";
  recog.onresult = e => { said = ""; for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript + " "; box.value = (base ? base + " " : "") + said.trim(); };
  recog.onend = () => { recog = null; const m = $("#micB"); if (m) m.textContent = "🎤 Speak instead"; };
  try { recog.start(); $("#micB").textContent = "■ Stop listening"; } catch(e){ recog = null; toast("Microphone isn't available"); }
}
function stopMic(){ if (recog){ try { recog.stop(); } catch(e){} recog = null; } }
function finishSession(){
  const p = prog(cur.id);
  p.scores = p.scores || [0,0,0]; p.scores[si] = Math.max(p.scores[si] || 0, score);
  const firstTime = si === p.sess && !p.done;
  if (firstTime){ p.sess = si + 1; if (p.sess >= 3){ p.done = true; } }
  markToday(); save(); bars(1, 0);
  const st = streak(), finished = p.done && firstTime && si === 2;
  $("#stage").innerHTML = `<div class="idea" style="text-align:center;justify-content:center"><div style="font-size:54px">${finished ? "🏆" : "✅"}</div>
    <h2>${finished ? esc(cur.title) + " complete" : "Day " + (si + 1) + " done"}</h2>
    <p class="muted">Recall ${score}/3 · streak ${st} ${st === 1 ? "day" : "days"}.</p>
    <p class="muted small">${finished ? "Your summary sheet is ready in the Library." : si < 2 ? "Day " + (si + 2) + " unlocks next. These questions will come back for review tomorrow." : ""}</p></div>`;
  $("#rfoot").innerHTML = `<div class="row">${finished ? `<button class="btn ghost" data-act="sheet" data-id="${cur.id}">Summary sheet</button>` : ""}<button class="btn" data-act="close">Finish</button></div>`;
}

/* ---------------- spaced review session ---------------- */
let deck = [], di = 0, dScore = 0;
function startReview(){
  deck = dueList().sort(() => Math.random() - .5).slice(0, 20); di = 0; dScore = 0;
  if (!deck.length){ toast("Nothing due today"); return; }
  openReader(); showReview();
}
function showReview(){
  const d = deck[di]; bars(deck.length, di);
  renderMCQ(`Review · ${esc(d.b.title)} · ${di + 1}/${deck.length}`, d.q, right => {
    if (right) dScore++; grade(d.id, right);
    return di === deck.length - 1 ? ["Finish review", endReview] : ["Next", () => { di++; showReview(); }];
  });
}
function endReview(){
  markToday(); save(); bars(1, 0);
  $("#stage").innerHTML = `<div class="idea" style="text-align:center;justify-content:center"><div style="font-size:54px">🧠</div><h2>${dScore} of ${deck.length}</h2><p class="muted">Right answers come back later; missed ones come back tomorrow.</p></div>`;
  $("#rfoot").innerHTML = `<button class="btn" data-act="close">Finish</button>`;
}

/* ---------------- news ---------------- */
const safeUrl = u => /^https:\/\//.test(u || "") ? u : "#";
function renderNews(n){
  const el = $("#digest");
  if (!n || !Array.isArray(n.items) || !n.items.length){ el.innerHTML = `<div class="label">Today's top news</div><p class="small muted" style="margin:0">No digest yet. It's added each morning.</p>`; return; }
  const groups = {}; n.items.forEach(i => { (groups[i.section] = groups[i.section] || []).push(i); });
  const stale = n.date && n.date !== today();
  el.innerHTML = `<div class="label">Top news · ${esc(n.dateLabel || n.date || "")}</div>
   ${stale ? `<p class="small" style="color:var(--accent);margin:0 0 8px">This is the latest digest; today's hasn't arrived yet.</p>` : ""}
   ${Object.keys(groups).map(g => `<h3 style="font-size:17px;margin:14px 0 4px">${esc(g)}</h3>` + groups[g].map(i => `
     <a class="news" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener"><span style="padding-right:10px"><b>${esc(i.headline)}</b><br><span class="small muted" style="line-height:1.5">${esc(i.summary)}</span><br><span class="small muted">${esc(i.source)}</span></span><span>↗</span></a>`).join("")).join("")}
   <div class="row" style="margin-top:12px"><button class="btn ghost" id="listenNews">🔊 Listen to the news</button></div>
   <p class="small muted" style="margin:12px 0 0">Summaries written by Claude from public reports; tap through to check the original.</p>`;
  $("#listenNews").onclick = () => { if (synth && synth.speaking){ stopSpeak(); $("#listenNews").textContent = "🔊 Listen to the news"; return; }
    $("#listenNews").textContent = "■ Stop";
    speak("Top news for " + (n.dateLabel || "today") + ". " + Object.keys(groups).map(g => g + ". " + groups[g].map(i => i.headline + ". " + i.summary).join(" ")).join(" "), () => { const b = $("#listenNews"); if (b) b.textContent = "🔊 Listen to the news"; }); };
}

/* ---------------- storage back-ends ---------------- */
const remote = { push(){}, pull(){} };
let pushTimer = null;
function setStatus(t){ const el = $("#syncStatus"); if (el) el.textContent = t; }
if (MODE === "github"){
  const token = () => ls(TOKKEY) || "";
  const b64e = s => btoa(unescape(encodeURIComponent(s)));
  const b64d = s => decodeURIComponent(escape(atob(s.replace(/\n/g, ""))));
  const gh = (method, body) => fetch(`https://api.github.com/repos/${OWNER}/${PREPO}/contents/${PFILE}` + (method === "GET" ? "?t=" + Date.now() : ""), {
    method, cache: "no-store", headers: { "Authorization": "Bearer " + token(), "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, body: body ? JSON.stringify(body) : undefined });
  let syncing = false;
  async function sync(){
    if (!token() || syncing || !navigator.onLine){ renderSyncUI(); return; }
    syncing = true; setStatus("Syncing…");
    try {
      let sha; const g = await gh("GET");
      if (g.status === 200){ const j = await g.json(); sha = j.sha; S = merge(S, JSON.parse(b64d(j.content))); }
      else if (g.status === 401 || g.status === 403) throw new Error("The key was refused. Check it has access to News_brief_log with Contents: Read and write.");
      else if (g.status !== 404) throw new Error("GitHub answered " + g.status);
      ls(KEY, JSON.stringify(S));
      const body = { message: "Progress update " + new Date().toISOString(), content: b64e(JSON.stringify(Object.assign({}, S, { updated: Date.now() }), null, 1)) };
      if (sha) body.sha = sha;
      const p = await gh("PUT", body);
      if (p.status === 409){ syncing = false; return sync(); }
      if (!p.ok) throw new Error("Couldn't save to GitHub (" + p.status + ")");
      setStatus("Synced " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })); render();
    } catch(e){ setStatus("Sync failed: " + e.message); }
    syncing = false;
  }
  remote.push = () => { clearTimeout(pushTimer); pushTimer = setTimeout(sync, 1500); };
  remote.pull = sync;
  function renderSyncUI(){
    const has = !!token();
    $("#syncPanel").innerHTML = `<div class="label">Sync across devices</div>
      <p class="small muted" style="margin:0 0 4px;line-height:1.5">${has ? "Sync is on. Progress saves to your private News_brief_log repo, so your other devices (and Claude) see it." : "Sync is off, so progress is saved on this phone only. Paste your GitHub key to sync."}</p>
      ${has ? "" : `<input class="tok" id="tok" type="password" autocomplete="off" placeholder="Paste your GitHub key (starts github_pat_)">`}
      <div class="row"><button class="btn" id="saveTok">${has ? "Sync now" : "Save and sync"}</button>${has ? `<button class="btn ghost" id="clearTok">Remove key</button>` : ""}</div>
      <p class="sync" id="syncStatus" style="margin:10px 0 0"></p>`;
    $("#saveTok").onclick = () => { const t = $("#tok"); if (t && t.value.trim()){ ls(TOKKEY, t.value.trim()); } renderSyncUI(); sync(); };
    if (has) $("#clearTok").onclick = () => { ls(TOKKEY, null); renderSyncUI(); toast("Key removed from this phone"); };
  }
  window.__renderSyncUI = renderSyncUI;
  async function loadNews(){
    try { const r = await fetch("news.json?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw 0; const n = await r.json(); ls("dailyIdeas.news", JSON.stringify(n)); renderNews(n); }
    catch(e){ try { const c = ls("dailyIdeas.news"); renderNews(c ? JSON.parse(c) : null); } catch(x){ renderNews(null); } }
  }
  window.__loadNews = loadNews;
} else {
  /* Claude version: progress in the artifact database (doc progress/main), news in news/latest */
  let docRef = null, chain = Promise.resolve();
  remote.push = () => { if (!docRef) return; clearTimeout(pushTimer); pushTimer = setTimeout(() => { const body = JSON.parse(JSON.stringify(S)); chain = chain.then(() => docRef.set(body)).catch(() => {}); }, 800); };
  window.__loadNews = () => {};
  window.__renderSyncUI = () => { $("#syncPanel").innerHTML = `<div class="label">Sync</div><p class="small muted" style="margin:0">Progress saves to your Claude account and is matched with the GitHub version each morning.</p>`; };
  (async () => {
    const off = () => { $("#digest").innerHTML = `<div class="label">Today's top news</div><p class="small muted" style="margin:0">Open this page in the Claude app to see the digest.</p>`; };
    try {
      if (!window.claude || !window.claude.use){ off(); return; }
      const [d, u] = await Promise.all([claude.use("db"), claude.use("user")]);
      if (!d){ off(); return; }
      const t = setTimeout(() => { if ($("#digest").textContent.includes("Loading")) $("#digest").innerHTML = `<div class="label">Today's top news</div><p class="small muted" style="margin:0">Can't reach the digest right now.</p>`; }, 10000);
      d.doc("news/latest").onSnapshot(s => { if (!s.metadata.fromCache) clearTimeout(t); renderNews(s.exists ? s.data() : null); }, () => { clearTimeout(t); renderNews(null); });
      if (!u) return;
      const owner = await (u.isOwner ? u.isOwner() : false); if (!owner) return;
      docRef = d.doc("progress/main");
      const snap = await docRef.get();
      if (snap && snap.exists) S = merge(S, snap.data());
      ls(KEY, JSON.stringify(S)); render(); remote.push();
    } catch(e){}
  })();
}

/* ---------------- events ---------------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]"); if (!t) return;
  const a = t.dataset.act, id = t.dataset.id;
  if (a === "review") startReview();
  else if (a === "start") startSession(id, peek(id).done ? 0 : peek(id).sess);
  else if (a === "listen") startSession(id, peek(id).done ? 0 : peek(id).sess, true);
  else if (a === "filter"){ filter = t.dataset.t; renderLibrary(); }
  else if (a === "book") bookPage(id);
  else if (a === "sess") startSession(id, +t.dataset.s);
  else if (a === "sheet") sheet(id);
  else if (a === "close") closeReader();
});
$("#closeR").onclick = closeReader;
document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav.tabs button").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + b.dataset.v)); window.scrollTo(0, 0);
  if (b.dataset.v === "news") window.__loadNews();
});
function toast(t){ const el = $("#toast"); el.textContent = t; el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 2600); }
function net(){ const o = $("#offline"); if (o) o.classList.toggle("on", !navigator.onLine); if (navigator.onLine) remote.pull(); }
addEventListener("online", net); addEventListener("offline", net);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible"){ remote.pull(); window.__loadNews(); render(); } });
let wake = null;
async function keepAwake(on){ try { if (on && "wakeLock" in navigator && !wake) wake = await navigator.wakeLock.request("screen"); if (!on && wake){ await wake.release(); wake = null; } } catch(e){} }
setInterval(() => keepAwake(!!(synth && synth.speaking)), 2000);
if (MODE === "github" && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

loadLocal(); render(); window.__renderSyncUI(); net(); window.__loadNews();
window.__dailyIdeas = { merge, upgrade, get S(){ return S; } };   // for testing
})();
