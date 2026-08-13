/**
 * =============================================================================
 *  HELIX PROJECT CONTROL — V2 & V3 Backend (Google Apps Script)
 * =============================================================================
 *  CÁCH CÀI ĐẶT:
 *  1. Mở Google Sheet dự án (đã có các tab dữ liệu, xem seed/*.xlsx mẫu).
 *  2. Menu: Tiện ích mở rộng (Extensions) > Apps Script.
 *  3. Xoá hết code mẫu, dán TOÀN BỘ nội dung file này vào.
 *  4. Bấm "Triển khai" (Deploy) > "Triển khai mới" (New deployment):
 *       - Loại (Type): Web app
 *       - Execute as: Me (tài khoản của bạn)
 *       - Who has access: Anyone  (để tool web truy cập được)
 *  5. Copy link kết thúc bằng "/exec", dán vào API_URL trong js/config.js
 *     (ở phía frontend).
 *  6. Mỗi khi sửa code này, phải "Triển khai" lại phiên bản mới (Manage
 *     deployments > Edit > New version) thì link mới nhận code mới.
 *
 *  KHÔNG cần sửa file này khi nhân rộng dự án — chỉ cần cấu trúc Sheet đúng
 *  quy tắc (xem README.md): mỗi tab = 1 module, dòng 1 = tên cột, cột "ID"
 *  sẽ được tool tự thêm nếu chưa có.
 * =============================================================================
 */

const ID_COL = 'ID';

// PHẢI TRÙNG với ACCESS_TOKEN trong js/config.js (frontend). Đổi giá trị này
// và deploy lại (Manage deployments > Edit > New version) để áp dụng.
const ACCESS_TOKEN = 'hpc-secret-8f3a1c';

function doGet(e) {
  try {
    if (e.parameter.token !== ACCESS_TOKEN) return jsonOut_({ error: 'Unauthorized' });
    const action = (e.parameter.action || 'all');
    let result;
    if (action === 'meta') result = getMeta_();
    else if (action === 'schema') result = getSchema_(e.parameter.sheet);
    else if (action === 'list') result = getList_(e.parameter.sheet);
    else if (action === 'all') result = getAll_();
    else if (action === 'check_update') result = checkUpdate_();
    else result = { error: 'Unknown action: ' + action };
    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.token !== ACCESS_TOKEN) return jsonOut_({ error: 'Unauthorized' });
    const action = body.action;
    let result;
    if (action === 'upsert') result = upsertRow_(body.sheet, body.data);
    else if (action === 'delete') result = deleteRow_(body.sheet, body.id);
    else if (action === 'deleteGroup') result = deleteGroup_(body.sheet, body.groupColumn, body.groupValue);
    else if (action === 'renameGroup') result = renameGroup_(body.sheet, body.groupColumn, body.oldValue, body.newValue);
    else if (action === 'upload') result = uploadFile_(body.filename, body.mimeType, body.base64);
    else result = { error: 'Unknown action: ' + action };
    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

/* ------------------------------- ĐỌC METADATA ------------------------------- */

function getMeta_() {
  const sheets = ss_().getSheets().map(sh => sh.getName()).filter(n => n.indexOf('_') !== 0);
  return { sheets: sheets };
}

function getSheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Không tìm thấy tab Sheet tên: ' + name);
  return sh;
}

function getHeaders_(sh) {
  const lastCol = sh.getLastColumn();
  if (lastCol === 0) return [];
  return sh.getRange(1, 1, 1, lastCol).getValues()[0].filter(h => String(h).trim() !== '');
}

// Tự thêm cột ID (đầu tiên) nếu Sheet chưa có — dùng làm khoá định danh ổn định
// cho từng dòng dữ liệu, không phụ thuộc số thứ tự dòng (an toàn khi xoá/thêm).
function ensureIdColumn_(sh) {
  const headers = getHeaders_(sh);
  if (headers.indexOf(ID_COL) === -1) {
    sh.insertColumnBefore(1);
    sh.getRange(1, 1).setValue(ID_COL);
    // gán ID cho các dòng dữ liệu đã có sẵn (nếu có) để không bị mất liên kết
    const lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      const ids = [];
      for (let i = 0; i < lastRow - 1; i++) ids.push([Utilities.getUuid()]);
      sh.getRange(2, 1, lastRow - 1, 1).setValues(ids);
    }
    return getHeaders_(sh);
  }
  return headers;
}

// Đọc dropdown (data validation dạng danh sách) đang gắn trên cột, nếu có, để
// frontend tự hiển thị dạng <select> mà không cần khai báo cứng trong config.js
function getColumnValidationOptions_(sh, colIndex) {
  try {
    const lastRow = Math.max(sh.getLastRow(), 2);
    const rule = sh.getRange(2, colIndex + 1).getDataValidation();
    if (!rule) return null;
    const crit = rule.getCriteriaType();
    if (crit === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      const args = rule.getCriteriaValues();
      return args[0] || null;
    }
    if (crit === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
      const range = rule.getCriteriaValues()[0];
      return range.getValues().flat().filter(v => v !== '');
    }
  } catch (e) { /* không có validation */ }
  return null;
}

function getSchema_(sheetName) {
  const sh = getSheet_(sheetName);
  const headers = ensureIdColumn_(sh);
  const columns = headers.map((h, i) => {
    const options = getColumnValidationOptions_(sh, i);
    return { key: h, validationOptions: options };
  });
  return { sheet: sheetName, columns: headers, columnMeta: columns };
}

