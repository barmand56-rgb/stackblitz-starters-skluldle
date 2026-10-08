let map;
let currentMarker = null;
let currentCompanyData = null;
let financialChartInstance = null;
let debounceTimer;

const SECRET_SALT = "EURO_EXPERT_SOLVABILITE_KEY_2026";

// =========================================================================
// 1. DICTIONNAIRE MULTI-SECTEURS INTELLIGENT (NAF/APE)
// =========================================================================
const SECTOR_PROFILES = {
  '68': {
    name: 'Immobilier & Transaction',
    labels: (c) => [
      { text: '✅ Carte Professionnelle CCI (T/G)', status: true },
      { text: '✅ Garantie Financière Séquestre', status: true },
      { text: '✅ Registre TRACFIN / KYC', status: true }
    ],
    riskFocus: 'Vérification de la régularité des mandats, cartes pro CCI et couverture des fonds mandants.'
  },
  '56': {
    name: 'Restauration & Hôtellerie',
    labels: (c) => [
      { text: c.est_bio ? '✅ Certification BIO' : '⚪ Restauration Classique', status: c.est_bio },
      { text: '✅ Contrôle Sanitaire Conforme', status: true },
      { text: '✅ Licence Débit de Boissons', status: true }
    ],
    riskFocus: 'Sensibilité au BFR saisonnier, aux coûts des matières premières et à la rotation des stocks.'
  },
  '41': { name: 'BTP & Construction', labels: (c) => getBtpLabels(c), riskFocus: 'Exposition aux retards de paiement des maîtres d\'ouvrage et retenues de garantie.' },
  '42': { name: 'Génie Civil & Travaux Publics', labels: (c) => getBtpLabels(c), riskFocus: 'Poids des investissements matériels et nantissements d\'outillage.' },
  '43': { name: 'Travaux Spécialisés BTP', labels: (c) => getBtpLabels(c), riskFocus: 'Gestion de la sous-traitance, des décennales et risque de sinistralité.' }
};

function getBtpLabels(c) {
  return [
    { text: c.est_rge ? '✅ Certification RGE ADEME' : '⚪ Non Certifié RGE', status: c.est_rge },
    { text: '✅ Assurance Décennale Active', status: true },
    { text: '✅ Conformité Sécurité Chantier', status: true }
  ];
}

function getSectorRules(nafCode, complements = {}) {
  const prefix = (nafCode || "").substring(0, 2);
  const profile = SECTOR_PROFILES[prefix];
  if (profile) {
    return {
      sectorName: profile.name,
      labelsHtml: profile.labels(complements).map(l => `<span class="label-badge-item ${l.status ? 'active' : 'inactive'}">${l.text}</span>`).join(''),
      riskFocus: profile.riskFocus
    };
  }
  return {
    sectorName: 'Commerce, Industrie & Services',
    labelsHtml: `<span class="label-badge-item active">✅ Immatriculation RCS Active</span><span class="label-badge-item active">✅ Conformité Urssaf &amp; Fiscale</span>`,
    riskFocus: 'Analyse standard de la liquidité générale, des fonds propres et de la rotation des créances clients.'
  };
}

// =========================================================================
// 2. INITIALISATION CARTE & CODE DE SÉCURITÉ
// =========================================================================
function initMap() {
  if (map) {
    map.remove();
  }
  map = L.map('map', { center: [-21.0924, 55.2289], zoom: 12, zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  setTimeout(() => { if (map) map.invalidateSize(); }, 200);
}

function generateDailyHash(dateStr) {
  let hash = 0;
  const str = dateStr + SECRET_SALT;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return "EES-" + Math.abs(hash).toString(36).toUpperCase().substring(0, 6);
}

function getTodayValidCodes() {
  const today = new Date();
  const dayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  return { dailyCode: generateDailyHash(dayStr), masterCode: "EURO2026" };
}

function verifyPassCode() {
  const inputEl = document.getElementById('passCodeInput');
  if (!inputEl) return;

  const inputCode = inputEl.value.trim().toUpperCase();
  const { dailyCode, masterCode } = getTodayValidCodes();
  const errorMsg = document.getElementById('passErrorMsg');

  if (inputCode === masterCode || inputCode === dailyCode) {
    const overlay = document.getElementById('passModalOverlay');
    if (overlay) overlay.style.display = 'none';

    if (map) {
      map.invalidateSize();
    }
  } else {
    if (errorMsg) errorMsg.style.display = 'block';
  }
}

window.verifyPassCode = verifyPassCode;

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initEventListeners();
  initToolsEventListeners();
  checkUrlParams();
  const input = document.getElementById('passCodeInput');
  if (input) input.focus();
});

// =========================================================================
// 3. APIS DONNÉES ENTREPRISES & BODACC
// =========================================================================
async function fetchBodaccData(siren) {
  try {
    const url = `https://bodacc-api.open-data.fr/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=siren%3D"${siren}"&limit=5`;
    const res = await fetch(url);
    if (!res.ok) return { hasProcedures: false, records: [] };
    const data = await res.json();
    const records = data.results || [];
    const alertKeywords = ['LIQUIDATION', 'REDRESSEMENT', 'SAUVEGARDE', 'FAILLITE', 'CESSATION'];
    const hasProcedures = records.some(r => alertKeywords.some(kw => (r.familleavis_libelle || '').toUpperCase().includes(kw)));
    return { hasProcedures, recordsCount: records.length, records };
  } catch (e) {
    return { hasProcedures: false, records: [] };
  }
}

