import {
  configured, auth, db, onAuthStateChanged, signInAnonymously,
  doc, collection, getDoc, setDoc, onSnapshot, writeBatch, serverTimestamp,
} from "./firebase.js";
import { ANSWERS, h, formatDate, sortDates, linkify, renderBoard, toast, errorMessage } from "./ui.js";

const $ = (id) => document.getElementById(id);
const stateEl = $("state");

function showState(title, ...content) {
  $("app").hidden = true;
  stateEl.hidden = false;
  stateEl.replaceChildren(h("h2", {}, title), ...content.map((c) => (typeof c === "string" ? h("p", {}, c) : c)));
}

function showError(err) {
  console.error(err);
  showState("Oups", errorMessage(err), "Recharge la page. Si ça continue, préviens l'organisateur.");
}

// Le lien d'invitation est dans le fragment (#i=…), qui n'est jamais envoyé au serveur.
function readToken() {
  const m = location.hash.match(/[#&]i=([a-f0-9]{32})/i);
  return m ? m[1].toLowerCase() : null;
}

function clearToken() {
  history.replaceState(null, "", location.pathname + location.search);
}

if (!configured) {
  showState("Site pas encore configuré", "La configuration Firebase est manquante (js/firebase-config.js).");
} else {
  const token = readToken();
  let routed = false;
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      signInAnonymously(auth).catch(showError);
      return;
    }
    if (routed) return;
    routed = true;
    route(user, token).catch(showError);
  });
}

async function route(user, token) {
  const member = await getDoc(doc(db, "members", user.uid));
  if (member.exists()) {
    if (token) clearToken();
    return openApp(member.data());
  }
  if (token) return showInvite(user, token);

  // Ni invité ni lien : seul l'organisateur a encore le droit de lire le planning.
  try {
    await getDoc(doc(db, "config", "event"));
    return openApp(null);
  } catch (err) {
    if (err.code !== "permission-denied") throw err;
    showState(
      "Planning sur invitation",
      "Pour accéder au planning, ouvre le lien personnel que l'organisateur t'a envoyé.",
      h("p", { class: "hint" }, "Tu avais déjà répondu ? Ton navigateur a peut-être oublié ton lien (changement de navigateur, données effacées…). Demande un nouveau lien à l'organisateur : tes réponses sont conservées."),
    );
  }
}

async function showInvite(user, token) {
  const snap = await getDoc(doc(db, "invites", token));
  if (!snap.exists()) {
    return showState("Lien invalide", "Ce lien n'existe pas ou a été remplacé par un nouveau. Demande un lien à l'organisateur.");
  }
  const invite = snap.data();
  if (invite.claimedBy) {
    return showState(
      "Lien déjà utilisé",
      "Ce lien a déjà été activé sur un autre appareil ou un autre navigateur.",
      "Si ce n'était pas toi, préviens l'organisateur : il te fera un nouveau lien et désactivera l'ancien.",
    );
  }

  const button = h("button", { class: "btn primary", type: "button" }, `Oui, je suis ${invite.name}`);
  button.addEventListener("click", async () => {
    button.disabled = true;
    const batch = writeBatch(db);
    batch.update(doc(db, "invites", token), { claimedBy: user.uid, claimedAt: serverTimestamp() });
    batch.set(doc(db, "members", user.uid), {
      name: invite.name, guestId: invite.guestId, token, joinedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
      clearToken();
      openApp({ name: invite.name, guestId: invite.guestId });
    } catch (err) {
      showError(err);
    }
  });

  showState(
    `Salut ${invite.name} !`,
    "Ce lien est personnel. En le validant, tu le lies à ce navigateur : c'est comme ça que l'organisateur sait que c'est bien toi qui réponds.",
    h("p", { class: "hint" }, "Ouvre-le dans le navigateur que tu utiliseras pour revenir ici (pas l'aperçu intégré de Teams ou d'une messagerie)."),
    h("div", { class: "actions" }, button),
    h("p", { class: "hint" }, `Tu n'es pas ${invite.name} ? Ferme cette page et préviens l'organisateur.`),
  );
}

let me = null;
let event = null;
let responses = [];
let draft = null;
let dirty = false;

function openApp(member) {
  me = member;
  stateEl.hidden = true;
  $("app").hidden = false;

  if (me) {
    $("whoami").textContent = `Connecté en tant que ${me.name}`;
  } else {
    $("whoami").replaceChildren("Mode organisateur (lecture seule) · ", h("a", { href: "admin.html" }, "Administration"));
    $("form-card").hidden = true;
  }
  $("whoami").hidden = false;

  onSnapshot(doc(db, "config", "event"), (snap) => {
    event = snap.exists() ? snap.data() : null;
    renderHeader();
    renderForm();
    renderResults();
  }, showError);

  onSnapshot(collection(db, "responses"), (qs) => {
    responses = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (me && !draft) {
      const mine = responses.find((r) => r.id === me.guestId);
      draft = { answers: { ...mine?.answers }, games: [...(mine?.games || [])], comment: mine?.comment || "" };
      renderForm();
    }
    renderResults();
  }, showError);

  addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });
}

