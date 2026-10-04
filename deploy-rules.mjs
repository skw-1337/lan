// Publie les règles Firestore en y insérant l'UID de l'organisateur.
// L'UID est lu dans .admin-uid, un fichier local ignoré par Git : il n'apparaît jamais sur GitHub.
// Usage : node deploy-rules.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const uid = readFileSync(new URL(".admin-uid", import.meta.url), "utf8").trim();
if (!/^[A-Za-z0-9]{20,40}$/.test(uid)) throw new Error("UID invalide dans .admin-uid");

const rules = readFileSync(new URL("firestore.rules", import.meta.url), "utf8");
const out = rules.replace("'UID_ORGANISATEUR'", `'${uid}'`);
if (out === rules) throw new Error("Marqueur 'UID_ORGANISATEUR' introuvable dans firestore.rules");

writeFileSync(new URL("firestore.deploy.rules", import.meta.url), out);
execSync("npx -y firebase-tools@15.32.1 deploy --only firestore:rules --non-interactive", {
  stdio: "inherit",
  cwd: new URL(".", import.meta.url),
});