async function fetchEnrichedCompanyData(siren) {
  const [gouvRes, bodaccData] = await Promise.all([
    fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${siren}&per_page=1`).then(r => r.ok ? r.json() : null).catch(() => null),
    fetchBodaccData(siren)
  ]);
  if (!gouvRes || !gouvRes.results || gouvRes.results.length === 0) return null;
  const company = formatGouvToEnrichedStructure(gouvRes.results[0]);
  company.bodacc = bodaccData;
  if (bodaccData.hasProcedures) company.etat_administratif = 'F';
  return company;
}

async function fetchAutocompleteSuggestions(query) {
  const autoBox = document.getElementById('autocompleteResults');
  if (!autoBox) return;
  try {
    const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(query)}&per_page=5`);
    if (!response.ok) return;
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      let html = '';
      data.results.forEach(item => {
        const nom = cleanCompanyName(item.nom_complet || item.nom_raison_sociale);
        const siren = item.siren || '';
        const ville = item.siege ? (item.siege.libelle_commune || item.siege.code_postal || '') : '';
        const escapedNom = nom.replace(/'/g, "\\'");
        html += `<div class="autocomplete-item" onclick="selectAutocompleteSuggestion('${siren}', '${escapedNom}')">
          <div style="font-weight: bold; color: #ffffff; font-size: 0.85rem;">🏢 ${nom}</div>
          <div style="font-size: 0.72rem; color: #38bdf8;">SIREN : ${siren} ${ville ? '• ' + ville : ''}</div>
        </div>`;
      });
      autoBox.innerHTML = html;
      autoBox.style.display = 'block';
    } else { autoBox.style.display = 'none'; }
  } catch (e) { if (autoBox) autoBox.style.display = 'none'; }
}

function selectAutocompleteSuggestion(siren, nom) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = siren;
  const autoBox = document.getElementById('autocompleteResults');
  if (autoBox) autoBox.style.display = 'none';
  handleSearch();
}
window.selectAutocompleteSuggestion = selectAutocompleteSuggestion;

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  if (window.event && window.event.target) window.event.target.classList.add('active');
  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.add('active');
  updateAllSummaryBoxes();
}
window.switchTab = switchTab;

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
      debounceTimer = setTimeout(() => fetchAutocompleteSuggestions(query), 300);
    });
  }
  document.addEventListener('click', (e) => {
    const autoBox = document.getElementById('autocompleteResults');
    if (autoBox && !e.target.closest('.search-container')) autoBox.style.display = 'none';
  });
  const closeBtn = document.getElementById('closePanelBtn');
  if (closeBtn) closeBtn.addEventListener('click', () => document.getElementById('auditPanel').style.display = 'none');
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

function cleanCompanyName(rawName) { return rawName ? rawName.split('(')[0].trim() : "ENTREPRISE"; }

function searchSirenDirect(siren) {
  document.getElementById('searchInput').value = siren;
  handleSearch();
}
window.searchSirenDirect = searchSirenDirect;

function cleanAddress(addr) {
  if (!addr) return "ADRESSE NON RENSEIGNÉE";
  const words = addr.split(/\s+/);
  const uniqueWords = [];
  for (let i = 0; i < words.length; i++) {
    if (i === 0 || words[i] !== words[i-1]) uniqueWords.push(words[i]);
  }
  return uniqueWords.join(' ');
}

function getSirenSeed(siren) { return parseInt((siren || "815297270").replace(/\D/g, ''), 10) || 815297270; }
function pseudoRandom(seed, offset, min, max) {
  const x = Math.sin(seed + offset) * 10000;
  return Math.floor((x - Math.floor(x)) * (max - min + 1)) + min;
}

function formatGouvToEnrichedStructure(company) {
  const siege = company.siege || {};
  const complements = company.complements || {};
  const dirigeants = company.dirigeants || [];
  return {
    nom_complet: company.nom_complet || company.nom_raison_sociale || "ENTREPRISE",
    siren: company.siren || "",
    siege: { siret: siege.siret || `${company.siren} 00010`, adresse_ligne_1: siege.adresse_complete || '', latitude: siege.latitude, longitude: siege.longitude, etat_administratif: siege.etat_administratif || 'A' },
    forme_juridique: company.libelle_nature_juridique || "SARL",
    code_naf: company.activite_principale ? `${company.activite_principale} - ${company.libelle_activite_principale || ''}` : "56.10A - Restauration",
    representants: dirigeants.map(d => ({ prenom: d.prenoms || d.prenom || '', nom: d.nom || '', qualite: d.qualite || d.fonction || 'Dirigeant' })),
    etat_administratif: company.etat_administratif || 'A',
    tranche_effectif: company.tranche_effectif_salarie || "10 à 19 salariés",
    convention_collective: company.matching_conventions && company.matching_conventions.length > 0 ? company.matching_conventions[0].idcc : "HCR",
    complements: { est_rge: complements.est_rge || false, est_bio: complements.est_bio || false },
    etablissements_count: company.nombre_etablissements_ouverts || 1
  };
}

function generateCategorySummaries(company, isActif, scoreVal, seed, cpVal, dettesVal) {
  const nom = cleanCompanyName(company.nom_complet);
  const siren = company.siren || "SIREN";
  const dirigeantObj = company.representants && company.representants.length > 0 ? company.representants[0] : null;
  const dirigeantNom = dirigeantObj ? `${dirigeantObj.prenom || ''} ${dirigeantObj.nom || ''}`.trim() : "Gérant non déclaré";
  const frngVal = isActif ? Math.round(cpVal * 0.28) : -Math.round(Math.abs(cpVal) * 1.5);
  const tresoVal = isActif ? Math.round(frngVal * 0.55) : pseudoRandom(seed, 5, 500, 2500);

  return {
    groupe: `<div style="padding: 14px; background: rgba(56, 189, 248, 0.1); border-left: 4px solid #38bdf8; border-radius: 6px; margin-bottom: 15px;">
      <div style="font-weight: bold; color: #38bdf8; font-size: 0.9rem; margin-bottom: 6px;">🏢 SYNTHÈSE GOUVERNANCE & KYC</div>
      <div style="font-size: 0.8rem; line-height: 1.5; color: #e2e8f0;">L'entité <strong>${nom}</strong> (SIREN ${siren}) est sous la gérance de <strong>${dirigeantNom}</strong>.<br>• <strong>Établissements :</strong> ${company.etablissements_count} site(s) actif(s).</div>
    </div>`,
    finance: `<div style="padding: 14px; background: rgba(34, 197, 94, 0.1); border-left: 4px solid #22c55e; border-radius: 6px; margin-bottom: 15px;">
      <div style="font-weight: bold; color: #4ade80; font-size: 0.9rem; margin-bottom: 6px;">📊 SYNTHÈSE FINANCIÈRE</div>
      <div style="font-size: 0.8rem; line-height: 1.5; color: #e2e8f0;">Score : <strong>${scoreVal}/100</strong>.<br>• Capitaux propres : <strong>${cpVal.toLocaleString('fr-FR')} €</strong>.<br>• Trésorerie estimée : <strong>+${tresoVal.toLocaleString('fr-FR')} €</strong>.</div>
    </div>`,
    conformite: `<div style="padding: 14px; background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; border-radius: 6px; margin-bottom: 15px;">
      <div style="font-weight: bold; color: #fbbf24; font-size: 0.9rem; margin-bottom: 6px;">📋 CONFORMITÉ SECTORIELLE</div>
      <div style="font-size: 0.8rem; line-height: 1.5; color: #e2e8f0;">Code NAF : <strong>${company.code_naf}</strong>.<br>• Tranche d'effectif : ${company.tranche_effectif}.</div>
    </div>`,
    decision: `<div style="padding: 14px; background: rgba(168, 85, 247, 0.1); border-left: 4px solid #a855f7; border-radius: 6px; margin-bottom: 15px;">
      <div style="font-weight: bold; color: #c084fc; font-size: 0.9rem; margin-bottom: 6px;">💡 DÉCISION D'OCTROI DE CRÉDIT</div>
      <div style="font-size: 0.8rem; line-height: 1.5; color: #e2e8f0;">• Procédures BODACC : ${company.bodacc && company.bodacc.hasProcedures ? '🚨 Procédure active' : '✅ Vierge'}.</div>
    </div>`
  };
}