function renderHeader() {
  document.title = event?.title || "LAN party";
  $("title").textContent = event?.title || "LAN party";
  $("description").textContent = event?.description || "";
  const info = event?.info?.trim();
  $("info-card").hidden = !info;
  $("info").replaceChildren(info ? linkify(info) : "");
}

function setDirty(value) {
  dirty = value;
  $("save-status").textContent = value ? "Modifications non enregistrées" : "";
  $("save-status").classList.toggle("warn", value);
}

function renderForm() {
  if (!me || !draft) return;
  const form = $("form");
  if (!event) {
    form.replaceChildren(h("p", { class: "muted" }, "L'organisateur n'a pas encore proposé de dates."));
    return;
  }
  const dates = sortDates(event.dates);
  const games = event.games || [];

  const dateRows = dates.map((d) => {
    const labelId = `date-${d.id}`;
    return h("div", { class: "date-row" },
      h("div", { class: "date-title", id: labelId },
        h("span", { class: "date-main" }, formatDate(d.date, true)),
        d.label && h("span", { class: "date-label" }, d.label),
      ),
      h("div", { class: "seg", role: "radiogroup", "aria-labelledby": labelId },
        Object.entries(ANSWERS).map(([value, a]) =>
          h("label", { class: `seg-${value}` },
            h("input", {
              type: "radio", name: `d-${d.id}`, value, checked: draft.answers[d.id] === value,
              onchange: () => { draft.answers[d.id] = value; setDirty(true); },
            }),
            h("span", {}, a.label),
          ),
        ),
      ),
    );
  });

  const gameChips = games.map((g) =>
    h("label", { class: "chip" },
      h("input", {
        type: "checkbox", checked: draft.games.includes(g.id),
        onchange: (e) => {
          draft.games = e.target.checked ? [...draft.games, g.id] : draft.games.filter((id) => id !== g.id);
          setDirty(true);
        },
      }),
      h("span", {}, g.name),
    ),
  );

  form.replaceChildren(
    h("h3", {}, "Tes dispos"),
    dates.length ? h("div", { class: "dates" }, dateRows) : h("p", { class: "muted" }, "Pas encore de dates proposées."),
    games.length ? h("h3", {}, "Les jeux qui te tentent") : null,
    games.length ? h("div", { class: "chips" }, gameChips) : null,
    h("h3", {}, h("label", { for: "comment" }, "Un commentaire ?")),
    h("textarea", {
      id: "comment", rows: 3, maxlength: 500, value: draft.comment,
      placeholder: "Ex. dispo seulement après 21h, je propose tel jeu…",
      oninput: (e) => { draft.comment = e.target.value; setDirty(true); },
    }),
    h("div", { class: "form-footer" },
      h("button", { class: "btn primary", type: "submit" }, "Enregistrer"),
      h("span", { id: "save-status", class: "save-status", "aria-live": "polite" }),
    ),
  );
  setDirty(dirty);
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!me || !event) return;
  const dateIds = new Set((event.dates || []).map((d) => d.id));
  const gameIds = new Set((event.games || []).map((g) => g.id));
  const answers = Object.fromEntries(Object.entries(draft.answers).filter(([id, a]) => dateIds.has(id) && ANSWERS[a]));
  const button = e.target.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await setDoc(doc(db, "responses", me.guestId), {
      name: me.name,
      answers,
      games: draft.games.filter((id) => gameIds.has(id)),
      comment: draft.comment.trim().slice(0, 500),
      updatedAt: serverTimestamp(),
    });
    setDirty(false);
    toast("C'est noté ✔");
  } catch (err) {
    toast(`Échec de l'enregistrement : ${errorMessage(err)}`);
  } finally {
    button.disabled = false;
  }
});

function renderResults() {
  renderBoard($("board"), { event, responses, meId: me?.guestId });
}
