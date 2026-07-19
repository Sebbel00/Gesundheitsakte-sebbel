import { firebaseConfig, LOGIN_DOMAIN } from "./firebase-config.js";

import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, addDoc, updateDoc,
  deleteDoc, query, where, orderBy, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ---------------------------------------------------------------------------
// Grundkonfiguration
// ---------------------------------------------------------------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const TIMEPOINTS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

const REGIONS = [
  { key: "kopf",   label: "Kopfschmerzen",  symbol: "✕", color: "#C1533C" },
  { key: "nacken", label: "HWS / Nacken",   symbol: "○", color: "#3E7C82" },
  { key: "bws",    label: "BWS",            symbol: "△", color: "#8A6D3B" },
  { key: "lws",    label: "LWS",            symbol: "◇", color: "#5B5F97" },
  { key: "arme",   label: "Arme",           symbol: "▽", color: "#7A9E5D" },
  { key: "beine",  label: "Beine",          symbol: "✳", color: "#A0522D" },
  { key: "bauch",  label: "Bauch",          symbol: "□", color: "#B85C8A" },
];

const BESCHWERDEN_LIST = [
  "Schwindel", "Müdigkeit", "Konzentrationsstörung", "Niedergeschlagenheit",
  "Übelkeit", "Appetitlosigkeit", "Mundtrockenheit", "Lustlosigkeit",
  "Magenbeschwerden", "Schlafstörungen", "Verstopfung", "Schwitzen"
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentUser = null;   // firebase auth user
let currentRole = null;   // "patient" | "doctor"
let currentUsername = null;
let editingEntryId = null;
let allEntriesCache = [];

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------
function toPseudoEmail(username) {
  return `${username.trim().toLowerCase()}@${LOGIN_DOMAIN}`;
}

function usernameFromEmail(email) {
  return email.split("@")[0];
}

function showToast(msg, isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = msg;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatDateDE(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const submitBtn = document.getElementById("login-submit");
  submitBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, toPseudoEmail(username), password);
  } catch (err) {
    loginError.textContent = "Anmeldung fehlgeschlagen. Benutzername oder Passwort falsch.";
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

// ---------------------------------------------------------------------------
// AUTH STATE
// ---------------------------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    currentRole = null;
    document.getElementById("view-login").classList.remove("hidden");
    document.getElementById("view-app").classList.add("hidden");
    return;
  }

  currentUser = user;
  currentUsername = usernameFromEmail(user.email);

  // Nutzerprofil (Rolle) laden
  const profileSnap = await getDoc(doc(db, "users", user.uid));
  if (!profileSnap.exists()) {
    showToast("Kein Nutzerprofil gefunden. Bitte Admin kontaktieren.", true);
    await signOut(auth);
    return;
  }
  currentRole = profileSnap.data().role;

  document.getElementById("view-login").classList.add("hidden");
  document.getElementById("view-app").classList.remove("hidden");
  document.getElementById("current-username").textContent = currentUsername;
  const badge = document.getElementById("current-role-badge");
  badge.textContent = currentRole === "patient" ? "Patient" : "Arzt / Ärztin";
  badge.classList.toggle("doctor", currentRole === "doctor");

  // Tabs je nach Rolle
  const tabUsers = document.getElementById("tab-users");
  const tabEntry = document.getElementById("tab-entry");
  if (currentRole === "doctor") {
    tabUsers.classList.add("hidden");
    tabEntry.classList.add("hidden");
    switchTab("history");
  } else {
    tabUsers.classList.remove("hidden");
    tabEntry.classList.remove("hidden");
    switchTab("entry");
  }

  buildEntryForm();
  document.getElementById("entry-date").value = todayISO();
  await loadHistory();
  if (currentRole === "patient") await loadUserList();
});

// ---------------------------------------------------------------------------
// TABS
// ---------------------------------------------------------------------------
function switchTab(tab) {
  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  const btn = document.getElementById(`tab-${tab}`);
  if (btn) btn.classList.add("active");
  document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
  document.getElementById(`panel-${tab}`).classList.remove("hidden");
}
["entry", "history", "users"].forEach(t => {
  const btn = document.getElementById(`tab-${t}`);
  if (btn) btn.addEventListener("click", () => switchTab(t));
});

