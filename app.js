/* Daily Ideas — GitHub Pages version */
const BOOKS = window.BOOKS;
const OWNER = "jasonjjeffrey-glitch", PREPO = "News_brief_log", PFILE = "progress.json";
const KEY = "dailyIdeas.v1", TOKKEY = "dailyIdeas.ghToken";
const $ = s => document.querySelector(s);
let S = { books: {}, days: [], updated: 0 };

/* ---------- storage ---------- */
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
function loadLocal() { try { const r = ls(KEY); if (r) S = Object.assign(S, JSON.parse(r)); } catch (e) {} }
function save() { S.updated = Date.now(); ls(KEY, JSON.stringify(S)); scheduleSync(); }

/* ---------- dates & streak ---------- */
const dstr = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const todayStr = () => dstr(new Date());
function markToday() { const t = todayStr(); if (!S.days.includes(t)) S.days.push(t); }
function streak() { const set = new Set(S.days); let n = 0; const d = new Date(); if (!set.has(dstr(d))) d.setDate(d.getDate() - 1); while (set.has(dstr(d))) { n++; d.setDate(d.getDate() - 1); } return n; }
function todaysBook() { const next = BOOKS.find(b => !(S.books[b.id] && S.books[b.id].done)); if (next) return next; return BOOKS[Math.floor(Date.now() / 86400000) % BOOKS.length]; }

/* ---------- GitHub progress sync ---------- */
let syncTimer = null, syncing = false;
const token = () => ls(TOKKEY) || "";
function setStatus(t) { const el = $("#syncStatus"); if (el) el.textContent = t; }
function merge(remote) {
  if (!remote || !remote.books) return;
  S.days = [...new Set([...(remote.days || []), ...S.days])].sort();
  for (const k in remote.books) {
    const r = remote.books[k], l = S.books[k] || {};
    S.books[k] = { read: !!(r.read || l.read), done: !!(r.done || l.done), quizScore: Math.max(r.quizScore || 0, l.quizScore || 0) };
  }
}
const b64e = s => btoa(unescape(encodeURIComponent(s)));
const b64d = s => decodeURIComponent(escape(atob(s.replace(/\n/g, ""))));
async function gh(method, body) {
  const url = `https://api.github.com/repos/${OWNER}/${PREPO}/contents/${PFILE}`;
  const r = await fetch(url + (method === "GET" ? "?t=" + Date.now() : ""), {
    method, cache: "no-store",
    headers: { "Authorization": "Bearer " + token(), "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: body ? JSON.stringify(body) : undefined
  });
  return r;
}
async function sync() {
  if (!token() || syncing || !navigator.onLine) { renderSync(); return; }
  syncing = true; setStatus("Syncing…");
  try {
    let sha;
    const g = await gh("GET");
    if (g.status === 200) { const j = await g.json(); sha = j.sha; merge(JSON.parse(b64d(j.content))); }
    else if (g.status === 401 || g.status === 403) { throw new Error("The key was refused. Check it has access to News_brief_log with Contents: Read and write."); }
    else if (g.status !== 404) { throw new Error("GitHub answered " + g.status); }
    ls(KEY, JSON.stringify(S));
    const body = { message: "Progress update " + new Date().toISOString(), content: b64e(JSON.stringify({ books: S.books, days: S.days, updated: Date.now() }, null, 1)) };
    if (sha) body.sha = sha;
    const p = await gh("PUT", body);
    if (p.status === 409) { syncing = false; return sync(); }
    if (!p.ok) throw new Error("Couldn't save to GitHub (" + p.status + ")");
    setStatus("Synced " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    render();
  } catch (e) { setStatus("Sync failed: " + e.message); }
  syncing = false;
}
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 1500); }
function renderSync() {
  const has = !!token();
  $("#syncInfo").textContent = has
    ? "Sync is on. Progress saves to your private News_brief_log repo, so your other devices (and Claude) see it."
    : "Sync is off, so progress is saved on this phone only. Paste your GitHub key to sync across devices.";
  $("#tok").style.display = has ? "none" : "block";
  $("#saveTok").textContent = has ? "Sync now" : "Save and sync";
  $("#clearTok").style.display = has ? "inline-flex" : "none";
  if (!has) setStatus("");
}
$("#saveTok").onclick = () => { const v = $("#tok").value.trim(); if (v) { ls(TOKKEY, v); $("#tok").value = ""; } renderSync(); sync(); };
$("#clearTok").onclick = () => { ls(TOKKEY, null); renderSync(); toast("Key removed from this phone"); };

