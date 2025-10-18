/************ PSLE Quiz – Single-file app.js (no auto-skip, start fix) ************/

let QUIZ_LENGTH = 10;
let currentCount = 0;
let score = 0;
let SERVED_IDS = new Set();

// Optional meta caches for Stats grouping
let skillMeta = JSON.parse(localStorage.getItem('skillMeta') || '{}');        // { [skill]: {subject, topic} }
let skillClusterMap = JSON.parse(localStorage.getItem('skillClusters') || '{}'); // { [skill]: "Cluster" }

// ---------- small helpers ----------
function norm(s){ return (s || '').toString().trim().toLowerCase(); }
function shuffle(arr){
  return arr.map(v => ({ v, sort: Math.random() }))
            .sort((a,b) => a.sort - b.sort)
            .map(({v}) => v);
}
function safeGet(id){ return document.getElementById(id); }

// ---------- DOM ----------
const views = {
  home:    safeGet('homeView'),
  quiz:    safeGet('quizView'),
  stats:   safeGet('statsView'),
  summary: safeGet('summaryView'),
};

const subjectSelect   = safeGet('subjectSelect');
const quizLengthInput = safeGet('quizLength');
const startBtn        = safeGet('startBtn');
const btnHome         = safeGet('btnHome');
const btnStats        = safeGet('btnStats');
const resetBtn        = safeGet('resetBtn');

const qMeta    = safeGet('qMeta');
const qText    = safeGet('qText');
const qOptions = safeGet('qOptions');
const qInput   = safeGet('qInput');
const checkBtn = safeGet('checkBtn');
const nextBtn  = safeGet('nextBtn');
const feedback = safeGet('feedback');

const overall      = safeGet('overall');
const skillTableEl = safeGet('skillTable');     // whole table (we rebuild header+tbody)
const maxInfo      = safeGet('maxInfo');        // optional <span> to show "(Available: N)"

// ---------- State ----------
let ALL = [];         // loaded question pool for selected subject(s)
let current = null;   // current question obj
let lastSubject = 'all';

// ---------- View helpers ----------
function show(viewName){
  Object.entries(views).forEach(([name, el]) => {
    if (!el) return;
    const active = name === viewName;
    el.classList.toggle('active', active);
    el.style.display = active ? 'block' : 'none';
  });
}

function clearMedia() {
  document.getElementById('qImage')?.remove();
  document.getElementById('qTable')?.remove();
}

function resetToHome(){
  ALL = [];
  current = null;
  currentCount = 0;
  score = 0;
  SERVED_IDS = new Set();

  if (qMeta) qMeta.textContent = '';
  if (qText) qText.textContent = '';
  if (qOptions) qOptions.innerHTML = '';
  if (qInput) qInput.value = '';
  if (feedback) feedback.textContent = '';
  clearMedia();

  if (views.summary) views.summary.innerHTML = '';

  show('home');
  updateAvailableCount();
}

// ---------- topics/cluster (optional) ----------
async function ensureSkillClustersLoaded() {
  if (Object.keys(skillClusterMap).length) return;
  try {
    const res = await fetch('topics.json', { cache: 'no-store' });
    if (!res.ok) return;
    const topics = await res.json();
    const map = {};
    if (topics && topics.subjects) {
      for (const [, obj] of Object.entries(topics.subjects)) {
        (obj.clusters || []).forEach(cluster => {
          const cname = cluster.name || '—';
          (cluster.topics || []).forEach(t => {
            (t.skills || []).forEach(code => { map[code] = cname; });
          });
        });
      }
    }
    skillClusterMap = map;
    localStorage.setItem('skillClusters', JSON.stringify(map));
  } catch (e) {
    console.warn('topics.json not available; continuing without clusters.', e);
  }
}

