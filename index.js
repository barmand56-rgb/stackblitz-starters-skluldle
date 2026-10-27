/* =============================================================================
   EURO EXPERT SOLVABILITÉ — index.js
   Moteur d'analyse B2B basé sur des données publiques (API Recherche d'entreprises)

   Principes :
   - Aucune donnée inventée : ce qui n'est pas disponible s'affiche « Non disponible ».
   - Le score est INDICATIF, calculé avec une méthode documentée (voir computeScore).
   - Toutes les données externes sont échappées avant d'être injectées dans le DOM.
   - Aucun secret dans ce fichier : l'accès est vérifié côté serveur (api/verify.js).

   Sections :
     0. Configuration      4. Recherche & autocomplétion   8. Carte
     1. Utilitaires        5. Score indicatif              9. Rapport PDF
     2. Accès / session    6. Modèle de données           10. Initialisation
     3. API & cache        7. Rendu du tableau de bord
   ============================================================================= */
   'use strict';

   /* =============================================================================
      0. CONFIGURATION
      ============================================================================= */
   const CONFIG = Object.freeze({
     searchApi: 'https://recherche-entreprises.api.gouv.fr/search',
     minAutocompleteChars: 3,
     autocompleteDelayMs: 250,
     cacheMaxEntries: 100,
     analysisEndpoint: '/api/analyse',
     auth: Object.freeze({
       endpoint: '/api/verify',
       storageKey: 'ees_session',
       // Hôtes d'aperçu développeur (StackBlitz / local) : le verrouillage y est désactivé.
       // Sur votre domaine de production, l'accès est toujours vérifié par le serveur.
       devHostPatterns: [/^localhost$/, /^127\.0\.0\.1$/, /webcontainer\.io$/, /staticblitz\.com$/, /stackblitz\.io$/]
     })
   });
   
   const NA = 'Non disponible';
   
   const LINKS = Object.freeze({
     annuaire: (siren) => `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`,
     inpi: (siren) => `https://data.inpi.fr/entreprises/${siren}`,
     bodacc: 'https://www.bodacc.fr/',
     dvf: 'https://app.dvf.etalab.gouv.fr/',
     alimconfiance: 'https://alim-confiance.gouv.fr/',
     gelAvoirs: 'https://gels-avoirs.dgtresor.gouv.fr/'
   });
   
   const NATURE_JURIDIQUE = Object.freeze({
     1000: 'Entrepreneur individuel',
     5498: 'EURL',
     5499: 'SARL',
     5710: 'SAS',
     5720: 'SASU',
     6540: 'Société civile immobilière',
     9220: 'Association déclarée'
   });
   
   const TRANCHES_EFFECTIF = Object.freeze({
     NN: 'Unité non employeuse', '00': '0 salarié', '01': '1 à 2 salariés', '02': '3 à 5 salariés',
     '03': '6 à 9 salariés', 11: '10 à 19 salariés', 12: '20 à 49 salariés', 21: '50 à 99 salariés',
     22: '100 à 199 salariés', 31: '200 à 249 salariés', 32: '250 à 499 salariés', 41: '500 à 999 salariés',
     42: '1 000 à 1 999 salariés', 51: '2 000 à 4 999 salariés', 52: '5 000 à 9 999 salariés', 53: '10 000 salariés et plus'
   });
   
   const TONES = Object.freeze({
     emerald: { text: 'text-emerald-400', pill: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30', hex: '#10b981', pdf: '#059669' },
     amber: { text: 'text-amber-400', pill: 'bg-amber-500/20 text-amber-300 border border-amber-500/30', hex: '#f59e0b', pdf: '#d97706' },
     red: { text: 'text-red-400', pill: 'bg-red-500/20 text-red-400 border border-red-500/30', hex: '#ef4444', pdf: '#dc2626' },
     slate: { text: 'text-slate-300', pill: 'bg-slate-500/20 text-slate-300 border border-slate-500/30', hex: '#94a3b8', pdf: '#475569' }
   });
   
   /* Effectif : bornes (nombre de salariés) par tranche Sirene */
   const TRANCHE_RANGES = Object.freeze({
     '01': [1, 2], '02': [3, 5], '03': [6, 9], 11: [10, 19], 12: [20, 49], 21: [50, 99], 22: [100, 199],
     31: [200, 249], 32: [250, 499], 41: [500, 999], 42: [1000, 1999], 51: [2000, 4999], 52: [5000, 9999], 53: [10000, 10000]
   });
   
   /* ESTIMATION DE CA — ordres de grandeur du chiffre d'affaires par salarié, par division NAF.
      ⚠ Valeurs indicatives posées à la main et volontairement larges. À CALIBRER avec les statistiques
      sectorielles ESANE de l'INSEE avant tout usage commercial intensif. */
   const SECTOR_BENCHMARKS = Object.freeze([
     { from: 1, to: 3, label: 'agriculture, sylviculture, pêche', min: 40000, max: 120000 },
     { from: 10, to: 33, label: 'industrie manufacturière', min: 150000, max: 400000 },
     { from: 35, to: 39, label: 'énergie, eau, déchets', min: 200000, max: 600000 },
     { from: 41, to: 43, label: 'construction', min: 90000, max: 200000 },
     { from: 45, to: 45, label: 'commerce et réparation automobile', min: 250000, max: 600000 },
     { from: 46, to: 46, label: 'commerce de gros', min: 350000, max: 900000 },
     { from: 47, to: 47, label: 'commerce de détail', min: 120000, max: 300000 },
     { from: 49, to: 53, label: 'transports et entreposage', min: 90000, max: 200000 },
     { from: 55, to: 55, label: 'hébergement', min: 50000, max: 120000 },
     { from: 56, to: 56, label: 'restauration', min: 45000, max: 100000 },
     { from: 58, to: 63, label: 'information et communication', min: 90000, max: 200000 },
     { from: 68, to: 68, label: 'activités immobilières', min: 100000, max: 400000 },
     { from: 69, to: 75, label: 'services spécialisés, scientifiques et techniques', min: 70000, max: 160000 },
     { from: 77, to: 82, label: 'services administratifs et de soutien', min: 40000, max: 100000 },
     { from: 85, to: 85, label: 'enseignement', min: 30000, max: 80000 },
     { from: 86, to: 88, label: 'santé humaine et action sociale', min: 40000, max: 110000 },
     { from: 90, to: 93, label: 'arts, spectacles, sports et loisirs', min: 40000, max: 120000 },
     { from: 94, to: 96, label: 'autres services', min: 30000, max: 90000 }
   ]);
   const GENERIC_BENCHMARK = Object.freeze({ label: 'secteur non couvert, plage générique très large', min: 50000, max: 250000 });
   // Activités pour lesquelles le CA ne se déduit pas de l'effectif (holdings, patrimoine immobilier, associations…)
   const NON_ESTIMABLE_NAF = /^(64|65|66|68\.2|70\.10|84|94|97|98|99)/;
   
   const state = {
     view: null,
     chart: null,
     map: null,
     markerLayer: null,
     searchTimer: null,
     searchController: null
   };
   
   /* =============================================================================
      1. UTILITAIRES
      ============================================================================= */
   const $ = (id) => document.getElementById(id);
   
   const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
   const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
   const digits = (value) => String(value ?? '').replace(/\D/g, '');
   const numOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
   
   function setText(id, value) {
     const el = $(id);
     if (el) el.textContent = value;
   }
   
   function setHTML(id, html) {
     const el = $(id);
     if (el) el.innerHTML = html; // n'appeler qu'avec du contenu déjà échappé via esc()
   }
   
   const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
   const cleanSpaces = (s) => s.replace(/[  ]/g, ' ');
   const fmtEuro = (n) => (n === null || n === undefined ? NA : `${cleanSpaces(numberFormat.format(Math.round(n)))} €`);
   const fmtPct = (ratio, signed = false) => {
     if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return NA;
     const text = (ratio * 100).toFixed(1).replace('.', ',');
     return `${signed && ratio > 0 ? '+' : ''}${text} %`;
   };
   
   function fmtDate(iso) {
     const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
     return m ? `${m[3]}/${m[2]}/${m[1]}` : NA;
   }
   
   function ageInYears(iso) {
     const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
     if (!m) return null;
     const now = new Date();
     let age = now.getFullYear() - Number(m[1]);
     if (now.getMonth() + 1 < Number(m[2]) || (now.getMonth() + 1 === Number(m[2]) && now.getDate() < Number(m[3]))) age -= 1;
     return Math.max(age, 0);
   }
   
   function notify(message) {
     const el = document.createElement('div');
     el.className = 'fixed bottom-4 right-4 z-[2000] max-w-sm px-4 py-3 rounded-xl bg-slate-900 border border-cyan-500/40 text-xs text-slate-100 shadow-2xl';
     el.setAttribute('role', 'status');
     el.textContent = message;
     document.body.appendChild(el);
     setTimeout(() => el.remove(), 4500);
   }
   
   /** Crée un élément avec classe et texte (jamais de HTML brut). */
   function h(tag, className, text) {
     const el = document.createElement(tag);
     if (className) el.className = className;
     if (text !== undefined) el.textContent = text;
     return el;
   }
   
   /** N° de TVA intracommunautaire théorique, calculé à partir du SIREN (formule officielle). */
   function vatFromSiren(siren) {
     if (!/^\d{9}$/.test(siren)) return NA;
     const key = (12 + 3 * (Number(siren) % 97)) % 97;
     return `FR${String(key).padStart(2, '0')}${siren}`;
   }
   
   /* =============================================================================
      2. ACCÈS / SESSION  (vérification côté serveur : api/verify.js)
      ============================================================================= */
   const isDevHost = () => CONFIG.auth.devHostPatterns.some((re) => re.test(location.hostname));
   
   function setLocked(locked) {
     const modal = $('auth-modal');
     if (modal) modal.classList.toggle('hidden', !locked);
     ['header', 'main', 'footer'].forEach((selector) => {
       const el = document.querySelector(selector);
       if (el) el.inert = locked;
     });
   }
   
   function readSession() {
     try {
       const s = JSON.parse(localStorage.getItem(CONFIG.auth.storageKey));
       return s && typeof s.token === 'string' && s.exp > Date.now() ? s : null;
     } catch (e) {
       return null;
     }
   }
   
   function writeSession(session) {
     try { localStorage.setItem(CONFIG.auth.storageKey, JSON.stringify(session)); } catch (e) { /* stockage indisponible */ }
   }
   
   function clearSession() {
     try { localStorage.removeItem(CONFIG.auth.storageKey); } catch (e) { /* stockage indisponible */ }
   }
   
   async function authRequest(payload) {
     const res = await fetch(CONFIG.auth.endpoint, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify(payload)
     });
     let data = null;
     try { data = await res.json(); } catch (e) { /* réponse non JSON */ }
     return { status: res.status, data };
   }
   
   const DEV_PREVIEW_KEY = 'ees_dev_preview';
   
   /** Aperçu développeur (StackBlitz / local) : l'écran de verrouillage s'affiche, avec un bouton pour continuer sans clé. */
   function addDevPreviewButton() {
     const form = document.querySelector('#auth-modal form');
     if (!form || $('dev-preview-btn')) return;
     const btn = h('button', 'w-full py-2.5 text-xs text-slate-400 border border-dashed border-slate-600 rounded-xl hover:text-cyan-300 hover:border-cyan-500/50 transition-all',
       'Aperçu développeur : continuer sans clé');
     btn.type = 'button';
     btn.id = 'dev-preview-btn';
     btn.addEventListener('click', () => {
       try { sessionStorage.setItem(DEV_PREVIEW_KEY, '1'); } catch (e) { /* stockage indisponible */ }
       setLocked(false);
     });
     form.appendChild(btn);
   }
   
   async function initAuth() {
     if (isDevHost()) {
       addDevPreviewButton();
       let preview = false;
       try { preview = sessionStorage.getItem(DEV_PREVIEW_KEY) === '1'; } catch (e) { /* stockage indisponible */ }
       setLocked(!preview);
     } else {
       setLocked(true);
     }
     const session = readSession();
     if (!session) return;
     try {
       const { status, data } = await authRequest({ token: session.token });
       if (status === 200 && data && data.ok) setLocked(false);
       else clearSession();
     } catch (e) {
       /* serveur injoignable : l'état de verrouillage reste inchangé */
     }
   }
   
   async function validateAccessCode(event) {
     if (event) event.preventDefault();
     const input = $('access-code-input');
     const banner = $('auth-error');
     if (!input) return;
   
     const showError = (message) => {
       if (banner) {
         banner.textContent = message;
         banner.classList.remove('hidden');
       }
       input.classList.add('border-red-500');
       setTimeout(() => input.classList.remove('border-red-500'), 2000);
     };
   
     const code = input.value.trim();
     if (!code) return showError("Saisissez votre clé d'accès.");
   
     const submit = event && event.target && event.target.querySelector
       ? event.target.querySelector('button[type="submit"]') : null;
     if (submit) submit.disabled = true;
   
     try {
       const { status, data } = await authRequest({ code });
       if (status === 200 && data && data.ok && data.token) {
         writeSession({ token: data.token, exp: data.exp });
         if (banner) banner.classList.add('hidden');
         input.value = '';
         setLocked(false);
       } else if (status === 429) {
         showError('Trop de tentatives. Réessayez dans quelques minutes.');
       } else if (status === 401) {
         showError("Clé d'accès invalide ou expirée.");
       } else {
         showError("Service d'authentification indisponible. Réessayez plus tard.");
       }
     } catch (e) {
       showError("Service d'authentification indisponible. Réessayez plus tard.");
     } finally {
       if (submit) submit.disabled = false;
     }
   }
   
   function lockSession() {
     clearSession();
     try { sessionStorage.removeItem(DEV_PREVIEW_KEY); } catch (e) { /* stockage indisponible */ }
     setLocked(true);
   }
   
   /* =============================================================================
      3. API & CACHE
      ============================================================================= */
   const apiCache = new Map();
   
   const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
   
   async function fetchGouvAPI(url, signal) {
     if (apiCache.has(url)) return apiCache.get(url);
     for (let attempt = 0; attempt < 2; attempt += 1) {
       try {
         const res = await fetch(url, { signal });
         if (res.status === 429 || res.status >= 500) { await sleep(500); continue; } // surcharge : une seconde chance
         if (!res.ok) return null;
         const data = await res.json();
         if (apiCache.size >= CONFIG.cacheMaxEntries) apiCache.delete(apiCache.keys().next().value);
         apiCache.set(url, data);
         return data;
       } catch (e) {
         if (e.name === 'AbortError') return null;
         console.error('Erreur API :', e);
         await sleep(300);
       }
     }
     return null;
   }
   
   function searchUrl(q, params, perPage) {
     const qs = new URLSearchParams({ q, per_page: String(perPage), ...params });
     return `${CONFIG.searchApi}?${qs.toString()}`;
   }
   
   const normalizeName = (s) =>
     String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
   
   /** « uni vert 97434 » -> filtre code postal ; « uni vert 974 » -> filtre département. */
   function extractLocation(raw) {
     const parts = raw.trim().split(/\s+/);
     const last = parts[parts.length - 1];
     if (parts.length > 1) {
       if (/^\d{5}$/.test(last)) return { text: parts.slice(0, -1).join(' '), params: { code_postal: last } };
       if (/^97\d$/.test(last)) return { text: parts.slice(0, -1).join(' '), params: { departement: last } };
     }
     return { text: raw, params: {} };
   }
   
   /**
    * Recherche robuste : SIREN/SIRET directement ; sinon plusieurs formulations successives
    * (texte normalisé, sans lettres isolées, deux premiers mots significatifs).
    * Retourne { results, failed } : `failed` distingue « service en panne » de « aucun résultat ».
    */
   async function searchCompanies(raw, perPage = 25, signal) {
     const compact = raw.replace(/\s+/g, '');
     if (/^\d{9,14}$/.test(compact)) {
       const data = await fetchGouvAPI(searchUrl(compact.slice(0, 9), {}, perPage), signal);
       return { results: (data && data.results) || [], failed: !data, byNumber: true };
     }
   
     const { text, params } = extractLocation(raw);
     const hasParams = Object.keys(params).length > 0;
     const normalized = text.replace(/['’\-]/g, ' ').replace(/\s+/g, ' ').trim();
     const stripped = normalized.replace(/\b[a-zA-Z]\b/g, '').replace(/\s+/g, ' ').trim();
     const shortened = normalized.split(' ').filter((w) => w.length >= 3).slice(0, 2).join(' ');
     const attempts = [...new Set([normalized, stripped, shortened].filter((q) => q.length >= 2))];
   
     let failed = false;
     for (const q of attempts) {
       if (signal && signal.aborted) break;
       let data = await fetchGouvAPI(searchUrl(q, params, perPage), signal);
       if (!data && hasParams && !(signal && signal.aborted)) data = await fetchGouvAPI(searchUrl(q, {}, perPage), signal);
       if (!data) { failed = true; continue; }
       if (Array.isArray(data.results) && data.results.length > 0) return { results: data.results, failed: false, byNumber: false };
     }
     return { results: [], failed, byNumber: false };
   }
   
   const activeFirst = (results) =>
     [...results].sort((a, b) => Number(b.etat_administratif === 'A') - Number(a.etat_administratif === 'A'));
   
   /* =============================================================================
      4. RECHERCHE & AUTOCOMPLÉTION
      ============================================================================= */
   function companyDisplayName(company) {
     const siege = company.siege || {};
     const commercial = siege.nom_commercial || company.nom_commercial ||
       (Array.isArray(siege.liste_enseignes) ? siege.liste_enseignes[0] : null) || siege.enseigne || null;
     const raison = company.nom_complet || company.nom_raison_sociale || company.nom || 'Entreprise';
     return String(commercial || raison.split('(')[0]).trim();
   }
   
   function hideAutocomplete() {
     const box = $('autocomplete-results');
     if (box) box.classList.add('hidden');
   }
   
   function initSearchUI() {
     const box = $('autocomplete-results');
     if (!box) return;
     if (box.parentElement) {
       Object.assign(box.parentElement.style, { position: 'relative', overflow: 'visible' });
     }
     Object.assign(box.style, { position: 'absolute', top: '100%', left: '0', right: '0', zIndex: '999999', backgroundColor: '#0f172a' });
   }
   
   function handleSearchInput(event) {
     const value = event && event.target ? event.target.value : '';
     clearTimeout(state.searchTimer);
     state.searchTimer = setTimeout(() => fetchAutocompleteSuggestions(value), CONFIG.autocompleteDelayMs);
   }
   
   function handleSearchKeyup(event) {
     if (event.key === 'Enter') executeSearch();
   }
   
   async function fetchAutocompleteSuggestions(query) {
     const raw = (query || '').trim();
     if (raw.length < CONFIG.minAutocompleteChars) return hideAutocomplete();
   
     if (state.searchController) state.searchController.abort();
     const controller = new AbortController();
     state.searchController = controller;
   
     const { results } = await searchCompanies(raw, 15, controller.signal);
     if (controller.signal.aborted) return;
     const input = $('search-input');
     if (input && input.value.trim() !== raw) return; // la saisie a changé entre-temps
   
     if (results.length > 0) renderAutocompleteResults(activeFirst(results));
     else hideAutocomplete();
   }
   
   function renderAutocompleteResults(results) {
     const box = $('autocomplete-results');
     if (!box) return;
     box.replaceChildren();
   
     results.forEach((company) => {
       const siege = company.siege || {};
       const name = companyDisplayName(company);
       const active = company.etat_administratif === 'A';
       const place = [siege.code_postal, siege.libelle_commune].filter(Boolean).join(' ');
   
       const item = h('div', 'p-3 hover:bg-slate-800 cursor-pointer transition-all border-b border-slate-700/50 text-left');
       const row = h('div', 'flex items-center gap-3 w-full');
       row.appendChild(h('div', 'w-8 h-8 min-w-[32px] rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 flex items-center justify-center font-bold text-sm', name.charAt(0).toUpperCase()));
   
       const body = h('div', 'flex-1 min-w-0');
       const top = h('div', 'flex items-center justify-between gap-2');
       top.appendChild(h('span', 'text-sm font-bold text-white truncate', name));
       top.appendChild(h('span', `text-[10px] px-1.5 py-0.5 rounded font-semibold ${active ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`, active ? 'Active' : 'Fermée'));
   
       const meta = h('div', 'flex items-center gap-2 text-xs text-slate-400 mt-0.5');
       const sirenSpan = h('span', undefined, 'SIREN: ');
       sirenSpan.appendChild(h('strong', 'text-slate-200', company.siren || NA));
       meta.appendChild(sirenSpan);
       if (place) meta.appendChild(h('span', undefined, place));
   
       body.append(top, meta);
       row.appendChild(body);
       item.appendChild(row);
   
       item.addEventListener('click', (e) => {
         e.stopPropagation();
         const input = $('search-input');
         if (input) input.value = name;
         hideAutocomplete();
         selectCompany(company);
       });
       box.appendChild(item);
     });
     box.classList.remove('hidden');
   }
   
   async function executeSearch(options) {
     const pickFirst = !!(options && options.pickFirst === true);
     const input = $('search-input');
     const raw = input ? input.value.trim() : '';
     hideAutocomplete();
     clearTimeout(state.searchTimer);
     if (state.searchController) state.searchController.abort();
     if (raw.length < 2) return notify('Saisissez un nom d’entreprise, un SIREN ou un SIRET.');
   
     const { results, failed, byNumber } = await searchCompanies(raw, 25);
     if (results.length === 0) {
       return notify(failed
         ? 'Le service officiel de recherche ne répond pas. Réessayez dans un instant.'
         : `Aucune entreprise trouvée pour « ${raw} ». Essayez le SIREN, ajoutez un code postal (ex. « nom 97400 ») ou vérifiez l’orthographe. Les entreprises « non diffusibles » n’apparaissent pas dans les sources publiques.`);
     }
   
     const sorted = activeFirst(results);
     const target = normalizeName(raw);
     const exact = sorted.find((c) => normalizeName(companyDisplayName(c)) === target || normalizeName(c.nom_complet) === target);
     if (byNumber || pickFirst || sorted.length === 1 || exact) return selectCompany(exact || sorted[0]);
   
     renderAutocompleteResults(sorted); // plusieurs possibilités : on laisse l'utilisateur choisir
     notify(`${sorted.length} entreprises correspondent : choisissez-en une dans la liste.`);
   }
   
   function triggerSearchBySiren(query) {
     const input = $('search-input');
     if (input) input.value = query;
     executeSearch({ pickFirst: true });
   }
   
   function resetToHome() {
     state.view = null;
     const input = $('search-input');
     if (input) input.value = '';
     hideAutocomplete();
     const dash = $('dashboard-content');
     if (dash) dash.classList.add('hidden');
     setMapHeader('Localisation du Siège Social', 'FRANCE',
       'Sélectionnez une entreprise ou utilisez la barre de recherche ci-dessus pour géolocaliser le siège social.');
     showHomeMap();
   }
   
   /* =============================================================================
      5. SCORE INDICATIF
      Méthode (100 points) — uniquement des données publiques :
        Statut administratif   20  actif = 20, cessé = 0 (et score plafonné à 20)
        Ancienneté             25  >=10 ans 25 | >=5 ans 20 | >=2 ans 12 | >=1 an 6 | sinon 3
        Effectif               15  selon la tranche Sirene (non employeur = 2, >=20 salariés = 15)
        Comptes publiés        25  comptes publiés 5 + résultat net positif 12 + CA en hausse 8
        Gouvernance            10  au moins un dirigeant déclaré
        Établissements ouverts  5  au moins un établissement ouvert
      Ce score n'est ni une notation réglementée, ni une garantie de solvabilité.
      ============================================================================= */
   const EFFECTIF_POINTS = { NN: 2, '00': 2, '01': 6, '02': 8, '03': 10, 11: 12 };
   
   function computeScore(company, fin, dirigeants) {
     const closed = company.etat_administratif !== 'A';
     const criteria = [];
     const add = (name, pts, max, note) => criteria.push({ name, pts, max, note });
   
     add('Statut administratif', closed ? 0 : 20, 20,
       closed ? 'Entreprise cessée au répertoire Sirene' : 'Entreprise active au répertoire Sirene');
   
     const age = ageInYears(company.date_creation);
     if (age === null) add('Ancienneté', 0, 25, 'Date de création non renseignée');
     else {
       const pts = age >= 10 ? 25 : age >= 5 ? 20 : age >= 2 ? 12 : age >= 1 ? 6 : 3;
       add('Ancienneté', pts, 25, age < 1 ? "Moins d'un an d'existence" : `${age} ${age > 1 ? 'ans' : 'an'} d'existence`);
     }
   
     const tranche = company.tranche_effectif_salarie;
     if (!tranche || !(tranche in TRANCHES_EFFECTIF)) add('Effectif', 0, 15, 'Tranche d’effectif non renseignée');
     else add('Effectif', EFFECTIF_POINTS[tranche] ?? 15, 15, TRANCHES_EFFECTIF[tranche]);
   
     if (!fin.latest) add('Comptes publiés', 0, 25, 'Aucun compte publié accessible');
     else {
       let pts = 5;
       const notes = ['comptes publiés'];
       if (fin.latest.resultat !== null) {
         if (fin.latest.resultat > 0) { pts += 12; notes.push('résultat net positif'); } else notes.push('résultat net nul ou négatif');
       }
       if (fin.growth !== null) {
         if (fin.growth > 0) { pts += 8; notes.push('CA en hausse'); } else notes.push('CA stable ou en baisse');
       }
       add('Comptes publiés', pts, 25, `Exercice ${fin.latest.year} : ${notes.join(', ')}`);
     }
   
     add('Gouvernance', dirigeants.length > 0 ? 10 : 0, 10,
       dirigeants.length > 0 ? `${dirigeants.length} dirigeant(s) déclaré(s)` : 'Aucun dirigeant déclaré');
   
     const open = numOrNull(company.nombre_etablissements_ouverts);
     add('Établissements ouverts', open !== null && open >= 1 ? 5 : 0, 5,
       open === null ? 'Non renseigné' : `${open} établissement(s) ouvert(s)`);
   
     let total = criteria.reduce((sum, c) => sum + c.pts, 0);
     if (closed) total = Math.min(total, 20);
   
     let grade, label, risk, tone, terms;
     if (closed) {
       grade = 'D'; label = 'ENTREPRISE CESSÉE'; risk = 'Critique'; tone = 'red'; terms = 'Paiement à la commande conseillé';
     } else if (total >= 75) {
       grade = 'A'; label = 'PROFIL FAVORABLE'; risk = 'Faible'; tone = 'emerald'; terms = 'Conditions usuelles';
     } else if (total >= 60) {
       grade = 'B'; label = 'PROFIL CORRECT'; risk = 'Modéré'; tone = 'amber'; terms = 'Conditions usuelles, suivi conseillé';
     } else if (total >= 45) {
       grade = 'C'; label = 'VIGILANCE CONSEILLÉE'; risk = 'Élevé'; tone = 'amber'; terms = 'Terme court ou garanties conseillés';
     } else {
       grade = 'D'; label = 'RISQUE ÉLEVÉ'; risk = 'Élevé'; tone = 'red'; terms = 'Paiement à la commande conseillé';
     }
     return { total, grade, label, risk, tone, terms, criteria, closed };
   }
   
   /* =============================================================================
      6. MODÈLE DE DONNÉES (tout ce que l'interface et le PDF affichent)
      ============================================================================= */
   function parseFinances(company) {
     const raw = company.finances;
     if (!raw || typeof raw !== 'object') return [];
     return Object.keys(raw).sort()
       .map((year) => ({ year, ca: numOrNull(raw[year] && raw[year].ca), resultat: numOrNull(raw[year] && raw[year].resultat_net) }))
       .filter((row) => row.ca !== null || row.resultat !== null);
   }
   
   function summarizeFinances(rows) {
     const recent = rows.slice(-3);
     const latest = recent[recent.length - 1] || null;
     const previous = recent.length > 1 ? recent[recent.length - 2] : null;
     const growth = latest && previous && latest.ca !== null && previous.ca ? (latest.ca - previous.ca) / Math.abs(previous.ca) : null;
     const margin = latest && latest.ca && latest.resultat !== null ? latest.resultat / latest.ca : null;
     return { rows: recent, latest, previous, growth, margin };
   }
   
   /** Arrondi à 2 chiffres significatifs (vers le bas ou vers le haut). */
   function roundSig(n, direction) {
     const step = Math.pow(10, Math.floor(Math.log10(n)) - 1);
     return (direction === 'down' ? Math.floor(n / step) : Math.ceil(n / step)) * step;
   }
   
   /**
    * Estimation du chiffre d'affaires lorsqu'aucun compte n'est publié :
    * effectif (bornes de la tranche Sirene) x ordre de grandeur sectoriel de CA par salarié.
    * Résultat = FOURCHETTE à fiabilité faible, toujours étiquetée « estimation » et jamais utilisée dans le score.
    */
   function estimateRevenue(company) {
     const unavailable = (reason) => ({ available: false, reason });
     if (company.etat_administratif !== 'A') return unavailable('Entreprise cessée : aucune estimation.');
     const naf = company.activite_principale || '';
     if (NON_ESTIMABLE_NAF.test(naf)) {
       return unavailable('Pour une société de portefeuille, une activité immobilière patrimoniale ou une association, le chiffre d’affaires ne se déduit pas de l’effectif.');
     }
     const tranche = company.tranche_effectif_salarie;
     const range = TRANCHE_RANGES[tranche];
     if (!range) return unavailable('Effectif salarié inconnu ou nul : le chiffre d’affaires ne peut pas être déduit de l’effectif.');
   
     const division = parseInt(naf.slice(0, 2), 10);
     const bench = SECTOR_BENCHMARKS.find((b) => division >= b.from && division <= b.to) || GENERIC_BENCHMARK;
     const year = company.annee_tranche_effectif_salarie;
     return {
       available: true,
       low: roundSig(range[0] * bench.min, 'down'),
       high: roundSig(range[1] * bench.max, 'up'),
       confidence: 'Faible',
       basis: `${TRANCHES_EFFECTIF[tranche]}${year ? ` (donnée ${year})` : ''} × ${fmtEuro(bench.min)} à ${fmtEuro(bench.max)} de CA par salarié (${bench.label})`
     };
   }
   
   function buildAddress(siege) {
     const cp = siege.code_postal || '';
     const city = siege.libelle_commune || '';
     let addr = String(siege.adresse || siege.geo_adresse || '').trim();
     if (!addr) addr = [cp, city].filter(Boolean).join(' ');
     else {
       if (cp && !addr.includes(cp)) addr += ` ${cp}`;
       if (city && !addr.toUpperCase().includes(String(city).toUpperCase())) addr += ` ${city}`;
     }
     return addr || NA;
   }
   
   function buildView(company) {
     const siege = company.siege || {};
     const dirigeants = Array.isArray(company.dirigeants) ? company.dirigeants : [];
     const fin = summarizeFinances(parseFinances(company));
     const raison = String(company.nom_complet || company.nom_raison_sociale || company.nom || 'ENTREPRISE');
     const nature = company.nature_juridique ? String(company.nature_juridique) : '';
   
     return {
       company,
       siege,
       dirigeants,
       fin,
       estimate: fin.rows.length ? { available: false, reason: 'Comptes publiés disponibles.' } : estimateRevenue(company),
       analysis: null,
       score: computeScore(company, fin, dirigeants),
       displayName: companyDisplayName(company).toUpperCase(),
       raison: raison.split('(')[0].trim(),
       siren: digits(company.siren),
       siret: digits(siege.siret),
       naf: company.activite_principale || '',
       active: company.etat_administratif === 'A',
       siegeActive: siege.etat_administratif === 'A',
       dateCreation: company.date_creation || '',
       dateFermeture: company.date_fermeture || '',
       forme: nature ? (NATURE_JURIDIQUE[nature] || `Code nature juridique ${nature}`) : NA,
       effectif: TRANCHES_EFFECTIF[company.tranche_effectif_salarie] || NA,
       categorie: company.categorie_entreprise || NA,
       address: buildAddress(siege),
       postal: siege.code_postal || '',
       city: siege.libelle_commune || '',
       lat: parseFloat(siege.latitude),
       lon: parseFloat(siege.longitude),
       nbEtab: numOrNull(company.nombre_etablissements),
       nbEtabOpen: numOrNull(company.nombre_etablissements_ouverts),
       extractedAt: new Date()
     };
   }
   
   /* =============================================================================
      7. RENDU DU TABLEAU DE BORD
      ============================================================================= */
   const tile = (label, value, tone = 'text-white') =>
     `<div class="bg-slate-800/80 p-2.5 rounded-lg border border-slate-700/60 text-left">` +
     `<span class="text-[10px] text-slate-400 block uppercase font-medium">${esc(label)}</span>` +
     `<span class="text-xs font-bold ${tone}">${esc(value)}</span></div>`;
   
   const tilesRow = (tiles) => `<div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">${tiles.join('')}</div>`;
   
   const bullets = (items) =>
     `<div class="border-t border-slate-800 pt-2 text-xs text-slate-300 space-y-1.5 text-left">` +
     items.map(([title, body]) => `<p><strong class="text-white">• ${esc(title)} :</strong> ${esc(body)}</p>`).join('') + '</div>';
   
   const externalLink = (href, label, icon = 'fa-arrow-up-right-from-square') =>
     `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" ` +
     `class="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 rounded-lg text-xs font-bold transition-all inline-flex items-center gap-1.5">` +
     `<i class="fa-solid ${icon}"></i> ${esc(label)}</a>`;
   
   const auditButton = (siren) =>
     `<button type="button" data-audit-siren="${esc(digits(siren))}" ` +
     `class="px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-400/40 rounded-lg text-xs font-bold transition-all inline-flex items-center gap-1.5">` +
     `<i class="fa-solid fa-magnifying-glass"></i> Auditer</button>`;
   
   const infoCard = (title, text) =>
     `<div class="p-3.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-300 space-y-1">` +
     `<strong class="text-white block">${esc(title)}</strong><p>${esc(text)}</p></div>`;
   
   function selectCompany(company) {
     if (!company) return;
     const view = buildView(company);
     state.view = view;
   
     renderHeader(view);
     renderScore(view);
     renderLeaders(view);
     renderFinances(view);
     renderGroup(view);
     renderCompliance(view);
     renderRealEstate(view);
     renderCompanyMap(view);
     renderAnalysis(view);
   
     const dash = $('dashboard-content');
     if (dash) dash.classList.remove('hidden');
     switchTab('cat-finances');
     hideAutocomplete();
     if (dash && dash.scrollIntoView) dash.scrollIntoView({ behavior: 'smooth', block: 'start' });
   }
   
   function renderHeader(v) {
     setText('company-name', v.displayName);
     setText('company-siren', v.siren || '---');
     setText('company-naf', v.naf || '---');
     setText('company-date', fmtDate(v.dateCreation));
   
     const pill = (id, tone, html) => {
       const el = $(id);
       if (!el) return;
       el.className = `px-3 py-1 rounded-full text-xs font-bold ${TONES[tone].pill}`;
       el.innerHTML = html;
     };
     pill('badge-status-insee', v.active ? 'emerald' : 'red', esc(v.active ? 'Actif (INSEE)' : 'Cessé (INSEE)'));
     pill('badge-status-site', v.siegeActive ? 'emerald' : 'red',
       `<i class="fa-solid fa-store mr-1"></i>${esc(v.siegeActive ? 'SIÈGE OUVERT' : 'SIÈGE FERMÉ')}`);
   
     const food = $('badge-daaf-status');
     if (food) {
       const isFood = /^(56|10|47\.11|47\.2)/.test(v.naf); // restauration, industrie alimentaire, commerce alimentaire
       food.classList.toggle('hidden', !isFood);
       food.className = `px-3 py-1 rounded-lg text-xs font-bold ${TONES.slate.pill}${isFood ? '' : ' hidden'}`;
       food.innerHTML = '<i class="fa-solid fa-circle-info"></i> CONTRÔLE SANITAIRE : NON INTÉGRÉ';
     }
   
     const banner = $('alert-banner-daaf');
     if (banner) {
       banner.classList.toggle('hidden', v.active);
       if (!v.active) {
         setHTML('alert-daaf-text',
           `<strong>Alerte :</strong> cette entreprise est enregistrée comme cessée au répertoire Sirene` +
           `${v.dateFermeture ? ` (depuis le ${esc(fmtDate(v.dateFermeture))})` : ''}. Toute relation commerciale doit être revue.`);
       }
     }
   
     setHTML('company-official-links',
       [externalLink(LINKS.annuaire(v.siren), 'Annuaire Entreprises', 'fa-building-columns'),
         externalLink(LINKS.inpi(v.siren), 'INPI', 'fa-file-invoice'),
         externalLink(LINKS.bodacc, 'BODACC', 'fa-newspaper')].join(''));
   }
   
   function drawScoreGauge(score, color) {
     const canvas = $('scoreGaugeCanvas');
     if (!canvas) return;
     const ctx = canvas.getContext('2d');
     ctx.clearRect(0, 0, canvas.width, canvas.height);
     const cx = canvas.width / 2;
     const cy = canvas.height / 2;
     const radius = 65;
   
     ctx.lineWidth = 12;
     ctx.beginPath();
     ctx.arc(cx, cy, radius, 0.8 * Math.PI, 2.2 * Math.PI);
     ctx.strokeStyle = 'rgba(30, 41, 59, 0.6)';
     ctx.stroke();
   
     ctx.beginPath();
     ctx.arc(cx, cy, radius, 0.8 * Math.PI, 0.8 * Math.PI + (score / 100) * 1.4 * Math.PI);
     ctx.strokeStyle = color;
     ctx.stroke();
   }
   
   function renderScore(v) {
     const s = v.score;
     const tone = TONES[s.tone];
     drawScoreGauge(s.total, tone.hex);
     setText('score-value', String(s.total));
   
     const label = $('score-label');
     if (label) {
       label.textContent = `${s.label} (INDICATIF)`;
       label.className = `text-xs font-bold ${tone.text}`;
     }
   
     setText('credit-limit', 'Non chiffré');
     setText('payment-terms', s.terms);
   
     const risk = $('risk-level');
     if (risk) {
       risk.textContent = s.risk;
       risk.className = `text-2xl font-black ${tone.text}`;
     }
     const grade = $('credit-rating-grade');
     if (grade) {
       grade.textContent = `GRADE ${s.grade}`;
       grade.className = `text-xs font-bold px-2.5 py-0.5 rounded ${tone.pill}`;
     }
   }
   
   function renderLeaders(v) {
     const box = $('leaders-container');
     if (!box) return;
     box.replaceChildren();
     if (v.dirigeants.length === 0) {
       box.appendChild(h('div', 'p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-300', 'Aucun dirigeant renseigné dans les sources publiques.'));
       return;
     }
     v.dirigeants.slice(0, 6).forEach((d) => {
       const legal = d.type_dirigeant === 'personne morale';
       const name = legal ? (d.denomination || NA) : [d.prenoms, d.nom].filter(Boolean).join(' ') || NA;
       const row = h('div', 'p-3 bg-slate-900 border border-slate-800 rounded-xl flex justify-between items-center text-xs');
       const left = h('div');
       left.appendChild(h('div', 'font-bold text-white', name));
       left.appendChild(h('div', 'text-slate-400', d.qualite || 'Dirigeant'));
       row.appendChild(left);
       row.appendChild(h('span', 'text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-mono', legal ? 'Personne morale' : 'Mandat RCS'));
       box.appendChild(row);
     });
   }
   
   function emptyFinanceHTML(est) {
     const base = '<p class="mb-3">Comptes non publiés ou non accessibles via les sources ouvertes : aucun historique financier à afficher.</p>';
     if (!est || !est.available) {
       return `<div class="text-center">${base}${est && est.reason ? `<p class="text-slate-500">${esc(est.reason)}</p>` : ''}</div>`;
     }
     return `<div class="max-w-md w-full text-left">${base}` +
       `<div class="border border-dashed border-amber-500/60 bg-amber-500/5 rounded-xl p-4">` +
       `<span class="text-[10px] font-bold uppercase text-amber-400 block mb-1">Estimation indicative — non issue de comptes publiés</span>` +
       `<div class="text-lg font-black text-white">${esc(fmtEuro(est.low))} à ${esc(fmtEuro(est.high))}</div>` +
       `<p class="text-[11px] text-slate-400 mt-1">Chiffre d’affaires annuel possible. Base : ${esc(est.basis)}. ` +
       `Fiabilité : ${esc(est.confidence.toLowerCase())}. À ne pas utiliser pour fixer un encours.</p></div></div>`;
   }
   
   function renderChart(rows, estimate) {
     const canvas = $('financialChart');
     if (!canvas) return;
     let empty = $('financial-empty');
     if (!empty) {
       empty = h('div', 'h-full flex items-center justify-center text-center text-xs text-slate-400 px-6');
       empty.id = 'financial-empty';
       canvas.parentElement.appendChild(empty);
     }
     if (state.chart) { state.chart.destroy(); state.chart = null; }
   
     if (rows.length === 0 || typeof Chart === 'undefined') {
       canvas.classList.add('hidden');
       empty.classList.remove('hidden');
       if (rows.length === 0) empty.innerHTML = emptyFinanceHTML(estimate);
       else empty.textContent = 'Graphique indisponible (bibliothèque Chart.js non chargée).';
       return;
     }
     canvas.classList.remove('hidden');
     empty.classList.add('hidden');
   
     Chart.defaults.color = '#94a3b8';
     Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.15)';
     const toK = (n) => (n === null ? null : Math.round(n / 1000));
     state.chart = new Chart(canvas.getContext('2d'), {
       type: 'bar',
       data: {
         labels: rows.map((r) => r.year),
         datasets: [
           { label: "Chiffre d'Affaires (k€)", data: rows.map((r) => toK(r.ca)), backgroundColor: 'rgba(0, 242, 254, 0.6)' },
           { label: 'Résultat Net (k€)', data: rows.map((r) => toK(r.resultat)), backgroundColor: 'rgba(16, 185, 129, 0.6)' }
         ]
       },
       options: { responsive: true, maintainAspectRatio: false, animation: { duration: 300 } }
     });
   }
   
   function renderFinances(v) {
     const { fin, score } = v;
     renderChart(fin.rows, v.estimate);
   
     setText('ratio-marge', fin.margin === null ? NA : fmtPct(fin.margin));
     setText('ratio-autonomie', NA);
     setText('ratio-paydex', NA);
   
     const growth = $('ratio-croissance');
     if (growth) {
       growth.textContent = fin.growth === null ? NA : fmtPct(fin.growth, true);
       const tone = fin.growth === null ? 'text-slate-200' : fin.growth >= 0 ? 'text-emerald-400' : 'text-red-400';
       growth.className = `${tone} font-mono`;
     }
   
     const tone = TONES[score.tone];
     const latestText = fin.latest
       ? `Dernier exercice publié : ${fin.latest.year} — CA ${fmtEuro(fin.latest.ca)}, résultat net ${fmtEuro(fin.latest.resultat)}.`
       : 'Aucun compte publié n’est accessible : l’analyse financière est limitée aux éléments d’identité et d’ancienneté.';
   
     setHTML('ai-synthesis-finances',
       tilesRow([tile('Niveau de risque indicatif', score.risk, tone.text), tile('Conditions suggérées', score.terms), tile('Note indicative', `${score.total} / 100 (grade ${score.grade})`, tone.text)]) +
       bullets([
         ['Données financières', latestText],
         ...(v.estimate.available ? [['Estimation indicative du CA', `Entre ${fmtEuro(v.estimate.low)} et ${fmtEuro(v.estimate.high)} (fiabilité faible). Ce n’est pas un chiffre publié et il n’entre ni dans la note ni dans les ratios.`]] : []),
         ['Plafond d’encours', 'Aucun montant n’est calculé automatiquement : il dépend de votre exposition, de vos garanties et de comptes à jour.'],
         ['Indicateurs non disponibles', 'Autonomie financière, délais de paiement (Paydex), DSO, DPO et BFR ne figurent pas dans les sources ouvertes.']
       ]) +
       `<div class="border-t border-slate-800 mt-3 pt-2 text-xs text-slate-300 text-left"><strong class="text-white block mb-1">Détail de la note indicative</strong>` +
       score.criteria.map((c) => `<p class="flex justify-between gap-3"><span>${esc(c.name)} — <span class="text-slate-400">${esc(c.note)}</span></span><span class="font-mono text-slate-200 whitespace-nowrap">${c.pts}/${c.max}</span></p>`).join('') + '</div>');
   }
   
   function renderGroup(v) {
     const holding = $('holding-container');
     if (holding) {
       holding.replaceChildren();
       const legalPersons = v.dirigeants.filter((d) => d.type_dirigeant === 'personne morale' && digits(d.siren).length === 9);
       if (legalPersons.length === 0) {
         holding.innerHTML = `<div class="p-3 text-xs text-slate-400 font-mono">Aucune personne morale dirigeante déclarée dans les sources publiques.</div>`;
       } else {
         holding.innerHTML = legalPersons.map((d) => {
           const siren = digits(d.siren);
           return `<div class="p-4 bg-slate-900/90 border border-indigo-500/40 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-2">` +
             `<div><div class="flex flex-wrap items-center gap-2"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/30 text-indigo-300 font-mono">PERSONNE MORALE DIRIGEANTE</span>` +
             `<strong class="text-white text-sm font-bold">${esc(d.denomination || NA)}</strong></div>` +
             `<div class="text-xs text-slate-400 mt-1 font-mono">SIREN: <strong class="text-slate-200">${esc(siren)}</strong> | ${esc(d.qualite || 'Dirigeant')}</div></div>` +
             `<div class="flex flex-wrap items-center gap-2">${externalLink(LINKS.annuaire(siren), 'Annuaire', 'fa-building-columns')}${auditButton(siren)}</div></div>`;
         }).join('');
       }
     }
   
     const assoc = $('associated-restaurants-container');
     if (assoc) {
       const etab = v.nbEtab === null ? NA : `${v.nbEtab} établissement(s), dont ${v.nbEtabOpen === null ? NA : v.nbEtabOpen} ouvert(s)`;
       assoc.innerHTML =
         infoCard('Siège social', `${v.address} — ${v.siegeActive ? 'ouvert' : 'fermé'}`) +
         infoCard('Établissements de l’entreprise', etab);
     }
   
     setHTML('ai-synthesis-kyc',
       tilesRow([tile('Établissements', v.nbEtab === null ? NA : String(v.nbEtab), 'text-sky-400'), tile('Registre RBO', 'Non consulté', 'text-slate-300'), tile('Sanctions / PPE', 'Non consulté', 'text-slate-300')]) +
       bullets([
         ['Périmètre', 'Les liens de groupe ne sont affichés que lorsqu’une personne morale est déclarée dirigeante au registre.'],
         ['Conformité LCB-FT', 'Cette plateforme ne consulte ni le registre des bénéficiaires effectifs ni les listes de gel des avoirs : à vérifier avant tout engagement significatif.']
       ]) +
       `<div class="flex flex-wrap gap-2 mt-3">${externalLink(LINKS.gelAvoirs, 'Registre des gels des avoirs')}${externalLink(LINKS.inpi(v.siren), 'Registre INPI')}</div>`);
   }
   
   function renderCompliance(v) {
     setHTML('press-sanitary-container',
       infoCard('Statut administratif (INSEE / Sirene)',
         v.active ? 'Entreprise active au répertoire Sirene.' : `Entreprise cessée${v.dateFermeture ? ` depuis le ${fmtDate(v.dateFermeture)}` : ''}.`) +
       `<div class="mt-2">${infoCard('Contrôles sanitaires officiels', 'Les résultats de contrôle (Alim’confiance) ne sont pas intégrés à cette plateforme.')}</div>`);
   
     setHTML('ai-synthesis-conformite',
       tilesRow([tile('Statut administratif', v.active ? 'Entreprise active' : 'Entreprise cessée', v.active ? 'text-emerald-400' : 'text-red-400'),
         tile('Contrôle sanitaire', 'Non intégré', 'text-slate-300'), tile('Annonces BODACC', 'Non intégré', 'text-slate-300')]) +
       bullets([
         ['Annonces légales', 'Procédures collectives et publications au BODACC : consultez la source officielle pour une vérification à jour.'],
         ['Hygiène alimentaire', 'Pour les activités concernées, consultez les résultats de contrôle officiels publiés sur Alim’confiance.']
       ]) +
       `<div class="flex flex-wrap gap-2 mt-3">${externalLink(LINKS.bodacc, 'BODACC')}${externalLink(LINKS.alimconfiance, 'Alim’confiance')}</div>`);
   }
   
   function renderRealEstate(v) {
     setText('immo-valeur', NA);
     setHTML('ai-synthesis-legal',
       tilesRow([tile('Estimation immobilière', NA, 'text-slate-300'), tile('Données DVF', 'Non intégré', 'text-slate-300'), tile('Adresse du siège', v.city || NA)]) +
       bullets([['Valorisation', 'Aucune estimation n’est produite : les valeurs foncières (DVF) ne sont pas intégrées et un bail commercial ne se déduit pas de données publiques.']]) +
       `<div class="flex flex-wrap gap-2 mt-3">${externalLink(LINKS.dvf, 'Explorateur DVF (DGFiP / Etalab)')}</div>`);
   }
   
   function switchTab(tabId) {
     document.querySelectorAll('.tab-content').forEach((el) => el.classList.add('hidden'));
     document.querySelectorAll('.tab-btn').forEach((el) => el.classList.remove('active'));
     const panel = $(tabId);
     const button = $(`tab-btn-${tabId}`);
     if (panel) panel.classList.remove('hidden');
     if (button) button.classList.add('active');
   }
   
   /* =============================================================================
      8. CARTE (Leaflet)
      ============================================================================= */
   function ensureMap() {
     const el = $('map');
     if (!el || typeof L === 'undefined') return null;
     if (!state.map) {
       state.map = L.map('map', { zoomControl: true, scrollWheelZoom: false });
       L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(state.map);
       state.markerLayer = L.layerGroup().addTo(state.map);
     }
     setTimeout(() => state.map && state.map.invalidateSize(), 150);
     return state.map;
   }
   
   function showHomeMap() {
     const map = ensureMap();
     if (!map) return;
     state.markerLayer.clearLayers();
     map.setView([48.8566, 12.3522], 4);
     [['Paris', 48.8566, 2.3522], ['Bruxelles', 50.8503, 4.3517], ['Berne', 46.948, 7.4474], ['Francfort', 50.1109, 8.6821]]
       .forEach(([name, lat, lon]) => L.marker([lat, lon]).addTo(state.markerLayer).bindPopup(name));
   }
   
   function setMapHeader(title, postal, address) {
     setHTML('map-section-title', `<i class="fa-solid fa-location-dot text-cyan-400 mr-2"></i>${esc(title)}`);
     setText('map-postal-code', postal);
     setText('map-address-text', address);
   }
   
   function renderCompanyMap(v) {
     setMapHeader(`Siège social — ${v.displayName}`, [v.postal, v.city].filter(Boolean).join(' ') || 'FRANCE', v.address);
     const map = ensureMap();
     if (!map) return;
     if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) {
       showHomeMap();
       setText('map-address-text', `${v.address} — localisation GPS non disponible.`);
       return;
     }
     state.markerLayer.clearLayers();
     const popup = h('div');
     popup.appendChild(h('b', undefined, v.displayName));
     popup.appendChild(document.createElement('br'));
     popup.appendChild(h('span', undefined, v.address));
     L.marker([v.lat, v.lon]).addTo(state.markerLayer).bindPopup(popup).openPopup();
     map.setView([v.lat, v.lon], 15);
   }
   
   /* =============================================================================
      9. RAPPORT PDF (pdfMake) — document d'information, jamais « certifié »
      ============================================================================= */
   const LEGAL_NOTICE =
     'Ce rapport est établi par Euro Expert Solvabilité à partir de sources publiques (répertoire Sirene de l’INSEE et ' +
     'comptes publiés, via l’API Recherche d’entreprises). Il est fourni à titre d’information, sans valeur contractuelle ' +
     'ni garantie. La note est indicative : elle ne constitue ni une notation de crédit réglementée, ni un conseil, ni une ' +
     'certification. Les éléments non consultés sont signalés comme tels et doivent être vérifiés auprès des sources officielles. ' +
     'Les estimations et l’analyse rédigée, lorsqu’elles figurent dans ce rapport, sont signalées comme telles et ne constituent pas des données publiées.';
   
   const LOGO_SVG =
     '<svg width="45" height="45" viewBox="0 0 100 100"><rect width="100" height="100" rx="16" fill="#0f172a"/>' +
     '<path d="M50 15 L82 30 V55 C82 76 50 90 50 90 C50 90 18 76 18 55 V30 Z" fill="none" stroke="#0284c7" stroke-width="6"/>' +
     '<path d="M40 50 L48 58 L62 40" fill="none" stroke="#34d399" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
   
   function buildReportDefinition(v) {
     const s = v.score;
     const color = TONES[s.tone].pdf;
     const dateLong = v.extractedAt.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
     const reference = `EES-${v.siren}-${v.extractedAt.toISOString().slice(0, 10).replace(/-/g, '')}`;
   
     const layout = {
       hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
       vLineWidth: () => 0.5,
       hLineColor: () => '#cbd5e1',
       vLineColor: () => '#cbd5e1'
     };
     const section = (text) => ({ text, style: 'sectionTitle' });
     const label = (text) => ({ text, style: 'tableLabel' });
     const cell = (text, extra = {}) => ({ text: String(text ?? NA), fontSize: 7.5, ...extra });
     const head = (text, style = 'tableHeaderDark') => ({ text, style });
     const rule = { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 543, y2: 0, lineWidth: 1.5, lineColor: '#0284c7' }], margin: [0, 0, 0, 10] };
     const pageHeader = (title) => ({
       columns: [
         { text: title, fontSize: 8.5, bold: true, color: '#0f172a' },
         { text: `SIREN : ${v.siren}`, fontSize: 8, bold: true, color: '#475569', alignment: 'right' }
       ],
       margin: [0, 0, 0, 6]
     });
     const noticeBox = (fill, titleColor, title, body) => ({
       table: { widths: ['*'], body: [[{ fillColor: fill, margin: [8, 8, 8, 8], stack: [
         { text: title, fontSize: 7.5, bold: true, color: titleColor, margin: [0, 0, 0, 3] },
         { text: body, fontSize: 7.5, color: '#334155' }] }]] },
       layout: 'noBorders',
       margin: [0, 0, 0, 10]
     });
     const statBox = (title, value, sub, valueColor, width) => ({
       width,
       table: { widths: ['*'], body: [[{ fillColor: '#f8fafc', margin: [4, 6, 4, 6], stack: [
         { text: title, fontSize: 6.5, bold: true, color: '#475569', alignment: 'center' },
         { text: value, fontSize: 10.5, bold: true, color: valueColor, alignment: 'center', margin: [0, 3, 0, 2] },
         { text: sub, fontSize: 6.5, color: '#64748b', alignment: 'center' }] }]] },
       layout
     });
   
     /* ---- Synthèse ---- */
     const finSentence = v.fin.latest
       ? `Derniers comptes publiés : exercice ${v.fin.latest.year}.`
       : 'Aucun compte publié n’est accessible : l’analyse financière est limitée.';
     const summaryText = v.active
       ? `Synthèse établie à partir des données publiques disponibles pour ${v.raison} (SIREN ${v.siren}). Note indicative : ${s.total}/100 — ${s.label.toLowerCase()}. ${finSentence}`
       : `${v.raison} (SIREN ${v.siren}) est enregistrée comme CESSÉE au répertoire Sirene${v.dateFermeture ? ` depuis le ${fmtDate(v.dateFermeture)}` : ''}. Toute relation commerciale doit être revue.`;
   
     /* ---- Spectre de risque ---- */
     const spectrum = [['Très élevé', '#991b1b', '#ffffff'], ['Élevé', '#c2410c', '#ffffff'], ['Assez élevé', '#d97706', '#ffffff'],
       ['Moyen', '#eab308', '#0f172a'], ['Assez faible', '#0d9488', '#ffffff'], ['Faible', '#059669', '#ffffff'], ['Très faible', '#065f46', '#ffffff']];
     const activeIndex = Math.min(6, Math.floor(s.total / (100 / 7)));
     const spectrumHead = spectrum.map(([text, fill, txt]) => ({ text, fillColor: fill, color: txt, fontSize: 6, bold: true, alignment: 'center', margin: [0, 3, 0, 3] }));
     const spectrumPointer = spectrum.map((_, i) => (i === activeIndex
       ? { text: '[ ESTIMATION ]', color, fontSize: 6.5, bold: true, alignment: 'center', margin: [0, 2, 0, 0] }
       : { text: '', fontSize: 6.5 }));
   
     /* ---- Finances ---- */
     const rows = v.fin.rows;
     const variation = (current, previous) => (current === null || previous === null || !previous ? '—' : fmtPct((current - previous) / Math.abs(previous), true));
     const financeBody = [[head('EXERCICE'), head('CHIFFRE D’AFFAIRES', 'tableHeaderDarkRight'), head('RÉSULTAT NET', 'tableHeaderDarkRight'), head('VARIATION DU CA', 'tableHeaderDarkCenter')]];
     rows.forEach((r, i) => financeBody.push([
       cell(r.year, { bold: true }), cell(fmtEuro(r.ca), { alignment: 'right' }),
       cell(fmtEuro(r.resultat), { alignment: 'right', color: r.resultat !== null && r.resultat < 0 ? '#dc2626' : '#0f172a' }),
       cell(i === 0 ? '—' : variation(r.ca, rows[i - 1].ca), { alignment: 'center' })
     ]));
     const dashedLayout = {
       hLineWidth: () => 1, vLineWidth: () => 1,
       hLineColor: () => '#d97706', vLineColor: () => '#d97706',
       hLineStyle: () => ({ dash: { length: 3, space: 2 } }), vLineStyle: () => ({ dash: { length: 3, space: 2 } })
     };
     const est = v.estimate;
     const estimateBlock = est.available
       ? { table: { widths: ['*'], body: [[{ fillColor: '#fffbeb', margin: [8, 8, 8, 8], stack: [
         { text: 'ESTIMATION INDICATIVE — NON ISSUE DE COMPTES PUBLIÉS', fontSize: 7, bold: true, color: '#b45309', margin: [0, 0, 0, 3] },
         { text: `Chiffre d’affaires annuel possible : ${fmtEuro(est.low)} à ${fmtEuro(est.high)}`, fontSize: 9.5, bold: true, color: '#0f172a', margin: [0, 0, 0, 3] },
         { text: `Base de calcul : ${est.basis}. Fiabilité : ${est.confidence.toLowerCase()}. Cette fourchette n’entre ni dans la note ni dans les ratios et ne doit pas servir à fixer un encours.`, fontSize: 7, color: '#78350f' }] }]] },
         layout: dashedLayout, margin: [0, 0, 0, 10] }
       : { text: est.reason || '', fontSize: 7, color: '#64748b', margin: [0, 0, 0, 10] };
     const financeBlock = rows.length
       ? { table: { widths: ['16%', '30%', '30%', '24%'], body: financeBody }, layout, margin: [0, 0, 0, 10] }
       : { stack: [noticeBox('#f8fafc', '#475569', 'COMPTES NON DISPONIBLES', 'Aucun compte publié n’est accessible via les sources ouvertes pour cette entité (comptes non déposés ou confidentiels).'), estimateBlock] };
   
     const ratioRows = [
       [head('INDICATEUR'), head('VALEUR', 'tableHeaderDarkCenter'), head('MÉTHODE / SOURCE')],
       [cell('Marge nette', { bold: true }), cell(v.fin.margin === null ? NA : fmtPct(v.fin.margin), { alignment: 'center', bold: true }), cell('Résultat net / CA du dernier exercice publié')],
       [cell('Croissance du CA', { bold: true }), cell(v.fin.growth === null ? NA : fmtPct(v.fin.growth, true), { alignment: 'center', bold: true }), cell('Variation entre les deux derniers exercices publiés')],
       [cell('Autonomie financière', { bold: true }), cell(NA, { alignment: 'center' }), cell('Bilan détaillé non accessible via les sources ouvertes')],
       [cell('Délais de paiement (Paydex, DSO, DPO)', { bold: true }), cell(NA, { alignment: 'center' }), cell('Données non publiques (fournisseurs privés)')]
     ];
   
     const effortBlock = v.fin.margin !== null && v.fin.margin > 0
       ? noticeBox('#fff7ed', '#9a3412', 'EFFORT DE CHIFFRE D’AFFAIRES EN CAS D’IMPAYÉ',
         `Pour absorber un impayé de 10 000 €, ${v.raison} devrait réaliser environ ${fmtEuro(10000 / v.fin.margin)} de chiffre d’affaires supplémentaire, ` +
         `sur la base de sa marge nette de ${fmtPct(v.fin.margin)} (exercice ${v.fin.latest.year}).`)
       : noticeBox('#f8fafc', '#475569', 'EFFORT DE CHIFFRE D’AFFAIRES EN CAS D’IMPAYÉ',
         'Non calculable : la marge nette de l’entité n’est pas disponible ou n’est pas positive.');
   
     /* ---- Analyse rédigée (si générée) ---- */
     let sectionNo = 6;
     const nextSection = (title) => section(`${++sectionNo}. ${title}`);
     const analysisBlocks = [];
     if (v.analysis) {
       const a = v.analysis;
       const listPdf = (title, items, titleColor) => (items && items.length
         ? [{ text: title, fontSize: 7.5, bold: true, color: titleColor, margin: [0, 2, 0, 2] }, { ul: items.map((t) => ({ text: t, fontSize: 7.5, margin: [0, 0, 0, 1] })), margin: [0, 0, 0, 4] }]
         : []);
       analysisBlocks.push(
         nextSection('ANALYSE RÉDIGÉE'),
         { text: a.source === 'ia' ? 'Texte rédigé par une IA à partir des seules données de ce rapport. À relire avant diffusion.' : 'Synthèse générée automatiquement, sans IA, à partir des données de ce rapport.', fontSize: 6.5, italics: true, color: '#64748b', margin: [0, 0, 0, 4] },
         { text: a.resume, fontSize: 7.5, color: '#0f172a', margin: [0, 0, 0, 6] },
         ...listPdf('Points forts', a.points_forts, '#059669'),
         ...listPdf('Points de vigilance', a.points_vigilance, '#d97706'),
         { text: [{ text: 'Recommandation : ', bold: true }, a.recommandation], fontSize: 7.5, color: '#0f172a', margin: [0, 2, 0, 4] },
         ...listPdf('À vérifier', a.verifications, '#0284c7'),
         { text: '', margin: [0, 0, 0, 6] }
       );
     }
   
     /* ---- Gouvernance ---- */
     const governanceBody = [[head('NOM / DÉNOMINATION'), head('QUALITÉ'), head('TYPE')]];
     v.dirigeants.slice(0, 8).forEach((d) => {
       const legal = d.type_dirigeant === 'personne morale';
       governanceBody.push([
         cell(legal ? (d.denomination || NA) : [d.prenoms, d.nom].filter(Boolean).join(' ') || NA, { bold: true }),
         cell(d.qualite || 'Dirigeant'),
         cell(legal ? `Personne morale${digits(d.siren) ? ` (SIREN ${digits(d.siren)})` : ''}` : 'Personne physique')
       ]);
     });
     const governanceBlock = v.dirigeants.length
       ? { table: { widths: ['40%', '30%', '30%'], body: governanceBody }, layout, margin: [0, 0, 0, 10] }
       : noticeBox('#f8fafc', '#475569', 'DIRIGEANTS NON RENSEIGNÉS', 'Aucun dirigeant n’est déclaré dans les sources publiques consultées.');
   
     /* ---- Contrôles ---- */
     const checkRow = (name, status, source, ok = false) => [
       cell(name, { bold: true }), cell(status, { bold: true, color: ok ? '#059669' : '#475569', alignment: 'center' }), cell(source)];
     const checks = [
       [head('CONTRÔLE'), head('STATUT', 'tableHeaderDarkCenter'), head('SOURCE OFFICIELLE À CONSULTER')],
       checkRow('Statut administratif', v.active ? 'Vérifié : actif' : 'Vérifié : cessé', 'Répertoire Sirene (INSEE)', v.active),
       checkRow('Annonces légales / procédures collectives', 'Non consulté', 'BODACC — bodacc.fr'),
       checkRow('Bénéficiaires effectifs (RBE)', 'Non consulté', 'Registre INPI — data.inpi.fr'),
       checkRow('Gel des avoirs / sanctions', 'Non consulté', 'DG Trésor — gels-avoirs.dgtresor.gouv.fr'),
       checkRow('Contrôles sanitaires (si concerné)', 'Non consulté', 'Alim’confiance — alim-confiance.gouv.fr'),
       checkRow('Valeurs foncières', 'Non consulté', 'DVF — app.dvf.etalab.gouv.fr')
     ];
   
     return {
       pageSize: 'A4',
       pageMargins: [26, 26, 26, 30],
       info: { title: `Rapport d’analyse ${v.raison}`, author: 'Euro Expert Solvabilité', subject: `SIREN ${v.siren}` },
       footer: (currentPage, pageCount) => ({
         columns: [
           { text: '© 2026 Euro Expert Solvabilité • Source : Sirene (INSEE) via API Recherche d’entreprises • Document d’information non contractuel', style: 'footerText' },
           { text: `Page ${currentPage} sur ${pageCount}`, alignment: 'right', style: 'footerText' }
         ],
         margin: [26, 6, 26, 0]
       }),
       content: [
         /* ===== PAGE 1 ===== */
         {
           columns: [
             { svg: LOGO_SVG, width: 36, height: 36 },
             { stack: [
               { text: 'EURO EXPERT SOLVABILITÉ', fontSize: 13.5, bold: true, color: '#0f172a' },
               { text: 'RAPPORT D’ANALYSE B2B — DONNÉES PUBLIQUES', fontSize: 7, bold: true, color: '#0284c7', margin: [0, 2, 0, 0] }], margin: [8, 0, 0, 0] },
             { stack: [
               { text: `Édition : ${dateLong}`, fontSize: 7, color: '#475569', alignment: 'right' },
               { text: `Réf. : ${reference}`, fontSize: 7.5, bold: true, color: '#0f172a', alignment: 'right', margin: [0, 1, 0, 0] },
               { text: 'Rapport établi par Euro Expert Solvabilité', fontSize: 6.5, color: '#0284c7', alignment: 'right', margin: [0, 1, 0, 0] }] }
           ],
           margin: [0, 0, 0, 8]
         },
         rule,
         {
           table: { widths: ['*'], body: [[{ fillColor: '#0f172a', margin: [10, 8, 10, 8], stack: [
             { text: 'SYNTHÈSE DE L’ANALYSE', fontSize: 9.5, bold: true, color: '#38bdf8', margin: [0, 0, 0, 4] },
             { text: summaryText, fontSize: 7.5, color: '#f8fafc' }] }]] },
           layout: 'noBorders',
           margin: [0, 0, 0, 10]
         },
   
         section('1. IDENTITÉ LÉGALE (RÉPERTOIRE SIRENE)'),
         { table: { widths: ['22%', '28%', '22%', '28%'], body: [
           [label('Raison sociale'), cell(v.raison, { bold: true, fontSize: 8 }), label('Forme juridique'), cell(v.forme)],
           [label('SIREN / SIRET'), cell(`${v.siren || NA} / ${v.siret || NA}`, { bold: true, color: '#0284c7' }), label('Code NAF / APE'), cell(v.naf || NA)],
           [label('TVA intracom. (théorique)'), cell(vatFromSiren(v.siren)), label('Date de création'), cell(fmtDate(v.dateCreation), { bold: true })],
           [label('Effectif (tranche)'), cell(v.effectif), label('Catégorie'), cell(v.categorie)],
           [label('Statut administratif'), cell(v.active ? 'Active' : `Cessée${v.dateFermeture ? ` (${fmtDate(v.dateFermeture)})` : ''}`, { bold: true, color: v.active ? '#059669' : '#dc2626' }), label('Établissements'), cell(v.nbEtab === null ? NA : `${v.nbEtab} (dont ${v.nbEtabOpen === null ? NA : v.nbEtabOpen} ouvert(s))`)],
           [label('Siège social'), cell(v.address, { colSpan: 3 }), {}, {}]
         ] }, layout, margin: [0, 0, 0, 10] },
   
         section('2. NOTE INDICATIVE ET NIVEAU DE RISQUE'),
         { columns: [
           statBox('NOTE INDICATIVE', `${s.total} / 100`, `Grade ${s.grade}`, color, '32%'),
           statBox('NIVEAU DE RISQUE INDICATIF', s.risk, s.label, color, '34%'),
           statBox('CONDITIONS SUGGÉRÉES', s.terms, 'Aucun plafond chiffré', '#0284c7', '34%')
         ], columnGap: 6, margin: [0, 0, 0, 8] },
         { text: 'POSITION SUR LE SPECTRE DE RISQUE COMMERCIAL', fontSize: 7.5, bold: true, color: '#0f172a', margin: [0, 0, 0, 3] },
         { table: { widths: Array(7).fill('14.28%'), body: [spectrumHead, spectrumPointer] }, layout: 'noBorders', margin: [0, 0, 0, 8] },
   
         section('3. DÉTAIL DE LA NOTE INDICATIVE'),
         { table: { widths: ['26%', '12%', '62%'], body: [
           [head('CRITÈRE'), head('POINTS', 'tableHeaderDarkCenter'), head('OBSERVATION')],
           ...s.criteria.map((c) => [cell(c.name, { bold: true }), cell(`${c.pts} / ${c.max}`, { alignment: 'center', bold: true }), cell(c.note)]),
           [cell('TOTAL', { bold: true }), cell(`${s.total} / 100`, { alignment: 'center', bold: true, color }), cell(s.closed ? 'Note plafonnée à 20 : entreprise cessée.' : 'Somme des critères ci-dessus.')]
         ] }, layout },
   
         /* ===== PAGE 2 ===== */
         { text: '', pageBreak: 'after' },
         pageHeader('PAGE 2 — DONNÉES FINANCIÈRES PUBLIÉES'),
         rule,
         section('4. COMPTES PUBLIÉS (DERNIERS EXERCICES)'),
         financeBlock,
         section('5. RATIOS CALCULABLES ET INDICATEURS NON DISPONIBLES'),
         { table: { widths: ['32%', '18%', '50%'], body: ratioRows }, layout, margin: [0, 0, 0, 10] },
         section('6. EFFORT DE CHIFFRE D’AFFAIRES EN CAS D’IMPAYÉ'),
         effortBlock,
   
         /* ===== PAGE 3 ===== */
         { text: '', pageBreak: 'after' },
         pageHeader('PAGE 3 — ANALYSE, GOUVERNANCE, CONTRÔLES ET MENTIONS'),
         rule,
         ...analysisBlocks,
         nextSection('DIRIGEANTS DÉCLARÉS'),
         governanceBlock,
         nextSection('CONTRÔLES ET VÉRIFICATIONS COMPLÉMENTAIRES'),
         { table: { widths: ['32%', '18%', '50%'], body: checks }, layout, margin: [0, 0, 0, 10] },
         noticeBox('#fffbe1', '#b45309', 'À VÉRIFIER AVANT TOUT ENGAGEMENT SIGNIFICATIF',
           'Les contrôles marqués « Non consulté » ne sont pas couverts par ce rapport. Demandez un RIB au nom exact de l’entité (SIREN ci-dessus) et rapprochez ces données de vos propres informations (historique de paiement, garanties, assurance-crédit).'),
         nextSection('MENTIONS ET LIMITES'),
         { text: LEGAL_NOTICE, fontSize: 7, color: '#475569', margin: [0, 0, 0, 14] },
         { columns: [
           { stack: [
             { text: 'DOCUMENT ÉMIS PAR EURO EXPERT SOLVABILITÉ', fontSize: 7.5, bold: true, color: '#0f172a' },
             { text: `Édité le ${dateLong} à partir des sources publiques citées. Les données peuvent évoluer après cette date.`, fontSize: 6.5, color: '#64748b', margin: [0, 3, 0, 0] }], width: '66%' },
           { table: { widths: ['*'], body: [[{ fillColor: '#0f172a', margin: [6, 6, 6, 6], stack: [
             { text: 'EURO EXPERT', fontSize: 8, bold: true, color: '#38bdf8', alignment: 'center' },
             { text: 'SOLVABILITÉ', fontSize: 8, bold: true, color: '#34d399', alignment: 'center', margin: [0, 1, 0, 0] },
             { text: reference, fontSize: 5.5, color: '#94a3b8', alignment: 'center', margin: [0, 3, 0, 0] }] }]] },
           layout: 'noBorders', width: '32%' }
         ], columnGap: 10 }
       ],
       styles: {
         sectionTitle: { fontSize: 8.5, bold: true, color: '#0284c7', margin: [0, 5, 0, 3] },
         tableLabel: { bold: true, fontSize: 7.5, color: '#475569', fillColor: '#f8fafc' },
         tableHeaderDark: { fontSize: 7, bold: true, color: '#ffffff', fillColor: '#0f172a' },
         tableHeaderDarkCenter: { fontSize: 7, bold: true, color: '#ffffff', fillColor: '#0f172a', alignment: 'center' },
         tableHeaderDarkRight: { fontSize: 7, bold: true, color: '#ffffff', fillColor: '#0f172a', alignment: 'right' },
         footerText: { fontSize: 6.5, color: '#94a3b8' }
       },
       defaultStyle: { font: 'Roboto' }
     };
   }
   
   function generatePDFReport() {
     const view = state.view;
     if (!view) return notify('Veuillez d’abord rechercher et sélectionner une entreprise.');
     if (!window.pdfMake) return notify('La bibliothèque pdfMake n’est pas chargée.');
     try {
       window.pdfMake.createPdf(buildReportDefinition(view)).download(`Rapport_EES_${view.siren}.pdf`);
     } catch (e) {
       console.error('Erreur de génération du PDF :', e);
       notify('Impossible de générer le PDF. Réessayez.');
     }
   }
   
   /* =============================================================================
      9 bis. ANALYSE RÉDIGÉE — IA côté serveur (api/analyse.js), repli local sans IA
      Les chiffres sont toujours calculés par le code ; le modèle ne fait que rédiger.
      ============================================================================= */
   const isLegalPerson = (d) => d.type_dirigeant === 'personne morale';
   
   /** Faits transmis au serveur : pas de nom de dirigeant personne physique (minimisation des données). */
   function buildAIFacts(v) {
     const s = v.score;
     return {
       identite: {
         raison_sociale: v.raison, siren: v.siren, code_naf: v.naf, forme_juridique: v.forme,
         date_creation: v.dateCreation, anciennete_ans: ageInYears(v.dateCreation), tranche_effectif: v.effectif,
         categorie: v.categorie, statut: v.active ? 'Active' : 'Cessée', date_cessation: v.dateFermeture || null,
         commune: v.city, nb_etablissements: v.nbEtab, nb_etablissements_ouverts: v.nbEtabOpen
       },
       score: { note: s.total, grade: s.grade, risque: s.risk, conditions: s.terms, criteres: s.criteria },
       finances: {
         exercices: v.fin.rows.map((r) => ({ annee: r.year, ca: r.ca, resultat: r.resultat })),
         croissance: v.fin.growth,
         marge: v.fin.margin
       },
       estimation_ca: v.estimate.available ? { bas: v.estimate.low, haut: v.estimate.high, base: v.estimate.basis } : null,
       dirigeants: {
         nombre: v.dirigeants.length,
         fonctions: v.dirigeants.map((d) => d.qualite).filter(Boolean),
         personnes_morales: v.dirigeants.filter(isLegalPerson).map((d) => d.denomination).filter(Boolean)
       }
     };
   }
   
   /** Synthèse déterministe (sans IA), utilisée si le service d'analyse n'est pas disponible. */
   function buildFallbackAnalysis(v) {
     const s = v.score;
     const age = ageInYears(v.dateCreation);
     const latest = v.fin.latest;
     const sentences = [
       `${v.raison} (SIREN ${v.siren}) est ${v.active ? 'une entreprise active' : 'une entreprise cessée'}` +
         `${v.forme !== NA ? `, de forme ${v.forme}` : ''}${age !== null ? `, créée il y a ${age} an${age > 1 ? 's' : ''}` : ''}${v.city ? `, établie à ${v.city}` : ''}.`,
       v.effectif !== NA ? `Effectif déclaré : ${v.effectif.toLowerCase()}.` : 'Effectif non renseigné.',
       latest
         ? `Les derniers comptes publiés (exercice ${latest.year}) indiquent${latest.ca !== null ? ` un chiffre d’affaires de ${fmtEuro(latest.ca)}` : ''}` +
           `${latest.ca !== null && latest.resultat !== null ? ' et' : ''}${latest.resultat !== null ? ` un résultat net de ${fmtEuro(latest.resultat)}` : ''}.`
         : 'Aucun compte publié n’est accessible : l’appréciation financière reste limitée.',
       `La note indicative ressort à ${s.total}/100 (grade ${s.grade}, risque ${s.risk.toLowerCase()}).`
     ];
     return {
       resume: sentences.join(' '),
       points_forts: s.criteria.filter((c) => c.pts > 0 && c.pts >= c.max * 0.8).map((c) => `${c.name} : ${c.note}.`).slice(0, 4),
       points_vigilance: s.criteria.filter((c) => c.pts < c.max * 0.5).map((c) => `${c.name} : ${c.note}.`).slice(0, 4),
       recommandation: `${s.terms}. Cette appréciation repose uniquement sur des données publiques et doit être complétée par vos propres informations.`,
       verifications: ['Annonces et procédures collectives (BODACC)', 'Bénéficiaires effectifs et gel des avoirs', 'Historique de paiement et garanties disponibles']
     };
   }
   
   async function generateAIAnalysis() {
     const v = state.view;
     if (!v) return notify('Sélectionnez d’abord une entreprise.');
     const btn = $('ai-generate-btn');
     if (btn) btn.disabled = true;
     setHTML('ai-analysis', '<p class="text-slate-400"><i class="fa-solid fa-spinner animate-spin text-violet-400 mr-2"></i>Rédaction de l’analyse en cours…</p>');
   
     let analysis = null;
     let source = 'local';
     const session = readSession();
     if (session) {
       try {
         const res = await fetch(CONFIG.analysisEndpoint, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ token: session.token, facts: buildAIFacts(v) })
         });
         const data = await res.json().catch(() => null);
         if (res.ok && data && data.ok && data.analysis) { analysis = data.analysis; source = 'ia'; }
         else if (res.status === 401) { notify('Session expirée : reconnectez-vous.'); lockSession(); }
       } catch (e) { /* service d'analyse indisponible */ }
     }
     if (state.view !== v) return; // une autre entreprise a été sélectionnée entre-temps
   
     if (!analysis) {
       analysis = buildFallbackAnalysis(v);
       notify(session ? 'Analyse IA indisponible : synthèse automatique affichée à la place.' : 'Analyse IA disponible uniquement avec une session active : synthèse automatique affichée.');
     }
     v.analysis = { ...analysis, source, generatedAt: new Date() };
     renderAnalysis(v);
   }
   
   function renderAnalysis(v) {
     const btn = $('ai-generate-btn');
     if (btn) btn.disabled = false;
     const a = v.analysis;
     if (!a) {
       setHTML('ai-analysis', '<p class="text-slate-400">Cliquez sur « Générer l’analyse » pour obtenir une synthèse rédigée à partir des données ci-dessus.</p>');
       if (btn) btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Générer l’analyse';
       return;
     }
     if (btn) btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Régénérer';
   
     const isAI = a.source === 'ia';
     const chip = `<span class="inline-block mb-3 px-2.5 py-1 rounded-full text-[10px] font-bold ${isAI ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'bg-slate-500/20 text-slate-300 border border-slate-500/30'}">` +
       `${isAI ? 'Rédigée par IA à partir des données de ce rapport — à relire avant diffusion' : 'Synthèse automatique (sans IA)'}</span>`;
     const list = (title, items, tone) => (items && items.length
       ? `<div><strong class="${tone} block mb-1">${esc(title)}</strong><ul class="space-y-1">${items.map((i) => `<li class="flex gap-2"><span class="text-slate-500">•</span><span>${esc(i)}</span></li>`).join('')}</ul></div>`
       : '');
     setHTML('ai-analysis',
       `${chip}<p class="mb-3 text-slate-200">${esc(a.resume)}</p>` +
       `<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">${list('Points forts', a.points_forts, 'text-emerald-400')}${list('Points de vigilance', a.points_vigilance, 'text-amber-400')}</div>` +
       `<p class="border-t border-slate-800 pt-2 mb-3"><strong class="text-white">Recommandation :</strong> ${esc(a.recommandation)}</p>` +
       list('À vérifier', a.verifications, 'text-sky-400'));
   }
   
   /* =============================================================================
      10. INITIALISATION (une seule fois, chaque écouteur attaché une seule fois)
      ============================================================================= */
   function init() {
     initAuth();
     initSearchUI();
     showHomeMap();
   
     document.addEventListener('click', (e) => {
       const auditBtn = e.target.closest('[data-audit-siren]');
       if (auditBtn) {
         triggerSearchBySiren(auditBtn.getAttribute('data-audit-siren'));
         return;
       }
       const input = $('search-input');
       const box = $('autocomplete-results');
       if (input && box && !input.contains(e.target) && !box.contains(e.target)) hideAutocomplete();
     });
   
     document.addEventListener('keydown', (e) => {
       if (e.key === 'Escape') hideAutocomplete();
     });
   }
   
   if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
   else init();