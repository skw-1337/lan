// Catalogue des classiques de la LAN, avec leurs visuels (img/<clé>-card.jpg et img/<clé>-hero.jpg).
// Un jeu saisi par l'organisateur est reconnu par son nom ou un alias (« CS 1.6 », « War3 », « AoE2 »…).

export const norm = (s) => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const GAMES = [
  {
    key: "cs16", name: "Counter-Strike 1.6", genre: "FPS", year: 2003, pos: "85% 30%",
    aliases: ["counter strike", "counter strike 1 6", "cs", "cs 1 6", "cs16", "cs 16"],
  },
  {
    key: "wc3", name: "Warcraft III", genre: "RTS", year: 2002, pos: "50% 30%",
    aliases: ["warcraft 3", "warcraft iii", "wc3", "war3", "warcraft 3 frozen throne", "warcraft iii the frozen throne",
      "warcraft iii frozen throne", "warcraft 3 reign of chaos", "warcraft iii reign of chaos", "frozen throne", "tft"],
  },
  {
    key: "sc", name: "StarCraft", genre: "RTS", year: 1998, pos: "55% 40%",
    aliases: ["starcraft", "starcraft 1", "starcraft brood war", "brood war", "sc", "sc1", "sc bw", "starcraft remastered"],
  },
  {
    key: "aoe2", name: "Age of Empires II", genre: "RTS", year: 1999, pos: "88% 30%",
    aliases: ["age of empires", "age of empires 2", "age of empires ii", "aoe", "aoe2", "aoe 2", "aoe ii", "age of kings",
      "age of empires ii the age of kings", "age of empires 2 hd", "age of empires ii hd", "age of empires ii definitive edition", "aoe2 de"],
  },
  {
    key: "q3", name: "Quake III Arena", genre: "FPS", year: 1999, pos: "70% 40%",
    aliases: ["quake", "quake 3", "quake iii", "quake 3 arena", "quake iii arena", "q3", "q3a"],
  },
];

export const CATALOG = GAMES.map((g) => ({
  ...g,
  card: `img/${g.key}-card.jpg`,
  hero: `img/${g.key}-hero.jpg`,
  match: new Set([norm(g.name), ...g.aliases.map(norm)]),
}));

export function findGame(game) {
  if (!game) return null;
  return CATALOG.find((c) => c.key === game.key) || CATALOG.find((c) => c.match.has(norm(game.name))) || null;
}

// Teinte stable dérivée d'un texte, pour les avatars et les jeux sans visuel.
export function hue(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