/* ---------- read aloud ---------- */
const synth = window.speechSynthesis;
let voice = null, autoRead = false;
function pickVoice() {
  if (!synth) return;
  const v = synth.getVoices();
  voice = v.find(x => x.lang === "en-GB" && /natural|premium|enhanced|serena|daniel|kate|google uk/i.test(x.name)) || v.find(x => x.lang === "en-GB") || v.find(x => /^en/.test(x.lang)) || null;
}
if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }
function speak(text, onend) {
  if (!synth) { toast("Read-aloud isn't supported on this browser"); return; }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice; u.lang = voice ? voice.lang : "en-GB"; u.rate = 0.98;
  u.onend = () => { updateSpeakBtn(false); if (onend) onend(); };
  u.onerror = () => updateSpeakBtn(false);
  synth.speak(u); updateSpeakBtn(true);
}
function stopSpeak() { autoRead = false; if (synth) synth.cancel(); updateSpeakBtn(false); }
function updateSpeakBtn(on) { const b = $("#speakBtn"); if (b) { b.classList.toggle("on", on || autoRead); b.textContent = (on || autoRead) ? "■ Stop" : "🔊 Listen"; } }
function cardText(c) { return c[0] + ". " + c[1] + " Try this: " + c[2]; }

/* ---------- render ---------- */
function status(b) { const s = S.books[b.id]; if (!s) return ["Not started", ""]; if (s.done) return ["Done " + s.quizScore + "/3", "done"]; if (s.read) return ["Quiz to do", "part"]; return ["Not started", ""]; }
function render() {
  const st = streak(); $("#streakPill").textContent = "🔥 " + st + (st === 1 ? " day" : " days");
  const h = new Date().getHours(); $("#hello").textContent = (h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening") + ", Jason";
  const b = todaysBook(), s = S.books[b.id] || {}, doneToday = S.days.includes(todayStr());
  $("#todayPanel").innerHTML = `<div class="label">${doneToday ? "Today done ✓ · Bonus read" : "Today's read"} · ${b.topic}</div>
   <div style="display:flex;gap:14px;align-items:center;margin:6px 0 14px">
     <div class="cover" style="background:${b.color};width:64px;height:88px;font-size:11px">${b.title}</div>
     <div><h2 style="font-size:22px">${b.title}</h2><div class="muted small">${b.author} · ${b.year}</div><div class="muted small" style="margin-top:4px">5 cards · 3 questions · ~5 min</div></div>
   </div>
   <div class="row">${s.read && !s.done ? `<button class="btn" onclick="openQuiz('${b.id}')">Take the quiz</button>` : `<button class="btn" onclick="openBook('${b.id}')">${s.done ? "Read again" : "Start reading"}</button><button class="btn ghost" onclick="openBook('${b.id}',true)">🔊 Listen</button>`}</div>`;
  const done = BOOKS.filter(x => S.books[x.id] && S.books[x.id].done);
  $("#tDone").textContent = done.length; $("#tLeft").textContent = BOOKS.length - done.length;
  const tot = done.reduce((a, x) => a + S.books[x.id].quizScore, 0);
  $("#tQuiz").textContent = done.length ? Math.round(tot / (done.length * 3) * 100) + "%" : "–";
  const w = $("#week"); w.innerHTML = ""; const set = new Set(S.days);
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i);
    w.insertAdjacentHTML("beforeend", `<div class="day"><div class="dot ${set.has(dstr(d)) ? "on" : ""}">${set.has(dstr(d)) ? "✓" : ""}</div>${"SMTWTFS"[d.getDay()]}</div>`); }
  renderLibrary();
}
let filter = "All";
function renderLibrary() {
  const topics = ["All", ...new Set(BOOKS.map(b => b.topic))];
  $("#chips").innerHTML = topics.map(t => `<button class="chip ${t === filter ? "on" : ""}" onclick="filter='${t}';renderLibrary()">${t}</button>`).join("");
  $("#bookList").innerHTML = BOOKS.filter(b => filter === "All" || b.topic === filter).map(b => { const [t, c] = status(b);
    return `<div class="book" onclick="openBook('${b.id}')"><div class="cover" style="background:${b.color}">${b.title}</div>
      <div style="flex:1;min-width:0"><div class="t">${b.title}</div><div class="small muted">${b.author} · ${b.topic}</div></div><span class="pill ${c}">${t}</span></div>`; }).join("");
}

/* ---------- reader ---------- */
let cur = null, idx = 0;
function bars(n, i) { $("#bars").innerHTML = Array.from({ length: n }, (_, k) => `<i class="${k <= i ? "on" : ""}"></i>`).join(""); }
function openReader() { $("#reader").classList.add("open"); document.body.style.overflow = "hidden"; }
function closeReader() { stopSpeak(); $("#reader").classList.remove("open"); document.body.style.overflow = ""; render(); }
$("#closeR").onclick = closeReader;
function openBook(id, listen) { cur = BOOKS.find(b => b.id === id); idx = 0; openReader(); showCard(); if (listen) { autoRead = true; readCurrent(); } }
function readCurrent() { speak((idx === 0 ? cur.title + ", by " + cur.author + ". " : "") + cardText(cur.cards[idx]), () => {
  if (!autoRead) return;
  if (idx < cur.cards.length - 1) { idx++; showCard(); readCurrent(); } else { autoRead = false; finishRead(); } }); }
