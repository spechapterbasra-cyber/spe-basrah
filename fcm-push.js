/* FCM transport for Flutter Web. No private key is shipped to the browser. */
(() => {
  'use strict';
  const worker = 'https://spe-basrah-notifications.spechapterbasra.workers.dev';
  const base = new URL('./', document.baseURI);
  const membershipKey = 'spe_fcm_web_membership_v1';
  let initialized, syncJob, disabled = localStorage.getItem('flutter.notifications_enabled') === 'false';
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src; script.onload = resolve;
      script.onerror = () => reject(new Error('تعذر تحميل مكتبة إشعارات الويب. تحقق من الاتصال.'));
      document.head.appendChild(script);
    });
  }
  async function jsonFetch(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(worker + path, {signal:controller.signal,
        ...(body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || `FCM HTTP ${response.status}`);
      return data;
    } finally { clearTimeout(timer); }
  }
  async function setup() {
    if (!('serviceWorker' in navigator) || !('Notification' in window) || !window.isSecureContext) {
      throw new Error('هذا المتصفح لا يدعم الإشعارات هنا. على iPhone أضف الموقع إلى الشاشة الرئيسية وافتحه منها.');
    }
    await loadScript(new URL('fcm-config.js',base).href);
    const config = await jsonFetch('/push-config');
    if (config.provider !== 'fcm' || config.projectId !== SPE_FCM_CONFIG.projectId) throw new Error('انشر Worker FCM الصحيح أولًا.');
    if (!config.vapidKey || !/^[A-Za-z0-9_-]{80,100}$/.test(config.vapidKey)) throw new Error('أضف مفتاح Web Push العام من Firebase إلى FCM_WEB_VAPID_KEY في Worker.');
    await loadScript('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');
    if (!await firebase.messaging.isSupported()) throw new Error('الإشعارات غير مدعومة في هذا المتصفح.');
    for (const old of await navigator.serviceWorker.getRegistrations()) {
      const script = old.active?.scriptURL || old.waiting?.scriptURL || old.installing?.scriptURL || '';
      if (/\/OneSignalSDKWorker\.js(?:\?|$)/.test(script)) {
        const subscription = await old.pushManager.getSubscription();
        if (subscription) await subscription.unsubscribe();
        await old.unregister();
      }
    }
    const registration = await navigator.serviceWorker.register(new URL('firebase-messaging-sw.js',base).href,
      {scope:new URL('fcm-push-scope/',base).href,updateViaCache:'none'});
    if (!registration.active) await new Promise((resolve,reject) => {
      const service = registration.installing || registration.waiting;
      const timer = setTimeout(()=>reject(new Error('تعذر تشغيل مستقبل الإشعارات. أعد فتح الصفحة.')),12000);
      const check = () => {
        if (registration.active || service?.state === 'activated') {clearTimeout(timer);resolve();}
        else if (service?.state === 'redundant') {clearTimeout(timer);reject(new Error('فشل تحميل مستقبل FCM.'));}
      };
      service?.addEventListener('statechange',check);check();
    });
    const app = firebase.apps.find(x=>x.name === 'spe-web-push') || firebase.initializeApp(SPE_FCM_CONFIG,'spe-web-push');
    const messaging = firebase.messaging(app);
    messaging.onMessage(async payload => {
      if (disabled || Notification.permission !== 'granted') return;
      await speBasrahStoreLocalNotification(payload);
      await speBasrahStoreAcademicInvalidation(payload.data || {});
      if (payload.notification) await registration.showNotification(payload.notification.title || 'SPE Basrah',{
        ...payload.notification,icon:new URL('icons/Icon-192.png',base).href,
        tag:payload.data?.inboxId || payload.messageId,
        // Same format as the SDK's own notification click handler.
        data:{FCM_MSG:{...payload,fcmOptions:{link:payload.data?.link || base.href}}}});
    });
    return {messaging,registration,vapidKey:config.vapidKey};
  }
  async function ready() {
    if (!initialized) initialized = setup().catch(error=>{initialized=null;throw error;});
    return initialized;
  }
  async function deviceToken() {
    if (disabled || Notification.permission !== 'granted') throw new Error('اسمح بالإشعارات من إعدادات المتصفح أولًا.');
    const state = await ready();
    const token = await state.messaging.getToken({vapidKey:state.vapidKey,serviceWorkerRegistration:state.registration});
    if (!token) throw new Error('لم يصدر FCM رمزًا لهذا المتصفح.');
    return token;
  }
  window.speBasrahFcmRequestPermission = async function() {
    if (!('Notification' in window)) throw new Error('افتح الموقع من الشاشة الرئيسية على iPhone لتفعيل الإشعارات.');
    // Request before any network or storage await to retain the user gesture.
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') return false;
    disabled = false;
    await deviceToken();
    return true;
  };
  window.speBasrahFcmOptIn = async () => { disabled=false; await deviceToken(); return true; };
  window.speBasrahFcmSubscriptionId = deviceToken;
  window.speBasrahFcmOptOut = async function() {
    disabled = true;
    localStorage.removeItem(membershipKey);
    try { await syncJob; } catch (_) {}
    // Clear the browser subscription even if Worker configuration is unavailable.
    if (initialized) { const state = await initialized; await state.messaging.deleteToken(); }
    else if ('serviceWorker' in navigator) {
      for (const reg of await navigator.serviceWorker.getRegistrations()) {
        if (!/\/firebase-messaging-sw\.js(?:\?|$)/.test(reg.active?.scriptURL || '')) continue;
        const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe();
      }
    }
  };
  window.speBasrahSyncStudentTags = function(stage,course,typesCsv) {
    const previous = syncJob || Promise.resolve();
    const run = previous.catch(()=>{}).then(async()=>{
      if (disabled || Notification.permission !== 'granted') return false;
      const token = await deviceToken();
      const contentTypes = [...new Set(typesCsv.split(',').filter(Boolean))].sort();
      const fingerprint = JSON.stringify({token,stage,course,contentTypes});
      if (localStorage.getItem(membershipKey) === fingerprint) return true;
      localStorage.removeItem(membershipKey);
      await jsonFetch('/fcm-web-topics',{token,stage,course,contentTypes});
      if (disabled) return false;
      localStorage.setItem(membershipKey,fingerprint);
      return true;
    });
    syncJob = run;
    return run;
  };
})();
