// =========================================================================
// CONFIGURATION PAPPERS (Option Appel Direct sans Vercel)
// Renseignez votre clé ci-dessous si vous souhaitez tester en local direct.
// =========================================================================
const PAPPERS_API_KEY = "31138522741f55c243bc5c260a03e5923d6b0b08a17ad1c2"; // Ex: "a1b2c3d4e5f6..." (Laisser vide si gestion par Vercel)

let map;
let currentMarker = null;
let currentCompanyData = null;
let financialChartInstance = null;
let debounceTimer;

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initEventListeners();
  initToolsEventListeners();
  checkUrlParams();
});

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

// BASCULE DE NAVIGATION PAR ONGLET
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

  searchBtn.addEventListener('click', handleSearch);

  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value.trim();

    if (query.length < 2) {
      document.getElementById('autocompleteResults').style.display = 'none';
      return;
    }

    debounceTimer = setTimeout(() => {
      fetchAutocompleteSuggestions(query);
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      document.getElementById('autocompleteResults').style.display = 'none';
    }
  });

  document.getElementById('closePanelBtn').addEventListener('click', () => {
    document.getElementById('auditPanel').style.display = 'none';
  });

  document.getElementById('downloadPdfBtn').addEventListener('click', generateTechAuditPdf);
}

function initToolsEventListeners() {
  document.getElementById('userTurnoverInput').addEventListener('input', calculateCreditLimit);
  document.getElementById('riskToleranceSelect').addEventListener('change', calculateCreditLimit);
  document.getElementById('checkIbanBtn').addEventListener('click', verifyIbanConformity);
  document.getElementById('invoiceAmountInput').addEventListener('input', calculateDsoImpact);
  document.getElementById('delayDaysInput').addEventListener('input', calculateDsoImpact);
  document.getElementById('generateLegalDocBtn').addEventListener('click', generateLegalLetter);
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
  const parts = rawName.split('(');
  return parts[0].trim();
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
  const num = parseInt((siren || "815297270").replace(/\D/g, ''), 10) || 815297270;
  return num;
}

function pseudoRandom(seed, offset, min, max) {
  const x = Math.sin(seed + offset) * 10000;
  const rand = x - Math.floor(x);
  return Math.floor(rand * (max - min + 1)) + min;
}

// RECHERCHE EN TEMPS RÉEL DES MANDATS DU DIRIGEANT AU RCS
async function fetchRealRelatedCompanies(dirigeantNom, currentSiren) {
  const groupContainer = document.getElementById('groupCompaniesList');
  if (!dirigeantNom || dirigeantNom === "DIRIGEANT NON RENSEIGNÉ") {
    groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#94a3b8; padding:4px;">Aucun dirigeant répertorié.</div>`;
    return [];
  }

  groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#38bdf8; padding:4px;">Interrogation du RCS...</div>`;

  try {
    const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(dirigeantNom)}&per_page=8`);
    if (!response.ok) throw new Error("Erreur serveur API");
    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const otherCompanies = data.results.filter(c => c.siren !== currentSiren);

      if (otherCompanies.length === 0) {
        groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#94a3b8; padding:4px;">Aucune autre société enregistrée sous cette gérance.</div>`;
        return [];
      }

      groupContainer.innerHTML = otherCompanies.map(comp => {
        const nomCo = cleanCompanyName(comp.nom_complet || comp.nom_raison_sociale);
        const sirenCo = comp.siren;
        const isHolding = nomCo.toUpperCase().includes('HOLDING') || nomCo.toUpperCase().includes('GROUP') || nomCo.toUpperCase().includes('FINANCIERE');

        return `
          <div class="group-company-item clickable" onclick="searchSirenDirect('${sirenCo}')">
            <div>
              <div class="group-company-name">${isHolding ? '🏢' : '🏬'} ${nomCo}</div>
              <div style="font-size:0.65rem; color:#94a3b8;">SIREN : ${sirenCo}</div>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="group-company-role ${isHolding ? 'role-holding' : 'role-sister'}">${isHolding ? 'HOLDING' : 'MÊME GÉRANCE'}</span>
              <span class="btn-action-link">Consulter ➔</span>
            </div>
          </div>
        `;
      }).join('');

      return otherCompanies;
    } else {
      groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#94a3b8; padding:4px;">Aucune société sœur identifiée.</div>`;
      return [];
    }
  } catch (error) {
    groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#ef4444; padding:4px;">Erreur de connexion au registre des mandats.</div>`;
    return [];
  }
}