// ---------- Data loading ----------
async function loadQuestionsFor(subject){
  const files = {
    Math:    'questions/math.json',
    English: 'questions/english.json',
    Science: 'questions/science.json'
  };

  if (subject === 'all'){
    let combined = [];
    for (const key of Object.keys(files)) {
      try {
        const res = await fetch(files[key], { cache: 'no-store' });
        if (res.ok) {
          const arr = await res.json();
          combined = combined.concat(arr);
        }
      } catch(e){
        console.warn('Failed to load', key, e);
      }
    }
    return shuffle(combined);
  } else {
    try {
      const res = await fetch(files[subject], { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch(e){
      console.warn('Failed to load', subject, e);
    }
  }
  return [];
}

// Show "(Available: N)" on Home (if <span id="maxInfo"> exists)
async function updateAvailableCount() {
  if (!maxInfo || !subjectSelect) return;
  try {
    const subj = subjectSelect.value || 'all';
    const pool = await loadQuestionsFor(subj);
    maxInfo.textContent = `(Available: ${pool.length})`;
    if (quizLengthInput) quizLengthInput.max = Math.max(1, pool.length);
  } catch (e) {
    console.warn('updateAvailableCount error', e);
  }
}

// ---------- Stats ----------
function rememberSkillMeta(q) {
  if (!q || !q.skill_tag) return;
  if (!skillMeta[q.skill_tag]) {
    skillMeta[q.skill_tag] = { subject: q.subject || 'Unknown', topic: q.topic || null };
    localStorage.setItem('skillMeta', JSON.stringify(skillMeta));
  }
}

function logAttempt(q, correct){
  rememberSkillMeta(q);

  const attempts = JSON.parse(localStorage.getItem('attempts')||'{}');
  attempts[q.id] = { lastResult: !!correct, ts: Date.now(), skill: q.skill_tag, subject: q.subject || 'Unknown' };
  localStorage.setItem('attempts', JSON.stringify(attempts));

  const skillStats = JSON.parse(localStorage.getItem('skillStats')||'{}');
  skillStats[q.skill_tag] = skillStats[q.skill_tag] || { correct: 0, total: 0 };
  skillStats[q.skill_tag].total += 1;
  if (correct) skillStats[q.skill_tag].correct += 1;
  localStorage.setItem('skillStats', JSON.stringify(skillStats));

  const subjectStats = JSON.parse(localStorage.getItem('subjectStats')||'{}');
  const subj = q.subject || (skillMeta[q.skill_tag]?.subject) || 'Unknown';
  subjectStats[subj] = subjectStats[subj] || { correct: 0, total: 0 };
  subjectStats[subj].total += 1;
  if (correct) subjectStats[subj].correct += 1;
  localStorage.setItem('subjectStats', JSON.stringify(subjectStats));

  const answered = parseInt(localStorage.getItem('answered') || '0', 10) + 1;
  localStorage.setItem('answered', String(answered));
}

async function loadStats(){
  await ensureSkillClustersLoaded();

  const skillStats   = JSON.parse(localStorage.getItem('skillStats') || '{}');
  const subjectStats = JSON.parse(localStorage.getItem('subjectStats') || '{}');

  // overall
  let grandCorrect = 0, grandTotal = 0;
  Object.values(skillStats).forEach(s => { grandCorrect += s.correct || 0; grandTotal += s.total || 0; });
  const overallAcc = grandTotal ? Math.round(100*grandCorrect/grandTotal) : 0;
  const answered = parseInt(localStorage.getItem('answered') || '0', 10);
  if (overall) overall.textContent = `Overall accuracy: ${overallAcc}%  •  Questions answered: ${answered}`;

  const subjectSummary = Object.entries(subjectStats)
    .map(([subj, s]) => ({ subj, acc: s.total ? Math.round(100*s.correct/s.total) : 0, total: s.total || 0 }))
    .sort((a, b) => a.subj.localeCompare(b.subj))
    .map(o => `${o.subj}: ${o.acc}% (n=${o.total})`)
    .join('  •  ');
  if (overall && subjectSummary) overall.textContent += `  •  ${subjectSummary}`;

  if (!skillTableEl) return;

  // build nested: subject -> cluster -> skills
  const grouped = {};
  for (const [skill, stat] of Object.entries(skillStats)) {
    const meta = skillMeta[skill] || {};
    const subject = meta.subject || 'Unknown';
    const cluster = skillClusterMap[skill] || '—';

    grouped[subject] = grouped[subject] || { __totals: { correct: 0, total: 0 }, clusters: {} };
    grouped[subject].__totals.correct += stat.correct || 0;
    grouped[subject].__totals.total   += stat.total   || 0;

    const c = grouped[subject].clusters[cluster] = grouped[subject].clusters[cluster] || { __totals: { correct: 0, total: 0 }, skills: [] };
    c.__totals.correct += stat.correct || 0;
    c.__totals.total   += stat.total   || 0;
    c.skills.push({ skill, stat });
  }

  const theadHTML = `
    <thead>
      <tr>
        <th style="width:26%">Subject / Cluster</th>
        <th style="width:34%">Skill tag</th>
        <th style="width:12%; text-align:right;">Correct</th>
        <th style="width:12%; text-align:right;">Total</th>
        <th style="width:16%; text-align:right;">Accuracy</th>
      </tr>
    </thead>
  `;

  let tbodyHTML = '<tbody>';
  const subjNames = Object.keys(grouped).sort();
  if (!subjNames.length) {
    tbodyHTML += `<tr><td colspan="5" style="text-align:center; opacity:.7;">No attempts yet.</td></tr>`;
  } else {
    for (const subj of subjNames) {
      const sTot = grouped[subj].__totals;
      const sAcc = sTot.total ? Math.round(100*sTot.correct/sTot.total) : 0;

      tbodyHTML += `
        <tr class="row-subject">
          <td colspan="5"><strong>${subj}</strong> &nbsp; <span class="muted">Accuracy: ${sAcc}% (n=${sTot.total})</span></td>
        </tr>
      `;
      const clusters = grouped[subj].clusters;
      const clusterNames = Object.keys(clusters).sort((a,b) => a.localeCompare(b));
      for (const cname of clusterNames) {
        const c = clusters[cname];
        const cAcc = c.__totals.total ? Math.round(100*c.__totals.correct/c.__totals.total) : 0;

        tbodyHTML += `
          <tr class="row-cluster">
            <td><em>${cname}</em></td>
            <td colspan="4" class="muted">Cluster accuracy: ${cAcc}% (n=${c.__totals.total})</td>
          </tr>
        `;
        c.skills.sort((a,b) => a.skill.localeCompare(b.skill)).forEach(({ skill, stat }) => {
          const acc = stat.total ? Math.round(100*(stat.correct||0)/stat.total) : 0;
          tbodyHTML += `
            <tr class="row-skill">
              <td></td>
              <td>${skill}</td>
              <td style="text-align:right;">${stat.correct||0}</td>
              <td style="text-align:right;">${stat.total||0}</td>
              <td style="text-align:right;">${acc}%</td>
            </tr>
          `;
        });
      }
    }
  }
  tbodyHTML += '</tbody>';

  skillTableEl.innerHTML = theadHTML + tbodyHTML;
}

// ---------- Question flow ----------
function pickNext(){
  const set = ALL.filter(q => (lastSubject === 'all' || q.subject === lastSubject) && !SERVED_IDS.has(q.id));
  if (!set.length) return null;

  const stats = JSON.parse(localStorage.getItem('skillStats')||'{}');
  const attempts = JSON.parse(localStorage.getItem('attempts')||'{}');

  const weakness = (skill) => {
    const s = stats[skill] || { correct: 0, total: 0 };
    return 1 - (s.total ? s.correct / s.total : 0);
  };

  const scored = set.map(q => {
    const att = attempts[q.id];
    const seenPenalty = att && att.lastResult ? 0.2 : 0;
    return { q, score: weakness(q.skill_tag) - seenPenalty + Math.random()*0.01 };
  }).sort((a,b) => b.score - a.score);

  return scored[0].q;
}

function renderQuestion(q){
  current = q;
  if (q && q.id) SERVED_IDS.add(q.id);

  if (feedback) feedback.textContent = '';
  if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = 'Next'; }
  if (qOptions) qOptions.innerHTML = '';
  if (qInput) qInput.value = '';

  if (qMeta)  qMeta.textContent = `${q.subject} • ${q.skill_tag} • ${q.id}`;
  if (qText)  qText.textContent = q.text;

  clearMedia();

  if (q.image) {
    const img = document.createElement('img');
    img.id = 'qImage';
    img.src = q.image;
    img.alt = 'Question image';
    img.style.maxWidth = '100%';
    img.style.margin = '10px 0';
    qText.insertAdjacentElement('afterend', img);
  }

  if (q.table) {
    const tbl = document.createElement('table');
    tbl.id = 'qTable';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr>' + (q.table.headers||[]).map(h => `<th>${h}</th>`).join('') + '</tr>';
    tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    (q.table.rows || []).forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = r.map(c => `<td>${c}</td>`).join('');
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    tbl.style.margin = '10px 0';
    qText.insertAdjacentElement('afterend', tbl);
  }

  if (q.type === 'mcq'){
    document.getElementById('qInputWrap').style.display = 'none';
    (q.options || []).forEach(opt => {
      const btn = document.createElement('button');
      btn.textContent = opt;
      btn.onclick = () => { qInput.value = opt; checkAnswer(); };
      qOptions.appendChild(btn);
    });
  } else {
    document.getElementById('qInputWrap').style.display = 'flex';
  }
}

function checkAnswer() {
  if (!current) return;

  const a = norm(qInput.value);
  const answers = (current.answer || '').split('|').map(s => norm(s));
  const ok = answers.includes(a);

  logAttempt(current, ok);

  const answerText = (current.answer || '').replace(/\|/g, ' or ');
  if (feedback) {
    feedback.textContent =
      (ok ? '✅ Correct!\n' : '❌ Not quite.\n') +
      (answerText ? `Correct answer: ${answerText}\n` : '') +
      (current.solution ? `Solution: ${current.solution}` : '');
  }

  if (nextBtn) nextBtn.disabled = false;

  if (ok) score++;
  currentCount++;

  // Let the learner see the explanation on the last question.
  if (nextBtn) nextBtn.textContent = (currentCount >= QUIZ_LENGTH) ? 'Finish' : 'Next';
}

function next() {
  // Only end when the learner clicks Finish after the last Check
  if (currentCount >= QUIZ_LENGTH) {
    endQuiz();
    return;
  }

  const n = pickNext();
  if (!n) {
    if (feedback) feedback.textContent = 'All done for now!';
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  if (nextBtn) { nextBtn.textContent = 'Next'; nextBtn.disabled = true; }
  renderQuestion(n);
}

function endQuiz(){
  const total = QUIZ_LENGTH;
  const pct = total ? Math.round((score/total)*100) : 0;

  if (views.summary) {
    views.summary.innerHTML = `
      <h2>Quiz Complete 🎉</h2>
      <p>You scored <b>${score}</b> out of <b>${total}</b> (${pct}%).</p>
      <button id="returnHomeBtn">Return Home</button>
    `;
  }
  show('summary');
  const returnHomeBtn = document.getElementById('returnHomeBtn');
  if (returnHomeBtn) returnHomeBtn.onclick = resetToHome;
}

// ---------- Events ----------
if (startBtn) {
  startBtn.onclick = async () => {
    try {
      lastSubject = subjectSelect ? subjectSelect.value : 'all';
      ALL = await loadQuestionsFor(lastSubject);

      if (!ALL.length) {
        alert('No questions found for this subject.');
        return;
      }

      if (maxInfo) maxInfo.textContent = `(Available: ${ALL.length})`;

      const reqLen = Math.max(1, parseInt(quizLengthInput?.value, 10) || 10);
      QUIZ_LENGTH = Math.min(reqLen, ALL.length);

      currentCount = 0;
      score = 0;
      SERVED_IDS = new Set();

      show('quiz');
      if (nextBtn) nextBtn.disabled = true;
      next();
    } catch (e) {
      console.error('Start failed:', e);
      alert('Unable to start quiz. Check the console for details.');
    }
  };
}

if (checkBtn) checkBtn.onclick = checkAnswer;
if (nextBtn)  nextBtn.onclick  = next;

if (btnHome)  btnHome.onclick  = resetToHome;
if (btnStats) btnStats.onclick = async () => { await loadStats(); show('stats'); };

if (resetBtn) {
  resetBtn.onclick = ()=> {
    localStorage.removeItem('skillStats');
    localStorage.removeItem('attempts');
    localStorage.removeItem('answered');
    localStorage.removeItem('subjectStats');
    resetToHome();
  };
}

// update "(Available: N)" when subject changes
if (subjectSelect) subjectSelect.addEventListener('change', updateAvailableCount);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (views.home?.classList.contains('active')) {
      startBtn?.click();
    } else if (views.quiz?.classList.contains('active')) {
      if (nextBtn && !nextBtn.disabled) {
        nextBtn.click();
      } else {
        checkBtn?.click();
      }
    } else if (views.summary?.classList.contains('active')) {
      resetToHome();
    }
  }
  if (e.key === 'Escape') {
    resetToHome();
  }
});

// ---------- Init ----------
(async function init(){
  show('home');
  await ensureSkillClustersLoaded();
  updateAvailableCount();
})();