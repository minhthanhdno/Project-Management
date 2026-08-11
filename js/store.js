/* ==========================================================================
   HELIX PROJECT CONTROL — V2
   store.js — Bộ nhớ dữ liệu phía client + hàng đợi đồng bộ 2 chiều với Google
   Sheet. File này KHÔNG cần sửa khi nhân rộng dự án.

   Cơ chế đồng bộ 2 chiều:
   - PULL: khi tải trang & định kỳ mỗi AUTO_PULL_SECONDS giây, gọi API "all"
     để lấy dữ liệu mới nhất từ Google Sheet (phản ánh thay đổi từ AppSheet /
     người khác sửa trực tiếp trên Sheet).
   - PUSH: mọi chỉnh sửa trên giao diện được ghi ngay vào bộ nhớ local (mượt,
     không chờ mạng) rồi xếp vào hàng đợi, gộp theo dòng (debounce), gửi lên
     Google Sheet qua upsert(). Trong lúc chờ, dòng đang sửa sẽ không bị ghi
     đè bởi PULL định kỳ (xem `pendingIds`).
   ========================================================================== */

window.HPC_STORE = (function () {
  const cfg = () => window.HPC_CONFIG;
  const api = window.HPC_API;

  let SHEETS = {};          // { sheetName: { columns:[...], rows:[...] } }
  let pendingIds = new Set(); // ID các dòng đang có thay đổi chưa đồng bộ xong -> PULL sẽ không ghi đè
  let pushTimers = {};       // debounce timer theo id
  let listeners = [];        // callback re-render
  let syncState = "idle";    // idle | syncing | synced | error
  let lastError = null;
  let pullTimer = null;
  let lastActivityAt = Date.now(); // thời điểm người dùng tương tác gần nhất (gõ/click/chọn...)

  // Gọi hàm này mỗi khi người dùng tương tác (app.js gắn listener toàn trang).
  // Auto-pull sẽ hoãn lại cho tới khi im lặng đủ IDLE_MS liên tục, để không
  // render đè lên ô đang gõ dở (chưa kịp blur/lưu).
  function markActivity() { lastActivityAt = Date.now(); }

  function notify() { listeners.forEach(fn => fn()); }
  function onChange(fn) { listeners.push(fn); }
  function setSyncState(s, err) { syncState = s; lastError = err || null; notify(); }

  // Kênh riêng: CHỈ bắn khi auto-pull thực sự kéo về dữ liệu mới từ xa.
  // KHÔNG dùng chung với notify()/onChange() ở trên (vốn dùng để cập nhật
  // đèn trạng thái đồng bộ) để việc PUSH (lưu dòng mình vừa sửa/thêm) không
  // vô tình kích hoạt render lại toàn bảng và làm mất ô đang gõ dở.
  let dataListeners = [];
  function onDataChange(fn) { dataListeners.push(fn); }
  function notifyDataChange() { dataListeners.forEach(fn => fn()); }

  function getSheetData(sheetName) {
    return SHEETS[sheetName] || { columns: [], rows: [] };
  }

  function getAllSheetNames() { return Object.keys(SHEETS); }

  async function loadAll() {
    setSyncState("syncing");
    const res = await api.all();
    Object.keys(res.data).forEach(name => {
      const incoming = res.data[name];
      mergeIncoming(name, incoming);
    });
    setSyncState("synced");
    startAutoPull();
    return res;
  }

  // Trộn dữ liệu mới kéo về với dữ liệu local, KHÔNG ghi đè các dòng đang
  // chỉnh sửa dở (pendingIds) để tránh giật/mất thao tác người dùng.
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
    // giữ lại các dòng local mới thêm nhưng chưa kịp có trong lần pull này
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
    const idleMs = (cfg().AUTO_PULL_IDLE_SECONDS || 120) * 1000; // mặc định 2 phút
    const tickMs = Math.min(secs, 5) * 1000; // kiểm tra thường xuyên, nhưng chỉ THỰC SỰ pull khi đủ rảnh
    pullTimer = setInterval(async () => {
      if (Date.now() - lastActivityAt < idleMs) return; // còn đang tương tác -> bỏ qua lượt này
      try {
        const res = await api.all();
        Object.keys(res.data).forEach(name => mergeIncoming(name, res.data[name]));
        notifyDataChange(); // chỉ kênh này mới nên kích hoạt render lại toàn bảng
      } catch (e) { /* im lặng bỏ qua lỗi polling, giữ dữ liệu hiện có */ }
    }, tickMs);
  }

  function uid() { return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // Cập nhật 1 field của 1 dòng local ngay lập tức + xếp hàng đồng bộ lên server
  function updateField(sheetName, rowId, field, value) {
    const sheet = SHEETS[sheetName];
    if (!sheet) return;
    const row = sheet.rows.find(r => r.ID === rowId);
    if (!row) return;
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
    notify();
    setSyncState("syncing");
    api.remove(sheetName, rowId)
      .then(() => setSyncState("synced"))
      .catch(err => setSyncState("error", err.message));
  }

  function deleteGroup(sheetName, groupColumn, groupValue) {
    const sheet = SHEETS[sheetName];
    if (!sheet) return;
    sheet.rows = sheet.rows.filter(r => r[groupColumn] !== groupValue);
    notify();
    setSyncState("syncing");
    api.removeGroup(sheetName, groupColumn, groupValue)
      .then(() => setSyncState("synced"))
      .catch(err => setSyncState("error", err.message));
  }

  function renameGroup(sheetName, groupColumn, oldValue, newValue) {
    const sheet = SHEETS[sheetName];
    if (!sheet) return;
    sheet.rows.forEach(r => { if (r[groupColumn] === oldValue) r[groupColumn] = newValue; });
    notify();
    setSyncState("syncing");
    api.renameGroup(sheetName, groupColumn, oldValue, newValue)
      .then(() => setSyncState("synced"))
      .catch(err => setSyncState("error", err.message));
  }

  // Gộp nhiều lần sửa liên tiếp trên cùng 1 dòng thành 1 lần gọi API (debounce)
  function queuePush(sheetName, row) {
    pendingIds.add(row.ID);
    setSyncState("syncing");
    clearTimeout(pushTimers[row.ID]);
    pushTimers[row.ID] = setTimeout(async () => {
      try {
        await api.upsert(sheetName, row);
        pendingIds.delete(row.ID);
        if (pendingIds.size === 0) setSyncState("synced");
      } catch (err) {
        setSyncState("error", err.message);
      }
    }, cfg().PUSH_DEBOUNCE_MS);
  }

  async function forceFlush() {
    // đẩy ngay tất cả các timer đang chờ (dùng khi người dùng bấm "Đồng bộ ngay")
    Object.keys(pushTimers).forEach(id => clearTimeout(pushTimers[id]));
    pushTimers = {};
    const jobs = [];
    Object.keys(SHEETS).forEach(sheetName => {
      SHEETS[sheetName].rows.forEach(r => {
        if (pendingIds.has(r.ID)) jobs.push(api.upsert(sheetName, r).then(() => pendingIds.delete(r.ID)));
      });
    });
    setSyncState("syncing");
    try {
      await Promise.all(jobs);
      setSyncState("synced");
    } catch (err) {
      setSyncState("error", err.message);
    }
  }

  return {
    loadAll, onChange, onDataChange, getSheetData, getAllSheetNames,
    updateField, addRow, deleteRow, deleteGroup, renameGroup, forceFlush, markActivity,
    get syncState() { return syncState; },
    get lastError() { return lastError; },
    get pendingCount() { return pendingIds.size; },
  };
})();
