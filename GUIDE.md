# Nos Stickers — guide de mise en ligne

Compte environ 20 minutes. Tout est gratuit, aucune carte bancaire n'est demandée.

Fais tout ça depuis un ordinateur.

---

## Étape 1 — Supabase (la base de données et les photos)

### 1.1 Créer le compte et le projet
1. Va sur **supabase.com** et clique sur **Start your project**.
2. Inscris-toi (avec ton email, ou directement avec ton compte GitHub si tu le crées avant).
3. Clique sur **New project** :
   - **Name** : `nos-stickers`
   - **Database Password** : clique sur *Generate*, puis garde-le de côté. Tu n'en auras normalement plus besoin.
   - **Region** : *West EU (Paris)* ou la plus proche
   - Offre : **Free**
4. Clique sur **Create new project** et attends 1 à 2 minutes.

### 1.2 Préparer la base (copier-coller)
1. Dans le menu de gauche, ouvre **SQL Editor**.
2. Clique sur **New query**.
3. Ouvre le fichier `supabase-setup.sql` (avec le Bloc-notes ou TextEdit), copie **tout** le contenu et colle-le.
4. Clique sur **Run**. Tu dois voir *Success. No rows returned*.

### 1.3 Créer les 3 comptes
1. Menu de gauche : **Authentication** → **Users**.
2. Clique sur **Add user** → **Create new user**.
3. Mets l'email et un mot de passe, puis **coche « Auto Confirm User »**.
4. Recommence pour Adrien et Thomas. Tu leur donneras ensuite leur email et leur mot de passe.

### 1.4 Fermer les inscriptions
Pour que personne d'autre ne puisse se créer un compte :
**Authentication** → **Sign In / Providers** (ou **Settings**) → désactive **Allow new users to sign up** → **Save**.

### 1.5 Récupérer les 2 valeurs pour l'app
Va dans **Project Settings** (roue crantée en bas à gauche) :
- **Data API** (ou **API**) → copie le **Project URL**, du genre `https://abcdefgh.supabase.co`
- **API Keys** → copie la **Publishable key** (commence par `sb_publishable_`). Si tu ne la vois pas, prends la clé **anon public**.

⚠️ Ne prends **jamais** la clé *secret* ou *service_role*.

---

## Étape 2 — Brancher l'app sur Supabase

1. Ouvre le fichier `config.js` avec le Bloc-notes (Windows) ou TextEdit (Mac).
2. Colle les 2 valeurs entre les guillemets :
   ```js
   SUPABASE_URL: "https://abcdefgh.supabase.co",
   SUPABASE_KEY: "sb_publishable_xxxxxxxxxxxx"
   ```
3. Tu peux aussi changer `APP_NAME` si tu veux un autre nom.
4. Enregistre.

---

## Étape 3 — GitHub (mettre l'app en ligne)

### 3.1 Créer le compte et le dépôt
1. Va sur **github.com** et inscris-toi. Ton pseudo apparaîtra dans l'adresse de l'app.
2. En haut à droite, **+** → **New repository** :
   - **Repository name** : `nos-stickers`
   - Choisis **Public** (obligatoire pour l'hébergement gratuit)
   - Clique sur **Create repository**.

> Le code sera visible publiquement, mais **pas vos stickers ni vos photos** : ils sont protégés par vos comptes. La clé dans `config.js` est faite pour être publique.

### 3.2 Envoyer les fichiers
1. Sur la page du dépôt, clique sur **uploading an existing file**.
2. Glisse **tout le contenu** du dossier `nos-stickers` (les fichiers **et** le dossier `icons`). Ne glisse pas le dossier lui-même, mais ce qu'il contient.
3. En bas, clique sur **Commit changes**.

### 3.3 Activer l'hébergement
1. Dans le dépôt : **Settings** → **Pages** (menu de gauche).
2. **Source** : *Deploy from a branch*.
3. **Branch** : `main` et `/ (root)` → **Save**.
4. Attends 1 à 2 minutes, puis rafraîchis la page. L'adresse s'affiche en haut :
   **`https://TON-PSEUDO.github.io/nos-stickers/`**

C'est ce lien que tu envoies à Adrien et Thomas.

---

## Étape 4 — Installer l'app sur les téléphones

**Android (toi et Adrien)**
1. Ouvre le lien dans **Chrome**.
2. Menu **⋮** → **Installer l'application** (ou *Ajouter à l'écran d'accueil*).

**iPhone (Thomas)**
1. Ouvre le lien dans **Safari** (obligatoire, ça ne marche pas depuis Chrome ou Instagram sur iPhone).
2. Bouton **Partager** ⬆️ → **Sur l'écran d'accueil** → **Ajouter**.

Au premier lancement : connexion avec l'email et le mot de passe, puis chacun choisit son prénom. Accepte la localisation quand le téléphone la demande.

---

## Comment ça s'utilise

- **＋ Coller un sticker** : la carte se centre sur ta position. Ajuste en déplaçant la carte, puis **Poser ici**.
- Ajoute une photo et un petit mot, puis **Enregistrer**.
- Touche un pin pour voir la photo. Touche la photo pour l'afficher en grand.
- Chacun a sa couleur de pin. Tu peux supprimer uniquement les stickers que tu as posés.
- Le compteur en haut indique le nombre de stickers et de pays.

---

## À savoir

- **Pause Supabase** : si personne n'ouvre l'app pendant environ 7 jours, Supabase met le projet en pause. Rien n'est perdu. Va sur supabase.com, ouvre le projet et clique sur **Restore project**.
- **Place disponible** : 1 Go de photos gratuit. Les photos étant compressées (environ 300 Ko), ça fait à peu près 3 000 stickers.
- **Modifier l'app** : remplace le fichier sur GitHub (*Add file* → *Upload files*). Les téléphones récupèrent la nouvelle version à la prochaine ouverture.

## En cas de problème

| Ce que tu vois | Solution |
|---|---|
| « Presque prêt » au lancement | `config.js` n'est pas rempli ou pas envoyé sur GitHub |
| « Email ou mot de passe incorrect » | Vérifie le compte dans Supabase → Authentication → Users (et qu'il est bien confirmé) |
| « Impossible de charger la carte » | Le script SQL n'a pas été lancé, ou le projet Supabase est en pause |
| Erreur à l'envoi d'une photo | Relance le script SQL (étape 1.2), il peut être relancé sans risque |
| La position ne marche pas | Autorise la localisation pour le navigateur dans les réglages du téléphone |
