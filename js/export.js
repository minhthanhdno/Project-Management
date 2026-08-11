/* ==========================================================================
   HELIX PROJECT CONTROL — V2
   export.js — Xuất báo cáo Excel từ dữ liệu hiện có trong bộ nhớ (đã đồng bộ
   từ Google Sheet). Dùng thư viện SheetJS nhúng sẵn ở js/vendor/xlsx.full.min.js
   (không phụ thuộc CDN ngoài, chạy tốt cả trong mạng nội bộ có tường lửa).
   File này KHÔNG cần sửa khi nhân rộng dự án.
   ========================================================================== */

window.HPC_EXPORT = (function () {
  const store = window.HPC_STORE;
  const engine = window.HPC_ENGINE;

  function exportExcel(modules) {
    if (typeof XLSX === "undefined") { alert("Thư viện xuất Excel chưa sẵn sàng."); return; }
    const wb = XLSX.utils.book_new();
    modules.forEach(m => {
      if (m.kind !== "table" && m.kind !== "calendar") return;
      const data = store.getSheetData(m.sheet);
      const columns = engine.resolveColumns(m, data.columns);
      const rows = data.rows.map(r => {
        const o = {};
        columns.forEach(c => {
          let v = r[c.key];
          if (c.type === "checkbox") v = (v === true || v === "true" || v === "TRUE") ? "Có" : "Không";
          o[c.label] = v === undefined || v === null ? "" : v;
        });
        return o;
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const safeName = (m.label || m.sheet).replace(/[\[\]\*\/\\\?:]/g, "").slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, safeName || m.sheet);
    });
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, "HPC_BaoCao_" + today + ".xlsx");
  }

  return { exportExcel };
})();
