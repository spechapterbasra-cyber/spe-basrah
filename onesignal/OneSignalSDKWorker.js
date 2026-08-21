// SPE Basrah academic invalidation bridge.
// Capture OneSignal data pushes and forward the academic bucket to open clients.
// Also persist the signal in IndexedDB so it is processed after reopening the app.

const SPE_CACHE_SIGNAL_DB = "spe_basrah_cache_signal_v1";
const SPE_CACHE_SIGNAL_STORE = "signals";

function speFindAcademicData(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return null;
  const stage = value.academicStage || value.academic_stage || value.stage;
  const course = value.academicCourse || value.academic_course || value.course;
  const subject = value.subject || value.academicSubject;
  const category = value.category || value.academicCategory;
  if (stage && course && subject && category) {
    return {
      cache_action: "academic_invalidate",
      academicStage: String(stage),
      academicCourse: String(course),
      subject: String(subject),
      category: String(category),
    };
  }
  for (const key of Object.keys(value)) {
    const nested = speFindAcademicData(value[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}


function speFindValue(value, wantedKey, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return null;
  if (Object.prototype.hasOwnProperty.call(value, wantedKey)) {
    return value[wantedKey];
  }
  for (const key of Object.keys(value)) {
    const nested = speFindValue(value[key], wantedKey, depth + 1);
    if (nested !== null && nested !== undefined) return nested;
  }
  return null;
}

function speOpenSignalDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SPE_CACHE_SIGNAL_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SPE_CACHE_SIGNAL_STORE)) {
        db.createObjectStore(SPE_CACHE_SIGNAL_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function spePersistAcademicSignal(data) {
  const db = await speOpenSignalDb();
  const item = {
    id: `${data.academicStage}|${data.academicCourse}|${data.subject}|${data.category}|${Date.now()}|${Math.random()}`,
    ...data,
    createdAt: Date.now(),
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SPE_CACHE_SIGNAL_STORE, "readwrite");
    tx.objectStore(SPE_CACHE_SIGNAL_STORE).put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

self.addEventListener("push", (event) => {
  let payload = null;
  try { payload = event.data ? event.data.json() : null; } catch (_) {}
  const academic = speFindAcademicData(payload);
  if (!academic) return;

  const silentMarker = String(
    speFindValue(payload, "cache_silent") ??
    speFindValue(payload, "cacheSilent") ??
    ""
  ).toLowerCase();
  const isInternalSilent =
      silentMarker === "1" || silentMarker === "true" || silentMarker === "yes";

  // Internal cache invalidation must never become a visible blank web/PWA
  // notification. Stop OneSignal's later push handler only for this signal.
  // Normal visible academic notifications are not stopped.
  if (isInternalSilent) {
    event.stopImmediatePropagation();
  }

  event.waitUntil((async () => {
    try { await spePersistAcademicSignal(academic); } catch (_) {}
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      client.postMessage({ type: "SPE_ACADEMIC_INVALIDATE", data: academic });
    }
  })());
});

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
