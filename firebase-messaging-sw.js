// SPE Basrah academic invalidation bridge.
// Capture FCM data pushes and forward the academic bucket to open clients.
// Also persist the signal in IndexedDB so it is processed after reopening the app.

const SPE_CACHE_SIGNAL_DB = "spe_basrah_cache_signal_v1";
const SPE_CACHE_SIGNAL_STORE = "signals";

function speFindAcademicData(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return null;
  const action = String(value.cache_action || value.cacheAction || "").toLowerCase();
  const stage = value.academicStage || value.academic_stage || value.stage;
  const course = value.academicCourse || value.academic_course || value.course;
  const subject = value.subject || value.academicSubject;
  const category = value.category || value.academicCategory;
  if (action === "subject_info_invalidate" && stage && course) {
    return {
      cache_action: "subject_info_invalidate",
      academicStage: String(stage),
      academicCourse: String(course),
      ...(value.publishedAtMs ? { publishedAtMs: String(value.publishedAtMs) } : {}),
    };
  }
  if (stage && course && subject && category) {
    return {
      cache_action: "academic_invalidate",
      academicStage: String(stage),
      academicCourse: String(course),
      subject: String(subject),
      category: String(category),
      ...(value.publishedAtMs ? { publishedAtMs: String(value.publishedAtMs) } : {}),
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
    id: `${data.cache_action || "academic_invalidate"}|${data.academicStage}|${data.academicCourse}|${data.subject || ""}|${data.category || ""}|${Date.now()}|${Math.random()}`,
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

// Keep this file identical to firebase-messaging-sw.js: index.html
// registers that scoped path. Persist visible pushes even when the PWA is shut.
const SPE_INBOX_DB = "spe_basrah_local_inbox_v1";
const SPE_INBOX_STORE = "notifications";
const SPE_NOTIFICATION_RETENTION_MS = 48 * 60 * 60 * 1000;

function speNotificationFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const pick = (key) => speFindValue(payload, key);
  const silent = String(pick("cache_silent") ?? pick("cacheSilent") ?? "").toLowerCase();
  if (["1", "true", "yes"].includes(silent)) return null;
  const text = (value) => typeof value === "string" ? value
    : value && typeof value === "object" ? String(value.ar || value.en || "") : "";
  const body = text(pick("body")) || text(pick("alert")) || text(pick("contents"));
  // A cache-only signal must not appear as an empty inbox notification.
  if (!body.trim()) return null;
  const id = String(pick("inboxId") || pick("notificationId") || pick("i") || payload.id || "");
  if (!id) return null;
  return {
    id,
    title: text(pick("title")) || text(pick("headings")) || "SPE Basrah",
    body,
    route: String(pick("route") || ""),
    academicStage: String(pick("academicStage") || ""),
    academicCourse: String(pick("academicCourse") || ""),
    subject: String(pick("subject") || ""),
    category: String(pick("category") || ""),
    contentType: String(pick("contentType") || ""),
    createdAt: Date.parse(String(pick("sentAt") || "")) || Date.now(),
  };
}

async function spePersistInboxNotification(item) {
  if (!item || Date.now() - item.createdAt >= SPE_NOTIFICATION_RETENTION_MS) return;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(SPE_INBOX_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SPE_INBOX_STORE)) {
        request.result.createObjectStore(SPE_INBOX_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SPE_INBOX_STORE, "readwrite");
      const store = tx.objectStore(SPE_INBOX_STORE);
      store.put(item);
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        if (Date.now() - Number(cursor.value.createdAt || 0) >= SPE_NOTIFICATION_RETENTION_MS) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
    if (typeof payload?.custom === "string") payload.custom = JSON.parse(payload.custom);
  } catch (_) { return; }
  const academic = speFindAcademicData(payload);
  const item = speNotificationFromPayload(payload);
  const silent = String(speFindValue(payload, "cache_silent") ?? speFindValue(payload, "cacheSilent") ?? "").toLowerCase();
  // Preserve legacy internal cache handling. Visible pushes continue to the
  // FCM SDK's own display handler; this listener never displays twice.
  if (academic && ["1", "true", "yes"].includes(silent)) event.stopImmediatePropagation();
  if (!academic && !item) return;
  event.waitUntil((async () => {
    try { await spePersistInboxNotification(item); }
    catch (error) { console.warn("[SPE Inbox] Background save failed", String(error)); }
    if (academic) {
      try { await spePersistAcademicSignal(academic); } catch (_) {}
    }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (academic) client.postMessage({ type: "SPE_ACADEMIC_INVALIDATE", data: academic });
      if (item) client.postMessage({ type: "SPE_NOTIFICATION_INBOX_CHANGED" });
    }
  })());
});


// Handle clicks before the SDK so an already-open app navigates to the item.
self.addEventListener('notificationclick', event => {
  const payload = event.notification.data?.FCM_MSG;
  if (!payload) return;
  event.stopImmediatePropagation();
  event.notification.close();
  event.waitUntil((async () => {
    const base = new URL('./', self.location.href);
    let target;
    try { target = new URL(payload.data?.link || payload.fcmOptions?.link || base.href); }
    catch (_) { target = base; }
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) target = base;
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for (const client of windows) {
      const current = new URL(client.url);
      if (current.origin !== base.origin || !current.pathname.startsWith(base.pathname)) continue;
      if (client.navigate) {
        const navigated = await client.navigate(target.href);
        if (navigated) return navigated.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});

// Let FCM display its notification once; the listener above only persists data.
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');
importScripts('./fcm-config.js');
firebase.initializeApp(globalThis.SPE_FCM_CONFIG);
firebase.messaging();
