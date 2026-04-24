const EUROPE_VIEW = {
  center: [51.5, 10],
  zoom: 3.75,
};
const EUROPE_BOUNDS = [
  [34, -25],
  [72, 45],
];
const NOTICE_FOCUS_ZOOM = 7.25;
const VISIBILITY_REFRESH_MS = 2 * 60 * 1000;

const URL_PARAMS = new URLSearchParams(window.location.search);
const DEFAULT_API_BASE = "http://127.0.0.1:3000";
const API_BASE = (() => {
  const customBase = URL_PARAMS.get("apiBase");

  if (customBase) {
    return customBase.replace(/\/$/, "");
  }

  if (window.location.protocol === "file:") {
    return DEFAULT_API_BASE;
  }

  return "";
})();
const DATA_MODE = (() => {
  const explicitMode = URL_PARAMS.get("dataMode");

  if (explicitMode === "api" || explicitMode === "static") {
    return explicitMode;
  }

  if (window.location.hostname.endsWith(".github.io")) {
    return "static";
  }

  return "api";
})();
const STATIC_DATA_PATH = "./data/site-dataset.json";

const state = {
  filters: {
    country: "all",
    days: "30",
    nature: "all",
    page: 1,
    pageSize: 25,
    search: "",
    status: "all",
  },
  lastKnownSyncInProgress: false,
  map: null,
  mapLayer: null,
  mapRenderer: null,
  mapPointLayers: new Map(),
  payload: null,
  staticDataset: null,
  selectedId: null,
  lastLiveRefreshAt: 0,
};

const refs = {
  syncButton: document.querySelector("#syncButton"),
  exportButton: document.querySelector("#exportButton"),
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  countryFilter: document.querySelector("#countryFilter"),
  natureFilter: document.querySelector("#natureFilter"),
  daysFilter: document.querySelector("#daysFilter"),
  pageSizeFilter: document.querySelector("#pageSizeFilter"),
  syncHeadline: document.querySelector("#syncHeadline"),
  syncSubline: document.querySelector("#syncSubline"),
  totalCount: document.querySelector("#totalCount"),
  activeCount: document.querySelector("#activeCount"),
  awardedCount: document.querySelector("#awardedCount"),
  filteredCount: document.querySelector("#filteredCount"),
  panelStatus: document.querySelector("#panelStatus"),
  mapSummary: document.querySelector("#mapSummary"),
  errorBanner: document.querySelector("#errorBanner"),
  lastRunValue: document.querySelector("#lastRunValue"),
  nextRunValue: document.querySelector("#nextRunValue"),
  lastSyncDateValue: document.querySelector("#lastSyncDateValue"),
  storedDaysValue: document.querySelector("#storedDaysValue"),
  coverageValue: document.querySelector("#coverageValue"),
  scheduleValue: document.querySelector("#scheduleValue"),
  archiveFolderValue: document.querySelector("#archiveFolderValue"),
  archiveDaysList: document.querySelector("#archiveDaysList"),
  selectionEmpty: document.querySelector("#selectionEmpty"),
  detailCard: document.querySelector("#detailCard"),
  detailStatus: document.querySelector("#detailStatus"),
  detailType: document.querySelector("#detailType"),
  detailTitle: document.querySelector("#detailTitle"),
  detailBuyer: document.querySelector("#detailBuyer"),
  detailId: document.querySelector("#detailId"),
  detailLocation: document.querySelector("#detailLocation"),
  detailPublished: document.querySelector("#detailPublished"),
  detailDeadline: document.querySelector("#detailDeadline"),
  detailValue: document.querySelector("#detailValue"),
  detailNature: document.querySelector("#detailNature"),
  detailProcedure: document.querySelector("#detailProcedure"),
  detailCoords: document.querySelector("#detailCoords"),
  detailHtml: document.querySelector("#detailHtml"),
  detailPdf: document.querySelector("#detailPdf"),
  detailXml: document.querySelector("#detailXml"),
  tableSummary: document.querySelector("#tableSummary"),
  tableBody: document.querySelector("#tableBody"),
  emptyState: document.querySelector("#emptyState"),
  prevPageButton: document.querySelector("#prevPageButton"),
  nextPageButton: document.querySelector("#nextPageButton"),
  paginationLabel: document.querySelector("#paginationLabel"),
};

