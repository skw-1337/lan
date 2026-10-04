# LAN party : planning des dispos

Petit site statique (GitHub Pages) + Firebase (Firestore et Authentication) pour organiser une fake LAN :
chaque invité reçoit un lien personnel, indique ses dispos et les jeux qui le tentent, et tout le monde voit qui vient.

- `index.html` : page des invités
- `admin.html` : page de l'organisateur (connexion Google)
- `firestore.rules` : règles de sécurité, publiées avec `node deploy-rules.mjs`

## Comment l'identité est vérifiée

1. L'organisateur crée un lien par personne (`…/#i=<code de 128 bits>`) et l'envoie en privé.
2. À la première ouverture, l'invité confirme « Oui, je suis X ». Le lien est alors lié à ce navigateur
   (compte anonyme Firebase) et ne peut plus être activé ailleurs.
3. Les règles Firestore garantissent qu'un invité ne peut écrire que sa propre réponse, sous le nom choisi
   par l'organisateur. Personne ne peut lire le planning sans lien activé.

Si quelqu'un d'autre ouvre un lien avant son destinataire, celui-ci voit « Lien déjà utilisé » et prévient
l'organisateur, qui clique sur **Nouveau lien** : l'ancien lien et l'appareil lié sont désactivés, les
réponses sont conservées. Même chose si un invité change de téléphone ou efface les données de son navigateur.

## Mise en place

1. **Firebase** ([console.firebase.google.com](https://console.firebase.google.com)) :
   - créer un projet ;
   - Authentication → activer les fournisseurs **Anonyme** et **Google** ;
   - Authentication → Paramètres → Domaines autorisés → ajouter `<pseudo>.github.io` ;
   - Firestore Database → créer la base (mode production, région Europe) ;
   - Paramètres du projet → Vos applications → Web → copier la config dans `js/firebase-config.js`.
2. **GitHub Pages** : pousser ce dossier dans un dépôt public, puis Settings → Pages →
   Deploy from a branch → `main` / `(root)`.
3. **Organisateur** : ouvrir `admin.html`, se connecter avec Google, copier l'UID affiché dans un fichier
   `.admin-uid` à la racine du projet. Ce fichier est ignoré par Git : l'UID n'est jamais publié sur GitHub.
4. **Règles** : `node deploy-rules.mjs` insère l'UID dans les règles et les publie sur Firebase.

## Utilisation

- Dans `admin.html`, remplir l'événement (titre, infos pratiques Radmin/Discord, dates, jeux) et enregistrer.
- Ajouter les invités un par un : le message d'invitation est copié automatiquement, à coller en privé.
- Pour participer soi-même : se créer une invitation et l'ouvrir.
