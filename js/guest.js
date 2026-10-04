import {
  configured, auth, db, onAuthStateChanged, signInAnonymously,
  doc, collection, getDoc, setDoc, onSnapshot, writeBatch, serverTimestamp,
} from "./firebase.js";
import {
  ANSWERS, h, avatar, gameArt, dateParts, formatDate, sortDates, linkify, renderBoard, renderLineup, bestDate,
  initTopbar, toast, errorMessage,
} from "./ui.js";
import { t, initLangSwitch, onLangChange } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const stateEl = $("state");

initLangSwitch();
initTopbar();
renderLineup($("lineup-grid"));
$("description").textContent = t("hero.tagline");

// Écran d'état courant (chargement, lien invalide, validation…), rejoué si la langue change.
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
  setState(() => showState(t("common.oops"), errorMessage(err), t("common.retry")));
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
  setState(() => showState(t("common.notConfigured"), t("common.missingConfig")));
} else {
  setState(() => showState(t("common.loading")));
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
    setState(() => showState(
      t("guest.inviteOnly"),
      t("guest.inviteOnlyText"),
      h("p", { class: "hint" }, t("guest.inviteOnlyHint")),
    ));
  }
}

async function showInvite(user, token) {
  const snap = await getDoc(doc(db, "invites", token));
  if (!snap.exists()) {
    return setState(() => showState(t("guest.invalid"), t("guest.invalidText")));
  }
  const invite = snap.data();
  if (invite.claimedBy) {
    return setState(() => showState(t("guest.used"), t("guest.usedText"), t("guest.usedHint")));
  }

  async function claim(e) {
    e.currentTarget.disabled = true;
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
  }

  setState(() => showState(
    t("guest.hello", { name: invite.name }),
    t("guest.claimText"),
    h("p", { class: "hint" }, t("guest.claimHint")),
    h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", onclick: claim }, t("guest.claimButton", { name: invite.name })),
    ),
    h("p", { class: "hint" }, t("guest.notMe", { name: invite.name })),
  ));
}

let appOpen = false;
let me = null;
let event = null;
let responses = [];
let draft = null;
let dirty = false;

function openApp(member) {
  me = member;
  appOpen = true;
  currentState = null;
  stateEl.hidden = true;
  $("app").hidden = false;
  $("hero-stats").hidden = false;
  $("hero-actions").hidden = false;
  if (!me) {
    $("reponse").hidden = true;
    $("cta-answer").hidden = true;
  }
  renderWhoami();

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
      draft = {
        answers: { ...mine?.answers },
        games: [...(mine?.games || [])],
        comment: mine?.comment || "",
        suggestion: mine?.suggestion || "",
        suggestOpen: Boolean(mine?.suggestion),
      };
      renderForm();
    }
    renderResults();
  }, showError);

  addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });
}

onLangChange(() => {
  if (!appOpen) {
    currentState?.();
    renderLineup($("lineup-grid"));
    $("description").textContent = t("hero.tagline");
    return;
  }
  renderWhoami();
  renderHeader();
  renderForm();
  renderResults();
});

function renderWhoami() {
  const el = $("whoami");
  if (me) {
    el.replaceChildren(
      avatar(me.name, "avatar small"),
      h("span", {}, h("span", { class: "whoami-label" }, t("guest.signedIn"), " "), h("strong", {}, me.name)),
    );
  } else {
    el.replaceChildren(h("span", {}, t("guest.readOnly")), h("a", { href: "admin.html" }, t("guest.admin")));
  }
  el.hidden = false;
}

function renderHeader() {
  const title = event?.title || "LAN party";
  document.title = title;
  $("title").textContent = title;
  $("description").textContent = event?.description || t("hero.tagline");
  const info = event?.info?.trim();
  $("info-card").hidden = !info;
  $("info").replaceChildren(info ? linkify(info) : "");
}

function setDirty(value) {
  dirty = value;
  $("save-status").textContent = value ? t("guest.unsaved") : "";
  $("form-footer").classList.toggle("dirty", value);
}

