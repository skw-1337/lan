import {
  configured, auth, db, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut,
  doc, collection, getDoc, getDocs, setDoc, onSnapshot, writeBatch, serverTimestamp,
} from "./firebase.js";
import { h, avatar, gameArt, formatStamp, renderBoard, groupSuggestions, initTopbar, toast, errorMessage } from "./ui.js";
import { CATALOG, findGame, norm } from "./games.js";
import { t, lang, initLangSwitch, onLangChange } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const stateEl = $("state");
const MAX_DATES = 30;
const MAX_GAMES = 50;

initLangSwitch();
initTopbar();

// Écran d'état courant (connexion, compte non organisateur…), rejoué si la langue change.
let currentState = null;
function setState(render) {
  currentState = render;
  render();
}

function showState(title, ...content) {
  $("app").hidden = true;
  stateEl.hidden = false;
  stateEl.replaceChildren(
    h("p", { class: "eyebrow" }, t("common.access")),
    h("h2", {}, title),
    ...content.map((c) => (typeof c === "string" ? h("p", {}, c) : c)),
  );
}

function showError(err) {
  console.error(err);
  setState(() => showState(t("common.error"), errorMessage(err)));
}

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    prompt(t("common.copyPrompt"), text);
  }
}

if (!configured) {
  setState(() => showState(t("common.notConfigured"), t("common.missingConfig")));
} else {
  setState(() => showState(t("common.loading")));
  let opened = false;
  onAuthStateChanged(auth, async (user) => {
    if (!user || user.isAnonymous) return setState(showLogin);
    if (opened) return;
    try {
      await getDocs(collection(db, "invites"));
      opened = true;
      openAdmin(user);
    } catch (err) {
      if (err.code === "permission-denied") setState(() => showNotAdmin(user));
      else showError(err);
    }
  });
}

// Messages d'erreur de connexion : volontairement vagues (on ne dit pas si l'e-mail existe).
function loginError(err) {
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"].includes(err?.code)) {
    return t("admin.badCredentials");
  }
  if (err?.code === "auth/invalid-email") return t("admin.badEmail");
  if (err?.code === "auth/too-many-requests") return t("admin.tooMany");
  if (err?.code === "auth/network-request-failed") return t("err.offline");
  return errorMessage(err);
}

let loginEmail = "";

function showLogin() {
  const email = h("input", {
    id: "login-email", type: "email", autocomplete: "username", required: true, value: loginEmail,
    oninput: (e) => { loginEmail = e.target.value; },
  });
  const password = h("input", { id: "login-password", type: "password", autocomplete: "current-password", required: true });
  const submit = h("button", { class: "btn primary", type: "submit" }, t("admin.signIn"));
  const status = h("p", { class: "login-status", role: "alert" });

  const form = h("form", { class: "login-form" },
    h("label", { for: "login-email" }, t("admin.email")), email,
    h("label", { for: "login-password" }, t("admin.password")), password,
    status,
    h("div", { class: "login-actions" },
      submit,
      h("button", {
        class: "link", type: "button",
        onclick: async () => {
          if (!email.value.trim()) {
            status.textContent = t("admin.resetNeedsEmail");
            email.focus();
            return;
          }
          auth.languageCode = lang;
          try {
            await sendPasswordResetEmail(auth, email.value.trim());
          } catch (err) {
            if (err?.code === "auth/invalid-email" || err?.code === "auth/too-many-requests") {
              status.textContent = loginError(err);
              return;
            }
          }
          status.textContent = "";
          toast(t("admin.resetSent"));
        },
      }, t("admin.forgot")),
    ),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.disabled = true;
    status.textContent = "";
    try {
      await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    } catch (err) {
      status.textContent = loginError(err);
      password.select();
    } finally {
      submit.disabled = false;
    }
  });

  showState(t("admin.eyebrow"), t("admin.signInText"), form);
}

function showNotAdmin(user) {
  showState(
    t("admin.notAdmin"),
    t("admin.notAdminText", { email: user.email || t("admin.thisAccount") }),
    t("admin.uidText"),
    h("div", { class: "uid-row" },
      h("code", { class: "uid" }, user.uid),
      h("button", { class: "btn", type: "button", onclick: () => copy(user.uid, t("admin.uidCopied")) }, t("admin.copy")),
    ),
    h("div", { class: "actions" },
      h("button", { class: "btn ghost", type: "button", onclick: () => signOut(auth) }, t("admin.logout")),
    ),
  );
}

let adminUser = null;
let invites = [];
let responses = [];
let event = null;

