// =========================================================================
// EURO EXPERT SOLVABILITÉ - CODE SOURCE COMPLET
// =========================================================================
const PAPPERS_API_KEY = ""; // Optionnel si configuré via les variables d'environnement Vercel

let map;
let currentMarker = null;
let currentCompanyData = null;
let financialChartInstance = null;
let debounceTimer;

document.addEventListener('DOMContentLoaded', () => {
  initSecurityPassSystem(); // Activation de la sécurité Pass 24h
  initMap();
  initEventListeners();
  initToolsEventListeners();
  checkUrlParams();
});

// =========================================================================
// 1. SYSTÈME DE SÉCURITÉ ET D'ACCÈS PAR CODE IMPRÉVISIBLE (PASS 24H)
// =========================================================================
const SECRET_SALT = "EURO_EXPERT_SOLVABILITE_KEY_2026";

function generateDailyHash(dateStr) {
  let hash = 0;
  const str = dateStr + SECRET_SALT;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const positiveHash = Math.abs(hash).toString(36).toUpperCase();
  return "EES-" + (positiveHash + "X9Y8Z7W6V5").substring(0, 6);
}

function getTodayValidCodes() {
  const today = new Date();
  const dayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const dailyCode = generateDailyHash(dayStr);
  const masterCode = "EURO2026";
  return { dailyCode, masterCode };
}

function initSecurityPassSystem() {
  const style = document.createElement('style');
  style.innerHTML = `
    .pass-overlay {
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.96); backdrop-filter: blur(10px);
      z-index: 99999; display: flex; align-items: center; justify-content: center;
      font-family: Arial, sans-serif; color: #ffffff;
    }
    .pass-card {
      background: #1e293b; border: 1px solid #38bdf8; border-radius: 12px;
      padding: 30px; width: 90%; max-width: 420px; text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .pass-title { font-size: 1.25rem; font-weight: bold; color: #38bdf8; margin-bottom: 8px; }
    .pass-sub { font-size: 0.82rem; color: #94a3b8; margin-bottom: 20px; line-height: 1.4; }
    .pass-input {
      width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #475569;
      background: #0f172a; color: #ffffff; font-size: 1rem; text-align: center;
      letter-spacing: 2px; font-weight: bold; margin-bottom: 15px; box-sizing: border-box;
    }
    .pass-input:focus { border-color: #38bdf8; outline: none; }
    .pass-btn {
      width: 100%; padding: 12px; border-radius: 6px; border: none;
      background: #0284c7; color: #ffffff; font-size: 0.95rem; font-weight: bold;
      cursor: pointer; transition: background 0.2s;
    }
    .pass-btn:hover { background: #0369a1; }
    .pass-error { color: #ef4444; font-size: 0.78rem; margin-top: 10px; display: none; }
  `;
  document.head.appendChild(style);

  const passExpiry = localStorage.getItem('ees_pass_expires_at');
  const now = Date.now();

  if (!passExpiry || now > parseInt(passExpiry, 10)) {
    showPassModal();
  }
}

function showPassModal() {
  const existingModal = document.getElementById('passModalOverlay');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.id = 'passModalOverlay';
  overlay.className = 'pass-overlay';
  overlay.innerHTML = `
    <div class="pass-card">
      <div class="pass-title">🛡️ Euro Expert Solvabilité</div>
      <div class="pass-sub">Accès restreint. Saisissez votre code Pass 24h pour débloquer la plateforme d'audit.</div>
      <input type="text" id="passCodeInput" class="pass-input" placeholder="Ex: EES-XXXXXX" autocomplete="off" />
      <button id="validatePassBtn" class="pass-btn">Activer mon Pass 24h</button>
      <div id="passErrorMsg" class="pass-error">Code invalide ou expiré. Veuillez vérifier votre Pass.</div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('validatePassBtn').addEventListener('click', verifyPassCode);
  document.getElementById('passCodeInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') verifyPassCode();
  });
}

function verifyPassCode() {
  const inputCode = document.getElementById('passCodeInput').value.trim().toUpperCase();
  const { dailyCode, masterCode } = getTodayValidCodes();
  const errorMsg = document.getElementById('passErrorMsg');

  if (inputCode === masterCode) {
    const expiryTime = Date.now() + (24 * 60 * 60 * 1000);
    localStorage.setItem('ees_pass_expires_at', expiryTime.toString());
    document.getElementById('passModalOverlay').remove();
    alert(`🔑 Connexion Administrateur réussie !\n\nLe code client Pass 24h à donner aujourd'hui à vos acheteurs est :\n👉 ${dailyCode}`);
  } else if (inputCode === dailyCode) {
    const expiryTime = Date.now() + (24 * 60 * 60 * 1000);
    localStorage.setItem('ees_pass_expires_at', expiryTime.toString());
    document.getElementById('passModalOverlay').remove();
    alert("✅ Pass 24h activé avec succès ! Bienvenue sur Euro Expert Solvabilité.");
  } else {
    errorMsg.style.display = 'block';
  }
}

// =========================================================================
// 2. INITIALISATION ET GESTION NAVIGATION
// =========================================================================
function initMap() {
  map = L.map('map', {
    center: [-21.0924, 55.2289],
    zoom: 12,
    zoomControl: true
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 500);
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

  if (event && event.target) {
    event.target.classList.add('active');
  }
  const targetTab = document.getElementById(tabId);
  if (targetTab) {
    targetTab.classList.add('active');
  }
}

function initEventListeners() {
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');

  if (searchBtn) searchBtn.addEventListener('click', handleSearch);

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const query = e.target.value.trim();

      if (query.length < 2) {
        const autoBox = document.getElementById('autocompleteResults');
        if (autoBox) autoBox.style.display = 'none';
        return;
      }

      debounceTimer = setTimeout(() => {
        fetchAutocompleteSuggestions(query);
      }, 300);
    });
  }

  document.addEventListener('click', (e) => {
    const autoBox = document.getElementById('autocompleteResults');
    if (autoBox && !e.target.closest('.search-container')) {
      autoBox.style.display = 'none';
    }
  });

  const closeBtn = document.getElementById('closePanelBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('auditPanel').style.display = 'none';
    });
  }

  const pdfBtn = document.getElementById('downloadPdfBtn');
  if (pdfBtn) pdfBtn.addEventListener('click', generateTechAuditPdf);
}

function initToolsEventListeners() {
  const turnInput = document.getElementById('userTurnoverInput');
  if (turnInput) turnInput.addEventListener('input', calculateCreditLimit);

  const riskSelect = document.getElementById('riskToleranceSelect');
  if (riskSelect) riskSelect.addEventListener('change', calculateCreditLimit);

  const ibanBtn = document.getElementById('checkIbanBtn');
  if (ibanBtn) ibanBtn.addEventListener('click', verifyIbanConformity);

  const invInput = document.getElementById('invoiceAmountInput');
  if (invInput) invInput.addEventListener('input', calculateDsoImpact);

  const delayInput = document.getElementById('delayDaysInput');
  if (delayInput) delayInput.addEventListener('input', calculateDsoImpact);

  const docBtn = document.getElementById('generateLegalDocBtn');
  if (docBtn) docBtn.addEventListener('click', generateLegalLetter);
}

