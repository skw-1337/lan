// Test des règles Firestore sur le vrai projet, avec des comptes anonymes jetables.
// 1. Un compte « admin de test » est créé, et des règles où il est organisateur sont publiées.
// 2. On rejoue les scénarios normaux et les tentatives de triche.
// 3. On nettoie les données et les comptes de test, et on republie les vraies règles (deploy-rules.mjs).
import { initializeApp } from "firebase/app";
import { initializeAuth, inMemoryPersistence, signInAnonymously, deleteUser } from "firebase/auth";
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp,
} from "firebase/firestore";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const firebaseConfig = {
  apiKey: "AIzaSyC3bF-cHAd6e3K63dcL-M5sdlCidBBFqWU",
  authDomain: "lan-party-3cd50.firebaseapp.com",
  projectId: "lan-party-3cd50",
  appId: "1:330196376501:web:71d53dc7884293186d97fc",
};
const DEPLOY = "npx -y firebase-tools@15.32.1 deploy --only firestore:rules --project lan-party-3cd50 --non-interactive";
const hex = (n) => randomBytes(n).toString("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const users = [];
async function newUser(label) {
  const app = initializeApp(firebaseConfig, `${label}-${users.length}`);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  const cred = await signInAnonymously(auth);
  const u = { label, auth, uid: cred.user.uid, db: getFirestore(app) };
  users.push(u);
  return u;
}

const results = [];
async function ok(name, fn) {
  try { await fn(); results.push([true, name]); } catch (e) { results.push([false, name, e.code || e.message]); }
}
async function denied(name, fn) {
  try { await fn(); results.push([false, name, "AUTORISÉ alors que ça devrait être refusé"]); } catch (e) {
    results.push([e.code === "permission-denied", name, e.code || e.message]);
  }
}

function claim(u, token, invite, overrides = {}) {
  const b = writeBatch(u.db);
  b.update(doc(u.db, "invites", token), { claimedBy: u.uid, claimedAt: serverTimestamp() });
  b.set(doc(u.db, "members", u.uid), {
    name: invite.name, guestId: invite.guestId, token, joinedAt: serverTimestamp(), ...overrides,
  });
  return b.commit();
}

const response = (name, extra = {}) => ({
  name, answers: { d1: "yes", d2: "maybe" }, games: ["g1"], comment: "test", updatedAt: serverTimestamp(), ...extra,
});

// ---------- 1. Règles de test ----------
const admin = await newUser("admin");
// Le vrai organisateur (.admin-uid) garde ses droits pendant le test : les deux comptes sont admins.
const realAdmin = readFileSync("../.admin-uid", "utf8").trim();
writeFileSync("test.rules", readFileSync("../firestore.rules", "utf8").replace(
  /(function isAdmin\(\) \{[^}]*)request\.auth\.uid == '[^']*'/,
  `$1request.auth.uid in ['${realAdmin}', '${admin.uid}']`,
));
writeFileSync("firebase.json", JSON.stringify({ firestore: { rules: "test.rules" } }));
console.log("Publication des règles de test…");
execSync(DEPLOY, { stdio: "inherit" });

// Le test ne touche jamais aux vraies données : il sonde un document à part (config/rules-test)
// et ne supprime à la fin que ce qu'il a lui-même créé.
const probe = doc(admin.db, "config", "rules-test");

// Les nouvelles règles mettent jusqu'à une minute à s'appliquer partout : on attend, puis on vérifie
// que l'admin de test est accepté plusieurs fois de suite avant de commencer.
console.log("Attente de la propagation des règles (environ 1 min 30)…");
await sleep(75000);
for (let ok = 0, i = 0; ok < 3; i++) {
  try { await setDoc(probe, { at: serverTimestamp() }); ok++; } catch (e) {
    ok = 0;
    if (i > 30) throw e;
  }
  await sleep(4000);
}