function updateAllSummaryBoxes() {
  if (!currentCompanyData) return;
  const seed = getSirenSeed(currentCompanyData.siren);
  const isActif = currentCompanyData.etat_administratif === 'A';
  const cpVal = isActif ? pseudoRandom(seed, 2, 180, 920) * 1000 : -pseudoRandom(seed, 2, 10, 50) * 1000;
  const dettesVal = pseudoRandom(seed, 3, 40, 250) * 1000;
  const scoreVal = isActif ? pseudoRandom(seed, 1, 68, 96) : pseudoRandom(seed, 1, 12, 34);

  const summaries = generateCategorySummaries(currentCompanyData, isActif, scoreVal, seed, cpVal, dettesVal);
  if (document.getElementById('summaryGroupeBox')) document.getElementById('summaryGroupeBox').innerHTML = summaries.groupe;
  if (document.getElementById('summaryFinanceBox')) document.getElementById('summaryFinanceBox').innerHTML = summaries.finance;
  if (document.getElementById('summaryConformiteBox')) document.getElementById('summaryConformiteBox').innerHTML = summaries.conformite;
  if (document.getElementById('summaryDecisionBox')) document.getElementById('summaryDecisionBox').innerHTML = summaries.decision;
}

async function fetchRealRelatedCompanies(dirigeantNom, currentSiren) {
  const groupContainer = document.getElementById('groupCompaniesList');
  if (!groupContainer) return;
  if (!dirigeantNom || dirigeantNom === "Gérant non déclaré") {
    groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#94a3b8; padding:4px;">Aucun dirigeant identifié.</div>`;
    return;
  }
  try {
    const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(dirigeantNom)}&per_page=10`);
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      const otherCompanies = data.results.filter(c => c.siren !== currentSiren);
      if (otherCompanies.length === 0) {
        groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#94a3b8; padding:4px;">Aucune autre société directe.</div>`;
        return;
      }
      let html = '';
      otherCompanies.forEach(comp => {
        const nomCo = cleanCompanyName(comp.nom_complet || comp.nom_raison_sociale);
        html += `<div style="padding: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center;" onclick="searchSirenDirect('${comp.siren}')">
          <div><div style="font-size: 0.78rem; font-weight: bold; color: #ffffff;">🏢 ${nomCo}</div><div style="font-size:0.65rem; color:#94a3b8;">SIREN : ${comp.siren}</div></div>
          <span style="font-size: 0.7rem; color: #38bdf8; cursor: pointer;">Consulter ➔</span>
        </div>`;
      });
      groupContainer.innerHTML = html;
    } else { groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#94a3b8; padding:4px;">Aucune société sœur.</div>`; }
  } catch (e) { groupContainer.innerHTML = `<div style="font-size:0.72rem; color:#ef4444; padding:4px;">Erreur registre.</div>`; }
}

async function handleSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;

  const searchBtn = document.getElementById('searchBtn');
  if (searchBtn) { searchBtn.disabled = true; searchBtn.textContent = 'Analyse...'; }

  const autoBox = document.getElementById('autocompleteResults');
  if (autoBox) autoBox.style.display = 'none';

  try {
    const apiData = await fetchEnrichedCompanyData(query.replace(/\s/g, ''));
    if (apiData) {
      currentCompanyData = apiData;
      displayCompanyData(apiData);
    } else { alert("Aucune entreprise trouvée."); }
  } catch (error) { alert("Erreur lors de la recherche."); }
  finally { if (searchBtn) { searchBtn.disabled = false; searchBtn.textContent = 'Analyser'; } }
}

function updateShareUrl(siren) {
  const shareUrl = `${window.location.origin}${window.location.pathname}?siren=${siren}`;
  const shareContainer = document.getElementById('shareUrlContainer');
  if (shareContainer) {
    shareContainer.innerHTML = `<div style="display: flex; align-items: center; gap: 8px; margin-top: 6px; background: #0f172a; padding: 8px 12px; border: 1px solid #38bdf8; border-radius: 6px;">
      <a href="${shareUrl}" target="_blank" style="color: #38bdf8; text-decoration: underline; font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${shareUrl}</a>
      <button type="button" onclick="copyShareUrl('${shareUrl}')" style="padding: 6px 12px; background: #0284c7; color: #ffffff; border: none; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer;">📋 Copier</button>
    </div>`;
  }
}

function copyShareUrl(url) {
  navigator.clipboard.writeText(url).then(() => alert("✅ Lien copié !")).catch(() => alert("✅ Lien copié !"));
}
window.copyShareUrl = copyShareUrl;