function renderForm() {
  if (!me || !draft) return;
  const form = $("form");
  if (!event) {
    form.replaceChildren(h("p", { class: "empty" }, t("guest.noDatesYet")));
    return;
  }
  const dates = sortDates(event.dates);
  const games = event.games || [];

  const dateRows = dates.map((d) => {
    const labelId = `date-${d.id}`;
    const p = dateParts(d.date);
    return h("div", { class: "date-row" },
      h("div", { class: "date-tile", "aria-hidden": "true" },
        h("span", { class: "dt-day" }, p.day),
        h("span", { class: "dt-month" }, p.month),
      ),
      h("div", { class: "date-text", id: labelId },
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
            h("span", {}, h("i", { "aria-hidden": "true" }, a.icon), a.label),
          ),
        ),
      ),
    );
  });

  const picks = games.map((g) =>
    h("label", { class: "pick" },
      h("input", {
        type: "checkbox", checked: draft.games.includes(g.id),
        onchange: (e) => {
          draft.games = e.target.checked ? [...draft.games, g.id] : draft.games.filter((id) => id !== g.id);
          setDirty(true);
        },
      }),
      gameArt(g, "pick-art"),
      h("span", { class: "pick-name" }, g.name),
      h("span", { class: "pick-check", "aria-hidden": "true" }, "✔"),
      h("span", { class: "pick-frame", "aria-hidden": "true" }),
    ),
  );

  // « Autre » : le joueur propose un jeu qui n'est pas dans la liste.
  const suggestBox = h("div", { class: "suggest", hidden: !draft.suggestOpen },
    h("label", { for: "suggestion" }, t("guest.suggestLabel")),
    h("input", {
      id: "suggestion", type: "text", maxlength: 40, value: draft.suggestion,
      placeholder: t("guest.suggestPlaceholder"),
      oninput: (e) => { draft.suggestion = e.target.value; setDirty(true); },
    }),
  );
  const otherPick = h("label", { class: "pick pick-other" },
    h("input", {
      type: "checkbox", checked: draft.suggestOpen,
      onchange: (e) => {
        draft.suggestOpen = e.target.checked;
        suggestBox.hidden = !e.target.checked;
        if (e.target.checked) suggestBox.querySelector("input").focus();
        setDirty(true);
      },
    }),
    h("span", { class: "pick-art art-other", "aria-hidden": "true" }, "+"),
    h("span", { class: "pick-name" }, t("guest.other")),
    h("span", { class: "pick-check", "aria-hidden": "true" }, "✔"),
    h("span", { class: "pick-frame", "aria-hidden": "true" }),
  );

  form.replaceChildren(
    h("h3", {}, t("guest.yourDates")),
    dates.length ? h("div", { class: "dates" }, dateRows) : h("p", { class: "empty" }, t("guest.noDates")),
    h("h3", {}, t("guest.games")),
    h("div", { class: "picks" }, picks, otherPick),
    suggestBox,
    h("h3", {}, h("label", { for: "comment" }, t("guest.comment"))),
    h("textarea", {
      id: "comment", rows: 3, maxlength: 500, value: draft.comment,
      placeholder: t("guest.commentPlaceholder"),
      oninput: (e) => { draft.comment = e.target.value; setDirty(true); },
    }),
    h("div", { class: "form-footer", id: "form-footer" },
      h("button", { class: "btn primary", type: "submit" }, t("guest.save")),
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
      suggestion: draft.suggestOpen ? draft.suggestion.trim().replace(/\s+/g, " ").slice(0, 40) : "",
      updatedAt: serverTimestamp(),
    });
    setDirty(false);
    toast(t("guest.saved"));
  } catch (err) {
    toast(t("guest.saveFailed", { err: errorMessage(err) }));
  } finally {
    button.disabled = false;
  }
});

function renderResults() {
  renderBoard($("board"), { event, responses, meId: me?.guestId });
  renderLineup($("lineup-grid"), { games: event?.games, responses });
  const best = bestDate(event, responses);
  $("stat-dates").textContent = event?.dates?.length ?? 0;
  $("stat-answers").textContent = responses.length;
  $("stat-best").textContent = best ? formatDate(best.date.date) : "—";
}
