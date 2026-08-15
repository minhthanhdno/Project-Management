/* ==========================================================================
   HELIX PROJECT CONTROL — V3 (OFFLINE-FIRST HYBRID)
   store.js — Bộ nhớ dữ liệu In-Memory + IndexedDB cục bộ + Đồng bộ Google Sheets
   ========================================================================== */

window.HPC_STORE = (function () {
  const cfg = () => window.HPC_CONFIG;
  const api = window.HPC_API;

  // --- DATABASE LOCAL TRÌNH DUYỆT (INDEXEDDB) ---
  const DB_NAME = "HelixLocalDB";
  const DB_VERSION = 1;
  let localDB = null;

  const IDB = {
    init: () => new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("sheets")) db.createObjectStore("sheets");
        if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue");
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    }),
    get: (storeName, key) => new Promise(resolve => {
      if (!localDB) return resolve(null);
      const req = localDB.transaction(storeName, "readonly").objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    }),
    set: (storeName, key, value) => new Promise(resolve => {
      if (!localDB) return resolve();
      const tx = localDB.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => resolve();
    })
  };

  // --- BỘ NHỚ RAM (IN-MEMORY) ĐỂ RENDER UI TỨC THÌ ---
  let SHEETS = {};          
  let pendingIds = new Set(); 
  let pendingUpdates = {};   
  let listeners = [];        
  let syncState = "idle";    
  let lastError = null;
  let pullTimer = null;
  let pushTimer = null;      
  let lastActivityAt = Date.now(); 
  let lastSyncServerTime = 0; 
  let loadedSheets = new Set(); 
  let dataListeners = [];

  function markActivity() { lastActivityAt = Date.now(); }
  function notify() { listeners.forEach(fn => fn()); }
  function onChange(fn) { listeners.push(fn); }
  function onDataChange(fn) { dataListeners.push(fn); }
  function notifyDataChange() { dataListeners.forEach(fn => fn()); }
  function setSyncState(s, err) { syncState = s; lastError = err || null; notify(); }
  function getSheetData(sheetName) { return SHEETS[sheetName] || { columns: [], rows: [] }; }
  function getAllSheetNames() { return Object.keys(SHEETS); }

  // --- LƯU TRẠNG THÁI OFFLINE XUỐNG LOCAL DB ---
  async function persistLocalState(sheetName) {
    if (sheetName && SHEETS[sheetName]) await IDB.set("sheets", sheetName, SHEETS[sheetName]);
    await IDB.set("queue", "pendingQueue", { ids: Array.from(pendingIds), updates: pendingUpdates });
  }

  // --- KHỞI ĐỘNG HỆ THỐNG ---
  async function fetchMetaAndInit() {
    try { localDB = await IDB.init(); } catch (e) { console.warn("Lỗi IndexedDB:", e); }

    // 1. Phục hồi giỏ hàng chưa đồng bộ từ lần tắt máy trước
    const savedQueue = await IDB.get("queue", "pendingQueue");
    if (savedQueue) {
      pendingIds = new Set(savedQueue.ids || []);
      pendingUpdates = savedQueue.updates || {};
      if (pendingIds.size > 0) setSyncState("pending");
    }

    // 2. Lấy danh sách Sheet từ Cloud
    setSyncState("syncing");
    const res = await api.meta();
    res.sheets.forEach(s => { if(!SHEETS[s]) SHEETS[s] = { columns:[], rows:[] }; });
    
    if (pushTimer) clearInterval(pushTimer);
    pushTimer = setInterval(() => { if (pendingIds.size > 0) forceFlush(); }, 5 * 60 * 1000);

    return res;
  }

  // --- TẢI DỮ LIỆU ĐA TẦNG (HYBRID LOAD) ---
  async function loadSheet(sheetName) {
    if (loadedSheets.has(sheetName)) return;

    // TẦNG 1: Render ngay lập tức bằng dữ liệu Local (0ms latency)
    const localData = await IDB.get("sheets", sheetName);
    if (localData) {
      SHEETS[sheetName] = localData;
      loadedSheets.add(sheetName);
      notifyDataChange();
    }

    // TẦNG 2: Bắt đầu tải ngầm từ Cloud và hợp nhất
    setSyncState("syncing");
    try {
      const res = await api.list(sheetName);
      mergeIncoming(sheetName, res);
      loadedSheets.add(sheetName);
      await persistLocalState(sheetName); // Backup xuống Local
      notifyDataChange();
      setSyncState("synced");
    } catch (err) {
      setSyncState("error", err.message);
    }
  }

  async function backgroundLoadAll(moduleList) {
    // Ưu tiên nạp toàn bộ Local Data lên Dashboard trước
    for (let m of moduleList) {
      if (!loadedSheets.has(m.sheet)) {
        const localData = await IDB.get("sheets", m.sheet);
        if (localData) {
          SHEETS[m.sheet] = localData;
          loadedSheets.add(m.sheet);
        }
      }
    }
    notifyDataChange();

    // Tải ngầm những sheet chưa có local hoặc hợp nhất bản mới từ server
    for (let m of moduleList) {
      try {
        const res = await api.list(m.sheet);
        mergeIncoming(m.sheet, res);
        await persistLocalState(m.sheet);
        notifyDataChange();
      } catch(e) {}
    }
    
    try {
      const check = await api.checkUpdate();
      if (check && check.lastUpdated) lastSyncServerTime = check.lastUpdated;
    } catch(e){}
    
    startAutoPull();
    setSyncState("synced");
  }

  // Cập nhật thông minh: Ưu tiên giữ lại dữ liệu đang nằm trong giỏ hàng (chưa push)
  function mergeIncoming(sheetName, incoming) {
    const current = SHEETS[sheetName];
    if (!current) { SHEETS[sheetName] = incoming; return; }
    
    const localById = {};
    current.rows.forEach(r => { if (r.ID) localById[r.ID] = r; });
    
    const mergedRows = incoming.rows.map(r => {
      // Nếu dòng này đang nằm trong giỏ hàng chờ đẩy lên, tuyệt đối giữ nguyên giá trị Local
      if (r.ID && pendingIds.has(r.ID) && localById[r.ID]) return localById[r.ID];
      return r;
    });
    
    // Bổ sung các dòng tạo mới ở Local nhưng chưa lên Cloud
    current.rows.forEach(r => {
      if (r.ID && pendingIds.has(r.ID) && !incoming.rows.find(x => x.ID === r.ID)) {
        mergedRows.push(r);
      }
    });
    SHEETS[sheetName] = { columns: incoming.columns, rows: mergedRows };
  }

  function startAutoPull() {
    if (pullTimer) clearInterval(pullTimer);
    const secs = cfg().AUTO_PULL_SECONDS;
    if (!secs || secs <= 0) return;
    const idleMs = (cfg().AUTO_PULL_IDLE_SECONDS || 120) * 1000;
    
    pullTimer = setInterval(async () => {
      if (Date.now() - lastActivityAt < idleMs) return; 
      try {
        const check = await api.checkUpdate();
        if (check && check.lastUpdated && check.lastUpdated > lastSyncServerTime) {
          for (let sheet of loadedSheets) {
            try {
              const res = await api.list(sheet);
              mergeIncoming(sheet, res);
              await persistLocalState(sheet);
            } catch(e) {}
          }
          lastSyncServerTime = check.lastUpdated;
          notifyDataChange(); 
        }
      } catch (e) {}
    }, secs * 1000);
  }

  function uid() { return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // --- CÁC HÀM THAO TÁC DỮ LIỆU (DIRTY CHECK + BATCHING) ---
  function updateField(sheetName, rowId, field, value) {
    const sheet = SHEETS[sheetName];
    if (!sheet) return;
    const row = sheet.rows.find(r => r.ID === rowId);
    if (!row) return;
    
    if (String(row[field]) === String(value)) return; // Dirty check
    row[field] = value;
    queuePush(sheetName, row);
  }

  function addRow(sheetName, initial) {
    const sheet = SHEETS[sheetName];
    if (!sheet) return null;
    const row = Object.assign({ ID: uid() }, initial);
    sheet.columns.forEach(c => { if (!(c in row)) row[c] = ""; });
    sheet.rows.push(row);
    queuePush(sheetName, row);
    notify();
    return row;
  }

  function deleteRow(sheetName, rowId) {
    const sheet = SHEETS[sheetName];
    if (!sheet) return;
    sheet.rows = sheet.rows.filter(r => r.ID !== rowId);
    
    pendingIds.delete(rowId);
    if (pendingUpdates[`${sheetName}_${rowId}`]) delete pendingUpdates[`${sheetName}_${rowId}`];
    persistLocalState(sheetName);
    
    notify();
    setSyncState("syncing");
    api.remove(sheetName, rowId).then(() => setSyncState("synced")).catch(err => setSyncState("error", err.message));
  }

  function deleteGroup(sheetName, groupColumn, groupValue) {
    const sheet = SHEETS[sheetName];
    if (!sheet) return;
    sheet.rows = sheet.rows.filter(r => r[groupColumn] !== groupValue);
    persistLocalState(sheetName);
    notify();
    setSyncState("syncing");
    api.removeGroup(sheetName, groupColumn, groupValue).then(() => setSyncState("synced")).catch(err => setSyncState("error", err.message));
  }

  function renameGroup(sheetName, groupColumn, oldValue, newValue) {
    const sheet = SHEETS[sheetName];
    if (!sheet) return;
    sheet.rows.forEach(r => { if (r[groupColumn] === oldValue) r[groupColumn] = newValue; });
    persistLocalState(sheetName);
    notify();
    setSyncState("syncing");
    api.renameGroup(sheetName, groupColumn, oldValue, newValue).then(() => setSyncState("synced")).catch(err => setSyncState("error", err.message));
  }

  function queuePush(sheetName, row) {
    pendingIds.add(row.ID);
    pendingUpdates[`${sheetName}_${row.ID}`] = { sheet: sheetName, row: row };
    persistLocalState(sheetName); // Backup thay đổi xuống IndexedDB ngay lập tức
    setSyncState("pending"); 
  }

  // Đẩy toàn bộ thay đổi lên Google Sheets bằng Batch Request
  async function forceFlush() {
    if (pendingIds.size === 0) return;
    setSyncState("syncing");
    
    const payloads = Object.values(pendingUpdates).map(job => ({ sheet: job.sheet, data: job.row }));

    try {
      const res = await api.batchUpsert(payloads);
      if (res && res.ok) {
        pendingIds.clear();
        pendingUpdates = {};
        await persistLocalState(null); // Xóa giỏ hàng trong IndexedDB
        setSyncState("synced");
      } else {
        throw new Error(res.error || "Lỗi xử lý lô trên server");
      }
    } catch (err) {
      setSyncState("error", err.message);
    }
  }

  return {
    fetchMetaAndInit, loadSheet, backgroundLoadAll, isLoaded: (s) => loadedSheets.has(s),
    onChange, onDataChange, getSheetData, getAllSheetNames,
    updateField, addRow, deleteRow, deleteGroup, renameGroup, forceFlush, markActivity,
    get syncState() { return syncState; },
    get lastError() { return lastError; },
    get pendingCount() { return pendingIds.size; },
  };
})();