// ---------------------------------------------------------------------------
// EINTRAGSFORMULAR AUFBAUEN
// ---------------------------------------------------------------------------
function buildEntryForm() {
  const table = document.getElementById("pain-table");
  let thead = "<thead><tr><th style='text-align:left; padding-left:10px;'>Region</th>";
  TIMEPOINTS.forEach(t => thead += `<th>${t}</th>`);
  thead += "</tr></thead>";

  let tbody = "<tbody>";
  REGIONS.forEach(r => {
    tbody += `<tr data-region="${r.key}"><td class="region-label"><span class="symbol" style="color:${r.color}">${r.symbol}</span> ${r.label}</td>`;
    TIMEPOINTS.forEach(t => {
      tbody += `<td><select data-region="${r.key}" data-time="${t}" class="pain-select">
        ${[...Array(11).keys()].map(v => `<option value="${v}">${v}</option>`).join("")}
        <option value="" selected></option>
      </select></td>`;
    });
    tbody += "</tr>";
  });
  tbody += "</tbody>";
  table.innerHTML = thead + tbody;

  // Beschwerden-Checkliste
  const checklist = document.getElementById("beschwerden-checklist");
  checklist.innerHTML = BESCHWERDEN_LIST.map(b => `
    <label><input type="checkbox" value="${b}"> ${b}</label>
  `).join("");
}

function resetEntryForm() {
  document.querySelectorAll(".pain-select").forEach(sel => sel.value = "");
  document.getElementById("entry-medikamente").value = "";
  document.getElementById("entry-andere").value = "";
  document.querySelectorAll('input[name="schlaf"]').forEach(r => r.checked = false);
  document.querySelectorAll("#beschwerden-checklist input").forEach(c => c.checked = false);
  document.getElementById("entry-date").value = todayISO();
  document.getElementById("entry-error").textContent = "";
  editingEntryId = null;
  document.getElementById("entry-form-title").textContent = "Neuer Eintrag";
  document.getElementById("cancel-edit-btn").classList.add("hidden");
}

document.getElementById("cancel-edit-btn").addEventListener("click", resetEntryForm);

