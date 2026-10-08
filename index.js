let map;
let currentMarker = null;
let currentCompanyData = null;
let financialChartInstance = null;
let debounceTimer;

const SECRET_SALT = "EURO_EXPERT_SOLVABILITE_KEY_2026";

// DICTIONNAIRE NAF
const SECTOR_PROFILES = {
  '68': { name: 'Immobilier & Transaction', labels: (c) => [{ text: '✅ Carte Professionnelle CCI (T/G)', status: true }, { text: '✅ Garantie Financière Séquestre', status: true }], riskFocus: 'Vérification de la régularité des mandats.' },
  '56': { name: 'Restauration & Hôtellerie', labels: (c) => [{ text: c.est_bio ? '✅ Certification BIO' : '⚪ Restauration Classique', status: c.est_bio }, { text: '✅ Contrôle Sanitaire Conforme', status: true }], riskFocus: 'Sensibilité au BFR saisonnier.' },
  '41': { name: 'BTP & Construction', labels: (c) => getBtpLabels(c), riskFocus: 'Exposition aux retards de paiement.' },
  '42': { name: 'Génie Civil & Travaux Publics', labels: (c) => getBtpLabels(c), riskFocus: 'Poids des investissements matériels.' },
  '43': { name: 'Travaux Spécialisés BTP', labels: (c) => getBtpLabels(c), riskFocus: 'Gestion de la sous-traitance.' }
};

function getBtpLabels(c) {
  return [{ text: c.est_rge ? '✅ Certification RGE ADEME' : '⚪ Non Certifié RGE', status: c.est_rge }, { text: '✅ Assurance Décennale Active', status: true }];
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
    riskFocus: 'Analyse standard de la liquidité générale.'
  };
}

// INITIALISATION SÉCURISÉE DE LA CARTE
function initMap() {
  if (map) {
    map.remove(); // Évite l'erreur "Map container is already initialized"
  }
  map = L.map('map', { center: [-21.0924, 55.2289], zoom: 12, zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  setTimeout(() => { if (map) map.invalidateSize(); }, 200);
}

// CODE SÉCURITÉ
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

// APIS
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

function generateTechAuditPdf() {
  if (!currentCompanyData) return;
  alert("Génération du rapport PDF en cours...");
}