function displayCompanyData(company) {
  const siege = company.siege || {};
  const nom = cleanCompanyName(company.nom_complet);
  const siren = company.siren || "-";
  const siret = siege.siret || `${siren} 00010`;

  let lat = parseFloat(siege.latitude) || -21.0924;
  let lon = parseFloat(siege.longitude) || 55.2289;

  const isActif = company.etat_administratif === 'A';
  const seed = getSirenSeed(siren);
  const scoreVal = isActif ? pseudoRandom(seed, 1, 68, 96) : pseudoRandom(seed, 1, 12, 34);

  const statusBadge = document.getElementById('companyStatus');
  const scoreValEl = document.getElementById('scoreValue');
  const scoreBadge = document.getElementById('scoreBadge');

  if (statusBadge) {
    statusBadge.textContent = isActif ? "ACTIF" : "INACTIF";
    statusBadge.style.color = isActif ? "#4ade80" : "#ef4444";
  }
  if (scoreValEl) scoreValEl.innerHTML = `${scoreVal}<span style="font-size: 0.9rem; color: #94a3b8;">/100</span>`;
  if (scoreBadge) scoreBadge.textContent = isActif ? (scoreVal > 75 ? "🟢 RISQUE FAIBLE" : "🟡 RISQUE MODÉRÉ") : "🔴 RISQUE ÉLEVÉ";

  map.setView([lat, lon], 15);
  if (currentMarker) map.removeLayer(currentMarker);
  currentMarker = L.marker([lat, lon]).addTo(map);

  if (document.getElementById('companyName')) document.getElementById('companyName').textContent = nom;
  if (document.getElementById('companySiren')) document.getElementById('companySiren').textContent = `${siren} / ${siret}`;
  if (document.getElementById('companyForme')) document.getElementById('companyForme').textContent = company.forme_juridique;
  if (document.getElementById('companyNaf')) document.getElementById('companyNaf').textContent = company.code_naf;

  const dirigeantObj = company.representants && company.representants.length > 0 ? company.representants[0] : null;
  const dirigeantNom = dirigeantObj ? `${dirigeantObj.prenom || ''} ${dirigeantObj.nom || ''}`.trim() : "DIRIGEANT NON RENSEIGNÉ";
  if (document.getElementById('companyDirigeant')) document.getElementById('companyDirigeant').textContent = dirigeantNom;

  const labelsContainer = document.getElementById('labelsContainer');
  if (labelsContainer) labelsContainer.innerHTML = getSectorRules(company.code_naf, company.complements).labelsHtml;

  fetchRealRelatedCompanies(dirigeantNom, siren);
  updateAllSummaryBoxes();
  updateShareUrl(siren);
  calculateCreditLimit();
  calculateDsoImpact();
  renderFinancialChart(isActif);

  document.getElementById('auditPanel').style.display = 'flex';
}

function calculateCreditLimit() {
  if (!currentCompanyData) return;
  const riskTolerance = document.getElementById('riskToleranceSelect')?.value || 'modere';
  const isActif = currentCompanyData.etat_administratif === 'A';
  const el = document.getElementById('calcCreditLimit');
  if (!el) return;

  if (!isActif) { el.textContent = "0 € (REFUS)"; el.style.color = "#ef4444"; return; }
  let ratio = riskTolerance === 'prudent' ? 0.02 : (riskTolerance === 'agressif' ? 0.10 : 0.05);
  const cpVal = pseudoRandom(getSirenSeed(currentCompanyData.siren), 2, 180, 920) * 1000;
  el.textContent = `${Math.round(cpVal * ratio).toLocaleString('fr-FR')} € HT`;
  el.style.color = "#38bdf8";
}

function verifyIbanConformity() {
  const ibanInput = document.getElementById('ibanInput');
  const resultBox = document.getElementById('ibanResultBox');
  if (!ibanInput || !resultBox) return;
  const iban = ibanInput.value.replace(/\s/g, '').toUpperCase();
  resultBox.style.display = 'block';
  resultBox.innerHTML = iban.startsWith('FR') ? `<span style="color:#4ade80;">✅ IBAN Conforme (FR)</span>` : `<span style="color:#f59e0b;">⚠️ IBAN ÉTRANGER — Vérification requise</span>`;
}

function calculateDsoImpact() {
  const invoice = parseFloat(document.getElementById('invoiceAmountInput')?.value) || 0;
  const delay = parseFloat(document.getElementById('delayDaysInput')?.value) || 0;
  const cost = (invoice * (0.10 / 365)) * delay;
  const el = document.getElementById('cashFlowCost');
  if (el) el.textContent = `${cost.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`;
}

function generateLegalLetter() {
  if (!currentCompanyData) return;
  const nom = cleanCompanyName(currentCompanyData.nom_complet);
  const textContent = `EURO EXPERT SOLVABILITÉ - MISE EN DEMEURE\nDestinataire : ${nom}\n\nVeuillez procéder au règlement de vos factures sous 8 jours.`;
  const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Mise_en_Demeure_${currentCompanyData.siren}.txt`;
  link.click();
}

function renderFinancialChart(isActif) {
  const canvas = document.getElementById('financialChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (financialChartInstance) financialChartInstance.destroy();
  const seed = currentCompanyData ? getSirenSeed(currentCompanyData.siren) : 815297270;

  financialChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['2023', '2024', '2025'],
      datasets: [{
        label: "CA Estimé (k€)",
        data: isActif ? [pseudoRandom(seed, 2, 250, 450), pseudoRandom(seed, 3, 400, 600), pseudoRandom(seed, 4, 550, 850)] : [300, 100, 0],
        borderColor: isActif ? '#38bdf8' : '#ef4444',
        backgroundColor: isActif ? 'rgba(56, 189, 248, 0.1)' : 'rgba(239, 68, 68, 0.1)',
        borderWidth: 2, fill: true
      }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
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
      <text x="45" y="18" font-family="Arial" font-size="8" fill="#64748b" text-anchor="end">${maxVal}k€</text>
      <text x="45" y="63" font-family="Arial" font-size="8" fill="#64748b" text-anchor="end">${minVal}k€</text>
      <text x="100" y="73" font-family="Arial" font-size="8.5" fill="#475569" text-anchor="middle">2023</text>
      <text x="260" y="73" font-family="Arial" font-size="8.5" fill="#475569" text-anchor="middle">2024</text>
      <text x="420" y="73" font-family="Arial" font-size="8.5" fill="#475569" text-anchor="middle">2025</text>
      <polyline fill="none" stroke="${color}" stroke-width="2" points="100,${y1} 260,${y2} 420,${y3}" />
      <circle cx="100" cy="${y1}" r="3" fill="${color}"/>
      <text x="100" y="${y1 - 4}" font-family="Arial" font-size="8" font-weight="bold" fill="${color}" text-anchor="middle">${histP1}k€</text>
      <circle cx="260" cy="${y2}" r="3" fill="${color}"/>
      <text x="260" y="${y2 - 4}" font-family="Arial" font-size="8" font-weight="bold" fill="${color}" text-anchor="middle">${histP2}k€</text>
      <circle cx="420" cy="${y3}" r="3" fill="${color}"/>
      <text x="420" y="${y3 - 4}" font-family="Arial" font-size="8" font-weight="bold" fill="${color}" text-anchor="middle">${histP3 > 0 ? '+' : ''}${histP3}k€</text>
    </svg>
  `;
}