/* --------------------------------- ĐỌC DỮ LIỆU --------------------------------- */

function rowsToObjects_(sh) {
  const headers = ensureIdColumn_(sh);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { columns: headers, rows: [] };
  const values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const rows = [];
  values.forEach(rowVals => {
    const obj = {};
    let hasContent = false;
    headers.forEach((h, ci) => {
      let v = rowVals[ci];
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      obj[h] = v;
      if (String(v).trim() !== '') hasContent = true;
    });
    if (!hasContent) return; // bỏ qua dòng trắng hoàn toàn
    rows.push(obj);
  });
  return { columns: headers, rows: rows };
}

function getList_(sheetName) {
  const sh = getSheet_(sheetName);
  const data = rowsToObjects_(sh);
  return { sheet: sheetName, columns: data.columns, rows: data.rows };
}

function getAll_() {
  const names = getMeta_().sheets;
  const out = {};
  names.forEach(n => {
    try { out[n] = getList_(n); } catch (e) { /* bỏ qua tab lỗi */ }
  });
  return { sheets: names, data: out };
}

/* --------------------------------- GHI DỮ LIỆU --------------------------------- */

function findRowIndexById_(sh, headers, id) {
  const idColIdx = headers.indexOf(ID_COL);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sh.getRange(2, idColIdx + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2; // số dòng thật trên Sheet
  }
  return -1;
}

function upsertRow_(sheetName, data) {
  const sh = getSheet_(sheetName);
  let headers = ensureIdColumn_(sh);

  // Nếu client gửi lên 1 cột chưa có trên Sheet -> tự thêm cột mới (linh động
  // thêm cột không cần vào tay chỉnh Sheet trước, dù khuyến khích làm trên Sheet).
  Object.keys(data).forEach(k => {
    if (headers.indexOf(k) === -1 && k !== ID_COL) {
      sh.insertColumnAfter(sh.getLastColumn());
      sh.getRange(1, sh.getLastColumn()).setValue(k);
      headers = getHeaders_(sh);
    }
  });

  let id = data[ID_COL];
  let rowIdx = id ? findRowIndexById_(sh, headers, id) : -1;
  const isNew = (!id || rowIdx === -1);
  if (isNew) {
    id = id || Utilities.getUuid();
    rowIdx = sh.getLastRow() + 1;
  }

  const rowValues = headers.map(h => (h === ID_COL ? id : (data[h] !== undefined ? data[h] : '')));
  // Giữ nguyên giá trị cũ cho các cột KHÔNG có trong data gửi lên (cập nhật từng phần)
  if (!isNew) {
    const existing = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
    headers.forEach((h, i) => { if (h !== ID_COL && data[h] === undefined) rowValues[i] = existing[i]; });
  }
  sh.getRange(rowIdx, 1, 1, headers.length).setValues([rowValues]);
  return { ok: true, id: id, row: rowIdx, created: isNew };
}

function deleteRow_(sheetName, id) {
  const sh = getSheet_(sheetName);
  const headers = ensureIdColumn_(sh);
  const rowIdx = findRowIndexById_(sh, headers, id);
  if (rowIdx === -1) return { ok: false, error: 'Không tìm thấy ID: ' + id };
  sh.deleteRow(rowIdx);
  return { ok: true };
}

function deleteGroup_(sheetName, groupColumn, groupValue) {
  const sh = getSheet_(sheetName);
  const headers = ensureIdColumn_(sh);
  const colIdx = headers.indexOf(groupColumn);
  if (colIdx === -1) return { ok: false, error: 'Không tìm thấy cột nhóm: ' + groupColumn };
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, deleted: 0 };
  const values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  let deleted = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][colIdx]) === String(groupValue)) { sh.deleteRow(i + 2); deleted++; }
  }
  return { ok: true, deleted: deleted };
}

function renameGroup_(sheetName, groupColumn, oldValue, newValue) {
  const sh = getSheet_(sheetName);
  const headers = ensureIdColumn_(sh);
  const colIdx = headers.indexOf(groupColumn);
  if (colIdx === -1) return { ok: false, error: 'Không tìm thấy cột nhóm: ' + groupColumn };
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, updated: 0 };
  const range = sh.getRange(2, colIdx + 1, lastRow - 1, 1);
  const values = range.getValues();
  let updated = 0;
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(oldValue)) { values[i][0] = newValue; updated++; }
  }
  range.setValues(values);
  return { ok: true, updated: updated };
}

/* --------------------------------- UPLOAD FILE --------------------------------- */
function uploadFile_(filename, mimeType, base64Data) {
  try {
    const folder = DriveApp.getRootFolder(); // Lưu trực tiếp vào thư mục gốc Drive của bạn
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, filename);
    const file = folder.createFile(blob);
    // Bật chia sẻ để ai có link cũng xem được (phục vụ việc xem lại minh chứng)
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok: true, url: file.getUrl() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* --------------------------------- PERFORMANCE GUARD --------------------------------- */
function checkUpdate_() {
  // Lấy thời điểm file Google Sheet được chỉnh sửa lần cuối (siêu nhẹ, không cần đọc data)
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const file = DriveApp.getFileById(ss.getId());
  return { lastUpdated: file.getLastUpdated().getTime() };
}