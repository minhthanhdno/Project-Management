/* ==========================================================================
   HELIX PROJECT CONTROL — V2 & V3
   store.js — Bộ nhớ dữ liệu phía client + hàng đợi đồng bộ 2 chiều
   ========================================================================== */

window.HPC_STORE = (function () {
  const cfg = () => window.HPC_CONFIG;
  const api = window.HPC_API;

  let SHEETS = {};          
  let pendingIds = new Set(); 
  let pendingUpdates = {};   // THÊM MỚI: Giỏ hàng chứa dữ liệu sửa chưa đồng bộ
  let listeners = [];        
  let syncState = "idle";    
  let lastError = null;
  let pullTimer = null;
  let pushTimer = null;      // THÊM MỚI: Hẹn giờ 5 phút lưu 1 lần
  let lastActivityAt = Date.now(); 

  let lastSyncServerTime = 0; 
  let loadedSheets = new Set(); 

  function markActivity() { lastActivityAt = Date.now(); }
  function notify() { listeners.forEach(fn => fn()); }
  function onChange(fn) { listeners.push(fn); }
  function setSyncState(s, err) { syncState = s; lastError = err || null; notify(); }

  let dataListeners = [];
  function onDataChange(fn) { dataListeners.push(fn); }
  function notifyDataChange() { dataListeners.forEach(fn => fn()); }

  function getSheetData(sheetName) {
    return SHEETS[sheetName] || { columns: [], rows: [] };
  }
  function getAllSheetNames() { return Object.keys(SHEETS); }

  async function fetchMetaAndInit() {
    setSyncState("syncing");
    const res = await api.meta();
    res.sheets.forEach(s => { if(!SHEETS[s]) SHEETS[s] = { columns:[], rows:[] }; });
    
    // Kích hoạt bộ hẹn giờ lưu tự động lên Cloud mỗi 5 phút
    if (pushTimer) clearInterval(pushTimer);
    pushTimer = setInterval(() => {
      if (pendingIds.size > 0) forceFlush();
    }, 5 * 60 * 1000); // 5 phút * 60s * 1000ms

    return res;
  }

  async function loadSheet(sheetName) {
    if (loadedSheets.has(sheetName)) return;
    setSyncState("syncing");
    try {
      const res = await api.list(sheetName);
      mergeIncoming(sheetName, res);
      loadedSheets.add(sheetName);
      notifyDataChange();
      setSyncState("synced");
    } catch (err) {
      setSyncState("error", err.message);
      throw err;
    }
  }

  async function backgroundLoadAll(moduleList) {
    for (let m of moduleList) {
      if (!loadedSheets.has(m.sheet)) {
        try {
          const res = await api.list(m.sheet);
          mergeIncoming(m.sheet, res);
          loadedSheets.add(m.sheet);
          notifyDataChange();
        } catch(e) {
          console.warn("Lỗi tải nền " + m.sheet, e);
        }
      }
    }
    try {
      const check = await api.checkUpdate();
      if (check && check.lastUpdated) lastSyncServerTime = check.lastUpdated;
    } catch(e){}
    
    startAutoPull();
    setSyncState("synced");
  }

  function mergeIncoming(sheetName, incoming) {
    const current = SHEETS[sheetName];
    if (!current) {
      SHEETS[sheetName] = incoming;
      return;
    }
    const localById = {};
    current.rows.forEach(r => { if (r.ID) localById[r.ID] = r; });
    const mergedRows = incoming.rows.map(r => {
      if (r.ID && pendingIds.has(r.ID) && localById[r.ID]) return localById[r.ID];
      return r;
    });
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
    const tickMs = secs * 1000; 
    
    pullTimer = setInterval(async () => {
      if (Date.now() - lastActivityAt < idleMs) return; 
      try {
        const check = await api.checkUpdate();
        if (check && check.lastUpdated && check.lastUpdated > lastSyncServerTime) {
          for (let sheet of loadedSheets) {
            try {
              const res = await api.list(sheet);
              mergeIncoming(sheet, res);
            } catch(e) {}
          }
          lastSyncServerTime = check.lastUpdated;
          notifyDataChange(); 
        }
      } catch (e) {}
    }, tickMs);
  }

  function uid() { return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

 // 1. ÁP DỤNG DIRTY CHECK
  function updateField(sheetName, rowId, field, value) {
    const sheet = SHEETS[sheetName];
    if (!sheet) return;
    const row = sheet.rows.find(r => r.ID === rowId);
    if (!row) return;
    
    // DIRTY CHECK: Nếu giá trị gõ vào giống hệt giá trị cũ -> Bỏ qua, không đưa vào giỏ hàng chờ lưu
    if (String(row[field]) === String(value)) return; 
    
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
    notify();
    setSyncState("syncing");
    api.remove(sheetName, rowId).then(() => setSyncState("synced")).catch(err => setSyncState("error", err.message));
  }

  function deleteGroup(sheetName, groupColumn, groupValue) {
    const sheet = SHEETS[sheetName];
    if (!sheet) return;
    sheet.rows = sheet.rows.filter(r => r[groupColumn] !== groupValue);
    notify();
    setSyncState("syncing");
    api.removeGroup(sheetName, groupColumn, groupValue).then(() => setSyncState("synced")).catch(err => setSyncState("error", err.message));
  }

  function renameGroup(sheetName, groupColumn, oldValue, newValue) {
    const sheet = SHEETS[sheetName];
    if (!sheet) return;
    sheet.rows.forEach(r => { if (r[groupColumn] === oldValue) r[groupColumn] = newValue; });
    notify();
    setSyncState("syncing");
    api.renameGroup(sheetName, groupColumn, oldValue, newValue).then(() => setSyncState("synced")).catch(err => setSyncState("error", err.message));
  }

  // CƠ CHẾ GOM NHÓM (BATCHING) - KHÔNG GỬI API NGAY LẬP TỨC NỮA
  function queuePush(sheetName, row) {
    pendingIds.add(row.ID);
    pendingUpdates[`${sheetName}_${row.ID}`] = { sheet: sheetName, row: row };
    setSyncState("pending"); // Đổi trạng thái UI thành "Đang chờ"
  }

  // HÀM NÀY SẼ LẤY TOÀN BỘ GIỎ HÀNG ĐẨY LÊN CLOUD CÙNG 1 LÚC
 async function forceFlush() {
    if (pendingIds.size === 0) return;
    setSyncState("syncing");
    
    // Gom tất cả các dòng đang chờ thành 1 mảng Payload duy nhất
    const payloads = Object.values(pendingUpdates).map(job => ({
      sheet: job.sheet, 
      data: job.row 
    }));

    try {
      // Gửi ĐÚNG 1 REQUEST lên server
      const res = await api.batchUpsert(payloads);
      
      if (res && res.ok) {
        // Dọn dẹp giỏ hàng sau khi đẩy thành công
        pendingIds.clear();
        pendingUpdates = {};
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