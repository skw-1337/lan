import {
  configured, auth, db, onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider,
  doc, collection, getDoc, getDocs, setDoc, onSnapshot, writeBatch, serverTimestamp,
} from "./firebase.js";
import { h, formatStamp, renderBoard, toast, errorMessage } from "./ui.js";

const $ = (id) => document.getElementById(id);
const stateEl = $("state");
const MAX_DATES = 30;
const MAX_GAMES = 50;

function showState(title, ...content) {
  $("app").hidden = true;
  stateEl.hidden = false;
  stateEl.replaceChildren(h("h2", {}, title), ...content.map((c) => (typeof c === "string" ? h("p", {}, c) : c)));
}

function showError(err) {
  console.error(err);
  showState("Erreur", errorMessage(err));
}

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    prompt("Copie ce texte :", text);
  }
}

if (!configured) {
  showState("Site pas encore configuré", "La configuration Firebase est manquante (js/firebase-config.js).");
} else {
  let opened = false;
  onAuthStateChanged(auth, async (user) => {
    if (!user || user.isAnonymous) return showLogin();
    if (opened) return;
    try {
      await getDocs(collection(db, "invites"));
      opened = true;
      openAdmin(user);
    } catch (err) {
      if (err.code === "permission-denied") showNotAdmin(user);
      else showError(err);
    }
  });
}

function showLogin() {
  const button = h("button", { class: "btn primary", type: "button" }, "Se connecter avec Google");
  button.addEventListener("click", () => {
    signInWithPopup(auth, new GoogleAuthProvider()).catch((err) => {
      if (err.code !== "auth/popup-closed-by-user") toast(errorMessage(err));
    });
  });
  showState("Espace organisateur", "Connecte-toi avec ton compte Google pour gérer la LAN.", h("div", { class: "actions" }, button));
}

function showNotAdmin(user) {
  showState(
    "Compte pas encore organisateur",
    `Tu es connecté avec ${user.email || "un compte Google"}, mais ce compte n'est pas encore déclaré dans les règles Firestore.`,
    "Voici ton identifiant Firebase (UID). Il doit être enregistré dans le fichier .admin-uid du projet, puis les règles republiées avec node deploy-rules.mjs :",
    h("div", { class: "uid-row" },
      h("code", { class: "uid" }, user.uid),
      h("button", { class: "btn", type: "button", onclick: () => copy(user.uid, "UID copié") }, "Copier"),
    ),
    h("div", { class: "actions" }, h("button", { class: "btn ghost", type: "button", onclick: () => signOut(auth) }, "Se déconnecter")),
  );
}

let invites = [];
let responses = [];
let event = null;

function openAdmin(user) {
  stateEl.hidden = true;
  $("app").hidden = false;
  $("whoami").hidden = false;
  $("whoami").replaceChildren(
    `Organisateur : ${user.email || user.uid} · `,
    h("a", { href: "./" }, "Voir la page des invités"),
    " · ",
    h("button", { class: "link", type: "button", onclick: () => signOut(auth).then(() => location.reload()) }, "Déconnexion"),
  );

  loadEvent();
  onSnapshot(collection(db, "invites"), (qs) => {
    invites = qs.docs.map((d) => ({ token: d.id, ...d.data() }));
    renderInvites();
    renderResults();
  }, showError);
  onSnapshot(collection(db, "responses"), (qs) => {
    responses = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderInvites();
    renderResults();
  }, showError);
}

// ---------- Événement ----------

async function loadEvent() {
  const snap = await getDoc(doc(db, "config", "event")).catch(showError);
  event = snap?.exists() ? snap.data() : { title: "", description: "", info: "", dates: [], games: [] };
  $("ev-title").value = event.title || "";
  $("ev-description").value = event.description || "";
  $("ev-info").value = event.info || "";
  $("dates").replaceChildren(...(event.dates || []).map(dateRow));
  $("games").replaceChildren(...(event.games || []).map(gameRow));
  renderResults();
}

function dateRow(d = { id: randomHex(4), date: "", label: "" }) {
  return h("li", { class: "edit-row", "data-id": d.id },
    h("input", { type: "date", class: "date-input", value: d.date, "aria-label": "Date", required: true }),
    h("input", { type: "text", class: "label-input", value: d.label, maxlength: 40, placeholder: "Précision (ex. 20h → tard)", "aria-label": "Précision" }),
    h("button", { class: "btn icon", type: "button", title: "Retirer", "aria-label": "Retirer cette date", onclick: (e) => e.currentTarget.parentElement.remove() }, "✕"),
  );
}

function gameRow(g = { id: randomHex(4), name: "" }) {
  return h("li", { class: "edit-row", "data-id": g.id },
    h("input", { type: "text", class: "name-input", value: g.name, maxlength: 40, placeholder: "Nom du jeu", "aria-label": "Nom du jeu", required: true }),
    h("button", { class: "btn icon", type: "button", title: "Retirer", "aria-label": "Retirer ce jeu", onclick: (e) => e.currentTarget.parentElement.remove() }, "✕"),
  );
}

$("add-date").addEventListener("click", () => {
  if ($("dates").children.length >= MAX_DATES) return toast(`${MAX_DATES} dates maximum`);
  const row = dateRow();
  $("dates").append(row);
  row.querySelector("input").focus();
});