function initMap() {
  state.mapRenderer = L.canvas({ padding: 0.4 });
  state.map = L.map("map", {
    attributionControl: false,
    boxZoom: false,
    closePopupOnClick: false,
    doubleClickZoom: false,
    dragging: false,
    keyboard: false,
    maxBounds: EUROPE_BOUNDS,
    maxBoundsViscosity: 1,
    minZoom: 3,
    scrollWheelZoom: false,
    tap: false,
    touchZoom: false,
    worldCopyJump: false,
    renderer: state.mapRenderer,
    zoomControl: false,
    zoomSnap: 0.25,
  }).setView(EUROPE_VIEW.center, EUROPE_VIEW.zoom);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    maxZoom: 19,
    noWrap: true,
    subdomains: "abcd",
  }).addTo(state.map);

  state.mapLayer = L.layerGroup().addTo(state.map);
}

function resetMapToEurope(options = {}) {
  const { animate = false } = options;

  state.map.fitBounds(EUROPE_BOUNDS, {
    animate,
    padding: [12, 12],
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createDateFromKey(dateKey) {
  if (!dateKey) {
    return null;
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function parseTedDate(value) {
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}[+-]\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(/^(\d{4}-\d{2}-\d{2})([+-]\d{2}:\d{2})$/, "$1T00:00:00$2"));
  }

  return new Date(value);
}

function formatDate(value) {
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? createDateFromKey(value)
    : parseTedDate(value);

  if (!date || Number.isNaN(date.getTime())) {
    return "n.d.";
  }

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value) {
  const date = parseTedDate(value);

  if (!date || Number.isNaN(date.getTime())) {
    return "n.d.";
  }

  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDeadline(value) {
  if (!value) {
    return "n.d.";
  }

  return String(value).includes("T") ? formatDateTime(value) : formatDate(value);
}

function formatInteger(value) {
  return new Intl.NumberFormat("it-IT").format(Number(value || 0));
}

function formatCurrency(value, currency = "EUR") {
  if (!Number.isFinite(Number(value))) {
    return "n.d.";
  }

  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function humanizeValueSource(value) {
  const labels = {
    award: "Aggiudicato",
    estimated: "Stimato",
    "estimated-group": "Stimato gruppo",
    "estimated-part": "Stimato lotto",
    "estimated-lots": "Stimato lotti",
    "estimated-lots-largest": "Stimato lotto principale",
    framework: "Accordo quadro",
    "framework-award": "Accordo quadro aggiudicato",
    "framework-maximum": "Massimo accordo quadro",
    "framework-maximum-lots": "Massimo accordo quadro",
    "framework-maximum-lots-largest": "Massimo lotto accordo quadro",
    tender: "Offerta",
    "tender-largest": "Offerta principale",
    total: "Totale",
  };

  return labels[value] || "";
}

function formatNoticeValue(notice) {
  return formatCurrency(notice.estimatedValue, notice.currency || "EUR");
}

function formatValueSubtitle(notice) {
  const parts = [humanizeValueSource(notice.valueSource), notice.currency].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "n.d.";
}

function formatDetailValue(notice) {
  const value = formatNoticeValue(notice);
  const source = humanizeValueSource(notice.valueSource);

  if (value === "n.d." || !source) {
    return value;
  }

  return `${value} · ${source}`;
}

function humanizeNature(value) {
  if (value === "works") {
    return "Lavori";
  }

  if (value === "supplies") {
    return "Forniture";
  }

  if (value === "services") {
    return "Servizi";
  }

  return value || "n.d.";
}

function humanizeProcedure(value) {
  if (!value) {
    return "n.d.";
  }

  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function humanizeNoticeType(value) {
  return value ? value.toUpperCase() : "n.d.";
}

function statusClass(status) {
  if (status === "In corso") {
    return "is-live";
  }

  if (status === "Aggiudicato") {
    return "is-awarded";
  }

  if (status === "Scaduto") {
    return "is-expired";
  }

  return "is-published";
}

function statusColor(status) {
  if (status === "In corso") {
    return "#26c281";
  }

  if (status === "Aggiudicato") {
    return "#ffb454";
  }

  if (status === "Scaduto") {
    return "#ff6b8a";
  }

  return "#89a9ff";
}

function setError(message) {
  refs.errorBanner.hidden = !message;
  refs.errorBanner.textContent = message || "";
}

function apiPath(pathname) {
  return API_BASE ? `${API_BASE}${pathname}` : pathname;
}

function getConnectionErrorMessage() {
  if (API_BASE) {
    return `Backend non raggiungibile su ${API_BASE}. Avvia "node server.js" e apri http://127.0.0.1:3000.`;
  }

  return 'Backend non raggiungibile. Apri l\'app da http://127.0.0.1:3000 dopo avere avviato "node server.js".';
}

function readJson(response) {
  if (!response.ok) {
    return response.json().catch(() => null).then((payload) => {
      throw new Error(payload?.message || "Richiesta fallita.");
    });
  }

  return response.json();
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseArchiveWindow(daysParam) {
  if (!daysParam || daysParam === "30") {
    return 30;
  }

  if (daysParam === "all") {
    return "all";
  }

  return Math.min(365, Math.max(1, Number(daysParam) || 30));
}

function sortNoticesDesc(left, right) {
  const leftDate = parseTedDate(left.publicationDate)?.getTime() || 0;
  const rightDate = parseTedDate(right.publicationDate)?.getTime() || 0;

  if (rightDate !== leftDate) {
    return rightDate - leftDate;
  }

  return String(right.id).localeCompare(String(left.id));
}

function countStatuses(notices) {
  return notices.reduce((accumulator, notice) => {
    accumulator[notice.status] = (accumulator[notice.status] || 0) + 1;
    return accumulator;
  }, {});
}

function buildCountries(notices) {
  return [...new Set(notices.map((notice) => notice.countryName).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "it")
  );
}

function isWithinEuropeBounds(lat, lng) {
  return lat >= EUROPE_BOUNDS[0][0] && lat <= EUROPE_BOUNDS[1][0] && lng >= EUROPE_BOUNDS[0][1] && lng <= EUROPE_BOUNDS[1][1];
}

function buildMarkerOffset(index, source) {
  if (index === 0) {
    return { latDelta: 0, lngDelta: 0 };
  }

  const baseStep =
    source === "country"
      ? 0.22
      : source === "geocode"
        ? 0.04
        : 0.08;
  const angle = index * 2.399963229728653;
  const radius = baseStep * Math.sqrt(index);

  return {
    latDelta: Math.sin(angle) * radius * 0.58,
    lngDelta: Math.cos(angle) * radius,
  };
}

function buildMapMarkers(notices) {
  const coordinateGroups = new Map();
  const markers = [];

  notices.forEach((notice) => {
    if (!notice.coordinates || notice.coordinates.source === "europe") {
      return;
    }

    if (!isWithinEuropeBounds(notice.coordinates.lat, notice.coordinates.lng)) {
      return;
    }

    const coordinateKey = `${notice.coordinates.lat.toFixed(4)}|${notice.coordinates.lng.toFixed(4)}`;
    const groupIndex = coordinateGroups.get(coordinateKey) || 0;
    coordinateGroups.set(coordinateKey, groupIndex + 1);

    const offset = buildMarkerOffset(groupIndex, notice.coordinates.source);
    markers.push({
      buyer: notice.buyer,
      coordinatesSource: notice.coordinates.source,
      currency: notice.currency,
      deadlineDate: notice.deadlineDate,
      deadlineKind: notice.deadlineKind,
      estimatedValue: notice.estimatedValue,
      id: notice.id,
      lat: notice.coordinates.lat + offset.latDelta,
      lng: notice.coordinates.lng + offset.lngDelta,
      locationLabel: notice.locationLabel,
      markerKey: notice.id,
      publicationDate: notice.publicationDate,
      status: notice.status,
      title: notice.title,
      valueSource: notice.valueSource,
    });
  });

  return markers.sort(sortNoticesDesc);
}

function getArchiveDaysForWindow(datasetArchive, windowDays) {
  const orderedDays = (datasetArchive?.days || []).slice().sort((left, right) => left.dateKey.localeCompare(right.dateKey));

  if (windowDays === "all") {
    return orderedDays;
  }

  return orderedDays.slice(-windowDays);
}

function filterNotices(notices) {
  const query = normalizeText(state.filters.search);

  return notices.filter((notice) => {
    const matchesSearch =
      query.length === 0 ||
      normalizeText(
        [
          notice.id,
          notice.title,
          notice.buyer,
          notice.countryName,
          notice.city,
          notice.noticeType,
        ].join(" ")
      ).includes(query);

    const matchesStatus = state.filters.status === "all" || notice.status === state.filters.status;
    const matchesCountry = state.filters.country === "all" || notice.countryName === state.filters.country;
    const matchesNature = state.filters.nature === "all" || notice.contractNature === state.filters.nature;

    return matchesSearch && matchesStatus && matchesCountry && matchesNature;
  });
}

function buildExcelNumberCell(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return '<Cell><Data ss:Type="String"></Data></Cell>';
  }

  return `<Cell><Data ss:Type="Number">${numericValue}</Data></Cell>`;
}

function buildWorkbookXml(notices) {
  const rows = notices
    .map((notice) => `
      <Row>
        <Cell><Data ss:Type="String">${escapeXml(notice.id)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.title)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.buyer)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.countryName || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.city || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.status)}</Data></Cell>
        ${buildExcelNumberCell(notice.estimatedValue)}
        <Cell><Data ss:Type="String">${escapeXml(notice.currency || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.valueSource || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.deadlineDate || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.deadlineKind || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.publicationDate || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.noticeType || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.procedureType || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.links?.html || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.links?.pdf || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.links?.xml || "")}</Data></Cell>
      </Row>
    `)
    .join("");

  return `<?xml version="1.0"?>
  <?mso-application progid="Excel.Sheet"?>
  <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
    xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:x="urn:schemas-microsoft-com:office:excel"
    xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
    xmlns:html="http://www.w3.org/TR/REC-html40">
    <Worksheet ss:Name="Bandi TED">
      <Table>
        <Row>
          <Cell><Data ss:Type="String">ID</Data></Cell>
          <Cell><Data ss:Type="String">Titolo</Data></Cell>
          <Cell><Data ss:Type="String">Buyer</Data></Cell>
          <Cell><Data ss:Type="String">Paese</Data></Cell>
          <Cell><Data ss:Type="String">Citta</Data></Cell>
          <Cell><Data ss:Type="String">Stato</Data></Cell>
          <Cell><Data ss:Type="String">Valore</Data></Cell>
          <Cell><Data ss:Type="String">Valuta</Data></Cell>
          <Cell><Data ss:Type="String">Fonte valore</Data></Cell>
          <Cell><Data ss:Type="String">Scadenza</Data></Cell>
          <Cell><Data ss:Type="String">Tipo scadenza</Data></Cell>
          <Cell><Data ss:Type="String">Pubblicazione</Data></Cell>
          <Cell><Data ss:Type="String">Notice type</Data></Cell>
          <Cell><Data ss:Type="String">Procedura</Data></Cell>
          <Cell><Data ss:Type="String">HTML</Data></Cell>
          <Cell><Data ss:Type="String">PDF</Data></Cell>
          <Cell><Data ss:Type="String">XML</Data></Cell>
        </Row>
        ${rows}
      </Table>
    </Worksheet>
  </Workbook>`;
}

function downloadWorkbook(notices) {
  const workbook = buildWorkbookXml(notices);
  const blob = new Blob([workbook], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ted-archive-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildPayloadFromStaticDataset() {
  const dataset = state.staticDataset;
  const pageSize = Math.max(10, Math.min(100, Number(state.filters.pageSize) || 25));
  const windowDays = parseArchiveWindow(state.filters.days);
  const selectedDays = getArchiveDaysForWindow(dataset.archive, windowDays);
  const selectedDateKeys = new Set(selectedDays.map((day) => day.dateKey));
  const archiveNotices = dataset.notices
    .filter((notice) => windowDays === "all" || selectedDateKeys.has(notice.archiveDateKey))
    .slice()
    .sort(sortNoticesDesc);
  const filteredNotices = filterNotices(archiveNotices);
  const totalPages = Math.max(1, Math.ceil(filteredNotices.length / pageSize));
  const safePage = Math.min(Math.max(1, Number(state.filters.page) || 1), totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageNotices = filteredNotices.slice(pageStart, pageStart + pageSize);
  const statusCounts = countStatuses(archiveNotices);
  const mapPoints = buildMapMarkers(filteredNotices);

  return {
    notices: pageNotices,
    filteredNotices,
    mapPoints,
    pagination: {
      page: safePage,
      pageSize,
      totalPages,
      totalResults: filteredNotices.length,
    },
    summary: {
      archiveCount: archiveNotices.length,
      awardedCount: statusCounts["Aggiudicato"] || 0,
      countries: buildCountries(archiveNotices),
      filteredCount: filteredNotices.length,
      mapPointCount: mapPoints.length,
      openCount: statusCounts["In corso"] || 0,
      totalArchiveCount: dataset.sync?.storedNoticeCount || archiveNotices.length,
    },
    archive: {
      dateCount: selectedDays.length,
      days: selectedDays.slice().reverse(),
      fromDate: selectedDays[0]?.dateKey || null,
      toDate: selectedDays.at(-1)?.dateKey || null,
    },
    sync: dataset.sync,
  };
}

async function loadStaticDataset(revalidate = false) {
  const suffix = revalidate ? `?v=${Date.now()}` : "";
  const dataset = await fetch(`${STATIC_DATA_PATH}${suffix}`).then(readJson);
  state.staticDataset = dataset;
  return dataset;
}

function buildQueryString(options = {}) {
  const { fresh = false } = options;
  const query = new URLSearchParams({
    country: state.filters.country,
    days: state.filters.days,
    nature: state.filters.nature,
    page: String(state.filters.page),
    pageSize: String(state.filters.pageSize),
    search: state.filters.search,
    status: state.filters.status,
  });

  if (fresh) {
    query.set("fresh", "1");
  }

  return query.toString();
}

function updateCountryOptions(countries = []) {
  const currentValue = state.filters.country;
  const safeValue = countries.includes(currentValue) ? currentValue : "all";

  state.filters.country = safeValue;
  refs.countryFilter.innerHTML = [
    '<option value="all">Tutti i paesi</option>',
    ...countries.map((country) => `<option value="${country}">${country}</option>`),
  ].join("");
  refs.countryFilter.value = safeValue;

  return safeValue !== currentValue;
}

function getSelectedNotice() {
  return state.payload?.notices?.find((notice) => notice.id === state.selectedId) || null;
}

function updateLink(element, href) {
  if (href) {
    element.href = href;
    element.setAttribute("aria-disabled", "false");
    element.style.opacity = "1";
    element.style.pointerEvents = "auto";
    return;
  }

  element.href = "#";
  element.setAttribute("aria-disabled", "true");
  element.style.opacity = "0.45";
  element.style.pointerEvents = "none";
}

function renderKpis() {
  const summary = state.payload?.summary;

  refs.totalCount.textContent = formatInteger(summary?.totalArchiveCount || 0);
  refs.activeCount.textContent = formatInteger(summary?.openCount || 0);
  refs.awardedCount.textContent = formatInteger(summary?.awardedCount || 0);
  refs.filteredCount.textContent = formatInteger(summary?.filteredCount || 0);
}

function renderSyncConsole(sync) {
  if (!sync) {
    refs.syncHeadline.textContent = "Archivio non disponibile.";
    refs.syncSubline.textContent = "Stato scheduler assente.";
    return;
  }

  if (DATA_MODE === "static") {
    refs.syncHeadline.textContent = `Dataset GitHub · ${formatDateTime(sync.lastRunAt)}.`;
    refs.syncSubline.textContent = "Publish giornaliero via GitHub Actions.";
    return;
  }

  if (sync.inProgress) {
    refs.syncHeadline.textContent = `Sync in corso · ${sync.currentSyncDate || "oggi"}.`;
  } else {
    refs.syncHeadline.textContent = `Ultimo sync · ${formatDate(sync.lastSuccessfulSyncDate)}.`;
  }

  refs.syncSubline.textContent =
    `Prossimo job ${formatDateTime(sync.nextRunAt)} · ${String(sync.schedule.hour).padStart(2, "0")}:${String(sync.schedule.minute).padStart(2, "0")} ${sync.schedule.timezone}`;
}

function renderArchivePanel(sync, archive) {
  refs.lastRunValue.textContent = formatDateTime(sync?.lastRunAt);
  refs.nextRunValue.textContent = formatDateTime(sync?.nextRunAt);
  refs.lastSyncDateValue.textContent = formatDate(sync?.lastSuccessfulSyncDate);
  refs.storedDaysValue.textContent = formatInteger(sync?.storedDateCount || 0);
  refs.coverageValue.textContent = archive?.fromDate && archive?.toDate
    ? `${formatDate(archive.fromDate)} -> ${formatDate(archive.toDate)}`
    : "n.d.";
  refs.scheduleValue.textContent = sync
    ? `${String(sync.schedule.hour).padStart(2, "0")}:${String(sync.schedule.minute).padStart(2, "0")} ${sync.schedule.timezone}`
    : "n.d.";
  refs.archiveFolderValue.textContent = sync?.archiveDirectoryLabel || "n.d.";

  refs.archiveDaysList.innerHTML = (archive?.days || [])
    .slice(0, 10)
    .map((day) => `
      <span class="archive-day-chip">
        ${escapeHtml(day.dateKey)} · ${day.syncMode === "complete" ? "completo" : "snapshot"} · ${formatInteger(day.noticeCount)}
      </span>
    `)
    .join("");
}

function buildMapPopup(point) {
  return `
    <div class="map-group-popup">
      <h4>${escapeHtml(point.title)}</h4>
      <p>${escapeHtml(point.locationLabel)} · ${escapeHtml(point.status)}</p>
      <p>Pubbl. ${escapeHtml(formatDate(point.publicationDate))}</p>
      <p>Scad. ${escapeHtml(formatDeadline(point.deadlineDate))}${point.deadlineKind ? ` · ${escapeHtml(point.deadlineKind)}` : ""}</p>
    </div>
  `;
}

function renderMap() {
  const mapPoints = state.payload?.mapPoints || [];
  state.mapLayer.clearLayers();
  state.mapPointLayers.clear();

  if (mapPoints.length === 0) {
    refs.mapSummary.textContent = "Nessun marker disponibile per i filtri correnti.";
    resetMapToEurope();
    return;
  }

  mapPoints.forEach((point) => {
    const isSelected = point.id === state.selectedId;
    const marker = L.circleMarker([point.lat, point.lng], {
      color: statusColor(point.status),
      fillColor: statusColor(point.status),
      fillOpacity: isSelected ? 0.94 : 0.72,
      radius: isSelected ? 7 : 4.8,
      renderer: state.mapRenderer,
      weight: isSelected ? 2.4 : 1.4,
    });

    marker.bindPopup(buildMapPopup(point));
    marker.on("click", () => {
      selectNotice(point.id);
    });
    marker.addTo(state.mapLayer);
    state.mapPointLayers.set(point.markerKey, marker);
  });

  refs.mapSummary.textContent = `${formatInteger(mapPoints.length)} marker singoli · ${formatInteger(state.payload.summary.filteredCount)} bandi filtrati`;
  resetMapToEurope();
}

function renderDetail() {
  const notice = getSelectedNotice();

  if (!notice) {
    refs.selectionEmpty.hidden = false;
    refs.detailCard.hidden = true;
    return;
  }

  refs.selectionEmpty.hidden = true;
  refs.detailCard.hidden = false;

  refs.detailStatus.className = `status-pill ${statusClass(notice.status)}`;
  refs.detailStatus.textContent = notice.status;
  refs.detailType.textContent = humanizeNoticeType(notice.noticeType);
  refs.detailTitle.textContent = notice.title;
  refs.detailBuyer.textContent = notice.buyer;
  refs.detailId.textContent = notice.id;
  refs.detailLocation.textContent = notice.locationLabel;
  refs.detailPublished.textContent = formatDate(notice.publicationDate);
  refs.detailDeadline.textContent = notice.deadlineDate
    ? `${formatDeadline(notice.deadlineDate)}${notice.deadlineKind ? ` · ${notice.deadlineKind}` : ""}`
    : "n.d.";
  refs.detailValue.textContent = formatDetailValue(notice);
  refs.detailNature.textContent = humanizeNature(notice.contractNature);
  refs.detailProcedure.textContent = humanizeProcedure(notice.procedureType);
  refs.detailCoords.textContent = `${notice.coordinates.lat.toFixed(3)}, ${notice.coordinates.lng.toFixed(3)} (${notice.coordinates.source})`;

  updateLink(refs.detailHtml, notice.links.html);
  updateLink(refs.detailPdf, notice.links.pdf);
  updateLink(refs.detailXml, notice.links.xml);
}

function renderTable() {
  const notices = state.payload?.notices || [];
  const pagination = state.payload?.pagination;
  const totalResults = pagination?.totalResults || 0;

  refs.tableSummary.textContent = `${formatInteger(totalResults)} bandi filtrati`;
  refs.emptyState.hidden = totalResults !== 0;

  refs.tableBody.innerHTML = notices
    .map((notice) => `
      <tr class="${notice.id === state.selectedId ? "is-selected" : ""}" data-id="${notice.id}">
        <td>
          <div class="cell-stack">
            <span class="row-title">${escapeHtml(notice.title)}</span>
            <span class="row-subtitle">${escapeHtml(notice.id)} · ${escapeHtml(humanizeNoticeType(notice.noticeType))}</span>
          </div>
        </td>
        <td>
          <div class="cell-stack">
            <span class="row-title">${escapeHtml(notice.buyer)}</span>
            <span class="row-subtitle">${escapeHtml(humanizeProcedure(notice.procedureType))}</span>
          </div>
        </td>
        <td>
          <div class="cell-stack">
            <span class="row-title">${escapeHtml(notice.locationLabel)}</span>
            <span class="row-subtitle">${escapeHtml(humanizeNature(notice.contractNature))}</span>
          </div>
        </td>
        <td>
          <span class="status-pill ${statusClass(notice.status)}">${escapeHtml(notice.status)}</span>
        </td>
        <td>
          <div class="cell-stack">
            <span class="row-title">${escapeHtml(formatNoticeValue(notice))}</span>
            <span class="row-subtitle">${escapeHtml(formatValueSubtitle(notice))}</span>
          </div>
        </td>
        <td>
          <div class="cell-stack">
            <span class="row-title">${escapeHtml(formatDate(notice.publicationDate))}</span>
            <span class="row-subtitle">${escapeHtml(humanizeNoticeType(notice.noticeType))}</span>
          </div>
        </td>
        <td>
          <div class="cell-stack">
            <span class="row-title">${escapeHtml(formatDeadline(notice.deadlineDate))}</span>
            <span class="row-subtitle">${escapeHtml(notice.deadlineKind || "n.d.")}</span>
          </div>
        </td>
        <td>
          <div class="row-links">
            ${notice.links.html ? `<a href="${notice.links.html}" target="_blank" rel="noreferrer">HTML</a>` : ""}
            ${notice.links.pdf ? `<a href="${notice.links.pdf}" target="_blank" rel="noreferrer">PDF</a>` : ""}
            ${notice.links.xml ? `<a href="${notice.links.xml}" target="_blank" rel="noreferrer">XML</a>` : ""}
          </div>
        </td>
      </tr>
    `)
    .join("");

  refs.paginationLabel.textContent = `Pagina ${pagination?.page || 1} di ${pagination?.totalPages || 1}`;
  refs.prevPageButton.disabled = !pagination || pagination.page <= 1;
  refs.nextPageButton.disabled = !pagination || pagination.page >= pagination.totalPages;
}

function renderPanelStatus() {
  const archive = state.payload?.archive;
  const pagination = state.payload?.pagination;

  refs.panelStatus.textContent = archive?.dateCount
    ? `${archive.dateCount} giorni archiviati · ${formatInteger(pagination?.totalResults || 0)} bandi correnti`
    : "Archivio non ancora disponibile.";
}

function renderAll() {
  renderKpis();
  renderSyncConsole(state.payload?.sync);
  renderArchivePanel(state.payload?.sync, state.payload?.archive);
  renderPanelStatus();
  renderMap();
  renderTable();
  renderDetail();
}

async function loadDataset(options = {}) {
  const { preserveSelection = true, fresh = false } = options;
  setError("");
  refs.panelStatus.textContent = fresh
    ? DATA_MODE === "static"
      ? "Ricarico dataset GitHub..."
      : "Refresh live TED..."
    : API_BASE
      ? `Carico archivio da ${API_BASE}...`
      : "Carico archivio...";

  try {
    if (DATA_MODE === "static") {
      await loadStaticDataset(fresh);
    }

    const payload =
      DATA_MODE === "static"
        ? buildPayloadFromStaticDataset()
        : await fetch(apiPath(`/api/notices?${buildQueryString({ fresh })}`)).then(readJson);
    const previousSelectedId = preserveSelection ? state.selectedId : null;
    const countryChanged = updateCountryOptions(payload.summary?.countries || []);

    if (countryChanged) {
      state.filters.page = 1;
      await loadDataset({ preserveSelection: false });
      return;
    }

    state.payload = payload;

    if (previousSelectedId && payload.notices.some((notice) => notice.id === previousSelectedId)) {
      state.selectedId = previousSelectedId;
    } else {
      state.selectedId = payload.notices[0]?.id || null;
    }

    state.lastKnownSyncInProgress = Boolean(payload.sync?.inProgress);
    if (fresh) {
      state.lastLiveRefreshAt = Date.now();
    }
    if (DATA_MODE === "api" && payload.sync?.lastError) {
      setError(`Sync TED fallita alle ${formatDateTime(payload.sync.lastError.at)}. Mostro l'ultimo archivio valido disponibile.`);
    }
    renderAll();
  } catch (error) {
    const message =
      error instanceof TypeError || String(error.message || "").includes("Failed to fetch")
        ? getConnectionErrorMessage()
        : error.message || "Errore nel caricamento archivio.";

    setError(message);
    refs.panelStatus.textContent = "Archivio non raggiungibile.";
  }
}

async function refreshOnPageOpen() {
  await loadDataset({
    fresh: true,
    preserveSelection: false,
  });
  await refreshSyncStatus();
}

async function refreshWhenPageReturns() {
  if (document.hidden) {
    return;
  }

  if (Date.now() - state.lastLiveRefreshAt < VISIBILITY_REFRESH_MS) {
    return;
  }

  await loadDataset({
    fresh: true,
    preserveSelection: true,
  });
  await refreshSyncStatus();
}

async function refreshSyncStatus() {
  if (DATA_MODE === "static") {
    return;
  }

  try {
    const sync = await fetch(apiPath("/api/sync-status")).then(readJson);
    renderSyncConsole(sync);
    renderArchivePanel(sync, state.payload?.archive);

    if (state.lastKnownSyncInProgress && !sync.inProgress) {
      await loadDataset({ preserveSelection: false });
    }

    state.lastKnownSyncInProgress = sync.inProgress;
  } catch (error) {
    // Keep the last visible status if polling fails.
  }
}

function focusSelectedNoticeOnMap() {
  if (!state.selectedId) {
    return;
  }

  const marker = state.mapPointLayers.get(state.selectedId);

  if (!marker) {
    resetMapToEurope({ animate: true });
    return;
  }

  const latLng = marker.getLatLng();
  state.map.once("moveend", () => {
    marker.openPopup();
  });
  state.map.flyTo(latLng, NOTICE_FOCUS_ZOOM, {
    animate: true,
    duration: 0.65,
  });
}

function selectNotice(id) {
  state.selectedId = id;
  renderMap();
  renderTable();
  renderDetail();
  focusSelectedNoticeOnMap();
}

async function triggerManualSync() {
  if (DATA_MODE === "static") {
    refs.syncButton.disabled = true;
    refs.syncButton.textContent = "Ricarico dataset...";
    setError("");

    try {
      await loadDataset({ fresh: true, preserveSelection: true });
    } catch (error) {
      setError(error.message || "Ricarica dataset GitHub non riuscita.");
    } finally {
      refs.syncButton.disabled = false;
      refs.syncButton.textContent = "Ricarica dataset";
    }

    return;
  }

  refs.syncButton.disabled = true;
  refs.syncButton.textContent = "Sync in corso...";
  setError("");

  try {
    await fetch(apiPath("/api/admin/sync?mode=snapshot"), {
      method: "POST",
    }).then(readJson);

    await loadDataset({ preserveSelection: false });
    await refreshSyncStatus();
  } catch (error) {
    setError(error.message || "Sincronizzazione manuale non riuscita.");
  } finally {
    refs.syncButton.disabled = false;
    refs.syncButton.textContent = "Aggiorna TED";
  }
}

function triggerExport() {
  if (DATA_MODE === "static") {
    downloadWorkbook(state.payload?.filteredNotices || []);
    return;
  }

  const params = new URLSearchParams({
    country: state.filters.country,
    days: state.filters.days,
    nature: state.filters.nature,
    search: state.filters.search,
    status: state.filters.status,
  });

  window.location.assign(apiPath(`/api/export?${params.toString()}`));
}

const searchDebounce = {
  timer: null,
};

function queueDatasetReload() {
  if (searchDebounce.timer) {
    window.clearTimeout(searchDebounce.timer);
  }

  searchDebounce.timer = window.setTimeout(() => {
    state.filters.page = 1;
    loadDataset({ preserveSelection: false });
  }, 260);
}

refs.searchInput.addEventListener("input", (event) => {
  state.filters.search = event.target.value;
  queueDatasetReload();
});

refs.statusFilter.addEventListener("change", (event) => {
  state.filters.status = event.target.value;
  state.filters.page = 1;
  loadDataset({ preserveSelection: false });
});

refs.countryFilter.addEventListener("change", (event) => {
  state.filters.country = event.target.value;
  state.filters.page = 1;
  loadDataset({ preserveSelection: false });
});

refs.natureFilter.addEventListener("change", (event) => {
  state.filters.nature = event.target.value;
  state.filters.page = 1;
  loadDataset({ preserveSelection: false });
});

refs.daysFilter.addEventListener("change", (event) => {
  state.filters.days = event.target.value;
  state.filters.page = 1;
  loadDataset({ preserveSelection: false });
});

refs.pageSizeFilter.addEventListener("change", (event) => {
  state.filters.pageSize = Number(event.target.value);
  state.filters.page = 1;
  loadDataset({ preserveSelection: false });
});

refs.prevPageButton.addEventListener("click", () => {
  if (state.filters.page <= 1) {
    return;
  }

  state.filters.page -= 1;
  loadDataset({ preserveSelection: false });
});

refs.nextPageButton.addEventListener("click", () => {
  const totalPages = state.payload?.pagination?.totalPages || 1;

  if (state.filters.page >= totalPages) {
    return;
  }

  state.filters.page += 1;
  loadDataset({ preserveSelection: false });
});

refs.tableBody.addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    return;
  }

  const row = event.target.closest("tr[data-id]");

  if (!row) {
    return;
  }

  selectNotice(row.dataset.id);
});

refs.syncButton.addEventListener("click", () => {
  triggerManualSync();
});

refs.exportButton.addEventListener("click", () => {
  triggerExport();
});

initMap();
if (DATA_MODE === "static") {
  refs.syncButton.textContent = "Ricarica dataset";
}
if (window.location.protocol === "file:") {
  refs.syncSubline.textContent = `File locale: uso il backend ${DEFAULT_API_BASE}.`;
}
refreshOnPageOpen();
document.addEventListener("visibilitychange", () => {
  void refreshWhenPageReturns();
});
if (DATA_MODE === "api") {
  window.setInterval(refreshSyncStatus, 30000);
}
