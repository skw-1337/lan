// Fonctions d'affichage partagées par la page invité et la page admin.
// Tout le texte saisi passe par textContent (jamais innerHTML).
import { CATALOG, findGame, hue, norm } from "./games.js";
import { t, locale } from "./i18n.js";

export const ANSWERS = {
  yes: { icon: "✔", get label() { return t("ans.yes"); } },
  maybe: { icon: "~", get label() { return t("ans.maybe"); } },
  no: { icon: "✖", get label() { return t("ans.no"); } },
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

// Icônes SVG fixes (chaînes constantes du code, jamais de données saisies).
const ICONS = {
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a4 4 0 0 1-4 4M7 5H4v2a4 4 0 0 0 4 4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
};
export function icon(name, cls = "icon") {
  const t = document.createElement("template");
  t.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return t.content.firstChild;
}

// Formats de date dans la langue choisie (recréés si la langue change).
const formats = new Map();
function fmt(options) {
  const key = locale() + JSON.stringify(options);
  if (!formats.has(key)) formats.set(key, new Intl.DateTimeFormat(locale(), options));
  return formats.get(key);
}

function parseIso(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

export function formatDate(iso, long = false) {
  const date = parseIso(iso);
  if (!date) return t("date.tbd");
  return fmt(long ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "short" }).format(date);
}

export function dateParts(iso) {
  const date = parseIso(iso);
  if (!date) return { weekday: "", day: "?", month: "" };
  return {
    weekday: fmt({ weekday: "short" }).format(date),
    day: fmt({ day: "numeric" }).format(date),
    month: fmt({ month: "short" }).format(date),
  };
}

export function formatStamp(ts) {
  const date = ts?.toDate?.();
  return date ? fmt({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date) : "";
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
  if (err?.code === "permission-denied") return t("err.denied");
  if (err?.code === "unavailable") return t("err.offline");
  return err?.message || String(err);
}

// Barre du haut : devient opaque dès qu'on fait défiler la page.
export function initTopbar() {
  const bar = document.querySelector(".topbar");
  if (!bar) return;
  const update = () => bar.classList.toggle("scrolled", scrollY > 8);
  update();
  addEventListener("scroll", update, { passive: true });
}

export function avatar(name, cls = "avatar") {
  return h("span", { class: cls, style: `--h:${hue(name)}`, "aria-hidden": "true" }, String(name).trim().charAt(0) || "?");
}

// Visuel d'un jeu : l'illustration du catalogue, sinon une tuile colorée avec l'initiale.
export function gameArt(game, cls) {
  const info = findGame(game);
  if (info) return h("img", { class: cls, src: info.card, alt: "", loading: "lazy", decoding: "async" });
  return h("span", { class: `${cls} art-placeholder`, style: `--h:${hue(game.name)}`, "aria-hidden": "true" }, String(game.name).trim().charAt(0));
}

// Cartes du line-up. Sans jeux configurés, on présente les classiques du catalogue.
export function renderLineup(el, { games, responses = null } = {}) {
  const fromEvent = Boolean(games?.length);
  const list = fromEvent ? games : CATALOG.map((c) => ({ id: c.key, name: c.name, key: c.key }));
  el.replaceChildren(...list.map((g, i) => {
    const info = findGame(g);
    const voters = fromEvent && responses ? responses.filter((r) => r.games?.includes(g.id)).length : null;
    return h("article", { class: "game" },
      gameArt(g, "game-art"),
      h("span", { class: "game-index" }, String(i + 1).padStart(2, "0")),
      info && h("span", { class: "game-tag" }, info.genre),
      h("div", { class: "game-body" },
        h("h3", { class: "game-name" }, g.name),
        h("p", { class: "game-meta" },
          info && h("span", {}, String(info.year)),
          voters != null && h("span", { class: "game-votes" }, t(voters > 1 ? "lineup.many" : "lineup.one", { n: voters })),
        ),
      ),
    );
  }));
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

export function bestDate(event, responses) {
  return pickBest(tally(sortDates(event?.dates), responses));
}

// Jeux proposés librement par les joueurs (« Autre »), regroupés quel que soit l'écriture.
export function groupSuggestions(responses) {
  const groups = new Map();
  for (const r of responses) {
    const name = String(r.suggestion || "").trim();
    if (!name) continue;
    const key = norm(name);
    if (!groups.has(key)) groups.set(key, { name, voters: [] });
    groups.get(key).voters.push(r.name);
  }
  return [...groups.values()].sort((a, b) => b.voters.length - a.voters.length || a.name.localeCompare(b.name, "fr"));
}

// Tableau des réponses façon scoreboard : dates en colonnes, joueurs en lignes, puis jeux et commentaires.
export function renderBoard(el, { event, responses, meId = null, waiting = [] }) {
  el.replaceChildren();
  const dates = sortDates(event?.dates);
  const games = event?.games || [];
  const rows = [...responses].sort((a, b) => a.name.localeCompare(b.name, "fr"));

  if (!rows.length) {
    el.append(h("p", { class: "empty" }, t("board.empty")));
  } else if (dates.length) {
    const counts = tally(dates, rows);
    const best = pickBest(counts);
    if (best) {
      el.append(
        h("div", { class: "best" },
          icon("trophy", "best-icon"),
          h("div", { class: "best-text" },
            h("span", { class: "best-kicker" }, t("board.best")),
            h("strong", {}, formatDate(best.date.date, true)),
            h("span", { class: "best-count" },
              [best.date.label, t("board.yesCount", { n: best.yes }), best.maybe ? t("board.maybeCount", { n: best.maybe }) : ""].filter(Boolean).join(" · ")),
          ),
        ),
      );
    }

    const isBest = (d) => best && d.id === best.date.id;
    const table = h("table", { class: "board" },
      h("thead", {},
        h("tr", {},
          h("th", { scope: "col", class: "col-player" }, t("board.player")),
          dates.map((d) => {
            const p = dateParts(d.date);
            return h("th", { scope: "col", class: isBest(d) ? "is-best" : null },
              h("span", { class: "th-week" }, p.weekday, isBest(d) && h("span", { class: "top-badge" }, t("board.top"))),
              h("span", { class: "th-day" }, `${p.day} ${p.month}`),
              d.label && h("span", { class: "th-label" }, d.label),
            );
          }),
        ),
      ),
      h("tbody", {},
        rows.map((r) =>
          h("tr", { class: r.id === meId ? "is-me" : null },
            h("th", { scope: "row" },
              h("span", { class: "player" },
                avatar(r.name, "avatar small"),
                h("span", { class: "player-name" }, r.name),
                r.id === meId && h("span", { class: "me-tag" }, t("board.you")),
              ),
            ),
            dates.map((d) => {
              const a = r.answers?.[d.id];
              const info = ANSWERS[a];
              const label = info?.label || t("ans.none");
              return h("td", { class: [a || "none", isBest(d) ? "is-best" : ""].join(" ").trim(), title: label },
                h("span", { class: "cell", "aria-label": label }, info?.icon || "·"),
              );
            }),
          ),
        ),
      ),
      h("tfoot", {},
        h("tr", {},
          h("th", { scope: "row" }, t("board.total")),
          counts.map((c) =>
            h("td", { class: isBest(c.date) ? "is-best" : null },
              h("strong", {}, c.yes),
              c.maybe ? h("span", { class: "maybe-count", title: t("board.maybeCount", { n: c.maybe }) }, ` +${c.maybe}?`) : null,
            ),
          ),
        ),
      ),
    );
    el.append(h("div", { class: "table-wrap" }, table));
  } else {
    el.append(h("p", { class: "empty" }, t("board.noDates")));
  }

  if (waiting.length) {
    el.append(
      h("p", { class: "waiting" },
        h("strong", {}, t("board.waiting")),
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
      h("h3", {}, t("board.votes")),
      h("ol", { class: "votes" },
        votes.map((v) =>
          h("li", { class: "vote" },
            gameArt(v.game, "vote-art"),
            h("span", { class: "vote-name" }, v.game.name),
            h("span", { class: "vote-count" }, v.voters.length),
            h("div", { class: "bar" }, h("span", { style: `width:${(v.voters.length / max) * 100}%` })),
            h("div", { class: "vote-who" }, v.voters.length ? v.voters.join(", ") : t("board.nobody")),
          ),
        ),
      ),
    );
  }

  const suggestions = groupSuggestions(rows);
  if (suggestions.length) {
    el.append(
      h("h3", {}, t("board.suggestions")),
      h("ul", { class: "suggestions" },
        suggestions.map((s) =>
          h("li", { class: "suggestion" },
            gameArt({ name: s.name }, "sugg-art"),
            h("span", { class: "sugg-name" }, s.name),
            h("span", { class: "sugg-who" }, t("board.suggestedBy", { names: s.voters.join(", ") })),
          ),
        ),
      ),
    );
  }

  const comments = rows.filter((r) => r.comment);
  if (comments.length) {
    el.append(
      h("h3", {}, t("board.comments")),
      h("ul", { class: "comments" },
        comments.map((r) =>
          h("li", { class: "comment" },
            avatar(r.name),
            h("div", { class: "comment-body" }, h("strong", {}, r.name), h("p", {}, r.comment)),
          ),
        ),
      ),
    );
  }
}