$("add-game").addEventListener("click", () => {
  if ($("games").children.length >= MAX_GAMES) return toast(`${MAX_GAMES} jeux maximum`);
  const row = gameRow();
  $("games").append(row);
  row.querySelector("input").focus();
});

$("event-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dates = [...$("dates").children].map((li) => ({
    id: li.dataset.id,
    date: li.querySelector(".date-input").value,
    label: li.querySelector(".label-input").value.trim(),
  }));
  const games = [...$("games").children]
    .map((li) => ({ id: li.dataset.id, name: li.querySelector(".name-input").value.trim() }))
    .filter((g) => g.name);
  const data = {
    title: $("ev-title").value.trim(),
    description: $("ev-description").value.trim(),
    info: $("ev-info").value.trim(),
    dates,
    games,
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, "config", "event"), data);
    event = data;
    renderResults();
    toast("Événement enregistré ✔");
  } catch (err) {
    toast(`Échec : ${errorMessage(err)}`);
  }
});

// ---------- Invités ----------

function inviteLink(token) {
  return new URL(`./#i=${token}`, location.href).href;
}

function inviteMessage(invite) {
  return `Salut ${invite.name} ! Voici ton lien perso pour la LAN : ${inviteLink(invite.token)}\n`
    + "Il ne marche qu'une fois : ouvre-le dans ton navigateur habituel (pas dans l'aperçu de la messagerie). Ne le transfère à personne.";
}

$("invite-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("invite-name");
  const name = input.value.trim().replace(/\s+/g, " ");
  if (!name) return;
  if (invites.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
    return toast(`${name} a déjà une invitation`);
  }
  const invite = { token: randomHex(16), name, guestId: randomHex(8) };
  try {
    await setDoc(doc(db, "invites", invite.token), {
      name, guestId: invite.guestId, claimedBy: null, claimedAt: null, createdAt: serverTimestamp(),
    });
    input.value = "";
    await copy(inviteMessage(invite), `Invitation pour ${name} copiée : colle-la-lui en privé`);
  } catch (err) {
    toast(`Échec : ${errorMessage(err)}`);
  }
});

async function renewInvite(invite) {
  const ok = confirm(
    `Créer un nouveau lien pour ${invite.name} ?\n\n`
    + "L'ancien lien ne marchera plus, et l'appareil actuellement lié perdra l'accès. Ses réponses sont conservées.",
  );
  if (!ok) return;
  const fresh = { ...invite, token: randomHex(16) };
  const batch = writeBatch(db);
  batch.set(doc(db, "invites", fresh.token), {
    name: invite.name, guestId: invite.guestId, claimedBy: null, claimedAt: null, createdAt: serverTimestamp(),
  });
  batch.delete(doc(db, "invites", invite.token));
  if (invite.claimedBy) batch.delete(doc(db, "members", invite.claimedBy));
  try {
    await batch.commit();
    await copy(inviteMessage(fresh), `Nouveau lien pour ${invite.name} copié`);
  } catch (err) {
    toast(`Échec : ${errorMessage(err)}`);
  }
}

async function deleteInvite(invite) {
  if (!confirm(`Supprimer ${invite.name} ? Son lien et ses réponses seront effacés.`)) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, "invites", invite.token));
  if (invite.claimedBy) batch.delete(doc(db, "members", invite.claimedBy));
  batch.delete(doc(db, "responses", invite.guestId));
  try {
    await batch.commit();
    toast(`${invite.name} supprimé`);
  } catch (err) {
    toast(`Échec : ${errorMessage(err)}`);
  }
}

function renderInvites() {
  const answered = new Set(responses.map((r) => r.id));
  const list = $("invites");
  const sorted = [...invites].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  $("invite-count").textContent = invites.length ? `${invites.length} invité${invites.length > 1 ? "s" : ""}` : "";
  if (!sorted.length) {
    list.replaceChildren(h("li", { class: "muted" }, "Aucun invité pour l'instant."));
    return;
  }
  list.replaceChildren(
    ...sorted.map((inv) =>
      h("li", { class: "invite" },
        h("div", { class: "invite-main" },
          h("strong", {}, inv.name),
          h("div", { class: "badges" },
            inv.claimedBy
              ? h("span", { class: "badge ok", title: "Le lien a été ouvert et validé sur un appareil" }, `Lien validé ${formatStamp(inv.claimedAt)}`)
              : h("span", { class: "badge" }, "Lien pas encore ouvert"),
            answered.has(inv.guestId)
              ? h("span", { class: "badge ok" }, "A répondu")
              : h("span", { class: "badge" }, "Pas répondu"),
          ),
        ),
        h("div", { class: "invite-actions" },
          !inv.claimedBy && h("button", { class: "btn small", type: "button", onclick: () => copy(inviteMessage(inv), "Invitation copiée") }, "Copier l'invitation"),
          h("button", { class: "btn small", type: "button", onclick: () => renewInvite(inv) }, "Nouveau lien"),
          h("button", { class: "btn small danger", type: "button", onclick: () => deleteInvite(inv) }, "Supprimer"),
        ),
      ),
    ),
  );
}

// ---------- Tableau ----------

function renderResults() {
  if (!event) return;
  const answered = new Set(responses.map((r) => r.id));
  const waiting = invites.filter((i) => !answered.has(i.guestId)).map((i) => i.name);
  renderBoard($("board"), { event, responses, waiting });
}
