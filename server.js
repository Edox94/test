const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const LEGACY_DAILY_DIR = path.join(DATA_DIR, "daily");
const DAILY_DIR = path.join(DATA_DIR, "bandi-europei-giornalieri");
const GEO_CACHE_FILE = path.join(DATA_DIR, "geo-cache.json");
const SYNC_STATE_FILE = path.join(DATA_DIR, "sync-state.json");

const SYNC_HOUR = Number(process.env.SYNC_HOUR || 3);
const SYNC_MINUTE = Number(process.env.SYNC_MINUTE || 15);
const INITIAL_BACKFILL_DAYS = Number(process.env.INITIAL_BACKFILL_DAYS || 1);
const GEO_BATCH_LIMIT = Number(process.env.GEO_BATCH_LIMIT || 8);
const GEO_CONCURRENCY = Number(process.env.GEO_CONCURRENCY || 2);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 20000);
const GEO_TIMEOUT_MS = Number(process.env.GEO_TIMEOUT_MS || 4500);
const FETCH_PAGE_LIMIT = 250;
const MAX_MAP_MARKERS = Number(process.env.MAX_MAP_MARKERS || 15000);
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const ARCHIVE_SCHEMA_VERSION = 2;

const TED_SEARCH_ENDPOINT = "https://api.ted.europa.eu/v3/notices/search";
const TED_FIELDS = [
  "publication-number",
  "notice-title",
  "buyer-name",
  "publication-date",
  "deadline",
  "place-of-performance-city-lot",
  "place-of-performance-country-lot",
  "deadline-date-lot",
  "deadline-time-lot",
  "deadline-receipt-request-date-lot",
  "deadline-receipt-request-time-lot",
  "deadline-receipt-tender-date-lot",
  "deadline-receipt-tender-time-lot",
  "estimated-value-lot",
  "estimated-value-cur-lot",
  "procedure-type",
  "notice-type",
  "contract-nature",
  "links",
];

const COUNTRY_LOOKUP = {
  AUT: { name: "Austria", lat: 47.5162, lng: 14.5501 },
  BEL: { name: "Belgio", lat: 50.5039, lng: 4.4699 },
  BGR: { name: "Bulgaria", lat: 42.7339, lng: 25.4858 },
  CHE: { name: "Svizzera", lat: 46.8182, lng: 8.2275 },
  CYP: { name: "Cipro", lat: 35.1264, lng: 33.4299 },
  CZE: { name: "Cechia", lat: 49.8175, lng: 15.473 },
  DEU: { name: "Germania", lat: 51.1657, lng: 10.4515 },
  DNK: { name: "Danimarca", lat: 56.2639, lng: 9.5018 },
  ESP: { name: "Spagna", lat: 40.4637, lng: -3.7492 },
  EST: { name: "Estonia", lat: 58.5953, lng: 25.0136 },
  FIN: { name: "Finlandia", lat: 61.9241, lng: 25.7482 },
  FRA: { name: "Francia", lat: 46.2276, lng: 2.2137 },
  GBR: { name: "Regno Unito", lat: 55.3781, lng: -3.436 },
  GRC: { name: "Grecia", lat: 39.0742, lng: 21.8243 },
  HRV: { name: "Croazia", lat: 45.1, lng: 15.2 },
  HUN: { name: "Ungheria", lat: 47.1625, lng: 19.5033 },
  IRL: { name: "Irlanda", lat: 53.4129, lng: -8.2439 },
  ISL: { name: "Islanda", lat: 64.9631, lng: -19.0208 },
  ITA: { name: "Italia", lat: 41.8719, lng: 12.5674 },
  LTU: { name: "Lituania", lat: 55.1694, lng: 23.8813 },
  LUX: { name: "Lussemburgo", lat: 49.8153, lng: 6.1296 },
  LVA: { name: "Lettonia", lat: 56.8796, lng: 24.6032 },
  MLT: { name: "Malta", lat: 35.9375, lng: 14.3754 },
  NLD: { name: "Paesi Bassi", lat: 52.1326, lng: 5.2913 },
  NOR: { name: "Norvegia", lat: 60.472, lng: 8.4689 },
  POL: { name: "Polonia", lat: 51.9194, lng: 19.1451 },
  PRT: { name: "Portogallo", lat: 39.3999, lng: -8.2245 },
  ROU: { name: "Romania", lat: 45.9432, lng: 24.9668 },
  SVK: { name: "Slovacchia", lat: 48.669, lng: 19.699 },
  SVN: { name: "Slovenia", lat: 46.1512, lng: 14.9955 },
  SWE: { name: "Svezia", lat: 60.1282, lng: 18.6435 },
};

