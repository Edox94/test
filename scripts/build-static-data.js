const fs = require("node:fs/promises");
const path = require("node:path");
const {
  getSyncStatusPayload,
  runScheduledSync,
} = require("../server.js");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DAILY_DIR = path.join(DATA_DIR, "bandi-europei-giornalieri");
const STATIC_DATA_FILE = path.join(DATA_DIR, "site-dataset.json");

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function listDailyFiles() {
  const entries = await fs.readdir(DAILY_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
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

async function buildStaticDataset() {
  let syncFailed = false;

  try {
    await runScheduledSync();
  } catch (error) {
    syncFailed = true;
  }

  const files = await listDailyFiles();

  if (files.length === 0) {
    throw new Error("Nessun archivio giornaliero disponibile da pubblicare.");
  }

  const archives = await Promise.all(
    files.map(async (fileName) => {
      const archive = await readJson(path.join(DAILY_DIR, fileName));
      const dateKey = fileName.replace(/\.json$/, "");
      return {
        ...archive,
        dateKey,
      };
    })
  );

  const notices = archives
    .flatMap((archive) =>
      (archive.notices || []).map((notice) => ({
        ...notice,
        archiveDateKey: archive.dateKey,
      }))
    )
    .sort((left, right) => {
      const leftDate = new Date(left.publicationDate || 0).getTime();
      const rightDate = new Date(right.publicationDate || 0).getTime();

      if (rightDate !== leftDate) {
        return rightDate - leftDate;
      }

      return String(right.id).localeCompare(String(left.id));
    });

  const archiveDays = archives
    .map((archive) => ({
      dateKey: archive.dateKey,
      noticeCount: archive.notices?.length || 0,
      syncMode: archive.meta?.syncMode || "snapshot",
      updatedAt: archive.updatedAt || null,
    }))
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));

  const statusCounts = countStatuses(notices);
  const sync = getSyncStatusPayload();
  const dataset = {
    generatedAt: new Date().toISOString(),
    notices,
    archive: {
      dateCount: archiveDays.length,
      days: archiveDays.slice().reverse(),
      fromDate: archiveDays[0]?.dateKey || null,
      toDate: archiveDays.at(-1)?.dateKey || null,
    },
    summary: {
      archiveCount: notices.length,
      awardedCount: statusCounts["Aggiudicato"] || 0,
      countries: buildCountries(notices),
      openCount: statusCounts["In corso"] || 0,
      totalArchiveCount: sync.storedNoticeCount || notices.length,
    },
    sync: {
      ...sync,
      inProgress: false,
      lastStaticBuildAt: new Date().toISOString(),
      mode: "github-pages",
      syncFailed,
    },
  };

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATIC_DATA_FILE, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
}

buildStaticDataset().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