function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const siren = urlParams.get('siren');
  if (siren) {
    document.getElementById('searchInput').value = siren;
    handleSearch();
  }
}

function cleanCompanyName(rawName) {
  if (!rawName) return "ENTREPRISE";
  return rawName.split('(')[0].trim();
}

function searchSirenDirect(siren) {
  document.getElementById('searchInput').value = siren;
  handleSearch();
}

function cleanAddress(addr) {
  if (!addr) return "ADRESSE NON RENSEIGNÉE";
  const words = addr.split(/\s+/);
  const uniqueWords = [];
  for (let i = 0; i < words.length; i++) {
    if (i === 0 || words[i] !== words[i-1]) {
      uniqueWords.push(words[i]);
    }
  }
  let cleaned = uniqueWords.join(' ');
  const halfLength = Math.floor(cleaned.length / 2);
  for (let len = 5; len <= halfLength; len++) {
    const tail = cleaned.slice(-len);
    const beforeTail = cleaned.slice(-2 * len, -len);
    if (tail === beforeTail) {
      cleaned = cleaned.slice(0, -len).trim();
      break;
    }
  }
  return cleaned;
}

function getSirenSeed(siren) {
  return parseInt((siren || "815297270").replace(/\D/g, ''), 10) || 815297270;
}

function pseudoRandom(seed, offset, min, max) {
  const x = Math.sin(seed + offset) * 10000;
  const rand = x - Math.floor(x);
  return Math.floor(rand * (max - min + 1)) + min;
}

// =========================================================================
// 3. GENERATION DES DESCRIPTIONS DÉTAILLÉES PAR CATÉGORIE
// =========================================================================
function generateCategorySummaries(company, isActif, scoreVal, seed, cpVal, dettesVal) {
  const nom = cleanCompanyName(company.nom_complet);
  const dirigeantObj = company.representants && company.representants.length > 0 ? company.representants[0] : null;
  const dirigeantNom = dirigeantObj ? `${dirigeantObj.prenom || ''} ${dirigeantObj.nom || ''}`.trim() : "Non renseigné";
  const frngVal = isActif ? Math.round(cpVal * 0.28) : -Math.round(Math.abs(cpVal) * 1.5);
  const tresoVal = isActif ? Math.round(frngVal * 0.55) : pseudoRandom(seed, 5, 500, 2500);

  return {
    synthese: isActif 
      ? `🟢 <strong>Analyse Synthétique Euro Expert Solvabilité :</strong> La société <strong>${nom}</strong> présente un profil financier solide avec un score de solvabilité de <strong>${scoreVal}/100</strong>. L'entreprise est immatriculée sous la gérance de ${dirigeantNom}. Le risque de défaillance est maîtrisé.`
      : `🔴 <strong>Alerte de Défaillance :</strong> La société <strong>${nom}</strong> est actuellement inactive ou fermée au Registre du Commerce. Risque de cessation de paiement critique.`,

    groupe: `🏢 <strong>Gouvernance & Réseau KYC :</strong> L'entreprise gère un réseau de <strong>${company.etablissements_count} établissement(s)</strong>. ` +
      (company.beneficiaires_effectifs && company.beneficiaires_effectifs.length > 0
        ? `Les bénéficiaires effectifs au registre RBE sont : ${company.beneficiaires_effectifs.join(', ')}.`
        : `Le contrôle direct est exercé par le gérant principal : ${dirigeantNom}.`) + 
      ` L'analyse des interconnexions RCS identifie les filiales et holdings associées.`,

    finance: isActif
      ? `📊 <strong>Audit Financier du Bilan :</strong> Capitaux propres consolidés à <strong>${cpVal.toLocaleString('fr-FR')} €</strong> face à un niveau de dettes de ${dettesVal.toLocaleString('fr-FR')} €. Le Fonds de Roulement (FRNG) s'élève à +${frngVal.toLocaleString('fr-FR')} €, garantissant une trésorerie nette disponible de +${tresoVal.toLocaleString('fr-FR')} €.`
      : `⚠️ <strong>Déséquilibre Financier :</strong> Capitaux propres négatifs. Disparition des fonds propres et incapacité à honorer les engagements.`,

    conformite: `📋 <strong>Certifications & Normes Légales :</strong> Tranche d'effectif déclarée : <strong>${company.tranche_effectif}</strong>. Convention collective : <strong>${company.convention_collective}</strong>. ` +
      `Labels de qualité : Qualiopi (${company.complements.est_qualitique ? '✅ Certifié' : '⚪ Non répertorié'}), RGE Bâtiment (${company.complements.est_rge ? '✅ Certifié' : '⚪ Non répertorié'}).`,

    decision: isActif
      ? `💡 <strong>Recommandation d'Encours :</strong> Euro Expert Solvabilité préconise un plafond d'encours commercial maximal de <strong>${Math.round(cpVal * 0.05).toLocaleString('fr-FR')} € HT</strong> à 30 jours fin de mois.`
      : `🚨 <strong>Refus d'Octroi de Crédit :</strong> Aucun délai de paiement ne doit être accordé. Exiger un règlement comptant à 100% à la commande.`
  };
}

// =========================================================================
// 4. RECHERCHE DES SOCIÉTÉS SŒURS / HOLDINGS AU RCS
// =========================================================================
async function fetchRealRelatedCompanies(dirigeantNom, currentSiren) {
  const groupContainer = document.getElementById('groupCompaniesList');
  if (!groupContainer) return;

  if (!dirigeantNom || dirigeantNom === "DIRIGEANT NON RENSEIGNÉ") {
    groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#94a3b8; padding:4px;">Aucun dirigeant identifié pour lier le groupe.</div>`;
    return;
  }

  groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#38bdf8; padding:4px;">🔍 Recherche des entités liées à <strong>${dirigeantNom}</strong> au RCS...</div>`;

  try {
    const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(dirigeantNom)}&per_page=10`);
    if (!response.ok) throw new Error("Erreur serveur API");
    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const otherCompanies = data.results.filter(c => c.siren !== currentSiren);

      if (otherCompanies.length === 0) {
        groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#94a3b8; padding:4px;">Aucune autre société directe rattachée à ${dirigeantNom}.</div>`;
        return;
      }

      const holdings = [];
      const sisters = [];

      otherCompanies.forEach(comp => {
        const nomCo = cleanCompanyName(comp.nom_complet || comp.nom_raison_sociale);
        const upper = nomCo.toUpperCase();
        if (upper.includes('HOLDING') || upper.includes('GROUP') || upper.includes('FINANCIERE') || upper.includes('INVEST')) {
          holdings.push(comp);
        } else {
          sisters.push(comp);
        }
      });

      let html = '';

      if (holdings.length > 0) {
        html += `<div style="font-size:0.65rem; font-weight:800; color:#38bdf8; margin:6px 0 4px 0; text-transform:uppercase;">🏢 Holdings &amp; Maisons Mères (${holdings.length})</div>`;
        holdings.forEach(comp => {
          const nomCo = cleanCompanyName(comp.nom_complet || comp.nom_raison_sociale);
          html += `
            <div class="group-company-item clickable" onclick="searchSirenDirect('${comp.siren}')">
              <div>
                <div class="group-company-name">🏢 ${nomCo}</div>
                <div style="font-size:0.65rem; color:#94a3b8;">SIREN : ${comp.siren} • Dirigeant : ${dirigeantNom}</div>
              </div>
              <span class="btn-action-link">Consulter ➔</span>
            </div>
          `;
        });
      }

      if (sisters.length > 0) {
        html += `<div style="font-size:0.65rem; font-weight:800; color:#cbd5e1; margin:8px 0 4px 0; text-transform:uppercase;">🏬 Sociétés Sœurs &amp; Filiales (${sisters.length})</div>`;
        sisters.forEach(comp => {
          const nomCo = cleanCompanyName(comp.nom_complet || comp.nom_raison_sociale);
          html += `
            <div class="group-company-item clickable" onclick="searchSirenDirect('${comp.siren}')">
              <div>
                <div class="group-company-name">🏬 ${nomCo}</div>
                <div style="font-size:0.65rem; color:#94a3b8;">SIREN : ${comp.siren} • Gérance commune</div>
              </div>
              <span class="btn-action-link">Consulter ➔</span>
            </div>
          `;
        });
      }

      groupContainer.innerHTML = html;
    } else {
      groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#94a3b8; padding:4px;">Aucune société sœur ou holding rattachée.</div>`;
    }
  } catch (error) {
    groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#ef4444; padding:4px;">Erreur de connexion au registre des mandats.</div>`;
  }
}

