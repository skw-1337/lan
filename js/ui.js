// Fonctions d'affichage partagées par la page invité et la page admin.
// Tout le texte saisi passe par textContent (jamais innerHTML).

export const ANSWERS = {
  yes: { label: "Oui", icon: "✔" },
  maybe: { label: "Peut-être", icon: "~" },
  no: { label: "Non", icon: "✖" },
};

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const shortFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const longFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const stampFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function parseIso(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

export function formatDate(iso, long = false) {
  const date = parseIso(iso);
  return date ? (long ? longFmt : shortFmt).format(date) : "Date à définir";
}

export function formatStamp(ts) {
  const date = ts?.toDate?.();
  return date ? stampFmt.format(date) : "";
}

export function sortDates(dates = []) {
  return [...dates].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// Transforme les URL http(s) en liens cliquables, le reste reste du texte brut.
export function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /https?:\/\/[^\s<>"]+/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const url = m[0].replace(/[.,;:!?)]+$/, "");
    frag.append(text.slice(last, m.index), h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, url));
    last = m.index + url.length;
    re.lastIndex = last;
  }
  frag.append(text.slice(last));
  return frag;
}

export function toast(message) {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast", class: "toast", role: "status" });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), 2600);
}

export function errorMessage(err) {
  if (err?.code === "permission-denied") return "Accès refusé par la base de données.";
  if (err?.code === "unavailable") return "Connexion impossible. Vérifie ta connexion internet.";
  return err?.message || String(err);
}

function tally(dates, responses) {
  return dates.map((d) => {
    let yes = 0;
    let maybe = 0;
    for (const r of responses) {
      const a = r.answers?.[d.id];
      if (a === "yes") yes++;
      else if (a === "maybe") maybe++;
    }
    return { date: d, yes, maybe };
  });
}

function pickBest(counts) {
  let best = null;
  for (const c of counts) {
    if (c.yes === 0) continue;
    if (!best || c.yes > best.yes || (c.yes === best.yes && c.maybe > best.maybe)) best = c;
  }
  return best;
}

// Tableau des réponses : dates en colonnes, joueurs en lignes, puis jeux et commentaires.
export function renderBoard(el, { event, responses, meId = null, waiting = [] }) {
  el.replaceChildren();
  const dates = sortDates(event?.dates);
  const games = event?.games || [];
  const rows = [...responses].sort((a, b) => a.name.localeCompare(b.name, "fr"));

  if (!rows.length) {
    el.append(h("p", { class: "muted" }, "Personne n'a encore répondu."));
  } else if (dates.length) {
    const counts = tally(dates, rows);
    const best = pickBest(counts);
    if (best) {
      el.append(
        h("div", { class: "best" },
          h("span", { class: "best-kicker" }, "Meilleure date pour l'instant"),
          h("strong", {}, formatDate(best.date.date, true)),
          best.date.label && h("span", { class: "best-label" }, best.date.label),
          h("span", { class: "best-count" },
            `${best.yes} oui`, best.maybe ? ` · ${best.maybe} peut-être` : ""),
        ),
      );
    }

    const isBest = (d) => best && d.id === best.date.id;
    const table = h("table", { class: "board" },
      h("thead", {},
        h("tr", {},
          h("th", { scope: "col" }, "Joueur"),
          dates.map((d) =>
            h("th", { scope: "col", class: isBest(d) ? "is-best" : null },
              h("span", { class: "th-date" }, formatDate(d.date)),
              d.label && h("span", { class: "th-label" }, d.label),
            ),
          ),
        ),
      ),
      h("tbody", {},
        rows.map((r) =>
          h("tr", { class: r.id === meId ? "is-me" : null },
            h("th", { scope: "row" }, r.name, r.id === meId && h("span", { class: "me-tag" }, "toi")),
            dates.map((d) => {
              const a = r.answers?.[d.id];
              const info = ANSWERS[a];
              return h("td", { class: [a || "none", isBest(d) ? "is-best" : ""].join(" "), title: info?.label || "Pas répondu" },
                h("span", { "aria-label": info?.label || "Pas répondu" }, info?.icon || "·"),
              );
            }),
          ),
        ),
      ),
      h("tfoot", {},
        h("tr", {},
          h("th", { scope: "row" }, "Partants"),
          counts.map((c) =>
            h("td", { class: isBest(c.date) ? "is-best" : null },
              h("strong", {}, c.yes),
              c.maybe ? h("span", { class: "maybe-count" }, ` +${c.maybe}?`) : null,
            ),
          ),
        ),
      ),
    );
    el.append(h("div", { class: "table-wrap" }, table));
  } else {
    el.append(h("p", { class: "muted" }, "Aucune date proposée pour l'instant."));
  }

  if (waiting.length) {
    el.append(
      h("p", { class: "waiting" },
        h("strong", {}, "Pas encore répondu : "),
        [...waiting].sort((a, b) => a.localeCompare(b, "fr")).join(", "),
      ),
    );
  }

  if (games.length && rows.length) {
    const votes = games
      .map((g) => ({ game: g, voters: rows.filter((r) => r.games?.includes(g.id)).map((r) => r.name) }))
      .sort((a, b) => b.voters.length - a.voters.length || a.game.name.localeCompare(b.game.name, "fr"));
    const max = Math.max(1, ...votes.map((v) => v.voters.length));
    el.append(
      h("h3", {}, "Jeux les plus demandés"),
      h("ul", { class: "votes" },
        votes.map((v) =>
          h("li", {},
            h("div", { class: "vote-head" },
              h("span", { class: "vote-name" }, v.game.name),
              h("span", { class: "vote-count" }, v.voters.length),
            ),
            h("div", { class: "bar" }, h("span", { style: `width:${(v.voters.length / max) * 100}%` })),
            v.voters.length ? h("div", { class: "vote-who" }, v.voters.join(", ")) : null,
          ),
        ),
      ),
    );
  }

  const comments = rows.filter((r) => r.comment);
  if (comments.length) {
    el.append(
      h("h3", {}, "Commentaires"),
      h("ul", { class: "comments" },
        comments.map((r) => h("li", {}, h("strong", {}, r.name), h("p", {}, r.comment))),
      ),
    );
  }
}