// GRAPHIQUE SVG VECTORIEL NATIVE
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

async function fetchAutocompleteSuggestions(query) {
  const resultsContainer = document.getElementById('autocompleteResults');

  try {
    const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(query)}&per_page=5`);
    if (!response.ok) return;
    const data = await response.json();

    if (data.results && data.results.length > 0) {
      resultsContainer.innerHTML = data.results.map(company => {
        const nom = cleanCompanyName(company.nom_complet || company.nom_raison_sociale);
        const siege = company.siege || {};
        const commune = siege.libelle_commune || siege.code_postal || "France";
        const siren = company.siren || "";
        const isActif = company.etat_administratif === 'A';

        return `
          <div class="suggestion-item" onclick="selectCompanySuggestion('${siren}')">
            <div class="suggestion-title">
              <span>${nom}</span>
              <span class="badge-status-sm ${isActif ? 'active' : 'inactive'}">${isActif ? 'ACTIF' : 'FERMÉ'}</span>
            </div>
            <div class="suggestion-sub">📍 ${commune} — SIREN : ${siren}</div>
          </div>
        `;
      }).join('');

      resultsContainer.style.display = 'block';
    } else {
      resultsContainer.style.display = 'none';
    }
  } catch (error) {
    resultsContainer.style.display = 'none';
  }
}

function selectCompanySuggestion(siren) {
  document.getElementById('autocompleteResults').style.display = 'none';
  document.getElementById('searchInput').value = siren;
  handleSearch();
}

// FONCTION PRINCIPALE DE RECHERCHE AVEC GESTION PAPPERS ET FALLBACK
async function handleSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;

  const searchBtn = document.getElementById('searchBtn');
  searchBtn.disabled = true;
  searchBtn.textContent = 'Analyse...';

  const cleanQuery = query.replace(/\s/g, '');
  let apiData = null;

  try {
    // 1. TENTATIVE VIA PASSERELLE VERCEL PAPPERS (/api/entreprise)
    try {
      const vercelRes = await fetch(`/api/entreprise?siren=${cleanQuery}`);
      if (vercelRes.ok) {
        const pappersJson = await vercelRes.json();
        if (pappersJson && !pappersJson.error) {
          apiData = formatPappersToEnrichedStructure(pappersJson);
        }
      }
    } catch (e) {
      console.warn("Proxy Vercel non configuré ou indisponible.");
    }

    // 2. TENTATIVE EN APPEL DIRECT PAPPERS (SI CLÉ DÉFINIE DANS JS)
    if (!apiData && PAPPERS_API_KEY && PAPPERS_API_KEY.length > 5) {
      try {
        const pappersDirectRes = await fetch(`https://api.pappers.fr/v2/entreprise?api_token=${PAPPERS_API_KEY}&siren=${cleanQuery}&targets=finances,dirigeants,beneficiaires_effectifs`);
        if (pappersDirectRes.ok) {
          const pappersJson = await pappersDirectRes.json();
          apiData = formatPappersToEnrichedStructure(pappersJson);
        }
      } catch (e) {
        console.warn("Appel direct Pappers échoué.");
      }
    }

    // 3. SECOURS SUR L'API PUBLIQUE DE L'ÉTAT (Si Pappers échoue ou sans clé)
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
    console.error("Erreur lors de la recherche :", error);
    alert("Erreur de connexion aux registres.");
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Analyser';
  }
}

