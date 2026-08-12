/* ==========================================================================
   HELIX PROJECT CONTROL — V2
   api.js — Lớp giao tiếp với Google Apps Script Web App (backend/Code.gs).
   File này KHÔNG cần sửa khi nhân rộng dự án (chỉ cần đổi API_URL ở config.js).
   ========================================================================== */

window.HPC_API = (function () {
  const BASE = () => window.HPC_CONFIG.API_URL;

  async function get(params) {
    const url = new URL(BASE());
    Object.keys(params || {}).forEach(k => url.searchParams.set(k, params[k]));
    url.searchParams.set("token", window.HPC_CONFIG.ACCESS_TOKEN); // Phương án 4
    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (json && json.error) throw new Error(json.error);
    return json;
  }

  // Gửi POST dạng text/plain để tránh CORS-preflight (Apps Script không xử lý
  // OPTIONS request). Server vẫn JSON.parse(e.postData.contents) bình thường.
  async function post(body) {
    const res = await fetch(BASE(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({}, body, { token: window.HPC_CONFIG.ACCESS_TOKEN })), // Phương án 4
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (json && json.error) throw new Error(json.error);
    return json;
  }

  return {
    // Lấy danh sách toàn bộ tab (sheet) hiện có trong Google Sheet
    meta() { return get({ action: "meta" }); },

    // Lấy cấu trúc cột (+ dropdown validation nếu có) của 1 sheet
    schema(sheet) { return get({ action: "schema", sheet }); },

    // Lấy toàn bộ dữ liệu của 1 sheet
    list(sheet) { return get({ action: "list", sheet }); },

    // Lấy toàn bộ dữ liệu của TẤT CẢ sheet trong 1 lần gọi (dùng khi tải trang)
    all() { return get({ action: "all" }); },

    // Thêm mới / cập nhật 1 dòng. data phải có ID nếu là cập nhật; nếu tạo mới
    // để trống ID, server sẽ tự sinh UUID và trả về trong kết quả.
    upsert(sheet, data) { return post({ action: "upsert", sheet, data }); },

    // Xoá 1 dòng theo ID
    remove(sheet, id) { return post({ action: "delete", sheet, id }); },

    // Xoá toàn bộ các dòng có groupColumn === groupValue (xoá cả 1 giai đoạn/nhóm)
    removeGroup(sheet, groupColumn, groupValue) {
      return post({ action: "deleteGroup", sheet, groupColumn, groupValue });
    },

    // Đổi tên 1 giai đoạn/nhóm (cập nhật tất cả dòng có groupColumn === oldValue)
    renameGroup(sheet, groupColumn, oldValue, newValue) {
      return post({ action: "renameGroup", sheet, groupColumn, oldValue, newValue });
    },
    upload(filename, mimeType, base64) {
      return post({ action: "upload", filename, mimeType, base64 });
    }
  };
})();