const EUROPE_CENTER = { lat: 50.2, lng: 10.8 };
const EUROPE_BOUNDS = {
  north: 72,
  south: 34,
  west: -25,
  east: 45,
};
const DAY_CACHE = new Map();

const runtime = {
  currentSyncDate: null,
  nextRunAt: null,
  syncInProgress: false,
  syncPromise: null,
  timer: null,
};

let storageLoaded = false;
let geoCache = {};
let syncState = createInitialSyncState();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function createInitialSyncState() {
  return {
    version: 1,
    lastError: null,
    lastRunAt: null,
    lastRunSummary: null,
    lastSuccessfulSyncDate: null,
    nextScheduledRunAt: null,
    days: {},
  };
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function createDateFromKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTedDate(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function formatTedDateFromKey(dateKey) {
  return dateKey.replaceAll("-", "");
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

function addDays(dateKey, days) {
  const date = createDateFromKey(dateKey);
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

function listDateKeysBetween(startKey, endKey) {
  if (startKey > endKey) {
    return [];
  }

  const keys = [];
  let cursor = startKey;

  while (cursor <= endKey) {
    keys.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return keys;
}

function getTodayKey() {
  return formatDateKey(new Date());
}

function getYesterdayKey() {
  return addDays(getTodayKey(), -1);
}

function firstValue(value) {
  if (Array.isArray(value)) {
    return value.find(Boolean) || null;
  }

  return value ?? null;
}

function parseNumericValue(value) {
  const parsed = Number(firstValue(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function pickLocalizedText(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.find(Boolean) || null;
  }

  const preferredKeys = ["ita", "eng", "spa", "fra", "deu", "ces"];

  for (const key of preferredKeys) {
    const candidate = firstValue(value[key]);

    if (candidate) {
      return candidate;
    }
  }

  return Object.values(value)
    .map((candidate) => firstValue(candidate))
    .find(Boolean) || null;
}

function pickNoticeLink(links, section) {
  if (!links || !links[section]) {
    return null;
  }

  const candidate = links[section];
  return candidate.ITA || candidate.ENG || candidate.MUL || Object.values(candidate)[0] || null;
}

function getCountryMetadata(countryCode) {
  return COUNTRY_LOOKUP[countryCode] || null;
}

function buildLocationKey(city, countryCode) {
  return `${String(city || "").trim().toLowerCase()}|${countryCode || ""}`;
}

function buildMapKeyFromCoordinates({ lat, lng }, city, countryCode) {
  return `${lat.toFixed(3)}|${lng.toFixed(3)}|${countryCode || ""}|${String(city || "").trim().toLowerCase()}`;
}

function getLocationLabelFromParts(city, countryName) {
  if (city && countryName) {
    return `${city}, ${countryName}`;
  }

  return countryName || city || "n.d.";
}

function isWithinEuropeBounds(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= EUROPE_BOUNDS.south &&
    lat <= EUROPE_BOUNDS.north &&
    lng >= EUROPE_BOUNDS.west &&
    lng <= EUROPE_BOUNDS.east
  );
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

function combineTedDateAndTime(dateValue, timeValue) {
  const rawDate = firstValue(dateValue);
  const rawTime = firstValue(timeValue);

  if (!rawDate) {
    return null;
  }

  if (typeof rawDate === "string" && rawDate.includes("T")) {
    return rawDate;
  }

  if (!rawTime) {
    return rawDate;
  }

  const dateMatch = String(rawDate).match(/^(\d{4}-\d{2}-\d{2})([+-]\d{2}:\d{2})?$/);
  const timeMatch = String(rawTime).match(/^(\d{2}:\d{2}(?::\d{2})?)([+-]\d{2}:\d{2})?$/);

  if (!dateMatch || !timeMatch) {
    return rawDate;
  }

  const normalizedTime = timeMatch[1].length === 5 ? `${timeMatch[1]}:00` : timeMatch[1];
  return `${dateMatch[1]}T${normalizedTime}${timeMatch[2] || dateMatch[2] || ""}`;
}

function extractDeadlineInfo(rawNotice) {
  const deadlineCandidates = [
    {
      kind: "Offerte",
      value: combineTedDateAndTime(
        rawNotice["deadline-receipt-tender-date-lot"],
        rawNotice["deadline-receipt-tender-time-lot"]
      ),
    },
    {
      kind: "Domande",
      value: combineTedDateAndTime(
        rawNotice["deadline-receipt-request-date-lot"],
        rawNotice["deadline-receipt-request-time-lot"]
      ),
    },
    {
      kind: "Scadenza",
      value:
        firstValue(rawNotice.deadline) ||
        combineTedDateAndTime(rawNotice["deadline-date-lot"], rawNotice["deadline-time-lot"]),
    },
  ];

  const match = deadlineCandidates.find((candidate) => candidate.value);
  return {
    deadlineDate: match?.value || null,
    deadlineKind: match?.kind || null,
  };
}

function inferStatus(noticeType, deadlineDate) {
  if (typeof noticeType === "string" && noticeType.startsWith("can")) {
    return "Aggiudicato";
  }

  if (typeof noticeType === "string" && (noticeType.startsWith("cn") || noticeType.startsWith("pin")) && !deadlineDate) {
    return "In corso";
  }

  if (!deadlineDate) {
    return "Pubblicato";
  }

  const deadline = parseTedDate(deadlineDate);
  const now = new Date();

  if (!deadline || Number.isNaN(deadline.getTime())) {
    return "Pubblicato";
  }

  if (deadline >= now) {
    return "In corso";
  }

  return "Scaduto";
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
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

function dominantStatus(statusCounts) {
  const entries = Object.entries(statusCounts);

  if (entries.length === 0) {
    return "Pubblicato";
  }

  return entries.sort((left, right) => right[1] - left[1])[0][0];
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
        <Cell><Data ss:Type="Number">${Number(notice.estimatedValue || 0)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.currency || "EUR")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.deadlineDate || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.deadlineKind || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.publicationDate || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.noticeType || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.procedureType || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.links.html || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.links.pdf || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(notice.links.xml || "")}</Data></Cell>
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

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallbackValue;
    }

    throw error;
  }
}

async function writeJsonFile(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function migrateLegacyDailyArchive() {
  if (LEGACY_DAILY_DIR === DAILY_DIR) {
    return;
  }

  const legacyEntries = await fs.readdir(LEGACY_DAILY_DIR, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  });

  for (const entry of legacyEntries) {
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) {
      continue;
    }

    const sourcePath = path.join(LEGACY_DAILY_DIR, entry.name);
    const targetPath = path.join(DAILY_DIR, entry.name);
    const targetExists = await fs
      .access(targetPath)
      .then(() => true)
      .catch(() => false);

    if (!targetExists) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function ensureStorageLoaded() {
  if (storageLoaded) {
    return;
  }

  await fs.mkdir(DAILY_DIR, { recursive: true });
  await migrateLegacyDailyArchive();
  geoCache = await readJsonFile(GEO_CACHE_FILE, {});
  syncState = {
    ...createInitialSyncState(),
    ...(await readJsonFile(SYNC_STATE_FILE, createInitialSyncState())),
  };

  if (!syncState.days || typeof syncState.days !== "object") {
    syncState.days = {};
  }

  await rebuildSyncIndexFromFiles();
  storageLoaded = true;
}

async function rebuildSyncIndexFromFiles() {
  const entries = await fs.readdir(DAILY_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const days = {};

  for (const fileName of files) {
    const dateKey = fileName.replace(/\.json$/, "");
    const payload = await readJsonFile(path.join(DAILY_DIR, fileName), null);

    if (!payload) {
      continue;
    }

    DAY_CACHE.set(dateKey, payload);
    days[dateKey] = {
      noticeCount: payload.notices?.length || 0,
      schemaVersion: payload.meta?.schemaVersion || 0,
      syncMode: payload.meta?.syncMode || "snapshot",
      totalMatches: payload.totalMatches || 0,
      updatedAt: payload.updatedAt || null,
    };
  }

  syncState.days = days;

  const storedDates = Object.keys(syncState.days).sort();
  syncState.lastSuccessfulSyncDate = storedDates.at(-1) || null;

  await saveSyncState();
}

async function saveSyncState() {
  syncState.nextScheduledRunAt = runtime.nextRunAt;
  await writeJsonFile(SYNC_STATE_FILE, syncState);
}

async function saveGeoCache() {
  await writeJsonFile(GEO_CACHE_FILE, geoCache);
}

function listStoredDateKeys() {
  return Object.keys(syncState.days).sort();
}

function getDateInfo(dateKey) {
  return syncState.days[dateKey] || null;
}

function getSyncStatusPayload() {
  const storedDates = listStoredDateKeys();
  const newestDate = storedDates.at(-1) || null;
  const oldestDate = storedDates[0] || null;
  const storedNoticeCount = storedDates.reduce(
    (total, dateKey) => total + Number(syncState.days[dateKey]?.noticeCount || 0),
    0
  );

  return {
    currentSyncDate: runtime.currentSyncDate,
    inProgress: runtime.syncInProgress,
    lastError: syncState.lastError,
    lastRunAt: syncState.lastRunAt,
    lastRunSummary: syncState.lastRunSummary,
    lastSuccessfulSyncDate: syncState.lastSuccessfulSyncDate,
    nextRunAt: runtime.nextRunAt,
    oldestStoredDate: oldestDate,
    newestStoredDate: newestDate,
    archiveDirectory: DAILY_DIR,
    archiveDirectoryLabel: path.relative(ROOT, DAILY_DIR) || path.basename(DAILY_DIR),
    storedNoticeCount,
    schedule: {
      hour: SYNC_HOUR,
      minute: SYNC_MINUTE,
      timezone: process.env.TZ || "ora locale del server",
    },
    storedDateCount: storedDates.length,
    storedDates: storedDates
      .slice()
      .reverse()
      .map((dateKey) => ({
        dateKey,
        ...syncState.days[dateKey],
      })),
    serverTime: new Date().toISOString(),
  };
}

function computeNextRunAt(now = new Date()) {
  const next = new Date(now);
  next.setHours(SYNC_HOUR, SYNC_MINUTE, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next.toISOString();
}

async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex;
      currentIndex += 1;
      results[index] = await task(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function geocodeLocation(city, countryCode) {
  const country = getCountryMetadata(countryCode);
  const locationKey = buildLocationKey(city, countryCode);

  if (geoCache[locationKey]) {
    return geoCache[locationKey];
  }

  if (!city || !country) {
    return country
      ? { lat: country.lat, lng: country.lng, source: "country" }
      : { lat: EUROPE_CENTER.lat, lng: EUROPE_CENTER.lng, source: "europe" };
  }

  try {
    const endpoint = new URL("https://nominatim.openstreetmap.org/search");
    endpoint.searchParams.set("format", "jsonv2");
    endpoint.searchParams.set("limit", "1");
    endpoint.searchParams.set("q", `${city}, ${country.name}`);

    const response = await fetch(endpoint, {
      headers: {
        "Accept-Language": "it,en;q=0.8",
        "User-Agent": "TED-Radar-Archive/1.0",
      },
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
    });

    if (response.ok) {
      const payload = await response.json();
      const candidate = payload[0];

      if (candidate?.lat && candidate?.lon) {
        return {
          lat: Number(candidate.lat),
          lng: Number(candidate.lon),
          source: "city",
        };
      }
    }
  } catch (error) {
    // Fallback below keeps sync resilient when geocoding is unavailable.
  }

  return { lat: country.lat, lng: country.lng, source: "country" };
}

async function warmGeoCache(rawNotices) {
  const freshTargets = [];
  const seenKeys = new Set();

  for (const rawNotice of rawNotices) {
    const city = firstValue(rawNotice["place-of-performance-city-lot"]);
    const countryCode = firstValue(rawNotice["place-of-performance-country-lot"]);
    const country = getCountryMetadata(countryCode);

    if (!city || !country) {
      continue;
    }

    const locationKey = buildLocationKey(city, countryCode);

    if (geoCache[locationKey] || seenKeys.has(locationKey)) {
      continue;
    }

    seenKeys.add(locationKey);
    freshTargets.push({ city, countryCode, locationKey });
  }

  const limitedTargets = freshTargets.slice(0, GEO_BATCH_LIMIT);

  if (limitedTargets.length === 0) {
    return 0;
  }

  const results = await mapWithConcurrency(limitedTargets, GEO_CONCURRENCY, async (target) => {
    const coordinates = await geocodeLocation(target.city, target.countryCode);
    geoCache[target.locationKey] = coordinates;
    return coordinates;
  });

  if (results.length > 0) {
    await saveGeoCache();
  }

  return results.length;
}

function resolveCoordinates(rawNotice) {
  const city = firstValue(rawNotice["place-of-performance-city-lot"]);
  const countryCode = firstValue(rawNotice["place-of-performance-country-lot"]);
  const country = getCountryMetadata(countryCode);
  const locationKey = buildLocationKey(city, countryCode);

  if (geoCache[locationKey]) {
    return geoCache[locationKey];
  }

  if (country) {
    return { lat: country.lat, lng: country.lng, source: "country" };
  }

  return { lat: EUROPE_CENTER.lat, lng: EUROPE_CENTER.lng, source: "europe" };
}

function normalizeNotice(rawNotice) {
  const countryCode = firstValue(rawNotice["place-of-performance-country-lot"]);
  const country = getCountryMetadata(countryCode);
  const countryName = country?.name || countryCode || "n.d.";
  const city = firstValue(rawNotice["place-of-performance-city-lot"]);
  const noticeType = rawNotice["notice-type"] || null;
  const { deadlineDate, deadlineKind } = extractDeadlineInfo(rawNotice);
  const coordinates = resolveCoordinates(rawNotice);
  const locationLabel = getLocationLabelFromParts(city, countryName);
  const mapKey = buildMapKeyFromCoordinates(coordinates, city, countryCode);

  return {
    id: rawNotice["publication-number"],
    title: pickLocalizedText(rawNotice["notice-title"]) || "Titolo non disponibile",
    buyer: pickLocalizedText(rawNotice["buyer-name"]) || "Buyer non disponibile",
    publicationDate: rawNotice["publication-date"] || null,
    deadlineDate,
    estimatedValue: parseNumericValue(rawNotice["estimated-value-lot"]),
    currency: firstValue(rawNotice["estimated-value-cur-lot"]) || "EUR",
    procedureType: rawNotice["procedure-type"] || null,
    noticeType,
    contractNature: firstValue(rawNotice["contract-nature"]) || null,
    status: inferStatus(noticeType, deadlineDate),
    deadlineKind,
    countryCode,
    countryName,
    city: city || null,
    coordinates,
    locationLabel,
    mapKey,
    links: {
      detail: pickNoticeLink(rawNotice.links, "html"),
      html: pickNoticeLink(rawNotice.links, "htmlDirect"),
      pdf: pickNoticeLink(rawNotice.links, "pdf"),
      xml: rawNotice.links?.xml?.MUL || null,
    },
  };
}

async function fetchTedPage(dateKey, page) {
  const body = {
    fields: TED_FIELDS,
    limit: FETCH_PAGE_LIMIT,
    page,
    query: `publication-date>=${formatTedDateFromKey(dateKey)} AND publication-date<=${formatTedDateFromKey(dateKey)}`,
  };

  const response = await fetch(TED_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`TED API ${response.status}: ${errorBody.slice(0, 180)}`);
  }

  return response.json();
}

async function fetchTedDayArchive(dateKey, syncMode) {
  const firstPage = await fetchTedPage(dateKey, 1);
  const totalMatches = firstPage.totalNoticeCount || 0;
  const totalPages = Math.max(1, Math.ceil(totalMatches / FETCH_PAGE_LIMIT));
  const rawNotices = [...(firstPage.notices || [])];

  for (let page = 2; page <= totalPages; page += 1) {
    const payload = await fetchTedPage(dateKey, page);
    rawNotices.push(...(payload.notices || []));
  }

  const geocodedFreshCount = await warmGeoCache(rawNotices);
  const notices = rawNotices.map((rawNotice) => normalizeNotice(rawNotice)).sort(sortNoticesDesc);

  return {
    dateKey,
    notices,
    totalMatches,
    updatedAt: new Date().toISOString(),
    meta: {
      geocodedFreshCount,
      queryDate: dateKey,
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      syncMode,
      totalPages,
    },
  };
}

function buildDailyArchivePath(dateKey) {
  return path.join(DAILY_DIR, `${dateKey}.json`);
}

async function loadDailyArchive(dateKey) {
  if (DAY_CACHE.has(dateKey)) {
    return DAY_CACHE.get(dateKey);
  }

  const payload = await readJsonFile(buildDailyArchivePath(dateKey), null);

  if (!payload) {
    return null;
  }

  DAY_CACHE.set(dateKey, payload);
  return payload;
}

async function storeDailyArchive(dateKey, payload) {
  DAY_CACHE.set(dateKey, payload);
  await writeJsonFile(buildDailyArchivePath(dateKey), payload);
}

async function syncDate(dateKey, options = {}) {
  const { force = false, reason = "manual", syncMode = "snapshot" } = options;
  await ensureStorageLoaded();

  const currentInfo = getDateInfo(dateKey);

  if (!force && currentInfo && currentInfo.syncMode === syncMode) {
    return loadDailyArchive(dateKey);
  }

  const archive = await fetchTedDayArchive(dateKey, syncMode);
  await storeDailyArchive(dateKey, archive);

  syncState.days[dateKey] = {
    noticeCount: archive.notices.length,
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    syncMode,
    totalMatches: archive.totalMatches,
    updatedAt: archive.updatedAt,
  };
  syncState.lastError = null;
  syncState.lastRunAt = new Date().toISOString();
  syncState.lastRunSummary = {
    dateKey,
    noticeCount: archive.notices.length,
    reason,
    syncMode,
    totalMatches: archive.totalMatches,
  };
  syncState.lastSuccessfulSyncDate = dateKey;

  await saveSyncState();
  return archive;
}

function shouldRefreshTodaySnapshot() {
  const todayKey = getTodayKey();
  const info = getDateInfo(todayKey);

  if (!info) {
    return true;
  }

  const updatedAt = info.updatedAt ? new Date(info.updatedAt).getTime() : 0;
  const ageMs = Date.now() - updatedAt;

  return ageMs > 60 * 60 * 1000;
}

function getMissingCompletedDateKeys() {
  const yesterdayKey = getYesterdayKey();
  const completeKeys = listStoredDateKeys().filter((dateKey) => getDateInfo(dateKey)?.syncMode === "complete");

  if (completeKeys.length === 0) {
    const startKey = addDays(yesterdayKey, -(INITIAL_BACKFILL_DAYS - 1));
    return listDateKeysBetween(startKey, yesterdayKey);
  }

  const latestCompleteKey = completeKeys.at(-1);
  return listDateKeysBetween(addDays(latestCompleteKey, 1), yesterdayKey);
}

async function withSyncLock(task) {
  if (runtime.syncPromise) {
    return runtime.syncPromise;
  }

  runtime.syncInProgress = true;
  runtime.syncPromise = (async () => {
    try {
      return await task();
    } catch (error) {
      syncState.lastError = {
        at: new Date().toISOString(),
        message: error.message || "Errore sconosciuto durante la sincronizzazione.",
      };
      await saveSyncState();
      throw error;
    } finally {
      runtime.currentSyncDate = null;
      runtime.syncInProgress = false;
      runtime.syncPromise = null;
    }
  })();

  return runtime.syncPromise;
}

async function runStartupSync() {
  return withSyncLock(async () => {
    const syncedDates = [];

    for (const dateKey of getMissingCompletedDateKeys()) {
      runtime.currentSyncDate = dateKey;
      const payload = await syncDate(dateKey, {
        force: true,
        reason: "startup-backfill",
        syncMode: "complete",
      });
      syncedDates.push({
        dateKey,
        noticeCount: payload.notices.length,
        syncMode: "complete",
      });
    }

    if (shouldRefreshTodaySnapshot()) {
      const todayKey = getTodayKey();
      runtime.currentSyncDate = todayKey;
      const payload = await syncDate(todayKey, {
        force: true,
        reason: "startup-snapshot",
        syncMode: "snapshot",
      });
      syncedDates.push({
        dateKey: todayKey,
        noticeCount: payload.notices.length,
        syncMode: "snapshot",
      });
    }

    return {
      syncedDates,
      type: "startup",
    };
  });
}

async function runManualSnapshotSync() {
  return withSyncLock(async () => {
    const todayKey = getTodayKey();
    runtime.currentSyncDate = todayKey;

    const payload = await syncDate(todayKey, {
      force: true,
      reason: "manual-snapshot",
      syncMode: "snapshot",
    });

    return {
      syncedDates: [
        {
          dateKey: todayKey,
          noticeCount: payload.notices.length,
          syncMode: "snapshot",
        },
      ],
      type: "manual",
    };
  });
}

async function ensureLiveSnapshotForOpen() {
  try {
    await runManualSnapshotSync();
    return true;
  } catch (error) {
    if (listStoredDateKeys().length > 0) {
      return false;
    }

    throw error;
  }
}

async function runScheduledSync() {
  return withSyncLock(async () => {
    const syncedDates = [];
    const yesterdayKey = getYesterdayKey();
    const todayKey = getTodayKey();

    runtime.currentSyncDate = yesterdayKey;
    const completedArchive = await syncDate(yesterdayKey, {
      force: true,
      reason: "scheduled-complete",
      syncMode: "complete",
    });
    syncedDates.push({
      dateKey: yesterdayKey,
      noticeCount: completedArchive.notices.length,
      syncMode: "complete",
    });

    runtime.currentSyncDate = todayKey;
    const snapshotArchive = await syncDate(todayKey, {
      force: true,
      reason: "scheduled-snapshot",
      syncMode: "snapshot",
    });
    syncedDates.push({
      dateKey: todayKey,
      noticeCount: snapshotArchive.notices.length,
      syncMode: "snapshot",
    });

    return {
      syncedDates,
      type: "scheduled",
    };
  });
}

function scheduleNextDailySync() {
  if (runtime.timer) {
    clearTimeout(runtime.timer);
  }

  runtime.nextRunAt = computeNextRunAt();
  void saveSyncState();

  const delay = Math.max(5000, new Date(runtime.nextRunAt).getTime() - Date.now());

  runtime.timer = setTimeout(async () => {
    try {
      await runScheduledSync();
    } catch (error) {
      // Error is already persisted in withSyncLock.
    } finally {
      scheduleNextDailySync();
    }
  }, delay);
}

async function serveStatic(res, filePath) {
  const extension = path.extname(filePath);
  const contentType = MIME_TYPES[extension] || "application/octet-stream";
  const content = await fs.readFile(filePath);

  res.writeHead(200, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=300",
    "Content-Type": contentType,
  });
  res.end(content);
}

function parseArchiveWindow(daysParam) {
  if (!daysParam || daysParam === "30") {
    return 30;
  }

  if (daysParam === "all") {
    return "all";
  }

  return clamp(Number(daysParam) || 30, 1, 365);
}

async function getArchivePayloads(windowDays) {
  const storedDates = listStoredDateKeys();

  if (storedDates.length === 0) {
    return [];
  }

  const selectedDates =
    windowDays === "all"
      ? storedDates
      : storedDates.slice(-windowDays);
  const payloads = [];

  for (const dateKey of selectedDates) {
    let archive = await loadDailyArchive(dateKey);
    const syncMode = getDateInfo(dateKey)?.syncMode || archive?.meta?.syncMode || "snapshot";
    const schemaVersion = Number(archive?.meta?.schemaVersion || 0);

    if (!archive || schemaVersion < ARCHIVE_SCHEMA_VERSION) {
      try {
        archive = await syncDate(dateKey, {
          force: true,
          reason: archive ? "schema-upgrade" : "archive-rebuild",
          syncMode,
        });
      } catch (error) {
        if (!archive) {
          throw error;
        }
      }
    }

    if (archive) {
      payloads.push(archive);
    }
  }

  return payloads;
}

function filterNotices(notices, filters) {
  const query = normalizeText(filters.search);

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

    const matchesStatus = filters.status === "all" || notice.status === filters.status;
    const matchesCountry = filters.country === "all" || notice.countryName === filters.country;
    const matchesNature = filters.nature === "all" || notice.contractNature === filters.nature;

    return matchesSearch && matchesStatus && matchesCountry && matchesNature;
  });
}

function buildMapMarkers(notices) {
  const coordinateGroups = new Map();
  const markers = [];

  for (const notice of notices) {
    if (notice.coordinates.source === "europe") {
      continue;
    }

    if (!isWithinEuropeBounds(notice.coordinates.lat, notice.coordinates.lng)) {
      continue;
    }

    const coordinateKey = `${notice.coordinates.lat.toFixed(4)}|${notice.coordinates.lng.toFixed(4)}`;
    const groupIndex = coordinateGroups.get(coordinateKey) || 0;
    coordinateGroups.set(coordinateKey, groupIndex + 1);

    const offset = buildMarkerOffset(groupIndex, notice.coordinates.source);
    markers.push({
      buyer: notice.buyer,
      coordinatesSource: notice.coordinates.source,
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
    });
  }

  return markers
    .sort((left, right) => {
      const timeDiff =
        (parseTedDate(right.publicationDate)?.getTime() || 0) - (parseTedDate(left.publicationDate)?.getTime() || 0);

      if (timeDiff !== 0) {
        return timeDiff;
      }

      return String(right.id).localeCompare(String(left.id));
    })
    .slice(0, MAX_MAP_MARKERS);
}

function buildCountries(notices) {
  return [...new Set(notices.map((notice) => notice.countryName).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "it")
  );
}

async function queryArchive(params) {
  const filters = {
    country: params.country || "all",
    nature: params.nature || "all",
    search: params.search || "",
    status: params.status || "all",
  };

  const archives = await getArchivePayloads(parseArchiveWindow(params.days));
  const archiveDates = archives
    .map((archive) => ({
      dateKey: archive.dateKey,
      noticeCount: archive.notices.length,
      syncMode: archive.meta?.syncMode || "snapshot",
      updatedAt: archive.updatedAt,
    }))
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
  const archiveNotices = archives.flatMap((archive) => archive.notices).sort(sortNoticesDesc);
  const filteredNotices = filterNotices(archiveNotices, filters);

  return {
    archiveDates,
    archiveNotices,
    filteredNotices,
  };
}

async function buildNoticeDataset(params) {
  const pageSize = clamp(Number(params.pageSize) || DEFAULT_PAGE_SIZE, 10, MAX_PAGE_SIZE);
  const page = Math.max(1, Number(params.page) || 1);
  const { archiveDates, archiveNotices, filteredNotices } = await queryArchive(params);
  const syncPayload = getSyncStatusPayload();
  const paginationTotalPages = Math.max(1, Math.ceil(filteredNotices.length / pageSize));
  const safePage = Math.min(page, paginationTotalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageNotices = filteredNotices.slice(pageStart, pageStart + pageSize);
  const mapPoints = buildMapMarkers(filteredNotices);
  const archiveStatusCounts = countStatuses(archiveNotices);

  return {
    notices: pageNotices,
    mapPoints,
    pagination: {
      page: safePage,
      pageSize,
      totalPages: paginationTotalPages,
      totalResults: filteredNotices.length,
    },
    summary: {
      archiveCount: archiveNotices.length,
      awardedCount: archiveStatusCounts["Aggiudicato"] || 0,
      countries: buildCountries(archiveNotices),
      filteredCount: filteredNotices.length,
      mapPointCount: mapPoints.length,
      openCount: archiveStatusCounts["In corso"] || 0,
      totalArchiveCount: syncPayload.storedNoticeCount,
    },
    archive: {
      dateCount: archiveDates.length,
      days: archiveDates.slice().reverse(),
      fromDate: archiveDates[0]?.dateKey || null,
      toDate: archiveDates.at(-1)?.dateKey || null,
    },
    sync: syncPayload,
  };
}

function parseBodylessSyncRequest(requestUrl) {
  const mode = requestUrl.searchParams.get("mode") || "snapshot";

  if (!["snapshot", "scheduled", "startup"].includes(mode)) {
    throw new Error("Modalita sync non supportata.");
  }

  return { mode };
}

async function bootstrap() {
  await ensureStorageLoaded();
  scheduleNextDailySync();
  void runStartupSync().catch((error) => {
    console.warn(`Sync TED iniziale non completata: ${error.message || error}`);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    await ensureStorageLoaded();
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Origin": "*",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        sync: getSyncStatusPayload(),
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/sync-status") {
      json(res, 200, getSyncStatusPayload());
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/notices") {
      const fresh = requestUrl.searchParams.get("fresh") === "1";

      if (fresh) {
        await ensureLiveSnapshotForOpen();
      }

      const payload = await buildNoticeDataset({
        country: requestUrl.searchParams.get("country"),
        days: requestUrl.searchParams.get("days"),
        nature: requestUrl.searchParams.get("nature"),
        page: requestUrl.searchParams.get("page"),
        pageSize: requestUrl.searchParams.get("pageSize"),
        search: requestUrl.searchParams.get("search"),
        status: requestUrl.searchParams.get("status"),
      });

      json(res, 200, payload);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/export") {
      const { filteredNotices } = await queryArchive({
        country: requestUrl.searchParams.get("country"),
        days: requestUrl.searchParams.get("days"),
        nature: requestUrl.searchParams.get("nature"),
        search: requestUrl.searchParams.get("search"),
        status: requestUrl.searchParams.get("status"),
      });

      const workbook = buildWorkbookXml(filteredNotices);
      const fileName = `ted-archive-${getTodayKey()}.xls`;

      res.writeHead(200, {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Type": "application/vnd.ms-excel",
      });
      res.end(workbook);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/sync") {
      const { mode } = parseBodylessSyncRequest(requestUrl);
      const result =
        mode === "snapshot"
          ? await runManualSnapshotSync()
          : await runScheduledSync();

      json(res, 200, {
        ok: true,
        result,
        sync: getSyncStatusPayload(),
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/") {
      await serveStatic(res, path.join(ROOT, "index.html"));
      return;
    }

    if (req.method === "GET" && ["/app.js", "/styles.css"].includes(requestUrl.pathname)) {
      await serveStatic(res, path.join(ROOT, requestUrl.pathname));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    json(res, 404, { message: "Risorsa non trovata." });
  } catch (error) {
    json(res, 500, {
      message: error.message || "Errore interno del server.",
    });
  }
});

if (require.main === module) {
  bootstrap()
    .catch(() => {})
    .finally(() => {
      server.listen(PORT, HOST, () => {
        console.log(`Radar TED disponibile su http://${HOST}:${PORT}`);
      });
    });
}

module.exports = {
  bootstrap,
  buildNoticeDataset,
  fetchTedDayArchive,
  getSyncStatusPayload,
  queryArchive,
  runManualSnapshotSync,
  runScheduledSync,
  server,
  syncDate,
};