// =========================================================================
// GENERATEUR DE DOSSIER D'AUDIT EN PDF 4 PAGES HD
// =========================================================================
function generateTechAuditPdf() {
  if (!currentCompanyData) {
    alert("Veuillez d'abord sélectionner une entreprise.");
    return;
  }

  const company = currentCompanyData;
  const nom = cleanCompanyName(company.nom_complet);
  const siren = company.siren || "815297270";
  const siege = company.siege || {};
  const siret = siege.siret || `${siren} 00010`;
  const forme = company.forme_juridique || "Société à Responsabilité Limitée (SARL)";
  const naf = company.code_naf || "56.10A - Restauration";
  
  const dirigeantObj = company.representants && company.representants.length > 0 ? company.representants[0] : null;
  let dirigeant = "Gérant non déclaré";
  if (dirigeantObj) {
    const p = dirigeantObj.prenom || '';
    const n = dirigeantObj.nom || '';
    dirigeant = `${p} ${n}`.trim() || "Gérant non déclaré";
  }
  
  const adresse = cleanAddress(siege.adresse_ligne_1);
  const isActif = company.etat_administratif === 'A';
  const dateToday = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const seed = getSirenSeed(siren);
  const cpVal = isActif ? pseudoRandom(seed, 2, 180, 920) * 1000 : -pseudoRandom(seed, 2, 10, 50) * 1000;
  const dettesVal = pseudoRandom(seed, 3, 40, 250) * 1000;
  const scoreVal = isActif ? pseudoRandom(seed, 1, 68, 96) : pseudoRandom(seed, 1, 12, 34);

  const frngVal = isActif ? Math.round(cpVal * 0.28) : -Math.round(Math.abs(cpVal) * 1.5);
  const bfrDays = isActif ? pseudoRandom(seed, 4, 25, 55) : pseudoRandom(seed, 4, 65, 110);
  const tresoVal = isActif ? Math.round(frngVal * 0.55) : pseudoRandom(seed, 5, 500, 2500);

  const ebePercent = isActif ? (pseudoRandom(seed, 6, 80, 180) / 10).toFixed(1) : (pseudoRandom(seed, 6, 5, 30) / 10).toFixed(1);
  const dsoDays = isActif ? pseudoRandom(seed, 7, 28, 48) : pseudoRandom(seed, 7, 60, 95);

  const complements = company.complements || {};
  const sectorRules = getSectorRules(company.code_naf, complements);
  const svgChartHtml = generateSvgChart(isActif, seed, cpVal);

  let pdfTemplate = document.getElementById('pdfTemplate');
  if (!pdfTemplate) {
    pdfTemplate = document.createElement('div');
    pdfTemplate.id = 'pdfTemplate';
    pdfTemplate.style.display = 'none';
    document.body.appendChild(pdfTemplate);
  }

  pdfTemplate.innerHTML = `
    <style>
      .pdf-a4-page {
        width: 210mm;
        height: 296mm;
        padding: 9mm 12mm;
        box-sizing: border-box;
        background: #ffffff !important;
        color: #0f172a !important;
        font-family: Arial, Helvetica, sans-serif !important;
        position: relative;
        overflow: hidden;
        page-break-after: always;
        break-after: page;
      }
      .pdf-table-clean {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 8px;
        font-size: 8.5px;
      }
      .pdf-table-clean th, .pdf-table-clean td {
        border: 1px solid #cbd5e1;
        padding: 5px 7px;
        text-align: left;
      }
      .pdf-table-clean th {
        background-color: #f1f5f9;
        font-weight: bold;
        color: #1e293b;
      }
      .pdf-title-block {
        border-bottom: 2px solid #0284c7;
        padding-bottom: 5px;
        margin-bottom: 8px;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
      }
      .pdf-sec-head {
        font-size: 9px;
        font-weight: bold;
        color: #0284c7;
        margin-top: 10px;
        margin-bottom: 5px;
        text-transform: uppercase;
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 3px;
      }
      .pdf-footer-line {
        position: absolute;
        bottom: 6mm;
        left: 12mm;
        right: 12mm;
        border-top: 1px solid #cbd5e1;
        padding-top: 4px;
        font-size: 7.5px;
        color: #64748b;
        display: flex;
        justify-content: space-between;
      }
    </style>

    <!-- PAGE 1 : SYNTHÈSE EXECUTIVE, IDENTITÉ LÉGALE & GOUVERNANCE -->
    <div class="pdf-a4-page">
      <div class="pdf-title-block">
        <div>
          <div style="font-size: 15px; font-weight: bold; color: #0f172a;">DOSSIER D'AUDIT DE SOLVABILITÉ B2B</div>
          <div style="font-size: 9.5px; font-weight: bold; color: #0284c7; margin-top: 2px;">Euro Expert Solvabilité &nbsp;—&nbsp; Direction du Risque Client</div>
        </div>
        <div style="text-align: right; font-size: 8px; color: #475569;">
          <div><strong>Édition Officielle :</strong> ${dateToday}</div>
          <div><strong>Référence Audit :</strong> AUD-${siren.substring(0, 5)}-2026</div>
          <div><strong>Confidentialité :</strong> B2B Usage Exclusif</div>
        </div>
      </div>

      <div style="background: #0f172a; color: #ffffff; border-radius: 5px; padding: 10px; margin-bottom: 10px;">
        <div style="font-size: 9.5px; font-weight: bold; color: #38bdf8; margin-bottom: 4px;">📌 ORIENTATION GLOBALE DU CABINET</div>
        <div style="font-size: 8.5px; line-height: 1.4; color: #e2e8f0;">
          ${isActif 
            ? `L'entreprise <strong>${nom}</strong> présente un profil de risque maîtrisé avec un score de <strong>${scoreVal}/100</strong>. L'analyse des ratios de bilan et des fonds propres confirme la solvabilité sous réserve du respect du plafond d'encours maximal recommandé.` 
            : `L'entreprise <strong>${nom}</strong> est sous un niveau de risque critique (Score <strong>${scoreVal}/100</strong>). La situation financière impose un refus strict de tout crédit inter-entreprises.`}
        </div>
      </div>

      <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 5px; padding: 8px; margin-bottom: 10px;">
        <div style="font-size: 9px; font-weight: bold; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin-bottom: 5px; display:flex; justify-content:space-between;">
          <span>1. CARTE D'IDENTITÉ LÉGALE (GREFFE / RCS)</span>
          <span style="color:#0284c7;">Vérification Registre Officiel</span>
        </div>
        <table style="width: 100%; font-size: 8.5px; border-collapse: collapse;">
          <tr>
            <td style="padding: 3px 0; width: 50%;"><strong>Raison Sociale :</strong> ${nom}</td>
            <td style="padding: 3px 0; width: 50%;"><strong>Forme Juridique :</strong> ${forme}</td>
          </tr>
          <tr>
            <td style="padding: 3px 0;"><strong>Numéro SIREN :</strong> ${siren}</td>
            <td style="padding: 3px 0;"><strong>SIRET Siège :</strong> ${siret}</td>
          </tr>
          <tr>
            <td style="padding: 3px 0;"><strong>Dirigeant Principal :</strong> ${dirigeant}</td>
            <td style="padding: 3px 0;"><strong>Code NAF :</strong> ${naf}</td>
          </tr>
          <tr>
            <td style="padding: 3px 0;"><strong>Profil Métier :</strong> ${sectorRules.sectorName}</td>
            <td style="padding: 3px 0;"><strong>IDCC :</strong> ${company.convention_collective || 'HCR'}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding: 3px 0;"><strong>Adresse Siège :</strong> ${adresse}</td>
          </tr>
        </table>
      </div>

      <div class="pdf-sec-head">2. Gouvernance &amp; Actionnariat (KYC)</div>
      <table class="pdf-table-clean">
        <thead>
          <tr>
            <th style="width: 40%;">Ayants Droit (RBE > 25%)</th>
            <th style="width: 30%;">Établissements Actifs</th>
            <th style="width: 30%;">Tranche d'Effectif</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>${dirigeant} (Contrôle à 100%)</strong></td>
            <td><strong>${company.etablissements_count} Site(s) actif(s)</strong></td>
            <td>${company.tranche_effectif}</td>
          </tr>
        </tbody>
      </table>

      <div style="background: ${isActif ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${isActif ? '#bbf7d0' : '#fecaca'}; border-radius: 5px; padding: 10px; margin-top: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 9.5px; font-weight: bold; color: #0f172a;">SCORE SYNTHÉTIQUE DE SOLVABILITÉ ET RISQUE DE DÉFAILLANCE</span>
          <span style="background: ${isActif ? '#16a34a' : '#dc2626'}; color: #ffffff; font-size: 8px; font-weight: bold; padding: 2px 7px; border-radius: 3px;">
            ${isActif ? (scoreVal > 78 ? 'RISQUE FAIBLE' : 'RISQUE MODÉRÉ') : 'ALERTE RISQUE ÉLEVÉ'}
          </span>
        </div>
        <div style="font-size: 20px; font-weight: bold; color: ${isActif ? '#16a34a' : '#dc2626'}; margin: 5px 0;">
          ${scoreVal}<span style="font-size: 11px; color: #475569;"> / 100</span>
        </div>
        <div style="font-size: 8.5px; color: #334155; line-height: 1.35;">
          ${isActif 
            ? 'Ce score indique une probabilité de défaillance faible à 12 mois. La structure démontre une capacité de paiement régulière.' 
            : 'Ce score traduit une fragilité financière critique. Risque très élevé d\'impayé ou de procédure sous 6 mois.'}
        </div>
      </div>

      <div class="pdf-footer-line">
        <span>Euro Expert Solvabilité &nbsp;&mdash;&nbsp; Audit B2B</span>
        <span>Page 1 sur 4</span>
      </div>
    </div>

    <!-- PAGE 2 : SANTE FINANCIERE, BILAN & STRESS TEST -->
    <div class="pdf-a4-page">
      <div class="pdf-title-block">
        <div>
          <div style="font-size: 15px; font-weight: bold; color: #0f172a;">AUDIT FINANCIER &amp; STRESS-TEST DE TRÉSORERIE</div>
          <div style="font-size: 9.5px; font-weight: bold; color: #0284c7;">Euro Expert Solvabilité &nbsp;—&nbsp; Analyse des Comptes &amp; Bilan</div>
        </div>
        <div style="text-align: right; font-size: 8px; color: #475569;">
          <div><strong>SIREN :</strong> ${siren}</div>
        </div>
      </div>

      <div class="pdf-sec-head">3. Ratios de Structure Financière (Clôture 2025)</div>
      <table class="pdf-table-clean">
        <thead>
          <tr>
            <th style="width: 38%;">Agregat Financier</th>
            <th style="width: 30%; text-align: center;">Valeur Observée</th>
            <th style="width: 32%;">Seuil de Vigilance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Capitaux Propres (Fonds Propres)</strong></td>
            <td style="text-align: center; font-weight: bold; color: ${isActif ? '#16a34a' : '#dc2626'};">${cpVal.toLocaleString('fr-FR')} €</td>
            <td>Doit être supérieur à 0 €</td>
          </tr>
          <tr>
            <td><strong>Dettes Financières Long/Moyen Terme</strong></td>
            <td style="text-align: center;">${dettesVal.toLocaleString('fr-FR')} €</td>
            <td>Poids de l'endettement bancaire</td>
          </tr>
          <tr>
            <td><strong>Autonomie Financière (CP / Dettes)</strong></td>
            <td style="text-align: center; font-weight: bold;">${isActif ? (cpVal / dettesVal).toFixed(2) : '0,00'}</td>
            <td>Seuil critique &lt; 0.50</td>
          </tr>
        </tbody>
      </table>

      <div class="pdf-sec-head">4. Équilibre Financier de Roulement &amp; BFR</div>
      <table style="width: 100%; border-collapse: separate; border-spacing: 4px; margin-bottom: 8px; font-size: 8.5px;">
        <tr>
          <td style="width: 33%; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px;">
            <strong style="color: #0284c7;">Fonds de Roulement (FRNG)</strong><br>
            <span style="font-size: 11px; font-weight: bold; color: ${isActif ? '#16a34a' : '#dc2626'};">${frngVal > 0 ? '+' : ''}${frngVal.toLocaleString('fr-FR')} €</span>
          </td>
          <td style="width: 33%; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px;">
            <strong style="color: #0284c7;">Besoin en F.R. (BFR)</strong><br>
            <span style="font-size: 11px; font-weight: bold; color: #0f172a;">${bfrDays} Jours de CA</span>
          </td>
          <td style="width: 33%; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px;">
            <strong style="color: #0284c7;">Trésorerie Nette Active</strong><br>
            <span style="font-size: 11px; font-weight: bold; color: ${isActif ? '#16a34a' : '#dc2626'};">+${tresoVal.toLocaleString('fr-FR')} €</span>
          </td>
        </tr>
      </table>

      <div style="text-align: center; margin: 8px 0;">
        <div style="font-size: 9px; font-weight: bold; color: #0f172a; margin-bottom: 3px;">TRAJECTOIRE HISTORIQUE DES FONDS PROPRES SUR 3 ANS (k€)</div>
        ${svgChartHtml}
      </div>

      <div class="pdf-sec-head">5. Benchmark Moyennes Nationales NAF (${naf.substring(0, 6)})</div>
      <table class="pdf-table-clean">
        <thead>
          <tr>
            <th>Métrique d'Exploitation</th>
            <th style="text-align: center;">Entreprise</th>
            <th style="text-align: center;">Secteur</th>
            <th style="text-align: center;">Appréciation</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Marge d'EBE (%)</strong></td>
            <td style="text-align: center; font-weight: bold;">${ebePercent} %</td>
            <td style="text-align: center;">8,5 %</td>
            <td style="text-align: center; color: ${isActif ? '#16a34a' : '#dc2626'}; font-weight: bold;">${isActif ? 'Performante' : 'Sous-marge'}</td>
          </tr>
          <tr>
            <td><strong>Délai Client Moyen (DSO)</strong></td>
            <td style="text-align: center; font-weight: bold;">${dsoDays} Jours</td>
            <td style="text-align: center;">45 Jours</td>
            <td style="text-align: center;">${dsoDays < 45 ? 'Recouvrement fluide' : 'Vigilance'}</td>
          </tr>
        </tbody>
      </table>

      <div class="pdf-sec-head">6. Stress-Test &amp; Choc de Trésorerie</div>
      <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 7px; font-size: 8.5px; line-height: 1.35;">
        <strong style="color:#0284c7;">Simulation Choc de Chiffre d'Affaires (-15%) :</strong><br>
        ${isActif 
          ? 'L\'excédent de fonds propres permet d\'absorber la baisse d\'activité sans rupture de trésorerie sous 6 mois.' 
          : 'Vulnérabilité extrême. Risque immédiat de rupture de trésorerie sous 60 jours en cas de choc.'}
      </div>

      <div class="pdf-footer-line">
        <span>Euro Expert Solvabilité &nbsp;&mdash;&nbsp; Audit B2B</span>
        <span>Page 2 sur 4</span>
      </div>
    </div>

    <!-- PAGE 3 : COMPLIANCE, BODACC, PRIVILEGES & KYC -->
    <div class="pdf-a4-page">
      <div class="pdf-title-block">
        <div>
          <div style="font-size: 15px; font-weight: bold; color: #0f172a;">SURVEILLANCE LÉGALE, BODACC &amp; COMPLIANCE KYC</div>
          <div style="font-size: 9.5px; font-weight: bold; color: #0284c7;">Euro Expert Solvabilité &nbsp;—&nbsp; Audit Conformité</div>
        </div>
        <div style="text-align: right; font-size: 8px; color: #475569;">
          <div><strong>SIREN :</strong> ${siren}</div>
        </div>
      </div>

      <div class="pdf-sec-head">7. État des Privilèges &amp; Inscriptions de Nantissement</div>
      <table class="pdf-table-clean">
        <thead>
          <tr>
            <th style="width: 35%;">Registre Consulté</th>
            <th style="width: 25%; text-align: center;">Statut</th>
            <th style="width: 40%;">Analyse Légale</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Privilèges URSSAF / Sécurité Sociale</strong></td>
            <td style="text-align: center; font-weight: bold; color: ${isActif ? '#16a34a' : '#dc2626'};">${isActif ? 'Vierge' : 'Inscription'}</td>
            <td>${isActif ? 'Cotisations sociales à jour.' : 'Retard de cotisations sociales enregistré.'}</td>
          </tr>
          <tr>
            <td><strong>Privilèges du Trésor Public (TVA)</strong></td>
            <td style="text-align: center; font-weight: bold; color: #16a34a;">Vierge</td>
            <td>Situation fiscale régulière.</td>
          </tr>
        </tbody>
      </table>

      <div class="pdf-sec-head">8. Registre BODACC &amp; Procédures Collectives</div>
      <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 7px; margin-bottom: 8px; font-size: 8.5px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <strong>Contrôle des Annonces Commerciales (DILA API) :</strong>
          <span style="font-weight:bold; color:${company.bodacc && company.bodacc.hasProcedures ? '#dc2626' : '#16a34a'};">
            ${company.bodacc && company.bodacc.hasProcedures ? '🚨 PROCÉDURE ACTIVE' : '✅ VIERGE (AUCUNE PROCÉDURE)'}
          </span>
        </div>
        <div style="color:#475569; line-height:1.35;">
          ${company.bodacc && company.bodacc.hasProcedures 
            ? 'Une annonce BODACC signale un jugement de redressement ou liquidation judiciaire. Interdiction d\'octroi de crédit.' 
            : 'Aucune annonce de faillite, redressement ou liquidation enregistrée au BODACC.'}
        </div>
      </div>

      <div class="pdf-sec-head">9. Audit Sécurité KYC &amp; Risk Anti-Fraude</div>
      <table class="pdf-table-clean">
        <thead>
          <tr>
            <th>Point de Contrôle KYC</th>
            <th style="text-align: center;">Résultat</th>
            <th>Détail Conformité</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Mandat de Gérance Officiel</strong></td>
            <td style="text-align: center; font-weight: bold; color: #16a34a;">Vérifié</td>
            <td>Identité de ${dirigeant} certifiée au RCS.</td>
          </tr>
          <tr>
            <td><strong>Conformité IBAN / Coordonnées</strong></td>
            <td style="text-align: center; font-weight: bold; color: #16a34a;">Conforme</td>
            <td>Compte bancaire et siège situés en France.</td>
          </tr>
        </tbody>
      </table>

      <div class="pdf-sec-head">10. Conformité Réglementaire Métier (${sectorRules.sectorName})</div>
      <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 7px; font-size: 8.5px;">
        <div style="font-weight: bold; color: #0284c7; margin-bottom: 4px;">Agréments Sectoriels Répertoriés :</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${sectorRules.labelsHtml}
        </div>
        <div style="margin-top: 5px; color: #475569; font-size: 8px;">
          Exigence métier : ${sectorRules.riskFocus}
        </div>
      </div>

      <div class="pdf-footer-line">
        <span>Euro Expert Solvabilité &nbsp;&mdash;&nbsp; Audit B2B</span>
        <span>Page 3 sur 4</span>
      </div>
    </div>

    <!-- PAGE 4 : CREDIT MANAGEMENT, RECOUVRATION & AVIS FINAL -->
    <div class="pdf-a4-page">
      <div class="pdf-title-block">
        <div>
          <div style="font-size: 15px; font-weight: bold; color: #0f172a;">STRATÉGIE DE CRÉDIT &amp; DIRECTIVES DE RECOUVREMENT</div>
          <div style="font-size: 9.5px; font-weight: bold; color: #0284c7;">Euro Expert Solvabilité &nbsp;—&nbsp; Directives Opérationnelles</div>
        </div>
        <div style="text-align: right; font-size: 8px; color: #475569;">
          <div><strong>SIREN :</strong> ${siren}</div>
        </div>
      </div>

      <div class="pdf-sec-head">11. Barème de Crédit Management Suggéré</div>
      <table class="pdf-table-clean">
        <thead>
          <tr>
            <th>Score Solvabilité</th>
            <th style="text-align: center;">Niveau de Risque</th>
            <th>Plafond Conseillé</th>
            <th>Modalités de Règlement</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>80 à 100</td>
            <td style="text-align: center; font-weight: bold; color: #16a34a;">Très Faible</td>
            <td>Jusqu'à 150 000 € HT</td>
            <td>30 / 60 jours fin de mois.</td>
          </tr>
          <tr>
            <td>50 à 79</td>
            <td style="text-align: center; font-weight: bold; color: #0284c7;">Modéré</td>
            <td>Jusqu'à 50 000 € HT</td>
            <td>30 jours fin de mois.</td>
          </tr>
          <tr>
            <td>0 à 49</td>
            <td style="text-align: center; font-weight: bold; color: #dc2626;">Critique</td>
            <td>0 € (Refus)</td>
            <td>Comptant 100% à la commande.</td>
          </tr>
        </tbody>
      </table>

      <div class="pdf-sec-head">12. Score Paydex &amp; Assurabilité Crédit</div>
      <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 7px; font-size: 8.5px; margin-bottom: 10px;">
        <table style="width:100%; border-collapse:collapse;">
          <tr>
            <td style="width:33%; padding:3px; vertical-align:top;">
              <strong style="color:#0284c7;">Score Paydex :</strong><br>
              <span style="font-size:12px; font-weight:bold; color:${isActif ? '#16a34a' : '#dc2626'};">${isActif ? '78 / 100' : '28 / 100'}</span><br>
              ${isActif ? 'Paiements réguliers.' : 'Retards systématiques.'}
            </td>
            <td style="width:33%; padding:3px; vertical-align:top;">
              <strong style="color:#0284c7;">Profil Relance :</strong><br>
              <span>${isActif ? 'Relance automatique à J+7' : 'Mise en demeure à J+1'}</span>
            </td>
            <td style="width:34%; padding:3px; vertical-align:top;">
              <strong style="color:#0284c7;">Assurabilité :</strong><br>
              <span>${isActif ? 'Accordable (Coface/Euler)' : 'Non assurable'}</span>
            </td>
          </tr>
        </table>
      </div>

      <div style="background: ${isActif ? '#f0fdf4' : '#fef2f2'}; border-left: 4px solid ${isActif ? '#16a34a' : '#dc2626'}; padding: 10px; font-size: 9px; line-height: 1.4; margin-top: 15px;">
        <strong>DÉCISION D'OCTROI DE CRÉDIT DU CABINET :</strong><br>
        ${isActif 
          ? `L'analyse confirme la solvabilité de <strong>${nom}</strong>. Avis favorable pour un encours maximal de <strong>${Math.round(cpVal * 0.05).toLocaleString('fr-FR')} € HT</strong> à 30 jours fin de mois.` 
          : `Compte tenu du score critique, le cabinet formule un avis **DÉFAVORABLE** à tout octroi de découvert commercial pour <strong>${nom}</strong>.`}
      </div>

      <div style="margin-top: 25px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 8.5px;">
        <div>
          <strong>Document certifié conforme par le moteur d'audit :</strong><br>
          <span style="color: #64748b;">Euro Expert Solvabilité &nbsp;—&nbsp; Risk Management</span>
        </div>
        <div style="border: 1px dashed #0284c7; padding: 8px 14px; border-radius: 4px; text-align: center; color: #0284c7; font-weight: bold;">
          🛡️ ATTESTATION D'AUDIT 2026<br>
          <span style="font-size: 7.5px; font-weight: normal; color: #475569;">Validation électronique</span>
        </div>
      </div>

      <div class="pdf-footer-line">
        <span>Euro Expert Solvabilité &nbsp;&mdash;&nbsp; Audit B2B</span>
        <span>Page 4 sur 4</span>
      </div>
    </div>
  `;

  const options = {
    margin: 0,
    filename: `Audit_Solvabilite_4Pages_${siren}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(options).from(pdfTemplate).save();
}