function openAdmin(user) {
  adminUser = user;
  currentState = null;
  stateEl.hidden = true;
  $("app").hidden = false;
  $("admin-links").hidden = false;
  $("logout").addEventListener("click", () => signOut(auth).then(() => location.reload()));
  renderWhoami();

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
    if (event) renderQuickAdd();
  }, showError);
}

onLangChange(() => {
  if (!adminUser) {
    currentState?.();
    return;
  }
  renderWhoami();
  renderInvites();
  renderResults();
  if (event) renderQuickAdd();
});

function renderWhoami() {
  $("whoami").replaceChildren(
    avatar(adminUser.displayName || adminUser.email || "O", "avatar small"),
    h("span", {}, h("strong", {}, t("admin.organizer"))),
  );
  $("whoami").hidden = false;
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
  renderQuickAdd();
  renderResults();
}

// Les lignes éditables portent des marqueurs data-i18n-* : elles se traduisent sans perdre la saisie.
function dateRow(d = { id: randomHex(4), date: "", label: "" }) {
  return h("li", { class: "edit-row", "data-id": d.id },
    h("input", {
      type: "date", class: "date-input", value: d.date, required: true,
      "aria-label": t("admin.date"), "data-i18n-aria": "admin.date",
    }),
    h("input", {
      type: "text", class: "label-input", value: d.label, maxlength: 40,
      placeholder: t("admin.dateDetails"), "data-i18n-placeholder": "admin.dateDetails",
      "aria-label": t("admin.dateDetailsAria"), "data-i18n-aria": "admin.dateDetailsAria",
    }),
    h("button", {
      class: "btn icon", type: "button",
      title: t("admin.remove"), "data-i18n-title": "admin.remove",
      "aria-label": t("admin.removeDate"), "data-i18n-aria": "admin.removeDate",
      onclick: (e) => e.currentTarget.parentElement.remove(),
    }, "✕"),
  );
}

function gameRow(g = { id: randomHex(4), name: "" }) {
  const thumb = h("span", { class: "game-thumb" }, gameArt(g, "thumb-art"));
  const row = h("li", { class: "edit-row", "data-id": g.id },
    thumb,
    h("input", {
      type: "text", class: "name-input", value: g.name, maxlength: 40, required: true,
      placeholder: t("admin.gameName"), "data-i18n-placeholder": "admin.gameName",
      "aria-label": t("admin.gameName"), "data-i18n-aria": "admin.gameName",
      oninput: (e) => {
        thumb.replaceChildren(gameArt({ name: e.target.value || "?" }, "thumb-art"));
        renderQuickAdd();
      },
    }),
    h("button", {
      class: "btn icon", type: "button",
      title: t("admin.remove"), "data-i18n-title": "admin.remove",
      "aria-label": t("admin.removeGame"), "data-i18n-aria": "admin.removeGame",
      onclick: () => { row.remove(); renderQuickAdd(); },
    }, "✕"),
  );
  return row;
}

function addGame(g) {
  if ($("games").children.length >= MAX_GAMES) return toast(t("admin.maxGames", { n: MAX_GAMES }));
  const row = gameRow(g);
  $("games").append(row);
  renderQuickAdd();
  return row;
}

// Boutons « classiques » : un clic ajoute le jeu avec son nom exact, donc avec son visuel.
// En dessous, les jeux proposés par les invités (« Autre ») qui ne sont pas encore dans la liste.
function renderQuickAdd() {
  const names = [...$("games").querySelectorAll(".name-input")].map((input) => input.value);
  const present = new Set(names.map((name) => findGame({ name })?.key).filter(Boolean));
  const presentNames = new Set(names.map(norm));
  $("quick-games").replaceChildren(...CATALOG.map((c) =>
    h("button", {
      class: "quick", type: "button", disabled: present.has(c.key),
      title: present.has(c.key) ? t("admin.alreadyListed") : t("admin.addGame", { name: c.name }),
      onclick: () => addGame({ id: randomHex(4), name: c.name }),
    },
    h("img", { class: "quick-art", src: c.card, alt: "", loading: "lazy" }),
    h("span", {}, c.name)),
  ));

  const suggested = groupSuggestions(responses).filter((s) => {
    const key = findGame({ name: s.name })?.key;
    return !presentNames.has(norm(s.name)) && !(key && present.has(key));
  });
  $("suggest-add").hidden = !suggested.length;
  $("suggested-games").replaceChildren(...suggested.map((s) =>
    h("button", {
      class: "quick", type: "button",
      title: t("admin.suggestedBy", { names: s.voters.join(", ") }),
      onclick: () => addGame({ id: randomHex(4), name: s.name }),
    },
    gameArt({ name: s.name }, "quick-art"),
    h("span", {}, s.name),
    s.voters.length > 1 && h("small", { class: "quick-count" }, `×${s.voters.length}`)),
  ));
}

