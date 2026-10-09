/* TrioBros — carte partagée de stickers */
(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const PALETTE = ["#ff5a4e", "#10a99a", "#f7a400", "#7b5cff", "#e0458f", "#3fae4a"];
  const BUCKET = "photos";

  let sb = null;          // client Supabase
  let user = null;        // utilisateur connecté
  let map = null;
  let markersLayer = null;
  let meMarker = null;
  let pins = [];
  let firstFit = true;
  let newPinLatLng = null;
  let chosenFile = null;
  let currentPin = null;
  let deferredInstall = null;
  let profiles = {};        // id -> { id, name, avatar_path }
  let avatarUrls = {};      // chemin -> URL signée
  let profilesReady = true; // false si la table profiles n'existe pas encore
  let avatarFile = null;
  let shownProfile = null;
  let photoUrls = {};       // chemin photo -> URL signée
  let albumFilter = "all";
  let albumList = [];       // stickers affichés dans l'album (ordre)
  let viewerIndex = 0;

  /* ---------------- Utilitaires ---------------- */
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
  }

  function show(id) { $(id).classList.remove("hidden"); }
  function hide(id) { $(id).classList.add("hidden"); }

  function openSheet(id) {
    document.querySelectorAll(".sheet.open").forEach((s) => s.classList.remove("open"));
    $(id).classList.add("open");
    $("#backdrop").classList.add("on");
  }
  function closeSheets() {
    document.querySelectorAll(".sheet.open").forEach((s) => s.classList.remove("open"));
    $("#backdrop").classList.remove("on");
  }

  function colorFor(id) {
    let h = 0;
    for (const ch of String(id || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  function todayISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function formatDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function nameOf(uid, fallback) {
    const p = profiles[uid];
    if (p && p.name) return p.name;
    if (user && uid === user.id && user.user_metadata && user.user_metadata.name) return user.user_metadata.name;
    return fallback || "";
  }
  function myName() { return user ? nameOf(user.id) : ""; }

  function avatarUrl(uid) {
    const p = profiles[uid];
    return p && p.avatar_path ? avatarUrls[p.avatar_path] || null : null;
  }

  // Remplit un élément .avatar : photo si dispo, sinon initiale sur la couleur de la personne
  function setAvatar(el, uid, fallbackName) {
    el.style.setProperty("--c", colorFor(uid));
    el.textContent = "";
    const url = avatarUrl(uid);
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      el.appendChild(img);
    } else {
      el.textContent = (nameOf(uid, fallbackName) || "?").trim().charAt(0).toUpperCase();
    }
  }

  function crewIds() {
    const ids = new Set(Object.keys(profiles));
    pins.forEach((p) => ids.add(p.created_by));
    if (user) ids.add(user.id);
    return [...ids].sort((a, b) => (a === user.id ? -1 : b === user.id ? 1 : nameOf(a).localeCompare(nameOf(b))));
  }

  /* ---------------- Profils ---------------- */
  async function loadProfiles() {
    const { data, error } = await sb.from("profiles").select("*");
    if (error) {
      profilesReady = false;
      console.warn("profiles:", error.message);
      return;
    }
    profilesReady = true;
    profiles = Object.fromEntries((data || []).map((p) => [p.id, p]));
    const missing = data.map((p) => p.avatar_path).filter((path) => path && !avatarUrls[path]);
    if (missing.length) {
      const res = await sb.storage.from(BUCKET).createSignedUrls(missing, 60 * 60 * 24 * 7);
      (res.data || []).forEach((u) => { if (u.signedUrl) avatarUrls[u.path] = u.signedUrl; });
    }
    refreshAvatars();
  }

  function refreshAvatars() {
    if (!user) return;
    setAvatar($("#meAvatar"), user.id);
    if (markersLayer) renderPins();
    if (shownProfile && $("#profileSheet").classList.contains("open")) renderProfile(shownProfile);
    if (!$("#album").classList.contains("hidden")) renderAlbum();
  }

  /* ---------------- Démarrage ---------------- */
  async function init() {
    const name = cfg.APP_NAME && cfg.APP_NAME !== "Nos Stickers" ? cfg.APP_NAME : "TrioBros";
    document.title = name;
    document.querySelectorAll(".app-name").forEach((el) => (el.textContent = name));

    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY || !window.supabase) {
      show("#setup");
      return;
    }

    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });

    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") location.reload();
    });

    const { data } = await sb.auth.getSession();
    if (data && data.session) {
      user = data.session.user;
      startApp();
    } else {
      show("#login");
    }
  }

  /* ---------------- Connexion ---------------- */
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#loginBtn");
    btn.disabled = true;
    btn.textContent = "Connexion…";
    hide("#loginError");
    const { data, error } = await sb.auth.signInWithPassword({
      email: $("#email").value.trim(),
      password: $("#password").value
    });
    btn.disabled = false;
    btn.textContent = "Se connecter";
    if (error) {
      const m = (error.message || "").toLowerCase();
      let msg;
      if (m.includes("invalid login credentials")) msg = "Email ou mot de passe incorrect.";
      else if (m.includes("email not confirmed")) msg = "Compte pas encore confirmé dans Supabase (case « Auto Confirm User »).";
      else if (m.includes("api key") || m.includes("apikey") || m.includes("jwt")) msg = "Clé Supabase invalide dans config.js.";
      else if (m.includes("fetch") || m.includes("network")) msg = "Supabase injoignable : vérifie l'adresse dans config.js, ou le projet est en pause.";
      else msg = "Erreur : " + error.message;
      $("#loginError").textContent = msg;
      show("#loginError");
      return;
    }
    user = data.user;
    hide("#login");
    startApp();
  });

  function startApp() {
    hide("#login");
    show("#app");
    initMap();
    setAvatar($("#meAvatar"), user.id);
    loadProfiles().then(() => {
      if (!myName() || (profilesReady && !profiles[user.id])) openEdit(true);
    });
    loadPins();
    sb.channel("pins-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "pins" }, () => loadPins())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadProfiles())
      .subscribe();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") { loadProfiles(); loadPins(); }
    });
  }

  /* ---------------- Carte ---------------- */
  function initMap() {
    if (map) return;
    map = L.map("map", {
      zoomControl: false,
      worldCopyJump: true,
      minZoom: 2,
      rotate: true,          // rotation de la carte (plugin leaflet-rotate)
      touchRotate: true,     // tourner avec deux doigts
      rotateControl: false,  // on utilise notre propre boussole
      bearing: 0
    }).setView([46.6, 2.5], 3);
    map.on("rotate", updateCompass);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 100);
  }

  function pinIcon(pin) {
    const url = avatarUrl(pin.created_by);
    const inner = url ? `<img src="${url}" alt="">` : "<span></span>";
    return L.divIcon({
      className: "sticker-marker",
      html: `<div class="pin${url ? " has-av" : ""}" style="--c:${colorFor(pin.created_by)}">${inner}</div>`,
      iconSize: url ? [42, 42] : [34, 34],
      iconAnchor: url ? [21, 50] : [17, 40]
    });
  }

  async function loadPins() {
    if (!sb) return;
    const { data, error } = await sb.from("pins").select("*").order("stuck_on", { ascending: true });
    if (error) {
      toast("Impossible de charger la carte : " + error.message, 4000);
      return;
    }
    pins = data || [];
    renderPins();
    if (shownProfile && $("#profileSheet").classList.contains("open")) renderProfile(shownProfile);
    if (!$("#album").classList.contains("hidden")) renderAlbum();
  }

  function renderPins() {
    markersLayer.clearLayers();
    pins.forEach((p) => {
      L.marker([p.lat, p.lng], { icon: pinIcon(p), riseOnHover: true })
        .on("click", () => openDetail(p))
        .addTo(markersLayer);
    });

    const n = pins.length;
    const countries = new Set(pins.map((p) => p.country).filter(Boolean)).size;
    $("#counter").textContent =
      n === 0
        ? "Aucun sticker pour l'instant"
        : `${n} sticker${n > 1 ? "s" : ""} · ${countries} pays`;

    if (firstFit && n > 0) {
      firstFit = false;
      const b = L.latLngBounds(pins.map((p) => [p.lat, p.lng]));
      map.fitBounds(b, { padding: [60, 60], maxZoom: 12 });
    }
  }

  function locate() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("no-geo"));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve([p.coords.latitude, p.coords.longitude]),
        reject,
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 }
      );
    });
  }

  function showMe(latlng) {
    const icon = L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [16, 16] });
    if (meMarker) meMarker.setLatLng(latlng);
    else meMarker = L.marker(latlng, { icon, interactive: false, zIndexOffset: -100 }).addTo(map);
  }

  async function goToMe(zoom) {
    toast("Recherche de ta position…", 8000);
    try {
      const ll = await locate();
      showMe(ll);
      map.setView(ll, Math.max(map.getZoom(), zoom));
      $("#toast").classList.add("hidden");
      return true;
    } catch (e) {
      toast("Position introuvable. Autorise la localisation, ou vise à la main.", 4000);
      return false;
    }
  }

  $("#locateBtn").addEventListener("click", () => goToMe(14));

  /* ---------------- Rotation : boussole ---------------- */
  function updateCompass() {
    if (!map.getBearing) return;
    const b = map.getBearing();
    const tilted = Math.abs(((b % 360) + 360) % 360) > 0.5 && Math.abs(((b % 360) + 360) % 360 - 360) > 0.5;
    $("#compassBtn").classList.toggle("hidden", !tilted);
    $("#compassNeedle").style.transform = `rotate(${-b}deg)`;
  }
  $("#compassBtn").addEventListener("click", () => {
    // Retour au nord en douceur
    const start = map.getBearing();
    const delta = ((start + 180) % 360) - 180;
    const t0 = performance.now();
    (function step(t) {
      const k = Math.min(1, (t - t0) / 300);
      map.setBearing(start - delta * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
      else map.setBearing(0);
    })(t0);
  });

  /* ---------------- Recherche ---------------- */
  let searchTimer = null;
  let searchAbort = null;
  let searchMarker = null;

  const norm = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  function openSearch() {
    show("#searchPanel");
    document.body.classList.add("searching");
    const input = $("#searchInput");
    input.value = "";
    hide("#searchClear");
    renderSearch([], "");
    setTimeout(() => input.focus(), 50);
  }
  function closeSearch() {
    hide("#searchPanel");
    document.body.classList.remove("searching");
    $("#searchInput").blur();
    if (searchAbort) searchAbort.abort();
  }

  function stickerMatches(q) {
    const n = norm(q);
    if (n.length < 2) return [];
    return pins
      .filter((p) => norm(p.place).includes(n) || norm(p.note).includes(n) || norm(nameOf(p.created_by, p.author_name)).includes(n))
      .slice(0, 5);
  }

  function placeLabel(f) {
    const p = f.properties || {};
    const title = p.name || p.street || p.city || "Lieu";
    const parts = [p.city !== title ? p.city : null, p.state, p.country].filter(Boolean);
    return { title, sub: [...new Set(parts)].join(", ") };
  }

  function renderSearch(places, q, loading) {
    const box = $("#searchResults");
    box.textContent = "";
    const mine = stickerMatches(q);

    const section = (title) => {
      const h = document.createElement("div");
      h.className = "search-section";
      h.textContent = title;
      box.appendChild(h);
    };
    const row = (icon, title, sub, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "search-row";
      const i = document.createElement("span");
      i.className = "search-icon";
      if (icon instanceof HTMLElement) i.appendChild(icon); else i.textContent = icon;
      const t = document.createElement("span");
      t.className = "search-text";
      const s1 = document.createElement("strong");
      s1.textContent = title;
      const s2 = document.createElement("small");
      s2.textContent = sub || "";
      t.append(s1, s2);
      b.append(i, t);
      b.addEventListener("click", onClick);
      box.appendChild(b);
    };

    if (mine.length) {
      section("Nos stickers");
      mine.forEach((p) => {
        const av = document.createElement("span");
        av.className = "avatar sm";
        setAvatar(av, p.created_by, p.author_name);
        row(av, p.place || "Sticker", formatDate(p.stuck_on) + (p.note ? " · " + p.note : ""), () => {
          closeSearch();
          map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
          setTimeout(() => openDetail(p), 350);
        });
      });
    }
    if (places.length) {
      section("Lieux");
      places.forEach((f) => {
        const { title, sub } = placeLabel(f);
        row("📍", title, sub, () => goToPlace(f, title));
      });
    }
    if (!q.trim()) {
      const e = document.createElement("p");
      e.className = "search-hint";
      e.textContent = "Cherche une ville, un pays, un monument… ou un de vos stickers.";
      box.appendChild(e);
    } else if (loading && !mine.length) {
      const e = document.createElement("p");
      e.className = "search-hint";
      e.textContent = "Recherche…";
      box.appendChild(e);
    } else if (!loading && !mine.length && !places.length) {
      const e = document.createElement("p");
      e.className = "search-hint";
      e.textContent = "Aucun résultat.";
      box.appendChild(e);
    }
  }

  async function searchPlaces(q) {
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    try {
      const c = map.getCenter();
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=fr&limit=6&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&location_bias_scale=0.2`;
      const r = await fetch(url, { signal: searchAbort.signal });
      const j = await r.json();
      renderSearch(j.features || [], q, false);
    } catch (e) {
      if (e.name !== "AbortError") renderSearch([], q, false);
    }
  }

  function goToPlace(f, title) {
    closeSearch();
    const [lng, lat] = f.geometry.coordinates;
    const ext = f.properties && f.properties.extent; // [ouest, nord, est, sud]
    if (ext && ext.length === 4) {
      map.fitBounds([[ext[3], ext[0]], [ext[1], ext[2]]], { padding: [40, 40], maxZoom: 16 });
    } else {
      map.setView([lat, lng], 14);
    }
    if (searchMarker) searchMarker.remove();
    searchMarker = L.marker([lat, lng], {
      icon: L.divIcon({ className: "", html: `<div class="search-dot"></div>`, iconSize: [18, 18] }),
      interactive: false
    }).addTo(map);
    toast(title, 2200);
  }

  $("#searchBtn").addEventListener("click", openSearch);
  $("#searchClose").addEventListener("click", closeSearch);
  $("#searchClear").addEventListener("click", () => {
    $("#searchInput").value = "";
    hide("#searchClear");
    renderSearch([], "");
    $("#searchInput").focus();
  });
  $("#searchInput").addEventListener("input", (e) => {
    const q = e.target.value;
    $("#searchClear").classList.toggle("hidden", !q);
    clearTimeout(searchTimer);
    if (q.trim().length < 2) {
      if (searchAbort) searchAbort.abort();
      return renderSearch([], q, false);
    }
    renderSearch([], q, true);
    searchTimer = setTimeout(() => searchPlaces(q.trim()), 300);
  });
  $("#searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSearch();
    if (e.key === "Enter") {
      const first = $("#searchResults .search-row");
      if (first) first.click();
    }
  });

  /* ---------------- Placement d'un sticker ---------------- */
  function startPlacing() {
    document.body.classList.add("placing");
    goToMe(17);
  }
  function stopPlacing() {
    document.body.classList.remove("placing");
  }

  $("#addBtn").addEventListener("click", startPlacing);
  $("#placeCancel").addEventListener("click", stopPlacing);
  $("#placeGps").addEventListener("click", () => goToMe(17));
  $("#placeOk").addEventListener("click", () => {
    const c = map.getCenter().wrap();
    newPinLatLng = { lat: c.lat, lng: c.lng };
    stopPlacing();
    openForm();
  });

  /* ---------------- Formulaire ---------------- */
  function resetPhoto() {
    chosenFile = null;
    $("#photoInput").value = "";
    $("#photoPreview").removeAttribute("src");
    hide("#photoPreview");
    $("#photoPick").classList.remove("has-photo");
    $("#photoHint").textContent = "📷 Ajouter une photo";
  }

  function openForm() {
    resetPhoto();
    $("#noteInput").value = "";
    $("#dateInput").value = todayISO();
    $("#formSave").disabled = false;
    $("#formSave").textContent = "Enregistrer";
    openSheet("#formSheet");
  }

  $("#photoInput").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    chosenFile = f;
    const img = $("#photoPreview");
    img.src = URL.createObjectURL(f);
    show("#photoPreview");
    $("#photoPick").classList.add("has-photo");
    $("#photoHint").textContent = "Changer la photo";
  });

  $("#formCancel").addEventListener("click", closeSheets);

  async function compressImage(file, max = 1600, quality = 0.82) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error("image"));
        i.src = url;
      });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      return await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function reverseGeocode(lat, lng) {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10&accept-language=fr`
      );
      const j = await r.json();
      const a = j.address || {};
      const city = a.city || a.town || a.village || a.municipality || a.county || a.state || "";
      return {
        place: [city, a.country].filter(Boolean).join(", ") || null,
        country: a.country_code ? a.country_code.toUpperCase() : null
      };
    } catch (e) {
      return { place: null, country: null };
    }
  }

  $("#formSave").addEventListener("click", async () => {
    if (!newPinLatLng) return;
    const btn = $("#formSave");
    btn.disabled = true;
    btn.textContent = "Envoi…";
    let photoPath = null;
    try {
      if (chosenFile) {
        btn.textContent = "Envoi de la photo…";
        const blob = await compressImage(chosenFile);
        photoPath = `${user.id}/${uuid()}.jpg`;
        const up = await sb.storage.from(BUCKET).upload(photoPath, blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
      }
      btn.textContent = "Enregistrement…";
      const where = await reverseGeocode(newPinLatLng.lat, newPinLatLng.lng);
      const { error } = await sb.from("pins").insert({
        lat: newPinLatLng.lat,
        lng: newPinLatLng.lng,
        note: $("#noteInput").value.trim() || null,
        stuck_on: $("#dateInput").value || todayISO(),
        photo_path: photoPath,
        author_name: myName() || null,
        place: where.place,
        country: where.country
      });
      if (error) throw error;
      closeSheets();
      toast("Sticker posé ! 🎉");
      await loadPins();
    } catch (e) {
      if (photoPath) sb.storage.from(BUCKET).remove([photoPath]);
      toast("Oups, ça n'a pas marché : " + (e.message || e), 4500);
      btn.disabled = false;
      btn.textContent = "Réessayer";
    }
  });

  /* ---------------- Détail ---------------- */
  async function openDetail(p) {
    currentPin = p;
    $("#detailPlace").textContent = p.place || "Sticker";
    setAvatar($("#detailAuthorAv"), p.created_by, p.author_name);
    $("#detailAuthorName").textContent = nameOf(p.created_by, p.author_name) || "Quelqu'un";
    $("#detailDate").textContent = formatDate(p.stuck_on);
    $("#detailNote").textContent = p.note || "";
    $("#detailDelete").classList.toggle("hidden", !(user && p.created_by === user.id));

    const img = $("#detailPhoto");
    img.style.visibility = "hidden";
    img.onload = () => (img.style.visibility = "visible");
    img.onerror = () => toast("Photo indisponible pour le moment", 3000);
    img.removeAttribute("src");
    if (p.photo_path) {
      show("#detailPhotoWrap");
      openSheet("#detailSheet");
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(p.photo_path, 3600);
      if (!error && currentPin === p) img.src = data.signedUrl;
    } else {
      hide("#detailPhotoWrap");
      openSheet("#detailSheet");
    }
  }

  $("#detailClose").addEventListener("click", closeSheets);
  $("#detailAuthor").addEventListener("click", () => currentPin && openProfile(currentPin.created_by));

  $("#detailPhoto").addEventListener("click", () => {
    const src = $("#detailPhoto").src;
    if (!src) return;
    $("#photoFull img").src = src;
    show("#photoFull");
  });
  $("#photoFull").addEventListener("click", () => hide("#photoFull"));

  $("#detailDelete").addEventListener("click", async () => {
    const p = currentPin;
    if (!p || !confirm("Supprimer ce sticker de la carte ?")) return;
    const { error } = await sb.from("pins").delete().eq("id", p.id);
    if (error) return toast("Suppression impossible : " + error.message, 4000);
    if (p.photo_path) await sb.storage.from(BUCKET).remove([p.photo_path]);
    closeSheets();
    toast("Sticker supprimé");
    loadPins();
  });

  /* ---------------- Page profil ---------------- */
  function openProfile(uid) {
    shownProfile = uid;
    renderProfile(uid);
    openSheet("#profileSheet");
  }

  function renderProfile(uid) {
    const mine = uid === user.id;
    const theirPins = pins.filter((p) => p.created_by === uid).sort((a, b) => (a.stuck_on < b.stuck_on ? 1 : -1));
    const fallback = theirPins[0] && theirPins[0].author_name;

    // La bande : les 3 avatars pour passer d'un profil à l'autre
    const crew = $("#crew");
    crew.textContent = "";
    crewIds().forEach((id) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "crew-item" + (id === uid ? " active" : "");
      const av = document.createElement("span");
      av.className = "avatar sm";
      setAvatar(av, id);
      const n = document.createElement("span");
      n.textContent = id === user.id ? "Moi" : nameOf(id) || "?";
      b.append(av, n);
      b.addEventListener("click", () => openProfile(id));
      crew.appendChild(b);
    });

    setAvatar($("#profAvatar"), uid, fallback);
    $("#profName").textContent = nameOf(uid, fallback) || "Sans prénom";
    const first = theirPins[theirPins.length - 1];
    $("#profSub").textContent = first ? `Premier sticker le ${formatDate(first.stuck_on)}` : "Pas encore de sticker posé";

    $("#statPins").textContent = theirPins.length;
    $("#statCountries").textContent = new Set(theirPins.map((p) => p.country).filter(Boolean)).size;
    $("#statPhotos").textContent = theirPins.filter((p) => p.photo_path).length;

    $("#profListTitle").textContent = mine ? "Mes stickers" : "Ses stickers";
    const list = $("#profPins");
    list.textContent = "";
    if (!theirPins.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = mine ? "Colle ton premier sticker !" : "Rien pour l'instant.";
      list.appendChild(li);
    }
    theirPins.forEach((p) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      const t = document.createElement("strong");
      t.textContent = p.place || "Sticker";
      const d = document.createElement("span");
      d.textContent = formatDate(p.stuck_on) + (p.photo_path ? " · 📷" : "");
      b.append(t, d);
      b.addEventListener("click", () => {
        closeSheets();
        map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
        setTimeout(() => openDetail(p), 350);
      });
      li.appendChild(b);
      list.appendChild(li);
    });

    $("#profMine").classList.toggle("hidden", !mine);
  }

  $("#meBtn").addEventListener("click", () => openProfile(user.id));
  $("#profileClose").addEventListener("click", closeSheets);
  $("#logoutBtn").addEventListener("click", async () => { await sb.auth.signOut(); });
  $("#editProfileBtn").addEventListener("click", () => openEdit(false));

  /* ---------------- Modifier le profil ---------------- */
  let editIsFirst = false;

  function openEdit(first) {
    editIsFirst = first;
    avatarFile = null;
    $("#avatarInput").value = "";
    $("#editTitle").textContent = first ? "Bienvenue ! 👋" : "Mon profil";
    $("#editSub").textContent = first
      ? "Choisis ton prénom et une photo. Elle apparaîtra sur les stickers que tu poses."
      : "Ta photo apparaîtra sur les stickers que tu poses.";
    $("#editCancel").classList.toggle("hidden", first);
    $("#nameInput").value = myName();
    setAvatar($("#editAvatar"), user.id);
    $("#editSave").disabled = false;
    $("#editSave").textContent = "Enregistrer";
    openSheet("#editSheet");
  }

  $("#avatarInput").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    avatarFile = f;
    const el = $("#editAvatar");
    el.textContent = "";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(f);
    el.appendChild(img);
  });

  $("#editCancel").addEventListener("click", () => openProfile(user.id));

  async function squareImage(file, size = 400) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error("image"));
        i.src = url;
      });
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, size, size);
      return await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  $("#editForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#nameInput").value.trim();
    if (!name) return;
    const btn = $("#editSave");
    btn.disabled = true;
    btn.textContent = "Enregistrement…";

    // Sans la table profiles (script SQL pas encore lancé) : on garde au moins le prénom
    if (!profilesReady) {
      const { data, error } = await sb.auth.updateUser({ data: { name } });
      btn.disabled = false;
      btn.textContent = "Enregistrer";
      if (error) return toast("Erreur : " + error.message, 4000);
      user = data.user;
      closeSheets();
      setAvatar($("#meAvatar"), user.id);
      return toast("Photo de profil indisponible : lance le script supabase-profils.sql", 5000);
    }

    const old = profiles[user.id] && profiles[user.id].avatar_path;
    let newPath = null;
    try {
      if (avatarFile) {
        btn.textContent = "Envoi de la photo…";
        const blob = await squareImage(avatarFile);
        newPath = `avatars/${user.id}/${uuid()}.jpg`;
        const up = await sb.storage.from(BUCKET).upload(newPath, blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
      }
      const { error } = await sb.from("profiles").upsert({
        id: user.id,
        name,
        avatar_path: newPath || old || null,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
      if (newPath && old) sb.storage.from(BUCKET).remove([old]);
      sb.auth.updateUser({ data: { name } }).then((r) => { if (r.data && r.data.user) user = r.data.user; });
      await loadProfiles();
      toast(editIsFirst ? `Salut ${name} !` : "Profil mis à jour");
      if (editIsFirst) closeSheets();
      else openProfile(user.id);
    } catch (err) {
      if (newPath) sb.storage.from(BUCKET).remove([newPath]);
      toast("Oups : " + (err.message || err), 4500);
      btn.disabled = false;
      btn.textContent = "Réessayer";
    }
  });

  $("#backdrop").addEventListener("click", () => {
    // Au premier lancement, la fiche profil reste ouverte tant que le prénom n'est pas choisi
    if ($("#editSheet").classList.contains("open") && editIsFirst) return;
    closeSheets();
  });

  /* ---------------- Album ---------------- */
  async function signPhotos(list) {
    const missing = [...new Set(list.map((p) => p.photo_path).filter((path) => path && !photoUrls[path]))];
    if (!missing.length) return;
    const res = await sb.storage.from(BUCKET).createSignedUrls(missing, 60 * 60 * 24);
    (res.data || []).forEach((u) => { if (u.signedUrl) photoUrls[u.path] = u.signedUrl; });
  }

  function monthLabel(iso) {
    const [y, m] = iso.split("-").map(Number);
    const s = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function openAlbum() {
    closeSheets();
    show("#album");
    renderAlbum();
  }

  function renderFilters() {
    const box = $("#albumFilters");
    box.textContent = "";
    const opts = [["all", "Tous", null]].concat(crewIds().map((id) => [id, id === user.id ? "Moi" : nameOf(id) || "?", id]));
    opts.forEach(([key, label, uid]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (albumFilter === key ? " active" : "");
      if (uid) {
        const av = document.createElement("span");
        av.className = "avatar xs";
        setAvatar(av, uid);
        b.appendChild(av);
      }
      b.appendChild(document.createTextNode(label));
      b.addEventListener("click", () => { albumFilter = key; renderAlbum(); });
      box.appendChild(b);
    });
  }

  async function renderAlbum() {
    renderFilters();
    albumList = pins
      .filter((p) => albumFilter === "all" || p.created_by === albumFilter)
      .sort((a, b) => (a.stuck_on < b.stuck_on ? 1 : a.stuck_on > b.stuck_on ? -1 : 0));

    const nPhotos = albumList.filter((p) => p.photo_path).length;
    const nCountries = new Set(albumList.map((p) => p.country).filter(Boolean)).size;
    $("#albumCount").textContent = albumList.length
      ? `${albumList.length} sticker${albumList.length > 1 ? "s" : ""} · ${nPhotos} photo${nPhotos > 1 ? "s" : ""} · ${nCountries} pays`
      : "";

    const body = $("#albumBody");
    body.textContent = "";
    if (!albumList.length) {
      const e = document.createElement("div");
      e.className = "album-empty";
      e.innerHTML = "<div>📭</div><p>Pas encore de sticker ici.<br>Va en coller un !</p>";
      body.appendChild(e);
      return;
    }

    await signPhotos(albumList);

    let currentMonth = null;
    let grid = null;
    albumList.forEach((p, i) => {
      const month = monthLabel(p.stuck_on);
      if (month !== currentMonth) {
        currentMonth = month;
        const h = document.createElement("h3");
        h.className = "album-month";
        h.textContent = month;
        body.appendChild(h);
        grid = document.createElement("div");
        grid.className = "album-grid";
        body.appendChild(grid);
      }
      const card = document.createElement("button");
      card.type = "button";
      card.className = "album-card";
      const ph = document.createElement("div");
      ph.className = "album-photo";
      const url = p.photo_path && photoUrls[p.photo_path];
      if (url) {
        const img = document.createElement("img");
        img.loading = "lazy";
        img.alt = "";
        img.src = url;
        ph.appendChild(img);
      } else {
        ph.classList.add("no-photo");
        ph.style.setProperty("--c", colorFor(p.created_by));
        ph.innerHTML = "<span>📍</span>";
      }
      const av = document.createElement("span");
      av.className = "avatar xs album-av";
      setAvatar(av, p.created_by, p.author_name);
      ph.appendChild(av);
      const cap = document.createElement("div");
      cap.className = "album-cap";
      const t = document.createElement("strong");
      t.textContent = p.place || "Sticker";
      const d = document.createElement("span");
      d.textContent = formatDate(p.stuck_on);
      cap.append(t, d);
      card.append(ph, cap);
      card.addEventListener("click", () => openViewer(i));
      grid.appendChild(card);
    });
  }

  $("#albumBtn").addEventListener("click", openAlbum);
  $("#albumBack").addEventListener("click", () => hide("#album"));

  /* ---------------- Visionneuse ---------------- */
  function openViewer(i) {
    viewerIndex = i;
    show("#viewer");
    renderViewer();
  }

  function renderViewer() {
    const p = albumList[viewerIndex];
    if (!p) return;
    $("#viewerPos").textContent = `${viewerIndex + 1} / ${albumList.length}`;
    const url = p.photo_path && photoUrls[p.photo_path];
    const img = $("#viewerImg");
    if (url) {
      img.src = url;
      img.classList.remove("hidden");
      hide("#viewerEmpty");
    } else {
      img.removeAttribute("src");
      img.classList.add("hidden");
      show("#viewerEmpty");
    }
    $("#viewerPlace").textContent = p.place || "Sticker";
    setAvatar($("#viewerAuthorAv"), p.created_by, p.author_name);
    $("#viewerAuthorName").textContent = nameOf(p.created_by, p.author_name) || "Quelqu'un";
    $("#viewerDate").textContent = formatDate(p.stuck_on);
    $("#viewerNote").textContent = p.note || "";
    $("#viewerPrev").style.visibility = viewerIndex > 0 ? "visible" : "hidden";
    $("#viewerNext").style.visibility = viewerIndex < albumList.length - 1 ? "visible" : "hidden";
    // précharge la suivante
    const next = albumList[viewerIndex + 1];
    if (next && next.photo_path && photoUrls[next.photo_path]) new Image().src = photoUrls[next.photo_path];
  }

  function viewerStep(d) {
    const n = viewerIndex + d;
    if (n < 0 || n >= albumList.length) return;
    viewerIndex = n;
    renderViewer();
  }

  $("#viewerPrev").addEventListener("click", (e) => { e.stopPropagation(); viewerStep(-1); });
  $("#viewerNext").addEventListener("click", (e) => { e.stopPropagation(); viewerStep(1); });
  $("#viewerClose").addEventListener("click", () => hide("#viewer"));
  $("#viewerAuthor").addEventListener("click", () => {
    const p = albumList[viewerIndex];
    hide("#viewer");
    hide("#album");
    openProfile(p.created_by);
  });
  $("#viewerMap").addEventListener("click", () => {
    const p = albumList[viewerIndex];
    hide("#viewer");
    hide("#album");
    map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
    setTimeout(() => openDetail(p), 350);
  });

  // Glisser à gauche / à droite pour changer de photo
  let touchX = null;
  $("#viewerStage").addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $("#viewerStage").addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) viewerStep(dx < 0 ? 1 : -1);
  });
  document.addEventListener("keydown", (e) => {
    if ($("#viewer").classList.contains("hidden")) return;
    if (e.key === "ArrowLeft") viewerStep(-1);
    if (e.key === "ArrowRight") viewerStep(1);
    if (e.key === "Escape") hide("#viewer");
  });

  /* ---------------- Installation (Android) ---------------- */
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
    show("#installBtn");
  });
  $("#installBtn").addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    hide("#installBtn");
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  init();
})();