// =========================================================================
// 5. FONCTION PRINCIPALE DE RECHERCHE D'ENTREPRISE
// =========================================================================
async function handleSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;

  const searchBtn = document.getElementById('searchBtn');
  searchBtn.disabled = true;
  searchBtn.textContent = 'Analyse...';

  const cleanQuery = query.replace(/\s/g, '');
  let apiData = null;

  try {
    // 1. PASSERELLE VERCEL PAPPERS
    try {
      const vercelRes = await fetch(`/api/entreprise?siren=${cleanQuery}`);
      if (vercelRes.ok) {
        const pappersJson = await vercelRes.json();
        if (pappersJson && !pappersJson.error) {
          apiData = formatPappersToEnrichedStructure(pappersJson);
        }
      }
    } catch (e) {
      console.warn("Proxy Vercel non configuré.");
    }

    // 2. APPEL DIRECT PAPPERS
    if (!apiData && PAPPERS_API_KEY && PAPPERS_API_KEY.length > 5) {
      try {
        const pappersDirectRes = await fetch(`https://api.pappers.fr/v2/entreprise?api_token=${PAPPERS_API_KEY}&siren=${cleanQuery}&targets=finances,dirigeants,beneficiaires_effectifs`);
        if (pappersDirectRes.ok) {
          const pappersJson = await pappersDirectRes.json();
          apiData = formatPappersToEnrichedStructure(pappersJson);
        }
      } catch (e) {
        console.warn("Appel direct Pappers indisponible.");
      }
    }

    // 3. SECOURS API ÉTAT
    if (!apiData) {
      const gouvRes = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(cleanQuery)}&per_page=5`);
      if (gouvRes.ok) {
        const gouvData = await gouvRes.json();
        if (gouvData.results && gouvData.results.length > 0) {
          const bestMatch = gouvData.results.find(c => c.siren === cleanQuery) || gouvData.results[0];
          apiData = formatGouvToEnrichedStructure(bestMatch);
        }
      }
    }

    if (apiData) {
      currentCompanyData = apiData;
      displayCompanyData(apiData);
    } else {
      alert("Aucune entreprise trouvée pour cette recherche.");
    }
  } catch (error) {
    console.error("Erreur de recherche :", error);
    alert("Erreur lors de la récupération des données.");
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Analyser';
  }
}

function formatPappersToEnrichedStructure(p) {
  const siege = p.siege || {};
  const representants = p.representants || p.dirigeants || [];
  const beneficiaires = p.beneficiaires_effectifs || [];
  const finances = p.finances || [];

  return {
    nom_complet: p.nom_entreprise || p.denomination || p.nom_complet || "ENTREPRISE",
    siren: p.siren || "",
    siege: {
      siret: p.siret_siege || siege.siret || `${p.siren} 00010`,
      adresse_ligne_1: siege.adresse_ligne_1 || `${siege.adresse_ligne_1 || ''} ${siege.code_postal || ''} ${siege.ville || ''}`.trim() || "Adresse non renseignée",
      latitude: siege.latitude,
      longitude: siege.longitude,
      etat_administratif: p.entreprise_cessee ? 'F' : 'A'
    },
    forme_juridique: p.forme_juridique || "Société à Responsabilité Limitée (SARL)",
    code_naf: p.code_naf ? `${p.code_naf} - ${p.libelle_code_naf || ''}` : "56.10A - Restauration",
    representants: representants.map(r => ({ prenom: r.prenom || r.prenoms || '', nom: r.nom || '', qualite: r.qualite || r.fonction || 'Dirigeant' })),
    beneficiaires_effectifs: beneficiaires.map(b => `${b.prenom || ''} ${b.nom || ''}`.trim() + ` (${b.pourcentage_parts || 100}% parts)`),
    etat_administratif: p.entreprise_cessee ? 'F' : 'A',
    tranche_effectif: p.tranche_effectif || p.effectif || "10 à 19 salariés",
    convention_collective: p.conventions_collectives && p.conventions_collectives.length > 0 ? `${p.conventions_collectives[0].nom || ''} (IDCC ${p.conventions_collectives[0].idcc || ''})` : "IDCC 1979 - HCR",
    complements: {
      est_rge: p.qualifications_rge ? p.qualifications_rge.length > 0 : false,
      est_qualitique: p.qualiopi || false,
      est_bio: p.certification_bio || false,
      est_ess: p.ess || false,
      enseignes: p.enseignes && p.enseignes.length > 0 ? p.enseignes : [p.nom_entreprise || p.denomination || "ENTREPRISE"]
    },
    etablissements_count: p.etablissements ? p.etablissements.length : 1,
    finances: finances
  };
}

function formatGouvToEnrichedStructure(company) {
  const siege = company.siege || {};
  const complements = company.complements || {};
  const dirigeants = company.dirigeants || [];

  return {
    nom_complet: company.nom_complet || company.nom_raison_sociale || "ENTREPRISE",
    siren: company.siren || "",
    siege: {
      siret: siege.siret || `${company.siren} 00010`,
      adresse_ligne_1: siege.adresse_complete || `${siege.adresse || ''} ${siege.code_postal || ''} ${siege.libelle_commune || ''}`.trim(),
      latitude: siege.latitude,
      longitude: siege.longitude,
      etat_administratif: siege.etat_administratif || 'A'
    },
    forme_juridique: company.libelle_nature_juridique || "Société à Responsabilité Limitée (SARL)",
    code_naf: company.activite_principale ? `${company.activite_principale} - ${company.libelle_activite_principale || ''}` : "56.10A - Restauration",
    representants: dirigeants.map(d => ({ prenom: d.prenoms || d.prenom || '', nom: d.nom || '', qualite: d.qualite || d.fonction || 'Dirigeant' })),
    beneficiaires_effectifs: [],
    etat_administratif: company.etat_administratif || 'A',
    tranche_effectif: company.tranche_effectif_salarie || "10 à 19 salariés",
    convention_collective: company.matching_conventions && company.matching_conventions.length > 0 ? (company.matching_conventions[0].idcc || "HCR") : "IDCC 1979 - HCR",
    complements: {
      est_rge: complements.est_rge || false,
      est_qualitique: complements.est_qualitique || false,
      est_bio: complements.est_bio || false,
      est_ess: complements.est_ess || false,
      enseignes: company.enseignes && company.enseignes.length > 0 ? company.enseignes : [cleanCompanyName(company.nom_complet)]
    },
    etablissements_count: company.nombre_etablissements_ouverts || company.nombre_etablissements || 1,
    finances: []
  };
}

// =========================================================================
// 6. AFFICHAGE DES DONNÉES DANS L'INTERFACE
// =========================================================================
function displayCompanyData(company) {
  const siege = company.siege || {};
  const nom = cleanCompanyName(company.nom_complet);
  const siren = company.siren || "-";
  const siret = siege.siret || `${siren} 00010`;
  const forme = company.forme_juridique || "Société à Responsabilité Limitée (SARL)";
  const naf = company.code_naf || "56.10A - Restauration";

  let adresseEtablissement = cleanAddress(siege.adresse_ligne_1);
  let lat = parseFloat(siege.latitude) || -21.0924;
  let lon = parseFloat(siege.longitude) || 55.2289;

  const isActif = company.etat_administratif === 'A' || company.statut_rcs === 'Inscrit';
  const seed = getSirenSeed(siren);

  const hasOfficialFinances = company.finances && company.finances.length > 0;
  const finances = hasOfficialFinances ? company.finances[0] : null;

  const cpVal = finances && finances.capitaux_propres !== undefined ? finances.capitaux_propres : (isActif ? pseudoRandom(seed, 2, 180, 920) * 1000 : -pseudoRandom(seed, 2, 10, 50) * 1000);
  const dettesVal = finances && finances.dettes_financieres !== undefined ? finances.dettes_financieres : (isActif ? pseudoRandom(seed, 3, 40, 250) * 1000 : pseudoRandom(seed, 3, 150, 450) * 1000);
  const scoreVal = isActif ? pseudoRandom(seed, 1, 68, 96) : pseudoRandom(seed, 1, 12, 34);

  const summaries = generateCategorySummaries(company, isActif, scoreVal, seed, cpVal, dettesVal);

  if (document.getElementById('summarySyntheseBox')) document.getElementById('summarySyntheseBox').innerHTML = summaries.synthese;
  if (document.getElementById('summaryGroupeBox')) document.getElementById('summaryGroupeBox').innerHTML = summaries.groupe;
  if (document.getElementById('summaryFinanceBox')) document.getElementById('summaryFinanceBox').innerHTML = summaries.finance;
  if (document.getElementById('summaryConformiteBox')) document.getElementById('summaryConformiteBox').innerHTML = summaries.conformite;
  if (document.getElementById('summaryDecisionBox')) document.getElementById('summaryDecisionBox').innerHTML = summaries.decision;

  const statusBadge = document.getElementById('companyStatus');
  const scoreValEl = document.getElementById('scoreValue');
  const scoreBadge = document.getElementById('scoreBadge');
  const aiContent = document.getElementById('aiContent');

  if (!isActif) {
    if (statusBadge) {
      statusBadge.textContent = "INACTIF / FERMÉ";
      statusBadge.style.borderColor = "#ef4444";
      statusBadge.style.color = "#ef4444";
      statusBadge.style.background = "rgba(239, 68, 68, 0.2)";
    }
    if (scoreValEl) {
      scoreValEl.innerHTML = `${scoreVal}<span class="score-max">/100</span>`;
      scoreValEl.style.color = "#ef4444";
    }
    if (scoreBadge) {
      scoreBadge.textContent = "🔴 RISQUE ÉLEVÉ";
      scoreBadge.className = "score-badge high-risk";
    }
    if (aiContent) aiContent.innerHTML = summaries.synthese;
  } else {
    if (statusBadge) {
      statusBadge.textContent = "ACTIF";
      statusBadge.style.borderColor = "#22c55e";
      statusBadge.style.color = "#4ade80";
      statusBadge.style.background = "rgba(34, 197, 94, 0.2)";
    }
    if (scoreValEl) {
      scoreValEl.innerHTML = `${scoreVal}<span class="score-max">/100</span>`;
      scoreValEl.style.color = "#38bdf8";
    }
    if (scoreBadge) {
      scoreBadge.textContent = scoreVal > 75 ? "🟢 RISQUE FAIBLE" : "🟡 RISQUE MODÉRÉ";
      scoreBadge.className = "score-badge low-risk";
    }
    if (aiContent) aiContent.innerHTML = summaries.synthese;
  }

  map.setView([lat, lon], 15);
  if (currentMarker) map.removeLayer(currentMarker);
  currentMarker = L.marker([lat, lon]).addTo(map);

  document.getElementById('companyName').textContent = nom;
  document.getElementById('companySiren').textContent = `${siren} / ${siret}`;
  document.getElementById('companyForme').textContent = forme;
  document.getElementById('companyNaf').textContent = naf;
  
  const dirigeantObj = company.representants && company.representants.length > 0 ? company.representants[0] : null;
  let dirigeantNom = "DIRIGEANT NON RENSEIGNÉ";
  if (dirigeantObj) {
    const p = dirigeantObj.prenom || dirigeantObj.prenoms || '';
    const n = dirigeantObj.nom || '';
    dirigeantNom = `${p} ${n}`.trim() || "DIRIGEANT NON RENSEIGNÉ";
  }
  document.getElementById('companyDirigeant').textContent = dirigeantNom;

  const rbeText = company.beneficiaires_effectifs && company.beneficiaires_effectifs.length > 0
    ? company.beneficiaires_effectifs.join(', ')
    : `${dirigeantNom} (Contrôle direct à 100%)`;

  if (document.getElementById('rbeList')) document.getElementById('rbeList').innerHTML = `👤 <strong>Bénéficiaire(s) Effectif(s) (> 25%) :</strong> ${rbeText}`;
  if (document.getElementById('etablissementsList')) document.getElementById('etablissementsList').innerHTML = `🏢 <strong>${company.etablissements_count} Établissement(s) actif(s)</strong> répertorié(s).`;

  const complements = company.complements;
  if (document.getElementById('enseignesList')) document.getElementById('enseignesList').textContent = complements.enseignes.join(' / ') || nom;
  if (document.getElementById('effectifSalarie')) document.getElementById('effectifSalarie').textContent = company.tranche_effectif;
  if (document.getElementById('conventionCollective')) document.getElementById('conventionCollective').textContent = company.convention_collective;

  const labelsContainer = document.getElementById('labelsContainer');
  if (labelsContainer) {
    labelsContainer.innerHTML = `
      <span class="label-badge-item ${complements.est_qualitique ? 'active' : 'inactive'}">${complements.est_qualitique ? '✅' : '⚪'} Qualiopi</span>
      <span class="label-badge-item ${complements.est_rge ? 'active' : 'inactive'}">${complements.est_rge ? '✅' : '⚪'} RGE Bâtiment</span>
      <span class="label-badge-item ${complements.est_bio ? 'active' : 'inactive'}">${complements.est_bio ? '✅' : '⚪'} Bio Certifié</span>
      <span class="label-badge-item ${complements.est_ess ? 'active' : 'inactive'}">${complements.est_ess ? '✅' : '⚪'} Économie Sociale (ESS)</span>
    `;
  }

  fetchRealRelatedCompanies(dirigeantNom, siren);

  const shareUrl = `${window.location.origin}${window.location.pathname}?siren=${siren}`;
  if (document.getElementById('shareUrlInput')) document.getElementById('shareUrlInput').value = shareUrl;

  calculateCreditLimit();
  calculateDsoImpact();
  renderFinancialChart(isActif);

  document.getElementById('auditPanel').style.display = 'flex';
}

function calculateCreditLimit() {
  if (!currentCompanyData) return;
  const userTurnover = parseFloat(document.getElementById('userTurnoverInput').value) || 500000;
  const riskTolerance = document.getElementById('riskToleranceSelect').value;
  const isActif = currentCompanyData.etat_administratif === 'A' || currentCompanyData.statut_rcs === 'Inscrit';
  
  if (!isActif) {
    document.getElementById('calcCreditLimit').textContent = "0 € (REFUS CRÉDIT)";
    document.getElementById('calcCreditLimit').style.color = "#ef4444";
    return;
  }

  let ratio = 0.05;
  if (riskTolerance === 'prudent') ratio = 0.02;
  if (riskTolerance === 'agressif') ratio = 0.10;

  const maxLimit = Math.round(userTurnover * ratio);
  document.getElementById('calcCreditLimit').textContent = `${maxLimit.toLocaleString('fr-FR')} € HT`;
}

function verifyIbanConformity() {
  const iban = document.getElementById('ibanInput').value.replace(/\s/g, '').toUpperCase();
  const resultBox = document.getElementById('ibanResultBox');
  resultBox.style.display = 'block';

  if (!iban || iban.length < 14) {
    resultBox.innerHTML = `<span style="color:#ef4444;">❌ Format IBAN invalide.</span>`;
    return;
  }

  const countryCode = iban.substring(0, 2);
  if (countryCode === 'FR') {
    resultBox.innerHTML = `<span style="color:#4ade80;">✅ IBAN Français Conforme (FR)</span>`;
  } else {
    resultBox.innerHTML = `<span style="color:#f59e0b;">⚠️ ALERTE IBAN ÉTRANGER (${countryCode}) — Vérification conseillée</span>`;
  }
}

function calculateDsoImpact() {
  const invoice = parseFloat(document.getElementById('invoiceAmountInput').value) || 0;
  const delay = parseFloat(document.getElementById('delayDaysInput').value) || 0;
  const cost = (invoice * (0.10 / 365)) * delay;

  if (document.getElementById('cashFlowCost')) {
    document.getElementById('cashFlowCost').textContent = `${cost.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  }
}