function showCard() {
  const c = cur.cards[idx]; bars(cur.cards.length, idx);
  $("#stage").innerHTML = `<div class="idea" id="idea"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="label" style="margin:0">${cur.title} · ${idx + 1} of ${cur.cards.length}</div><button class="speak" id="speakBtn">🔊 Listen</button></div><h2>${c[0]}</h2><p>${c[1]}</p><div class="try"><b>Try this:</b> ${c[2]}</div></div>`;
  updateSpeakBtn(synth && synth.speaking);
  $("#speakBtn").onclick = e => { e.stopPropagation(); if ((synth && synth.speaking) || autoRead) stopSpeak(); else { autoRead = true; readCurrent(); } };
  const last = idx === cur.cards.length - 1;
  $("#rfoot").innerHTML = `<div class="row"><button class="btn ghost" ${idx === 0 ? "disabled" : ""} id="prevB">Back</button><button class="btn" id="nextB">${last ? "Go to quiz" : "Next"}</button></div>`;
  const next = () => { stopSpeak(); if (!last) { idx++; showCard(); } else finishRead(); };
  const prev = () => { stopSpeak(); if (idx > 0) { idx--; showCard(); } };
  $("#nextB").onclick = next; $("#prevB").onclick = prev;
  swipe($("#idea"), next, prev);
}
function finishRead() { S.books[cur.id] = Object.assign(S.books[cur.id] || {}, { read: true }); save(); openQuiz(cur.id); }
function swipe(el, next, prev) { let x0 = null; el.addEventListener("touchstart", e => x0 = e.touches[0].clientX, { passive: true });
  el.addEventListener("touchend", e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (dx < -50) next(); else if (dx > 50) prev(); x0 = null; }); }

/* ---------- quiz ---------- */
let qi = 0, score = 0;
function openQuiz(id) { cur = BOOKS.find(b => b.id === id); qi = 0; score = 0; openReader(); showQ(); }
function showQ() {
  const q = cur.quiz[qi]; bars(cur.quiz.length, qi);
  $("#stage").innerHTML = `<div class="idea"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="label" style="margin:0">Quiz · ${qi + 1} of ${cur.quiz.length}</div><button class="speak" id="speakBtn">🔊 Listen</button></div><h2 style="font-size:21px">${q.q}</h2>
   ${q.o.map((o, k) => `<button class="opt" data-k="${k}">${o}</button>`).join("")}<div class="explain" id="exp"></div></div>`;
  $("#speakBtn").onclick = () => { if (synth && synth.speaking) stopSpeak(); else speak(q.q + " " + q.o.map((o, k) => "Option " + (k + 1) + ": " + o + ".").join(" ")); };
  $("#rfoot").innerHTML = "";
  document.querySelectorAll(".opt").forEach(b => b.onclick = () => {
    stopSpeak();
    const k = +b.dataset.k; document.querySelectorAll(".opt").forEach(x => { x.disabled = true; if (+x.dataset.k === q.a) x.classList.add("right"); });
    if (k === q.a) score++; else b.classList.add("wrong");
    $("#exp").innerHTML = `<b>${k === q.a ? "Right." : "Not quite."}</b> ${q.e}`;
    const last = qi === cur.quiz.length - 1;
    $("#rfoot").innerHTML = `<button class="btn" id="qNext">${last ? "See result" : "Next question"}</button>`;
    $("#qNext").onclick = () => { if (last) finishQuiz(); else { qi++; showQ(); } };
  });
}
function finishQuiz() {
  const prev = S.books[cur.id] || {};
  S.books[cur.id] = Object.assign(prev, { read: true, done: true, quizScore: Math.max(score, prev.quizScore || 0) });
  markToday(); save(); bars(1, 0);
  const st = streak();
  $("#stage").innerHTML = `<div class="idea" style="text-align:center;justify-content:center"><div style="font-size:54px">${score === 3 ? "🏆" : "✅"}</div>
    <h2>${score} out of 3</h2><p class="muted">${cur.title} is done. Your streak is ${st} ${st === 1 ? "day" : "days"}.</p></div>`;
  $("#rfoot").innerHTML = `<div class="row"><button class="btn ghost" id="retry">Retry quiz</button><button class="btn" id="fin">Finish</button></div>`;
  $("#retry").onclick = () => openQuiz(cur.id); $("#fin").onclick = closeReader;
}