$("add-date").addEventListener("click", () => {
  if ($("dates").children.length >= MAX_DATES) return toast(t("admin.maxDates", { n: MAX_DATES }));
  const row = dateRow();
  $("dates").append(row);
  row.querySelector("input").focus();
});

$("add-game").addEventListener("click", () => {
  addGame()?.querySelector("input").focus();
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
    toast(t("admin.eventSaved"));
  } catch (err) {
    toast(t("admin.failed", { err: errorMessage(err) }));
  }
});

// ---------- Invités ----------

function inviteLink(token) {
  return new URL(`./#i=${token}`, location.href).href;
}

function inviteMessage(invite) {
  return t("admin.inviteMessage", { name: invite.name, link: inviteLink(invite.token) });
}

$("invite-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("invite-name");
  const name = input.value.trim().replace(/\s+/g, " ");
  if (!name) return;
  if (invites.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
    return toast(t("admin.alreadyInvited", { name }));
  }
  const invite = { token: randomHex(16), name, guestId: randomHex(8) };
  try {
    await setDoc(doc(db, "invites", invite.token), {
      name, guestId: invite.guestId, claimedBy: null, claimedAt: null, createdAt: serverTimestamp(),
    });
    input.value = "";
    await copy(inviteMessage(invite), t("admin.inviteCopied", { name }));
  } catch (err) {
    toast(t("admin.failed", { err: errorMessage(err) }));
  }
});

async function renewInvite(invite) {
  if (!confirm(t("admin.renewConfirm", { name: invite.name }))) return;
  const fresh = { ...invite, token: randomHex(16) };
  const batch = writeBatch(db);
  batch.set(doc(db, "invites", fresh.token), {
    name: invite.name, guestId: invite.guestId, claimedBy: null, claimedAt: null, createdAt: serverTimestamp(),
  });
  batch.delete(doc(db, "invites", invite.token));
  if (invite.claimedBy) batch.delete(doc(db, "members", invite.claimedBy));
  try {
    await batch.commit();
    await copy(inviteMessage(fresh), t("admin.renewCopied", { name: invite.name }));
  } catch (err) {
    toast(t("admin.failed", { err: errorMessage(err) }));
  }
}

async function deleteInvite(invite) {
  if (!confirm(t("admin.deleteConfirm", { name: invite.name }))) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, "invites", invite.token));
  if (invite.claimedBy) batch.delete(doc(db, "members", invite.claimedBy));
  batch.delete(doc(db, "responses", invite.guestId));
  try {
    await batch.commit();
    toast(t("admin.deleted", { name: invite.name }));
  } catch (err) {
    toast(t("admin.failed", { err: errorMessage(err) }));
  }
}

function renderInvites() {
  const answered = new Set(responses.map((r) => r.id));
  const list = $("invites");
  const sorted = [...invites].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  $("invite-count").textContent = invites.length
    ? t(invites.length > 1 ? "admin.guestMany" : "admin.guestOne", { n: invites.length })
    : "";
  if (!sorted.length) {
    list.replaceChildren(h("li", { class: "muted" }, t("admin.noGuests")));
    return;
  }
  list.replaceChildren(
    ...sorted.map((inv) =>
      h("li", { class: "invite" },
        avatar(inv.name),
        h("div", { class: "invite-main" },
          h("strong", {}, inv.name),
          h("div", { class: "badges" },
            inv.claimedBy
              ? h("span", { class: "badge ok", title: t("admin.linkConfirmedTitle") }, t("admin.linkConfirmed", { stamp: formatStamp(inv.claimedAt) }))
              : h("span", { class: "badge" }, t("admin.linkPending")),
            answered.has(inv.guestId)
              ? h("span", { class: "badge ok" }, t("admin.answered"))
              : h("span", { class: "badge" }, t("admin.notAnswered")),
          ),
        ),
        h("div", { class: "invite-actions" },
          !inv.claimedBy && h("button", { class: "btn small", type: "button", onclick: () => copy(inviteMessage(inv), t("admin.inviteCopiedShort")) }, t("admin.copyInvite")),
          h("button", { class: "btn small", type: "button", onclick: () => renewInvite(inv) }, t("admin.newLink")),
          h("button", { class: "btn small danger", type: "button", onclick: () => deleteInvite(inv) }, t("admin.delete")),
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