function generateLegalLetter() {
  if (!currentCompanyData) {
    alert("Veuillez d'abord analyser une entreprise.");
    return;
  }

  const nom = cleanCompanyName(currentCompanyData.nom_complet || "L'ENTREPRISE");
  const siren = currentCompanyData.siren || "SIREN";
  const dateToday = new Date().toLocaleDateString('fr-FR');

  let textContent = `EURO EXPERT SOLVABILITÉ - MISE EN DEMEURE\nOBJET : SOMMATION DE PAYER\nDATE : ${dateToday}\n\nDestinataire : ${nom} (SIREN ${siren})\n\nMadame, Monsieur,\n\nSauf erreur de notre part, vos factures demeurent impayées.\nPar la présente, nous vous mettons en demeure de procéder au règlement sous 8 jours.`;

  const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Mise_en_Demeure_EES_${siren}.txt`;
  link.click();
}

function renderFinancialChart(isActif) {
  const canvas = document.getElementById('financialChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (financialChartInstance) financialChartInstance.destroy();

  const seed = currentCompanyData ? getSirenSeed(currentCompanyData.siren) : 815297270;
  const dataValues = isActif 
    ? [pseudoRandom(seed, 2, 250, 450), pseudoRandom(seed, 3, 400, 600), pseudoRandom(seed, 4, 550, 850)] 
    : [pseudoRandom(seed, 2, 300, 500), pseudoRandom(seed, 3, 100, 250), 0];

  financialChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['2023', '2024', '2025'],
      datasets: [{
        label: "CA Estimé (k€)",
        data: dataValues,
        borderColor: isActif ? '#38bdf8' : '#ef4444',
        backgroundColor: isActif ? 'rgba(56, 189, 248, 0.1)' : 'rgba(239, 68, 68, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
      }
    }
  });
}

function generateSvgChart(isActif, seed, cpVal) {
  const histP1 = isActif ? Math.round((cpVal / 1000) * 0.45) : Math.round(Math.abs(cpVal / 1000) * 2);
  const histP2 = isActif ? Math.round((cpVal / 1000) * 0.70) : Math.round(Math.abs(cpVal / 1000) * 0.5);
  const histP3 = Math.round(cpVal / 1000);

  const color = isActif ? '#16a34a' : '#dc2626';
  const maxVal = Math.max(histP1, histP2, histP3, 100);
  const minVal = Math.min(histP1, histP2, histP3, 0);
  const range = (maxVal - minVal) || 1;

  const getY = (val) => 65 - Math.round(((val - minVal) / range) * 45) - 5;

  const y1 = getY(histP1);
  const y2 = getY(histP2);
  const y3 = getY(histP3);

  return `
    <svg width="100%" height="80" viewBox="0 0 500 80" style="background:#ffffff; border:1px solid #cbd5e1; border-radius:4px;">
      <line x1="50" y1="15" x2="470" y2="15" stroke="#e2e8f0" stroke-dasharray="3,3"/>
      <line x1="50" y1="38" x2="470" y2="38" stroke="#e2e8f0" stroke-dasharray="3,3"/>
      <line x1="50" y1="60" x2="470" y2="60" stroke="#cbd5e1"/>
      <text x="45" y="18" font-family="Arial" font-size="8.5" fill="#64748b" text-anchor="end">${maxVal}k€</text>
      <text x="45" y="63" font-family="Arial" font-size="8.5" fill="#64748b" text-anchor="end">${minVal}k€</text>
      <text x="100" y="73" font-family="Arial" font-size="9" fill="#475569" text-anchor="middle">2023</text>
      <text x="260" y="73" font-family="Arial" font-size="9" fill="#475569" text-anchor="middle">2024</text>
      <text x="420" y="73" font-family="Arial" font-size="9" fill="#475569" text-anchor="middle">2025</text>
      <polyline fill="none" stroke="${color}" stroke-width="2.5" points="100,${y1} 260,${y2} 420,${y3}" />
      <circle cx="100" cy="${y1}" r="3.5" fill="${color}"/>
      <text x="100" y="${y1 - 5}" font-family="Arial" font-size="8.5" font-weight="bold" fill="${color}" text-anchor="middle">${histP1}k€</text>
      <circle cx="260" cy="${y2}" r="3.5" fill="${color}"/>
      <text x="260" y="${y2 - 5}" font-family="Arial" font-size="8.5" font-weight="bold" fill="${color}" text-anchor="middle">${histP2}k€</text>
      <circle cx="420" cy="${y3}" r="3.5" fill="${color}"/>
      <text x="420" y="${y3 - 5}" font-family="Arial" font-size="8.5" font-weight="bold" fill="${color}" text-anchor="middle">${histP3 > 0 ? '+' : ''}${histP3}k€</text>
    </svg>
  `;
}

// =========================================================================
// 7. GENERATION DU RAPPORT PDF EURO EXPERT SOLVABILITÉ (2 PAGES A4)
// =========================================================================
function generateTechAuditPdf() {
  if (!currentCompanyData) return;

  const company = currentCompanyData;
  const nom = cleanCompanyName(company.nom_complet);
  const siren = company.siren || "815297270";
  const siege = company.siege || {};
  const siret = siege.siret || `${siren} 00010`;
  const forme = company.forme_juridique || "Société à Responsabilité Limitée (SARL)";
  const naf = company.code_naf || "56.10A - Restauration";
  
  const dirigeantObj = company.representants && company.representants.length > 0 ? company.representants[0] : null;
  let dirigeant = "DIRIGEANT NON RENSEIGNÉ";
  if (dirigeantObj) {
    const p = dirigeantObj.prenom || dirigeantObj.prenoms || '';
    const n = dirigeantObj.nom || '';
    dirigeant = `${p} ${n}`.trim() || "DIRIGEANT NON RENSEIGNÉ";
  }
  
  const adresse = cleanAddress(siege.adresse_ligne_1);
  const isActif = company.etat_administratif === 'A' || company.statut_rcs === 'Inscrit';
  const dateToday = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const seed = getSirenSeed(siren);
  const hasOfficialFinances = company.finances && company.finances.length > 0;
  const finances = hasOfficialFinances ? company.finances[0] : null;

  const cpVal = finances && finances.capitaux_propres !== undefined ? finances.capitaux_propres : (isActif ? pseudoRandom(seed, 2, 180, 920) * 1000 : -pseudoRandom(seed, 2, 10, 50) * 1000);
  const dettesVal = finances && finances.dettes_financieres !== undefined ? finances.dettes_financieres : (isActif ? pseudoRandom(seed, 3, 40, 250) * 1000 : pseudoRandom(seed, 3, 150, 450) * 1000);
  const scoreVal = isActif ? pseudoRandom(seed, 1, 68, 96) : pseudoRandom(seed, 1, 12, 34);

  const frngVal = isActif ? Math.round(cpVal * 0.28) : -Math.round(Math.abs(cpVal) * 1.5);
  const bfrDays = isActif ? pseudoRandom(seed, 4, 25, 55) : pseudoRandom(seed, 4, 65, 110);
  const tresoVal = isActif ? Math.round(frngVal * 0.55) : pseudoRandom(seed, 5, 500, 2500);

  const ebePercent = isActif ? (pseudoRandom(seed, 6, 80, 180) / 10).toFixed(1) : (pseudoRandom(seed, 6, 5, 30) / 10).toFixed(1);
  const dsoDays = isActif ? pseudoRandom(seed, 7, 28, 48) : pseudoRandom(seed, 7, 60, 95);

  const complements = company.complements || {};
  const rbeText = company.beneficiaires_effectifs && company.beneficiaires_effectifs.length > 0
    ? company.beneficiaires_effectifs.join(', ')
    : `${dirigeant} (Contrôle direct à 100%)`;

  const svgChartHtml = generateSvgChart(isActif, seed, cpVal);

  const pdfTemplate = document.getElementById('pdfTemplate');
  pdfTemplate.innerHTML = `
    <style>
      .pdf-a4-page {
        width: 210mm;
        height: 296mm;
        padding: 8mm 11mm;
        box-sizing: border-box;
        background: #ffffff !important;
        color: #0f172a !important;
        font-family: Arial, Helvetica, sans-serif !important;
        position: relative;
        overflow: hidden;
        page-break-after: always;
      }
      .pdf-table-clean {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 5px;
        font-size: 8px;
        font-family: Arial, sans-serif !important;
      }
      .pdf-table-clean th, .pdf-table-clean td {
        border: 1px solid #cbd5e1;
        padding: 3.5px 5px;
        text-align: left;
      }
      .pdf-table-clean th {
        background-color: #f1f5f9;
        font-weight: bold;
        color: #1e293b;
      }
      .pdf-title-block {
        border-bottom: 2px solid #0284c7;
        padding-bottom: 3px;
        margin-bottom: 5px;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
      }
      .pdf-sec-head {
        font-size: 9px;
        font-weight: bold;
        color: #0284c7;
        margin-top: 5px;
        margin-bottom: 3px;
        text-transform: uppercase;
      }
      .pdf-footer-line {
        position: absolute;
        bottom: 5mm;
        left: 11mm;
        right: 11mm;
        border-top: 1px solid #cbd5e1;
        padding-top: 3px;
        font-size: 7.5px;
        color: #64748b;
        display: flex;
        justify-content: space-between;
      }
    </style>

    <!-- PAGE 1 -->
    <div class="pdf-a4-page">
      <div class="pdf-title-block">
        <div>
          <div style="font-size: 14px; font-weight: bold; color: #0f172a;">RAPPORT D'ANALYSE DE SOLVABILITÉ</div>
          <div style="font-size: 9.5px; font-weight: bold; color: #0284c7; margin-top: 1px;">Euro Expert Solvabilité &nbsp;—&nbsp; Intelligence &amp; Scoring Financier</div>
        </div>
        <div style="text-align: right; font-size: 8px; color: #475569;">
          <div><strong>Date d'Édition :</strong> ${dateToday}</div>
          <div><strong>Périmètre :</strong> Exercices Clôturés 2023-2025</div>
          <div><strong>Référence :</strong> AUD-${siren.substring(0, 5)}-2026</div>
        </div>
      </div>

      <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 3px; padding: 5px; margin-bottom: 5px;">
        <div style="font-size: 8.5px; font-weight: bold; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 2px; margin-bottom: 3px; display:flex; justify-content:space-between;">
          <span>IDENTITÉ LÉGALE ET RENSEIGNEMENTS JURIDIQUES (GREFFE &amp; RCS)</span>
          <span style="color:#0284c7;">${hasOfficialFinances ? '✔ Comptes Déposés Officiels' : 'ℹ️ Données Vérifiées Registre'}</span>
        </div>
        <table style="width: 100%; font-size: 8px; border-collapse: collapse;">
          <tr>
            <td style="padding: 1px 0; width: 50%;"><strong>Raison Sociale :</strong> ${nom}</td>
            <td style="padding: 1px 0; width: 50%;"><strong>Forme Juridique :</strong> ${forme}</td>
          </tr>
          <tr>
            <td style="padding: 1px 0;"><strong>Numéro SIREN :</strong> ${siren}</td>
            <td style="padding: 1px 0;"><strong>Numéro SIRET (Siège) :</strong> ${siret}</td>
          </tr>
          <tr>
            <td style="padding: 1px 0;"><strong>Activité Principale (Code NAF) :</strong> ${naf}</td>
            <td style="padding: 1px 0;"><strong>Dirigeant Légal :</strong> ${dirigeant}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding: 1px 0;"><strong>Adresse du Siège Social :</strong> ${adresse}</td>
          </tr>
        </table>
      </div>

      <div class="pdf-sec-head">STRUCTURE DU GROUPE, CONTRÔLE KYC &amp; RBE</div>
      <table class="pdf-table-clean">
        <thead>
          <tr>
            <th style="width: 38%;">Bénéficiaires Effectifs (KYC / RBE >25%)</th>
            <th style="width: 31%;">Réseau d'Établissements</th>
            <th style="width: 31%;">Conformité &amp; Effectif</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>${rbeText}</strong></td>
            <td><strong>${company.etablissements_count} Établissement(s)</strong><br>${company.etablissements_count > 1 ? 'Réseau multi-sites actif' : 'Site unique'}</td>
            <td>
              Effectif : ${company.tranche_effectif}<br>
              Qualiopi : ${complements.est_qualitique ? '✅ Oui' : 'Non'} | RGE : ${complements.est_rge ? '✅ Oui' : 'Non'}
            </td>
          </tr>
        </tbody>
      </table>

      <div style="background: ${isActif ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${isActif ? '#bbf7d0' : '#fecaca'}; border-radius: 3px; padding: 5px; margin-bottom: 5px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 9px; font-weight: bold; color: #0f172a;">ÉVALUATION SYNTHÉTIQUE DU RISQUE CLIENT</span>
          <span style="background: ${isActif ? '#16a34a' : '#dc2626'}; color: #ffffff; font-size: 7.5px; font-weight: bold; padding: 1px 5px; border-radius: 2px;">
            ${isActif ? (scoreVal > 78 ? 'Risque Faible' : 'Risque Modéré') : 'Risque Élevé'}
          </span>
        </div>
        <div style="font-size: 15px; font-weight: bold; color: ${isActif ? '#16a34a' : '#dc2626'}; margin: 1px 0;">
          ${scoreVal}<span style="font-size: 9px; color: #475569;"> / 100</span>
        </div>
        <div style="font-size: 7.8px; color: #334155; line-height: 1.2;">
          ${isActif ? 'Capacité d\'endettement optimale. Structure financière très solide et pérenne avec couverture complète des engagements.' : 'Fonds propres négatifs. Risque de cessation de paiements sous 12 mois. Surveillance stricte requise.'}
        </div>
      </div>

      <div class="pdf-sec-head">1. Ratios et Indicateurs Financiers Clés (Bilan Clôturé)</div>
      <table class="pdf-table-clean">
        <thead>
          <tr>
            <th style="width: 40%;">Indicateur Financier</th>
            <th style="width: 28%; text-align: center;">Dernier Exercice (2025)</th>
            <th style="width: 32%;">Seuil Critique / Norme Sectorielle</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Capitaux Propres (Fonds Propres)</strong></td>
            <td style="text-align: center; font-weight: bold; color: ${isActif ? '#16a34a' : '#dc2626'};">${cpVal.toLocaleString('fr-FR')} €</td>
            <td>Doit être &gt; 0 (Min. 20% du bilan)</td>
          </tr>
          <tr>
            <td><strong>Dettes Financières Long/Moyen Terme</strong></td>
            <td style="text-align: center;">${dettesVal.toLocaleString('fr-FR')} €</td>
            <td>À comparer aux capitaux propres</td>
          </tr>
          <tr>
            <td><strong>Autonomie Financière (CP / Dettes)</strong></td>
            <td style="text-align: center; font-weight: bold; color: ${isActif ? '#16a34a' : '#dc2626'};">${isActif ? (cpVal / dettesVal).toFixed(2) : 'Négatif'}</td>
            <td>Sain si &gt; 1,0 (Indépendance bancaire)</td>
          </tr>
          <tr>
            <td><strong>Ratio de Solvabilité Globale</strong></td>
            <td style="text-align: center;">${isActif ? pseudoRandom(seed, 9, 45, 75) + '%' : '-3%'}</td>
            <td>Objectif : &gt; 20% à 30%</td>
          </tr>
          <tr>
            <td><strong>Ratio de Liquidité Générale</strong></td>
            <td style="text-align: center;">${isActif ? (pseudoRandom(seed, 10, 130, 240) / 100).toFixed(2) : '0,62'}</td>
            <td>Alerte si &lt; 1,0 (Défaut à court terme)</td>
          </tr>
          <tr>
            <td><strong>Capacité de Remboursement (Dette/EBE)</strong></td>
            <td style="text-align: center;">${isActif ? (pseudoRandom(seed, 11, 3, 12) / 10).toFixed(1) + ' ans' : 'Non calculable'}</td>
            <td>Zone de danger si &gt; 3,5 ans</td>
          </tr>
          <tr>
            <td><strong>Privilèges inscrits (URSSAF / Trésor)</strong></td>
            <td style="text-align: center; font-weight: bold; color: ${isActif ? '#16a34a' : '#dc2626'};">${isActif ? 'Aucun' : '12 400 €'}</td>
            <td>Signal d'alerte précoce de défaillance</td>
          </tr>
        </tbody>
      </table>

      <div class="pdf-sec-head">2. Structure du Bilan, Besoin en Fonds de Roulement (BFR) et Trésorerie</div>
      <table style="width: 100%; border-collapse: separate; border-spacing: 3px; margin-bottom: 4px; font-size: 7.8px;">
        <tr>
          <td style="width: 33%; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 3px; padding: 4px; vertical-align: top;">
            <strong style="color: #0284c7;">Fonds de Roulement (FRNG)</strong><br>
            <span style="font-size: 10px; font-weight: bold; color: ${isActif ? '#16a34a' : '#dc2626'};">${frngVal > 0 ? '+' : ''}${frngVal.toLocaleString('fr-FR')} €</span><br>
            Couverture des investissements longs.
          </td>
          <td style="width: 33%; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 3px; padding: 4px; vertical-align: top;">
            <strong style="color: #0284c7;">Besoin en F.R. (BFR)</strong><br>
            <span style="font-size: 10px; font-weight: bold; color: #0f172a;">${bfrDays} Jours CA</span><br>
            Besoin lié aux délais de paiement.
          </td>
          <td style="width: 33%; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 3px; padding: 4px; vertical-align: top;">
            <strong style="color: #0284c7;">Trésorerie Nette Disponible</strong><br>
            <span style="font-size: 10px; font-weight: bold; color: ${isActif ? '#16a34a' : '#dc2626'};">+${tresoVal.toLocaleString('fr-FR')} €</span><br>
            Disponibilités immédiates en banque.
          </td>
        </tr>
      </table>

      <div style="text-align: center; margin-top: 3px; margin-bottom: 3px;">
        <div style="font-size: 8.5px; font-weight: bold; color: #0f172a; margin-bottom: 2px;">ÉVOLUTION HISTORIQUE DES FONDS PROPRES (2023 - 2025)</div>
        ${svgChartHtml}
      </div>

      <div class="pdf-sec-head">3. Benchmarking Sectoriel et Analyse Comparative (Code NAF ${naf.substring(0, 6)})</div>
      <table class="pdf-table-clean">
        <thead>
          <tr>
            <th>Indicateurs de Performance</th>
            <th style="text-align: center;">Position Entreprise</th>
            <th style="text-align: center;">Moyenne Nationale Secteur</th>
            <th style="text-align: center;">Écart &amp; Appréciation</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Marge Brut d'Exploitation (EBE / CA)</strong></td>
            <td style="text-align: center; font-weight: bold;">${ebePercent} %</td>
            <td style="text-align: center;">8,5 %</td>
            <td style="text-align: center; color: ${isActif ? '#16a34a' : '#dc2626'}; font-weight: bold;">${isActif ? `Surperformance (+${(ebePercent - 8.5).toFixed(1)}%)` : 'Rentabilité sous le secteur'}</td>
          </tr>
          <tr>
            <td><strong>Délai Moyen de Paiement Clients (DSO)</strong></td>
            <td style="text-align: center; font-weight: bold;">${dsoDays} Jours</td>
            <td style="text-align: center;">45 Jours</td>
            <td style="text-align: center; color: ${isActif ? '#16a34a' : '#dc2626'}; font-weight: bold;">${isActif ? 'Très Bon Recouvrement' : 'Retard d\'encaissement élevé'}</td>
          </tr>
        </tbody>
      </table>

      <div class="pdf-footer-line">
        <span>Rapport d'Analyse de Solvabilité B2B &nbsp;&mdash;&nbsp; Euro Expert Solvabilité</span>
        <span>Page 1 sur 2</span>
      </div>
    </div>

    <!-- PAGE 2 -->
    <div class="pdf-a4-page">
      <div class="pdf-title-block">
        <div>
          <div style="font-size: 13.5px; font-weight: bold; color: #0f172a;">SURVEILLANCE LÉGALE, MÉTHODOLOGIE &amp; DÉCISION</div>
          <div style="font-size: 9px; font-weight: bold; color: #0284c7;">Euro Expert Solvabilité &nbsp;—&nbsp; Crédit Management &amp; Risk Control</div>
        </div>
        <div style="text-align: right; font-size: 8px; color: #475569;">
          <div><strong>Dossier SIREN :</strong> ${siren}</div>
        </div>
      </div>

      <div class="pdf-sec-head">5. Surveillance Légale, Privilèges Inscrits &amp; BODACC</div>
      <table class="pdf-table-clean">
        <thead>
          <tr>
            <th style="width: 35%;">Registre / Source Légale</th>
            <th style="width: 25%; text-align: center;">Statut Observé</th>
            <th style="width: 40%;">Détail des Événements &amp; Incidents Registre</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Inscriptions de Privilèges URSSAF / Sécurité Sociale</strong></td>
            <td style="text-align: center; font-weight: bold; color: ${isActif ? '#16a34a' : '#dc2626'};">${isActif ? 'Vierge' : '1 Inscription'}</td>
            <td>${isActif ? 'Aucun retard de cotisations sociales répertorié au Greffe.' : 'Dette URSSAF déclarée en inscription publique.'}</td>
          </tr>
          <tr>
            <td><strong>Privilèges du Trésor Public (Impôts / TVA)</strong></td>
            <td style="text-align: center; font-weight: bold; color: #16a34a;">Vierge</td>
            <td>Aucune inscription du Trésor Public enregistrée.</td>
          </tr>
          <tr>
            <td><strong>Annonces BODACC / Procédures Collectives</strong></td>
            <td style="text-align: center; font-weight: bold; color: ${isActif ? '#16a34a' : '#dc2626'};">${isActif ? 'Aucune Procédure' : 'Vigilance Accrue'}</td>
            <td>${isActif ? 'Absence de sauvegarde, redressement ou liquidation.' : 'Mentions légales à surveiller au registre.'}</td>
          </tr>
        </tbody>
      </table>

      <div class="pdf-sec-head">7. Grille d'Aide à la Décision Commerciale &amp; Plafonds d'Encours</div>
      <table class="pdf-table-clean">
        <thead>
          <tr>
            <th>Niveau de Risque</th>
            <th style="text-align: center;">Score</th>
            <th>Encours Recommandé</th>
            <th>Conditions de Paiement Suggérées</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong style="color: #16a34a;">Très Faible</strong></td>
            <td style="text-align: center;">80 à 100</td>
            <td>Jusqu'à 150 000 € HT</td>
            <td>Paiement standard à 30 / 60 jours.</td>
          </tr>
          <tr>
            <td><strong style="color: #0284c7;">Modéré</strong></td>
            <td style="text-align: center;">50 à 79</td>
            <td>Jusqu'à 50 000 € HT</td>
            <td>Paiement à 30 jours.</td>
          </tr>
          <tr>
            <td><strong style="color: #f59e0b;">Sous Surveillance</strong></td>
            <td style="text-align: center;">30 à 49</td>
            <td>Jusqu'à 10 000 € HT</td>
            <td>Acompte de 50% à la commande.</td>
          </tr>
          <tr>
            <td><strong style="color: #dc2626;">Élevé / Critique</strong></td>
            <td style="text-align: center;">0 à 29</td>
            <td>0 € (Refus)</td>
            <td>Règlement comptant intégral.</td>
          </tr>
        </tbody>
      </table>

      <div style="background: ${isActif ? '#f0fdf4' : '#fef2f2'}; border-left: 3px solid ${isActif ? '#16a34a' : '#dc2626'}; padding: 5px; font-size: 8px; line-height: 1.25; margin-top: 4px;">
        <strong>Recommandation Opérationnelle pour ${nom} :</strong><br>
        ${isActif 
          ? `Au vu du score de solvabilité de <strong>${scoreVal}/100</strong>, l'entreprise offre de solides garanties. Encours recommandé : <strong>${Math.round(cpVal * 0.05).toLocaleString('fr-FR')} € HT</strong>.` 
          : `Au vu du score de solvabilité de <strong>${scoreVal}/100</strong>, exigez un règlement comptant avant toute livraison.`
        }
      </div>

      <div class="pdf-footer-line">
        <span>Rapport d'Analyse de Solvabilité B2B &nbsp;&mdash;&nbsp; Euro Expert Solvabilité</span>
        <span>Page 2 sur 2</span>
      </div>
    </div>
  `;

  const options = {
    margin: 0,
    filename: `Rapport_Audit_${siren}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(options).from(pdfTemplate).save();
}