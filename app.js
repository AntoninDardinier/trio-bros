/* Nos Stickers — carte partagée de stickers */
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

  function myName() {
    return (user && user.user_metadata && user.user_metadata.name) || "";
  }

  /* ---------------- Démarrage ---------------- */
  async function init() {
    const name = cfg.APP_NAME || "Nos Stickers";
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
    if (!myName()) openSheet("#nameSheet");
    loadPins();
    sb.channel("pins-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "pins" }, () => loadPins())
      .subscribe();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") loadPins();
    });
  }

  /* ---------------- Carte ---------------- */
  function initMap() {
    if (map) return;
    map = L.map("map", { zoomControl: false, worldCopyJump: true, minZoom: 2 }).setView([46.6, 2.5], 3);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 100);
  }

  function pinIcon(pin) {
    return L.divIcon({
      className: "sticker-marker",
      html: `<div class="pin" style="--c:${colorFor(pin.created_by)}"><span></span></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 40]
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
    const who = p.author_name ? `Posé par ${p.author_name}` : "Posé";
    $("#detailMeta").textContent = `${who} · ${formatDate(p.stuck_on)}`;
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

  /* ---------------- Prénom ---------------- */
  $("#nameForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#nameInput").value.trim();
    if (!name) return;
    const { data, error } = await sb.auth.updateUser({ data: { name } });
    if (error) return toast("Erreur : " + error.message, 4000);
    user = data.user;
    closeSheets();
    toast(`Salut ${name} !`);
  });

  /* ---------------- Menu ---------------- */
  $("#menuBtn").addEventListener("click", () => {
    $("#menuHello").textContent = myName() ? `Salut ${myName()} 👋` : "Salut 👋";
    openSheet("#menuSheet");
  });
  $("#menuClose").addEventListener("click", closeSheets);
  $("#renameBtn").addEventListener("click", () => {
    $("#nameInput").value = myName();
    openSheet("#nameSheet");
  });
  $("#logoutBtn").addEventListener("click", async () => {
    await sb.auth.signOut();
  });

  $("#backdrop").addEventListener("click", () => {
    // La feuille "prénom" ne se ferme pas tant qu'il n'est pas choisi
    if ($("#nameSheet").classList.contains("open") && !myName()) return;
    closeSheets();
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