// ---------------------------------------------------------------------------
// EINTRAG SPEICHERN
// ---------------------------------------------------------------------------
document.getElementById("save-entry-btn").addEventListener("click", async () => {
  const errEl = document.getElementById("entry-error");
  errEl.textContent = "";

  const date = document.getElementById("entry-date").value;
  if (!date) {
    errEl.textContent = "Bitte ein Datum angeben.";
    return;
  }

  const values = {};
  REGIONS.forEach(r => { values[r.key] = {}; });
  document.querySelectorAll(".pain-select").forEach(sel => {
    if (sel.value !== "") {
      values[sel.dataset.region][sel.dataset.time] = Number(sel.value);
    }
  });

  const schlafInput = document.querySelector('input[name="schlaf"]:checked');
  const beschwerden = [...document.querySelectorAll("#beschwerden-checklist input:checked")].map(c => c.value);

  const entryData = {
    ownerUid: currentUser.uid,
    date,
    values,
    medikamente: document.getElementById("entry-medikamente").value.trim(),
    schlaf: schlafInput ? schlafInput.value : null,
    beschwerden,
    andere: document.getElementById("entry-andere").value.trim(),
    updatedAt: serverTimestamp(),
  };

  const saveBtn = document.getElementById("save-entry-btn");
  saveBtn.disabled = true;
  try {
    if (editingEntryId) {
      await updateDoc(doc(db, "entries", editingEntryId), entryData);
      showToast("Eintrag aktualisiert.");
    } else {
      entryData.createdAt = serverTimestamp();
      await addDoc(collection(db, "entries"), entryData);
      showToast("Eintrag gespeichert.");
    }
    resetEntryForm();
    await loadHistory();
    switchTab("history");
  } catch (err) {
    errEl.textContent = "Fehler beim Speichern: " + err.message;
  } finally {
    saveBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// VERLAUF LADEN
// ---------------------------------------------------------------------------
async function loadHistory() {
  const list = document.getElementById("entry-list");
  list.innerHTML = "<li class='empty-state'>Lade …</li>";

  let q;
  if (currentRole === "patient") {
    q = query(collection(db, "entries"), where("ownerUid", "==", currentUser.uid), orderBy("date", "desc"));
  } else {
    // Arzt: sieht alle Einträge (nur ein Patient in dieser App)
    q = query(collection(db, "entries"), orderBy("date", "desc"));
  }

  try {
    const snap = await getDocs(q);
    allEntriesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    list.innerHTML = `<li class='empty-state'>Fehler beim Laden: ${err.message}</li>`;
    return;
  }

  if (allEntriesCache.length === 0) {
    list.innerHTML = "<li class='empty-state'>Noch keine Einträge vorhanden.</li>";
    return;
  }

  list.innerHTML = "";
  allEntriesCache.forEach(entry => {
    const li = document.createElement("li");
    li.className = "entry-row";
    const painCount = Object.values(entry.values || {}).reduce((sum, obj) => sum + Object.keys(obj).length, 0);
    li.innerHTML = `
      <div>
        <div class="date">${formatDateDE(entry.date)}</div>
        <div class="meta">${painCount} Werte erfasst ${entry.schlaf ? "· Schlaf: " + (entry.schlaf === "ausreichend" ? "ausreichend" : "nicht ausreichend") : ""}</div>
      </div>
      <div class="entry-actions">
        <button class="btn btn-sm" data-action="view" data-id="${entry.id}">Ansehen</button>
      </div>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll('[data-action="view"]').forEach(btn => {
    btn.addEventListener("click", () => showEntryDetail(btn.dataset.id));
  });
}

// ---------------------------------------------------------------------------
// SVG-CHART ERZEUGEN
// ---------------------------------------------------------------------------
function buildChartSVG(entry) {
  const width = 640, height = 340;
  const padLeft = 34, padRight = 14, padTop = 14, padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const xFor = i => padLeft + (i / (TIMEPOINTS.length - 1)) * plotW;
  const yFor = v => padTop + plotH - (v / 10) * plotH;

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:auto; font-family:Inter,sans-serif;">`;

  // Gridlines horizontal (0-10)
  for (let v = 0; v <= 10; v++) {
    const y = yFor(v);
    svg += `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#D9D2C0" stroke-width="1"/>`;
    svg += `<text x="${padLeft - 8}" y="${y + 3}" font-size="9" text-anchor="end" fill="#5C594F">${v}</text>`;
  }
  // Gridlines vertical (Zeitpunkte)
  TIMEPOINTS.forEach((t, i) => {
    const x = xFor(i);
    svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${height - padBottom}" stroke="#EDE8DA" stroke-width="1"/>`;
    svg += `<text x="${x}" y="${height - padBottom + 14}" font-size="9" text-anchor="middle" fill="#5C594F">${t}</text>`;
  });

  // Linien pro Region
  REGIONS.forEach(r => {
    const vals = entry.values ? entry.values[r.key] || {} : {};
    let points = [];
    TIMEPOINTS.forEach((t, i) => {
      const v = vals[t];
      if (v !== undefined && v !== null && v !== "") {
        points.push([xFor(i), yFor(Number(v))]);
      }
    });
    if (points.length > 0) {
      const path = points.map(p => p.join(",")).join(" ");
      svg += `<polyline points="${path}" fill="none" stroke="${r.color}" stroke-width="2"/>`;
      points.forEach(p => {
        svg += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${r.color}"/>`;
      });
    }
  });

  svg += `</svg>`;
  return svg;
}

function buildLegendHTML() {
  return REGIONS.map(r => `
    <span class="legend-item">
      <span class="legend-swatch" style="background:${r.color}">${r.symbol}</span> ${r.label}
    </span>
  `).join("");
}

// ---------------------------------------------------------------------------
// DETAILANSICHT
// ---------------------------------------------------------------------------
let currentDetailEntry = null;

function showEntryDetail(id) {
  const entry = allEntriesCache.find(e => e.id === id);
  if (!entry) return;
  currentDetailEntry = entry;

  document.getElementById("detail-card").classList.remove("hidden");
  document.getElementById("detail-date").textContent = formatDateDE(entry.date);
  document.getElementById("detail-chart").innerHTML = buildChartSVG(entry);
  document.getElementById("detail-legend").innerHTML = buildLegendHTML();

  const beschwerdenText = (entry.beschwerden || []).join(", ") || "keine angegeben";
  document.getElementById("detail-meta").innerHTML = `
    <p><strong>Medikamente:</strong> ${entry.medikamente || "–"}</p>
    <p><strong>Schlaf:</strong> ${entry.schlaf === "ausreichend" ? "ausreichend" : entry.schlaf === "nicht_ausreichend" ? "nicht ausreichend" : "–"}</p>
    <p><strong>Sonstige Beschwerden:</strong> ${beschwerdenText}</p>
    <p><strong>Andere:</strong> ${entry.andere || "–"}</p>
  `;

  document.getElementById("edit-entry-btn").classList.toggle("hidden", currentRole !== "patient");
  document.getElementById("delete-entry-btn").classList.toggle("hidden", currentRole !== "patient");

  document.getElementById("detail-card").scrollIntoView({ behavior: "smooth" });
}

document.getElementById("edit-entry-btn").addEventListener("click", () => {
  if (!currentDetailEntry) return;
  loadEntryIntoForm(currentDetailEntry);
  switchTab("entry");
});

document.getElementById("delete-entry-btn").addEventListener("click", async () => {
  if (!currentDetailEntry) return;
  if (!confirm(`Eintrag vom ${formatDateDE(currentDetailEntry.date)} wirklich löschen?`)) return;
  await deleteDoc(doc(db, "entries", currentDetailEntry.id));
  document.getElementById("detail-card").classList.add("hidden");
  showToast("Eintrag gelöscht.");
  await loadHistory();
});

document.getElementById("print-entry-btn").addEventListener("click", () => {
  if (!currentDetailEntry) return;
  fillPrintArea(currentDetailEntry);
  window.print();
});

function loadEntryIntoForm(entry) {
  resetEntryForm();
  editingEntryId = entry.id;
  document.getElementById("entry-form-title").textContent = "Eintrag bearbeiten – " + formatDateDE(entry.date);
  document.getElementById("cancel-edit-btn").classList.remove("hidden");
  document.getElementById("entry-date").value = entry.date;
  document.getElementById("entry-medikamente").value = entry.medikamente || "";
  document.getElementById("entry-andere").value = entry.andere || "";
  if (entry.schlaf) {
    const radio = document.querySelector(`input[name="schlaf"][value="${entry.schlaf}"]`);
    if (radio) radio.checked = true;
  }
  (entry.beschwerden || []).forEach(b => {
    const cb = [...document.querySelectorAll("#beschwerden-checklist input")].find(c => c.value === b);
    if (cb) cb.checked = true;
  });
  REGIONS.forEach(r => {
    const vals = entry.values ? entry.values[r.key] || {} : {};
    Object.entries(vals).forEach(([t, v]) => {
      const sel = document.querySelector(`.pain-select[data-region="${r.key}"][data-time="${t}"]`);
      if (sel) sel.value = v;
    });
  });
}

// ---------------------------------------------------------------------------
// DRUCKBEREICH BEFÜLLEN
// ---------------------------------------------------------------------------
function fillPrintArea(entry) {
  document.getElementById("print-date").textContent = formatDateDE(entry.date);
  document.getElementById("print-chart").innerHTML = buildChartSVG(entry);
  document.getElementById("print-legend").innerHTML = buildLegendHTML();
  document.getElementById("print-medikamente").textContent = entry.medikamente || "–";
  document.getElementById("print-schlaf").textContent =
    entry.schlaf === "ausreichend" ? "ausreichend" : entry.schlaf === "nicht_ausreichend" ? "nicht ausreichend" : "–";
  document.getElementById("print-beschwerden").textContent = (entry.beschwerden || []).join(", ") || "keine angegeben";
  document.getElementById("print-andere").textContent = entry.andere || "–";
}

// ---------------------------------------------------------------------------
// NUTZERVERWALTUNG
// ---------------------------------------------------------------------------
document.getElementById("create-user-btn").addEventListener("click", async () => {
  const errEl = document.getElementById("user-error");
  errEl.textContent = "";
  const username = document.getElementById("new-user-username").value.trim();
  const password = document.getElementById("new-user-password").value;
  const role = document.getElementById("new-user-role").value;

  if (!username || !password) {
    errEl.textContent = "Bitte Benutzername und Passwort angeben.";
    return;
  }
  if (password.length < 8) {
    errEl.textContent = "Passwort sollte mindestens 8 Zeichen haben.";
    return;
  }

  const btn = document.getElementById("create-user-btn");
  btn.disabled = true;

  // Zweite, temporäre Firebase-App-Instanz nutzen, damit die eigene
  // (Patienten-)Sitzung dabei nicht überschrieben/abgemeldet wird.
  const secondaryApp = initializeApp(firebaseConfig, "Secondary-" + Date.now());
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, toPseudoEmail(username), password);
    await setDoc(doc(db, "users", cred.user.uid), {
      username,
      role,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid,
    });
    await signOut(secondaryAuth);
    showToast(`Zugang für "${username}" angelegt.`);
    document.getElementById("new-user-username").value = "";
    document.getElementById("new-user-password").value = "";
    await loadUserList();
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      errEl.textContent = "Dieser Benutzername ist bereits vergeben.";
    } else {
      errEl.textContent = "Fehler: " + err.message;
    }
  } finally {
    await deleteApp(secondaryApp);
    btn.disabled = false;
  }
});

async function loadUserList() {
  const tbody = document.getElementById("user-list-body");
  tbody.innerHTML = "<tr><td colspan='3'>Lade …</td></tr>";
  try {
    const snap = await getDocs(collection(db, "users"));
    if (snap.empty) {
      tbody.innerHTML = "<tr><td colspan='3'>Keine Nutzer gefunden.</td></tr>";
      return;
    }
    tbody.innerHTML = "";
    snap.forEach(d => {
      const u = d.data();
      const created = u.createdAt && u.createdAt.toDate ? u.createdAt.toDate().toLocaleDateString("de-DE") : "–";
      tbody.innerHTML += `<tr><td>${u.username}</td><td>${u.role === "patient" ? "Patient" : "Arzt/Ärztin"}</td><td>${created}</td></tr>`;
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan='3'>Fehler: ${err.message}</td></tr>`;
  }
}