/* ---------- flashcards ---------- */
let deck = [], fi = 0;
$("#startReview").onclick = () => {
  deck = []; BOOKS.forEach(b => { if (S.books[b.id] && S.books[b.id].done) b.quiz.forEach(q => deck.push({ b, q })); });
  if (!deck.length) { toast("Finish a book first, then its questions appear here"); return; }
  deck.sort(() => Math.random() - .5); fi = 0; openReader(); showF();
};
function showF() {
  const { b, q } = deck[fi]; bars(deck.length, fi);
  $("#stage").innerHTML = `<div class="flip" id="flip"><div class="in"><div class="face"><div class="label">${b.title}</div><h3>${q.q}</h3><p class="muted small" style="margin-top:auto">Tap to flip</p></div>
    <div class="face back"><div class="label" style="color:var(--good)">Answer</div><h3>${q.o[q.a]}</h3><p>${q.e}</p></div></div></div>`;
  $("#flip").onclick = () => $("#flip").classList.toggle("on");
  const last = fi === deck.length - 1;
  $("#rfoot").innerHTML = `<div class="row"><button class="btn ghost" ${fi === 0 ? "disabled" : ""} id="fp">Back</button><button class="btn" id="fn">${last ? "Done" : "Next"}</button></div>`;
  $("#fp").onclick = () => { fi--; showF(); }; $("#fn").onclick = () => { if (last) closeReader(); else { fi++; showF(); } };
}

/* ---------- news ---------- */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = u => /^https:\/\//.test(u || "") ? u : "#";
function renderNews(n) {
  const el = $("#digest");
  if (!n || !Array.isArray(n.items) || !n.items.length) { el.innerHTML = `<div class="label">Today's top news</div><p class="small muted" style="margin:0">No digest yet. It's added each morning.</p>`; return; }
  const groups = {}; n.items.forEach(i => { (groups[i.section] = groups[i.section] || []).push(i); });
  const stale = n.date && n.date !== todayStr();
  el.innerHTML = `<div class="label">Top news · ${esc(n.dateLabel || n.date || "")}</div>
   ${stale ? `<p class="small" style="color:var(--accent);margin:0 0 8px">This is the latest digest; today's hasn't arrived yet.</p>` : ""}
   ${Object.keys(groups).map(g => `<h3 style="font-size:17px;margin:14px 0 4px">${esc(g)}</h3>` + groups[g].map(i => `
     <a class="news" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener"><span style="padding-right:10px"><b>${esc(i.headline)}</b><br><span class="small muted" style="line-height:1.5">${esc(i.summary)}</span><br><span class="small muted">${esc(i.source)}</span></span><span>↗</span></a>`).join("")).join("")}
   <div class="row" style="margin-top:12px"><button class="btn ghost" id="listenNews">🔊 Listen to the news</button></div>
   <p class="small muted" style="margin:12px 0 0">Summaries written by Claude from public reports; tap through to check the original.</p>`;
  $("#listenNews").onclick = () => { if (synth && synth.speaking) { stopSpeak(); $("#listenNews").textContent = "🔊 Listen to the news"; return; }
    $("#listenNews").textContent = "■ Stop";
    speak("Top news for " + (n.dateLabel || "today") + ". " + Object.keys(groups).map(g => g + ". " + groups[g].map(i => i.headline + ". " + i.summary).join(" ")).join(" "),
      () => { const b = $("#listenNews"); if (b) b.textContent = "🔊 Listen to the news"; }); };
}
async function loadNews() {
  try { const r = await fetch("news.json?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw 0; const n = await r.json(); ls("dailyIdeas.news", JSON.stringify(n)); renderNews(n); }
  catch (e) { try { const c = ls("dailyIdeas.news"); renderNews(c ? JSON.parse(c) : null); } catch (x) { renderNews(null); } }
}

/* ---------- nav, offline, misc ---------- */
document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav.tabs button").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + b.dataset.v)); window.scrollTo(0, 0);
  if (b.dataset.v === "news") loadNews();
});
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 2600); }
function net() { $("#offline").classList.toggle("on", !navigator.onLine); if (navigator.onLine) sync(); }
addEventListener("online", net); addEventListener("offline", net);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { sync(); loadNews(); } });
/* keep the screen on while listening */
let wake = null;
async function keepAwake(on) { try { if (on && "wakeLock" in navigator && !wake) wake = await navigator.wakeLock.request("screen"); if (!on && wake) { await wake.release(); wake = null; } } catch (e) {} }
setInterval(() => keepAwake(!!(synth && synth.speaking)), 2000);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
loadLocal(); render(); renderSync(); net(); loadNews();