// Données de test, nommées pour ne jamais être confondues avec de vrais invités.
const tA = hex(16); const invA = { name: "Test Alice", guestId: hex(8) };
const tB = hex(16); const invB = { name: "Test Bob", guestId: hex(8) };
const tA2 = hex(16);
let cleaned = false;
async function cleanup() {
  const b = writeBatch(admin.db);
  for (const token of [tA, tB, tA2]) b.delete(doc(admin.db, "invites", token));
  for (const u of users) b.delete(doc(admin.db, "members", u.uid));
  for (const guestId of [invA.guestId, invB.guestId]) b.delete(doc(admin.db, "responses", guestId));
  b.delete(probe);
  await b.commit();
  cleaned = true;
}

try {
  // ---------- 2. Scénarios ----------
  const alice = await newUser("alice");
  const bob = await newUser("bob");
  const mallory = await newUser("mallory");

  // Inconnu sans invitation
  await denied("inconnu : lire l'événement", () => getDoc(doc(mallory.db, "config", "event")));
  await denied("inconnu : lister les réponses", () => getDocs(collection(mallory.db, "responses")));
  await denied("inconnu : lister les invitations", () => getDocs(collection(mallory.db, "invites")));
  await denied("inconnu : créer une invitation", () => setDoc(doc(mallory.db, "invites", hex(16)), { name: "X", guestId: hex(8), claimedBy: null, claimedAt: null }));
  await denied("inconnu : modifier l'événement", () => setDoc(doc(mallory.db, "config", "rules-test"), { title: "hack" }));
  await denied("inconnu : écrire une réponse", () => setDoc(doc(mallory.db, "responses", invA.guestId), response(invA.name)));
  await denied("inconnu : se déclarer membre sans invitation", () => setDoc(doc(mallory.db, "members", mallory.uid), { name: invA.name, guestId: invA.guestId, token: hex(16), joinedAt: serverTimestamp() }));

  // Organisateur
  await ok("organisateur : créer les invitations", async () => {
    await setDoc(doc(admin.db, "invites", tA), { ...invA, claimedBy: null, claimedAt: null, createdAt: serverTimestamp() });
    await setDoc(doc(admin.db, "invites", tB), { ...invB, claimedBy: null, claimedAt: null, createdAt: serverTimestamp() });
  });
  await ok("organisateur : lister les invitations", () => getDocs(collection(admin.db, "invites")));

  // Activation des liens
  await ok("invité : lire son invitation avec le lien", () => getDoc(doc(alice.db, "invites", tA)));
  await denied("invité : activer un lien sous un autre nom", () => claim(bob, tB, invB, { name: invA.name }));
  await denied("invité : activer un lien en prenant l'identifiant d'un autre", () => claim(bob, tB, invB, { guestId: invA.guestId }));
  await denied("invité : marquer le lien activé sans créer son profil", () => updateDoc(doc(bob.db, "invites", tB), { claimedBy: bob.uid, claimedAt: serverTimestamp() }));
  await ok("Alice : activer son lien", () => claim(alice, tA, invA));
  await ok("Bob : activer son lien", () => claim(bob, tB, invB));
  await denied("Mallory : réutiliser le lien d'Alice", () => claim(mallory, tA, invA));
  await denied("Mallory : se déclarer membre avec le lien d'Alice", () => setDoc(doc(mallory.db, "members", mallory.uid), { ...invA, token: tA, joinedAt: serverTimestamp() }));
  await denied("Mallory : rattacher le lien d'Alice à son compte", () => updateDoc(doc(mallory.db, "invites", tA), { claimedBy: mallory.uid }));
  await denied("Alice : activer aussi le lien de Bob", () => claim(alice, tB, invB));
  await denied("Mallory : lire l'événement après ses tentatives", () => getDoc(doc(mallory.db, "config", "event")));

  // Réponses
  await ok("Alice : lire l'événement", () => getDoc(doc(alice.db, "config", "event")));
  await ok("Alice : enregistrer sa réponse", () => setDoc(doc(alice.db, "responses", invA.guestId), response(invA.name)));
  await ok("Alice : modifier sa réponse", () => setDoc(doc(alice.db, "responses", invA.guestId), response(invA.name, { comment: "modifié" })));
  await ok("Alice : voir les réponses des autres", () => getDocs(collection(alice.db, "responses")));
  await denied("Alice : répondre sous le nom de Bob", () => setDoc(doc(alice.db, "responses", invA.guestId), response(invB.name)));
  await denied("Alice : écrire la réponse de Bob", () => setDoc(doc(alice.db, "responses", invB.guestId), response(invB.name)));
  await denied("Alice : réponse avec un champ en trop", () => setDoc(doc(alice.db, "responses", invA.guestId), response(invA.name, { admin: true })));
  await denied("Alice : réponse avec une valeur invalide", () => setDoc(doc(alice.db, "responses", invA.guestId), response(invA.name, { answers: { d1: "<script>" } })));
  await denied("Alice : commentaire trop long", () => setDoc(doc(alice.db, "responses", invA.guestId), response(invA.name, { comment: "x".repeat(501) })));
  await ok("Alice : proposer un autre jeu", () => setDoc(doc(alice.db, "responses", invA.guestId), response(invA.name, { suggestion: "Trackmania" })));
  await denied("Alice : jeu proposé trop long", () => setDoc(doc(alice.db, "responses", invA.guestId), response(invA.name, { suggestion: "x".repeat(41) })));
  await denied("Alice : jeu proposé qui n'est pas du texte", () => setDoc(doc(alice.db, "responses", invA.guestId), response(invA.name, { suggestion: { html: "<b>" } })));
  await denied("Alice : supprimer la réponse de Bob", () => deleteDoc(doc(alice.db, "responses", invB.guestId)));
  await denied("Alice : lister les invitations (et leurs liens)", () => getDocs(collection(alice.db, "invites")));
  await denied("Alice : lire le profil de Bob (qui contient son lien)", () => getDoc(doc(alice.db, "members", bob.uid)));
  await denied("Alice : modifier l'événement", () => setDoc(doc(alice.db, "config", "rules-test"), { title: "hack" }));
  await denied("Alice : se créer une invitation", () => setDoc(doc(alice.db, "invites", hex(16)), { name: "Faux", guestId: hex(8), claimedBy: null, claimedAt: null }));

  // Nouveau lien : l'ancien appareil perd l'accès
  await ok("organisateur : refaire un lien pour Alice", async () => {
    const b = writeBatch(admin.db);
    b.set(doc(admin.db, "invites", tA2), { ...invA, claimedBy: null, claimedAt: null, createdAt: serverTimestamp() });
    b.delete(doc(admin.db, "invites", tA));
    b.delete(doc(admin.db, "members", alice.uid));
    await b.commit();
  });
  await denied("ancien appareil d'Alice : écrire après le nouveau lien", () => setDoc(doc(alice.db, "responses", invA.guestId), response(invA.name)));
  await denied("ancien appareil d'Alice : lire après le nouveau lien", () => getDoc(doc(alice.db, "config", "event")));
  await ok("Mallory : l'ancien lien d'Alice est devenu invalide", async () => {
    const snap = await getDoc(doc(mallory.db, "invites", tA));
    if (snap.exists()) throw new Error("l'ancien lien existe encore");
  });
  const alice2 = await newUser("alice-nouvel-appareil");
  await ok("Alice : activer le nouveau lien sur un autre appareil", () => claim(alice2, tA2, invA));
  await ok("Alice : retrouver et modifier sa réponse", () => setDoc(doc(alice2.db, "responses", invA.guestId), response(invA.name)));

  // Nettoyage : uniquement les documents créés par ce test
  await ok("organisateur : supprimer les données de test", cleanup);
} finally {
  if (!cleaned) await cleanup().catch((e) => console.error("Nettoyage incomplet :", e.code || e.message));
  for (const u of users) {
    await deleteUser(u.auth.currentUser).catch((e) => console.error(`Compte de test ${u.label} non supprimé :`, e.code || e.message));
  }
  // ---------- 3. Retour aux vraies règles ----------
  console.log("\nRepublication des vraies règles…");
  execSync("node deploy-rules.mjs", { stdio: "inherit", cwd: ".." });
}

console.log("\nRésultats :");
for (const [pass, name, info] of results) console.log(`${pass ? "OK  " : "ÉCHEC"}  ${name}${pass ? "" : `  →  ${info}`}`);
const failed = results.filter((r) => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