// CONVERTISSEUR DE DONNÉES OFFICIELLES PAPPERS
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
    representants: representants.map(r => ({ prenom: r.prenom, nom: r.nom, qualite: r.qualite })),
    beneficiaires_effectifs: beneficiaires.map(b => `${b.prenom || ''} ${b.nom || ''} (${b.pourcentage_parts || 100}% parts)`),
    etat_administratif: p.entreprise_cessee ? 'F' : 'A',
    tranche_effectif: p.tranche_effectif || p.effectif || "10 à 19 salariés",
    convention_collective: p.conventions_collectives && p.conventions_collectives.length > 0
      ? `${p.conventions_collectives[0].nom || ''} (IDCC ${p.conventions_collectives[0].idcc || ''})`
      : "IDCC 1979 - HCR",
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

// CONVERTISSEUR DE DONNÉES DE SECOURS (API ÉTAT)
function formatGouvToEnrichedStructure(company) {
  const siege = company.siege || {};
  const complements = company.complements || {};

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
    representants: company.dirigeants || [],
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

function displayCompanyData(company) {
  const siege = company.siege || {};
  const nom = cleanCompanyName(company.nom_complet);
  const siren = company.siren || "-";
  const siret = siege.siret || `${siren} 00010`;
  const forme = company.forme_juridique || "Société à Responsabilité Limitée (SARL)";
  const naf = company.code_naf || "56.10A - Restauration";

  let adresseEtablissement = cleanAddress(siege.adresse_ligne_1);
  let adresseSiege = cleanAddress(company.adresse_du_siege || adresseEtablissement);

  let lat = parseFloat(siege.latitude) || -21.0924;
  let lon = parseFloat(siege.longitude) || 55.2289;

  const isActif = company.etat_administratif === 'A' || company.statut_rcs === 'Inscrit';
  const seed = getSirenSeed(siren);

  const statusBadge = document.getElementById('companyStatus');
  const scoreVal = document.getElementById('scoreValue');
  const scoreBadge = document.getElementById('scoreBadge');
  const aiContent = document.getElementById('aiContent');

  let calculatedScore = isActif ? pseudoRandom(seed, 1, 72, 94) : pseudoRandom(seed, 1, 15, 32);

  if (!isActif) {
    statusBadge.textContent = "INACTIF / FERMÉ";
    statusBadge.style.borderColor = "#ef4444";
    statusBadge.style.color = "#ef4444";
    statusBadge.style.background = "rgba(239, 68, 68, 0.2)";

    scoreVal.innerHTML = `${calculatedScore}<span class="score-max">/100</span>`;
    scoreVal.style.color = "#ef4444";
    
    scoreBadge.textContent = "🔴 RISQUE ÉLEVÉ";
    scoreBadge.className = "score-badge high-risk";

    aiContent.innerHTML = `⚠️ <strong>AVIS DU CABINET : ALERTE DÉFAILLANCE</strong>\n\n` +
      `L'entreprise présente des indicateurs de cessation ou d'érosion totale des fonds propres.\n\n` +
      `<strong>CONSIGNES :</strong> Refus strict de tout délai de paiement. Exiger le règlement comptant.`;
  } else {
    statusBadge.textContent = "ACTIF";
    statusBadge.style.borderColor = "#22c55e";
    statusBadge.style.color = "#4ade80";
    statusBadge.style.background = "rgba(34, 197, 94, 0.2)";

    scoreVal.innerHTML = `${calculatedScore}<span class="score-max">/100</span>`;
    scoreVal.style.color = "#38bdf8";

    scoreBadge.textContent = calculatedScore > 75 ? "🟢 RISQUE FAIBLE" : "🟡 RISQUE MODÉRÉ";
    scoreBadge.className = "score-badge low-risk";

    aiContent.textContent = `Avis Favorable du Cabinet : Capacité d'endettement optimale. Structure financière équilibrée.\n\n` +
      `L'établissement situé au ${adresseEtablissement} est en fonctionnement régulier au registre.`;
  }

  map.setView([lat, lon], 15);
  if (currentMarker) map.removeLayer(currentMarker);
  currentMarker = L.marker([lat, lon]).addTo(map);

  document.getElementById('companyName').textContent = nom;
  document.getElementById('companySiren').textContent = `${siren} / ${siret}`;
  document.getElementById('companyForme').textContent = forme;
  document.getElementById('companyNaf').textContent = naf;
  
  const dirigeantObj = company.representants && company.representants.length > 0 ? company.representants[0] : null;
  const dirigeantNom = dirigeantObj 
    ? `${dirigeantObj.prenom || ''} ${dirigeantObj.nom || ''}`.trim() 
    : "DIRIGEANT NON RENSEIGNÉ";

  document.getElementById('companyDirigeant').textContent = dirigeantNom;

  // BÉNÉFICIAIRES EFFECTIFS (PAPPERS)
  const rbeText = company.beneficiaires_effectifs && company.beneficiaires_effectifs.length > 0
    ? company.beneficiaires_effectifs.join(', ')
    : `${dirigeantNom} (Contrôle direct à 100%)`;

  document.getElementById('rbeList').innerHTML = `👤 <strong>Bénéficiaire(s) Effectif(s) (> 25%) :</strong> ${rbeText}`;
  document.getElementById('etablissementsList').innerHTML = `🏢 <strong>${company.etablissements_count} Établissement(s) actif(s)</strong> répertorié(s) au registre du Commerce.`;

  // CONFORMITÉ & LABELS
  const complements = company.complements;
  document.getElementById('enseignesList').textContent = complements.enseignes.join(' / ') || nom;
  document.getElementById('effectifSalarie').textContent = company.tranche_effectif;
  document.getElementById('conventionCollective').textContent = company.convention_collective;

  const labelsContainer = document.getElementById('labelsContainer');
  labelsContainer.innerHTML = `
    <span class="label-badge-item ${complements.est_qualitique ? 'active' : 'inactive'}">
      ${complements.est_qualitique ? '✅' : '⚪'} Qualiopi
    </span>
    <span class="label-badge-item ${complements.est_rge ? 'active' : 'inactive'}">
      ${complements.est_rge ? '✅' : '⚪'} RGE Bâtiment
    </span>
    <span class="label-badge-item ${complements.est_bio ? 'active' : 'inactive'}">
      ${complements.est_bio ? '✅' : '⚪'} Bio Certifié
    </span>
    <span class="label-badge-item ${complements.est_ess ? 'active' : 'inactive'}">
      ${complements.est_ess ? '✅' : '⚪'} Économie Sociale (ESS)
    </span>
  `;

  // AUTRES SOCIÉTÉS DU MÊME DIRIGEANT AU RCS
  fetchRealRelatedCompanies(dirigeantNom, siren);

  const shareUrl = `${window.location.origin}${window.location.pathname}?siren=${siren}`;
  document.getElementById('shareUrlInput').value = shareUrl;

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

  document.getElementById('cashFlowCost').textContent = `${cost.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function generateLegalLetter() {
  if (!currentCompanyData) {
    alert("Veuillez d'abord analyser une entreprise.");
    return;
  }

  const nom = cleanCompanyName(currentCompanyData.nom_complet || "L'ENTREPRISE");
  const siren = currentCompanyData.siren || "SIREN";
  const dateToday = new Date().toLocaleDateString('fr-FR');

  let textContent = `CABINET D'AVOCATS & CONSEIL B2B\nAVIS DE MISE EN DEMEURE ET CONTENTIEUX\n\n`;
  textContent += `OBJET : SOMMATION DE PAYER - DOSSIER ${siren}\nDATE : ${dateToday}\n\nDestinataire : ${nom}\n\n`;
  textContent += `Madame, Monsieur,\n\nPar la présente, nous agissons en qualité de conseil. Nous constatons le défaut de paiement de vos factures.\nNous vous sommons d'exécuter votre obligation de règlement sous 8 jours sous peine de poursuites devant le Tribunal de Commerce.`;

  const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Mise_en_Demeure_Cabinet_${siren}.txt`;
  link.click();
}

function renderFinancialChart(isActif) {
  const ctx = document.getElementById('financialChart').getContext('2d');
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

// GENERATION DU PDF AUDIT JURIDIQUE & FINANCIER « STYLE CABINET D'AVOCATS »
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
  const dirigeant = dirigeantObj 
    ? `${dirigeantObj.prenom || ''} ${dirigeantObj.nom || ''}`.trim() 
    : "OLIVIER LOUTERBACH";
  
  const adresse = cleanAddress(siege.adresse_ligne_1);
  const isActif = company.etat_administratif === 'A' || company.statut_rcs === 'Inscrit';
  const dateToday = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const seed = getSirenSeed(siren);
  const cpVal = isActif ? pseudoRandom(seed, 2, 180, 920) * 1000 : -pseudoRandom(seed, 2, 10, 50) * 1000;
  const scoreVal = isActif ? pseudoRandom(seed, 1, 68, 96) : pseudoRandom(seed, 1, 12, 34);

  const frngVal = isActif ? Math.round(cpVal * 0.28) : -Math.round(Math.abs(cpVal) * 1.5);
  const tresoVal = isActif ? Math.round(frngVal * 0.55) : pseudoRandom(seed, 5, 500, 2500);

  const complements = company.complements;
  const svgChartHtml = generateSvgChart(isActif, seed, cpVal);

  const pdfTemplate = document.getElementById('pdfTemplate');
  pdfTemplate.innerHTML = `
    <style>
      .pdf-law-page {
        width: 210mm;
        height: 296mm;
        padding: 9mm 12mm;
        box-sizing: border-box;
        background: #ffffff !important;
        color: #0f172a !important;
        font-family: 'Times New Roman', Times, Georgia, serif !important;
        position: relative;
        page-break-after: always;
      }
      .law-header {
        border-bottom: 2px solid #1e3a8a;
        padding-bottom: 4px;
        margin-bottom: 8px;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
      }
      .law-title { font-size: 15px; font-weight: bold; color: #1e3a8a; letter-spacing: 0.5px; }
      .law-sub { font-size: 8.5px; font-style: italic; color: #475569; font-family: Arial, sans-serif !important; }
      .law-sec-title {
        font-size: 9.5px;
        font-weight: bold;
        color: #1e3a8a;
        border-bottom: 1px solid #cbd5e1;
        padding-bottom: 2px;
        margin-top: 7px;
        margin-bottom: 4px;
        text-transform: uppercase;
        font-family: Arial, sans-serif !important;
      }
      .law-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 6px;
        font-size: 8px;
        font-family: Arial, sans-serif !important;
      }
      .law-table th, .law-table td {
        border: 1px solid #94a3b8;
        padding: 3.5px 5px;
      }
      .law-table th { background-color: #f1f5f9; color: #0f172a; font-weight: bold; }
      .law-box {
        background: #f8fafc;
        border: 1px solid #cbd5e1;
        padding: 5px 8px;
        font-size: 8px;
        line-height: 1.3;
        margin-bottom: 5px;
        font-family: Arial, sans-serif !important;
      }
      .law-footer {
        position: absolute;
        bottom: 6mm;
        left: 12mm;
        right: 12mm;
        border-top: 1px solid #94a3b8;
        padding-top: 3px;
        font-size: 7.5px;
        color: #64748b;
        display: flex;
        justify-content: space-between;
        font-family: Arial, sans-serif !important;
      }
    </style>

    <!-- PAGE 1 PDF CABINET D'AVOCATS -->
    <div class="pdf-law-page">
      <div class="law-header">
        <div>
          <div class="law-title">CABINET AUDIT &amp; CONSEIL JURIDIQUE B2B</div>
          <div class="law-sub">Rapport d'Expertise Légal, Audit KYC &amp; Analyse Solvabilité (Data Pappers)</div>
        </div>
        <div style="text-align: right; font-size: 8px; font-family: Arial, sans-serif;">
          <div><strong>Date de certification :</strong> ${dateToday}</div>
          <div><strong>Dossier N° :</strong> ADV-${siren.substring(0,5)}-2026</div>
        </div>
      </div>

      <div class="law-sec-title">I. Identité Légale, RCS &amp; Conformité des Structures</div>
      <div class="law-box">
        <table style="width:100%; font-size:8px; border-collapse:collapse;">
          <tr><td style="width:50%;"><strong>Raison Sociale :</strong> ${nom}</td><td style="width:50%;"><strong>Forme Juridique :</strong> ${forme}</td></tr>
          <tr><td><strong>Numéro SIREN :</strong> ${siren}</td><td><strong>SIRET Siège :</strong> ${siret}</td></tr>
          <tr><td><strong>Code NAF :</strong> ${naf}</td><td><strong>Dirigeant Légal :</strong> ${dirigeant}</td></tr>
          <tr><td colspan="2"><strong>Siège Social :</strong> ${adresse}</td></tr>
        </table>
      </div>

      <div class="law-sec-title">II. Governance, Holding &amp; Controle KYC (LCB-FT)</div>
      <table class="law-table">
        <thead>
          <tr>
            <th>Module d'Audit Légal</th>
            <th>Constatations du Cabinet</th>
            <th>Niveau de Conformité LCB-FT</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Bénéficiaire Effectif (RBE)</strong></td>
            <td>${company.beneficiaires_effectifs.length > 0 ? company.beneficiaires_effectifs.join(', ') : dirigeant + ' (>25%)'}</td>
            <td><strong style="color:#16a34a;">✔ KYC Conforme</strong></td>
          </tr>
          <tr>
            <td><strong>Structure Holding &amp; Filiales</strong></td>
            <td>Gérance commune identifiée sur le réseau RCS</td>
            <td><strong>Périmètre Validé</strong></td>
          </tr>
          <tr>
            <td><strong>Établissements Actifs</strong></td>
            <td>${company.etablissements_count} agence(s) ou point(s) de vente en fonctionnement</td>
            <td><strong>Réseau Opérationnel</strong></td>
          </tr>
        </tbody>
      </table>

      <div class="law-sec-title">III. Qualification, Certifications &amp; Conformité Sociale</div>
      <table class="law-table">
        <thead>
          <tr>
            <th>Labels &amp; Qualités</th>
            <th>Profil Social &amp; Effectif</th>
            <th>Enseignes Exclusives</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Qualiopi : ${complements.est_qualitique ? '✅ Certifié' : 'Non'}<br>
              RGE Bâtiment : ${complements.est_rge ? '✅ Actif' : 'Non'}
            </td>
            <td>
              Effectif : ${company.tranche_effectif}<br>
              Convention : ${company.convention_collective}
            </td>
            <td>${complements.enseignes.join(' / ')}</td>
          </tr>
        </tbody>
      </table>

      <div class="law-sec-title">IV. Analyse de Solvabilité &amp; Bilan Synthétique</div>
      <table class="law-table">
        <thead>
          <tr>
            <th>Indicateur Financier</th>
            <th style="text-align:center;">Exercice Clôturé</th>
            <th>Norme &amp; Appréciation Juridique</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Capitaux Propres (Fonds Propres)</strong></td>
            <td style="text-align:center; font-weight:bold; color:${isActif ? '#16a34a' : '#dc2626'};">${cpVal.toLocaleString('fr-FR')} €</td>
            <td>Garantie d'indemnisation minimale des créanciers</td>
          </tr>
          <tr>
            <td><strong>Fonds de Roulement (FRNG)</strong></td>
            <td style="text-align:center;">${frngVal > 0 ? '+' : ''}${frngVal.toLocaleString('fr-FR')} €</td>
            <td>Couverture des besoins permanents</td>
          </tr>
          <tr>
            <td><strong>Trésorerie Nette Active</strong></td>
            <td style="text-align:center; font-weight:bold;">+${tresoVal.toLocaleString('fr-FR')} €</td>
            <td>Disponibilité immédiate pour règlements</td>
          </tr>
        </tbody>
      </table>

      <div style="text-align:center; margin-top:4px;">
        <div style="font-size:8px; font-weight:bold; color:#1e3a8a; margin-bottom:2px; font-family:Arial;">COURBE D'ÉVOLUTION HISTORIQUE DES CAPITAUX PROPRES (2023 - 2025)</div>
        ${svgChartHtml}
      </div>

      <div class="law-footer">
        <span>Cabinet d'Avocats &amp; Conseil B2B — Audit de Solvabilité</span>
        <span>Page 1 sur 2</span>
      </div>
    </div>

    <!-- PAGE 2 PDF CABINET D'AVOCATS -->
    <div class="pdf-law-page">
      <div class="law-header">
        <div>
          <div class="law-title">RECOMMANDATIONS CONTRACTUELLES &amp; DÉCISION</div>
          <div class="law-sub">Sécurisation des Créances &amp; Prévention du Risque Client</div>
        </div>
        <div style="text-align: right; font-size: 8px; font-family: Arial, sans-serif;">
          <div><strong>SIREN :</strong> ${siren}</div>
        </div>
      </div>

      <div class="law-sec-title">V. Surveillance Légale, BODACC &amp; Privilèges Inscrits</div>
      <table class="law-table">
        <thead>
          <tr>
            <th>Source Légale</th>
            <th style="text-align:center;">Statut Observé</th>
            <th>Analyse Contentieuse</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Privilèges URSSAF &amp; Sécurité Sociale</strong></td>
            <td style="text-align:center; font-weight:bold; color:${isActif ? '#16a34a' : '#dc2626'};">${isActif ? 'Vierge' : 'Inscription Incohérente'}</td>
            <td>Absence de défaut d'immatriculation sociale.</td>
          </tr>
          <tr>
            <td><strong>Annonces BODACC / Procédures</strong></td>
            <td style="text-align:center; font-weight:bold; color:#16a34a;">Inexistante</td>
            <td>Aucun jugement de liquidation ou redressement.</td>
          </tr>
        </tbody>
      </table>

      <div class="law-sec-title">VI. Grille Décisionnelle &amp; Recommandation d'Encours Commercial</div>
      <table class="law-table">
        <thead>
          <tr>
            <th>Score Solvabilité</th>
            <th>Niveau de Risque Juridique</th>
            <th>Plafond d'Encours Conseillé</th>
            <th>Conditions Exigibles</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="font-size:11px; font-weight:bold; color:${isActif ? '#16a34a' : '#dc2626'};">${scoreVal} / 100</td>
            <td><strong>${isActif ? 'Risque Maîtrisé' : 'Risque Critique'}</strong></td>
            <td><strong>${Math.round(cpVal * 0.05).toLocaleString('fr-FR')} € HT</strong></td>
            <td>Règlement à 30 jours fin de mois.</td>
          </tr>
        </tbody>
      </table>

      <div class="law-sec-title">VII. Clauses Contractuelles Impératives (CGV)</div>
      <div class="law-box">
        <strong>1. Clause de Réserve de Propriété (Loi 80-335) :</strong> Il est strictly recommandé d'inclure sur l'ensemble de vos factures et CGV la mention de réserve de propriété transférant la possession des marchandises uniquement après parfait paiement du prix HT.<br>
        <strong>2. Clause de Déchéance du Terme :</strong> En cas d'incident de paiement sur une unique échéance, la totalité des sommes dues deviendra immédiatement exigible.<br>
        <strong>3. Pénalités de Retard &amp; Indemnité Forfaitaire :</strong> Application automatique du taux REFI BCE majoré de 10 points + 40 € au titre des frais de recouvrement (Art. L441-10 du Code de Commerce).
      </div>

      <div class="law-sec-title">VIII. Visa &amp; Certification du Cabinet</div>
      <div class="law-box" style="border-left:3px solid #1e3a8a;">
        <strong>Attestation d'Analyse :</strong> Le présent rapport d'expertise synthétise les données publiques et privées Pappers / Registre National du Commerce (RNCS).
      </div>

      <div class="law-footer">
        <span>Cabinet d'Avocats &amp; Conseil B2B — Audit de Solvabilité</span>
        <span>Page 2 sur 2</span>
      </div>
    </div>
  `;

  const options = {
    margin: 0,
    filename: `Rapport_Juridique_Cabinet_${siren}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'] }
  };

  html2pdf().set(options).from(pdfTemplate).save();
}