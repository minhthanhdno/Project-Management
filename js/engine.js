/* ==========================================================================
   HELIX PROJECT CONTROL — V2
   engine.js — Bộ máy hiển thị dùng chung cho MỌI module (bảng dữ liệu +
   Dashboard). File này KHÔNG cần sửa khi nhân rộng dự án hoặc thêm/bớt cột.

   Nguyên tắc: mọi bảng chỉ là {columns, rows}. Cột hiển thị lấy từ
   module.columns (nếu khai báo ở config.js) hoặc tự suy luận kiểu dữ liệu từ
   tên cột + dữ liệu mẫu (inferColumn). Nhờ vậy thêm/bớt cột trên Google Sheet
   sẽ tự phản ánh lên giao diện mà không cần sửa code.
   ========================================================================== */

window.HPC_ENGINE = (function () {
  const store = window.HPC_STORE;
  let COLLAPSED = {};
  let CAL_STATE = { mode: "day", anchorDate: null }; // giữ trạng thái Ngày/Tuần/Danh sách qua các lần render lại (giống COLLAPSED)

  function esc(s) { return (s === undefined || s === null) ? "" : String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function toNum(v, d) { const n = parseFloat(v); return isNaN(n) ? d : n; }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function fmtDate(s) { if (!s) return ""; const d = new Date(s + "T00:00:00"); if (isNaN(d)) return s; return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }); }

  /* --------------------------- suy luận cột tự động --------------------------- */
  function inferColumn(headerName) {
    const h = headerName.toLowerCase();
    if (h === "id") return null; // cột nội bộ, không hiển thị
    if (/(done|xong|hoàn thành|confirm|xác nhận)/i.test(h)) return { key: headerName, label: headerName, type: "checkbox", width: "70px" };
    if (/(date|ngày|due|hạn|start|end|bắt đầu)/i.test(h)) return { key: headerName, label: headerName, type: "date" };
    if (/(pct|percent|%)/i.test(h)) return { key: headerName, label: headerName, type: "percent", width: "64px" };
    return { key: headerName, label: headerName, type: "text" };
  }

  // Kết hợp cấu hình module.columns (nếu có) với cột thực tế đang có trên Sheet:
  // - Cột có trong config: dùng đúng type/label/options đã khai báo.
  // - Cột có trên Sheet nhưng KHÔNG khai báo trong config: tự suy luận, thêm vào cuối.
  // - Cột khai báo trong config nhưng Sheet chưa có: bỏ qua (Sheet là nguồn thật).
  function resolveColumns(moduleCfg, sheetColumns) {
    const declared = (moduleCfg.columns || []).filter(c => sheetColumns.includes(c.key));
    const declaredKeys = declared.map(c => c.key);
    const skip = ["ID"].concat(moduleCfg.groupByColumn ? [moduleCfg.groupByColumn] : []).concat(moduleCfg.hiddenColumns || []);
    const extra = sheetColumns.filter(c => !skip.includes(c) && !declaredKeys.includes(c)).map(inferColumn).filter(Boolean);
    return declared.concat(extra);
  }

  function contractorMatches(str, who) {
    if (!str) return false;
    if (/tất cả|toàn bộ liên danh|cả 3 nhà thầu|cả liên danh/i.test(str)) return true;
    return str.toLowerCase().includes(String(who).toLowerCase());
  }

  function uniqueValues(rows, key) {
    const seen = [];
    rows.forEach(r => { const v = r[key]; if (v && !seen.includes(v)) seen.push(v); });
    return seen;
  }

  function pctColor(p) {
    if (p >= 80) return "var(--green-500)";
    if (p >= 40) return "var(--teal-500)";
    if (p >= 15) return "var(--amber-500)";
    return "var(--red-500)";
  }

  function badgeColor(colorName) {
    return { green: "b-green", amber: "b-amber", red: "b-red", gray: "b-gray", blue: "b-blue" }[colorName] || "b-gray";
  }

  /* ================================ TABLE VIEW ================================ */
  function renderTable(root, moduleCfg, roleFilter) {
    const sheetData = store.getSheetData(moduleCfg.sheet);
    const columns = resolveColumns(moduleCfg, sheetData.columns);

    const wrap = document.createElement("div");
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";

    let search = "";
    let contractorChip = null;
    let statusChip = "ALL";

    const roleChipsHtml = moduleCfg.ownerColumn
      ? window.HPC_CONFIG.ROLE_OPTIONS.map(c => `<span class="filter-chip" data-c="${esc(c)}">${esc(c)}</span>`).join("")
      : "";
    const statusChipsHtml = moduleCfg.filterColumn
      ? `<span class="filter-chip active" data-s="ALL">Tất cả</span>` +
        (moduleCfg.filterOptions || uniqueValues(sheetData.rows, moduleCfg.filterColumn))
          .map(s => `<span class="filter-chip" data-s="${esc(s)}">${esc(s)}</span>`).join("")
      : "";

    toolbar.innerHTML = `
      <input class="search-box" placeholder="🔍 Tìm theo nội dung...">
      ${roleChipsHtml}${statusChipsHtml}
      <span class="spacer" style="flex:1"></span>
      ${moduleCfg.groupByColumn ? `<button class="btn sm" data-act="add-group">+ Thêm nhóm</button>` : `<button class="btn sm" data-act="add-row">+ Thêm dòng</button>`}
    `;
    wrap.appendChild(toolbar);
    const host = document.createElement("div");
    wrap.appendChild(host);
    root.appendChild(wrap);

    function filteredRows() {
      let rows = sheetData.rows.slice();
      if (roleFilter && roleFilter !== "ALL" && moduleCfg.ownerColumn) {
        rows = rows.filter(r => contractorMatches(r[moduleCfg.ownerColumn], roleFilter));
      }
      if (contractorChip) rows = rows.filter(r => contractorMatches(r[moduleCfg.ownerColumn], contractorChip));
      if (moduleCfg.filterColumn && statusChip !== "ALL") rows = rows.filter(r => r[moduleCfg.filterColumn] === statusChip);
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(s));
      }
      if (moduleCfg.defaultSort) {
        const [key, dir] = moduleCfg.defaultSort.split(":");
        rows.sort((a, b) => (dir === "desc" ? 1 : -1) * String(a[key] || "").localeCompare(String(b[key] || "")));
      }
      return rows;
    }

    function draw() {
      const rows = filteredRows();
      host.innerHTML = "";
      if (moduleCfg.groupByColumn) {
        const groups = uniqueValues(sheetData.rows, moduleCfg.groupByColumn);
        uniqueValues(rows, moduleCfg.groupByColumn).forEach(g => { if (!groups.includes(g)) groups.push(g); });
        if (!groups.length) { host.innerHTML = `<div class="card"><div class="empty-note">Chưa có dữ liệu. Bấm "+ Thêm nhóm" để bắt đầu.</div></div>`; return; }
        groups.forEach(g => {
          const items = rows.filter(r => r[moduleCfg.groupByColumn] === g);
          if (!items.length && (search || contractorChip || statusChip !== "ALL")) return;
          host.appendChild(buildGroupBlock(moduleCfg, columns, g, items));
        });
      } else {
        host.appendChild(buildFlatTable(moduleCfg, columns, rows));
      }
    }

    toolbar.querySelector(".search-box").oninput = e => { search = e.target.value; draw(); };
    toolbar.querySelectorAll("[data-c]").forEach(chip => {
      chip.onclick = () => {
        contractorChip = contractorChip === chip.dataset.c ? null : chip.dataset.c;
        toolbar.querySelectorAll("[data-c]").forEach(x => x.classList.toggle("active", x.dataset.c === contractorChip));
        draw();
      };
    });
    toolbar.querySelectorAll("[data-s]").forEach(chip => {
      chip.onclick = () => {
        statusChip = chip.dataset.s;
        toolbar.querySelectorAll("[data-s]").forEach(x => x.classList.toggle("active", x === chip));
        draw();
      };
    });
    const addRowBtn = toolbar.querySelector('[data-act="add-row"]');
    if (addRowBtn) addRowBtn.onclick = () => { store.addRow(moduleCfg.sheet, {}); draw(); window.HPC_APP.refreshNavCounts(); };
    const addGroupBtn = toolbar.querySelector('[data-act="add-group"]');
    if (addGroupBtn) addGroupBtn.onclick = () => {
      const name = prompt("Tên nhóm / giai đoạn mới:");
      if (!name) return;
      store.addRow(moduleCfg.sheet, { [moduleCfg.groupByColumn]: name });
      draw(); window.HPC_APP.refreshNavCounts();
    };

    draw();
    return draw; // trả về hàm draw để re-render khi store thay đổi (auto-pull)
  }

  function buildGroupBlock(moduleCfg, columns, groupName, items) {
    const block = document.createElement("div");
    block.className = "phase-block";
    const key = moduleCfg.id + "::" + groupName;
    const collapsed = !!COLLAPSED[key];
    const doneCount = moduleCfg.doneColumn ? items.filter(r => truthy(r[moduleCfg.doneColumn])).length : null;

    const head = document.createElement("div");
    head.className = "phase-head" + (collapsed ? " collapsed" : "");
    head.innerHTML = `
      <span class="p-toggle">▾</span>
      <span class="p-title"><input type="text" value="${esc(groupName)}"></span>
      <span class="p-meta">${items.length} dòng${doneCount !== null ? ` · ${doneCount} xong` : ""}</span>
      <span class="p-del" title="Xoá cả nhóm này">✕</span>`;
    block.appendChild(head);

    const body = document.createElement("div");
    body.style.display = collapsed ? "none" : "block";
    body.appendChild(buildFlatTable(moduleCfg, columns, items, groupName));
    block.appendChild(body);

    head.addEventListener("click", e => {
      if (e.target.tagName === "INPUT" || e.target.classList.contains("p-del")) return;
      COLLAPSED[key] = !collapsed;
      window.HPC_APP.render();
    });
    const renameInput = head.querySelector("input");
    renameInput.addEventListener("click", e => e.stopPropagation());
    renameInput.addEventListener("change", () => {
      store.renameGroup(moduleCfg.sheet, moduleCfg.groupByColumn, groupName, renameInput.value.trim());
    });
    head.querySelector(".p-del").addEventListener("click", e => {
      e.stopPropagation();
      if (!confirm(`Xoá toàn bộ ${items.length} dòng thuộc "${groupName}"?`)) return;
      store.deleteGroup(moduleCfg.sheet, moduleCfg.groupByColumn, groupName);
      window.HPC_APP.refreshNavCounts();
    });
    return block;
  }

  function truthy(v) { return v === true || v === "true" || v === "TRUE" || v === 1 || v === "1"; }

  function buildFlatTable(moduleCfg, columns, rows, groupValue) {
    const tblWrap = document.createElement("div");
    tblWrap.className = "tbl-wrap";
    const table = document.createElement("table");
    table.className = "dt";
    table.innerHTML = `<thead><tr>${columns.map(c => `<th style="${c.width ? "width:" + c.width : ""}">${esc(c.label)}</th>`).join("")}<th style="width:30px"></th></tr></thead>`;
    const tbody = document.createElement("tbody");
    rows.forEach(row => tbody.appendChild(buildRow(moduleCfg, columns, row)));
    table.appendChild(tbody);
    tblWrap.appendChild(table);

    const wrapper = document.createElement("div");
    wrapper.className = "card";
    wrapper.style.padding = "0";
    if (!moduleCfg.groupByColumn) wrapper.appendChild(tblWrap); else { wrapper.style.border = "none"; wrapper.style.background = "transparent"; wrapper.appendChild(tblWrap); }

    const foot = document.createElement("div");
    foot.className = "tbl-foot";
    const addBtn = document.createElement("button");
    addBtn.className = "btn sm";
    addBtn.textContent = "+ Thêm dòng";
    addBtn.onclick = () => {
      const initial = groupValue ? { [moduleCfg.groupByColumn]: groupValue } : {};
      store.addRow(moduleCfg.sheet, initial);
      window.HPC_APP.render();
      window.HPC_APP.refreshNavCounts();
    };
    foot.appendChild(addBtn);
    wrapper.appendChild(foot);
    return wrapper;
  }

  function buildRow(moduleCfg, columns, row) {
    const tr = document.createElement("tr");
    tr.dataset.id = row.ID;
    columns.forEach(col => {
      const td = document.createElement("td");
      if (col.primary) td.className = "cell-primary";
      if (col.key === (columns[0] && columns[0].key)) td.classList.add("cell-code");
      const val = row[col.key];
      renderCell(td, col, val, v => {
        store.updateField(moduleCfg.sheet, row.ID, col.key, v);
        window.HPC_APP.refreshSyncBadgeSoon();
      });
      tr.appendChild(td);
    });
    const delTd = document.createElement("td");
    const delBtn = document.createElement("span");
    delBtn.className = "row-del"; delBtn.textContent = "✕"; delBtn.title = "Xoá dòng";
    delBtn.onclick = () => {
      if (!confirm("Xoá dòng này?")) return;
      store.deleteRow(moduleCfg.sheet, row.ID);
      window.HPC_APP.render();
      window.HPC_APP.refreshNavCounts();
    };
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);
    return tr;
  }

  function renderCell(td, col, val, onCommit) {
    if (col.type === "text" || col.type === undefined) {
      td.contentEditable = "true";
      td.textContent = val || "";
      td.addEventListener("blur", () => onCommit(td.textContent.trim()));
      td.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); td.blur(); } });
    } else if (col.type === "textarea") {
      td.contentEditable = "true";
      td.style.minWidth = "260px";
      td.textContent = val || "";
      td.addEventListener("blur", () => onCommit(td.textContent.trim()));
    } else if (col.type === "date") {
      const inp = document.createElement("input");
      inp.type = "date"; inp.className = "cell-input"; inp.value = val || "";
      inp.addEventListener("change", () => onCommit(inp.value));
      td.appendChild(inp);
    } else if (col.type === "percent") {
      const inp = document.createElement("input");
      inp.type = "number"; inp.min = 0; inp.max = 100; inp.className = "pct-input"; inp.value = val || 0;
      inp.addEventListener("change", () => onCommit(clamp(toNum(inp.value, 0), 0, 100)));
      td.appendChild(inp);
      td.appendChild(Object.assign(document.createElement("span"), { textContent: "%", style: "color:var(--ink-faint);font-size:10.5px;margin-left:2px" }));
    } else if (col.type === "checkbox") {
      const inp = document.createElement("input");
      inp.type = "checkbox"; inp.className = "chk"; inp.checked = truthy(val);
      inp.addEventListener("change", () => { onCommit(inp.checked); window.HPC_APP.render(); });
      td.appendChild(inp);
    } else if (col.type === "select") {
      const sel = document.createElement("select");
      sel.className = "cell-select";
      const opts = [""].concat(col.options || []);
      if (val && !opts.includes(val)) opts.push(val);
      sel.innerHTML = opts.map(o => `<option value="${esc(o)}" ${o === val ? "selected" : ""}>${esc(o) || "—"}</option>`).join("");
      sel.addEventListener("change", () => { onCommit(sel.value); window.HPC_APP.render(); });
      td.appendChild(sel);
    } else if (col.type === "status") {
      const sel = document.createElement("select");
      sel.className = "cell-select";
      const opts = col.options || [];
      if (val && !opts.includes(val)) opts.push(val);
      sel.innerHTML = opts.map(o => `<option value="${esc(o)}" ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("");
      if (col.colorMap && col.colorMap[val]) sel.classList.add(badgeColor(col.colorMap[val]));
      sel.addEventListener("change", () => { onCommit(sel.value); window.HPC_APP.render(); });
      td.appendChild(sel);
    } else {
      td.textContent = val || "";
    }
  }

  /* =============================== DASHBOARD =============================== */
  function computeModuleStats(moduleCfg, roleFilter) {
    const data = store.getSheetData(moduleCfg.sheet);
    let rows = data.rows;
    if (roleFilter && roleFilter !== "ALL" && moduleCfg.ownerColumn) rows = rows.filter(r => contractorMatches(r[moduleCfg.ownerColumn], roleFilter));

    const total = rows.length;
    let doneCount = null, avgProgress = null, overdue = [], ownerBreakdown = null, alertRows = [];

    if (moduleCfg.doneColumn) doneCount = rows.filter(r => truthy(r[moduleCfg.doneColumn])).length;

    if (moduleCfg.progressColumns && moduleCfg.progressColumns.length) {
      avgProgress = total ? Math.round(rows.reduce((a, r) => a + moduleCfg.progressColumns.reduce((s, c) => s + toNum(r[c], 0), 0) / moduleCfg.progressColumns.length, 0) / total) : 0;
    } else if (moduleCfg.doneColumn) {
      avgProgress = total ? Math.round(doneCount / total * 100) : 0;
    }

    if (moduleCfg.dueColumn) {
      const today = todayStr();
      overdue = rows.filter(r => r[moduleCfg.dueColumn] && r[moduleCfg.dueColumn] < today && moduleCfg.doneColumn && !truthy(r[moduleCfg.doneColumn]));
    }

    if (moduleCfg.ownerColumn) {
      ownerBreakdown = window.HPC_CONFIG.ROLE_OPTIONS.map(who => {
        const items = rows.filter(r => contractorMatches(r[moduleCfg.ownerColumn], who));
        const d = moduleCfg.doneColumn ? items.filter(r => truthy(r[moduleCfg.doneColumn])).length : 0;
        return { who, total: items.length, done: d, pct: items.length ? Math.round(d / items.length * 100) : 0 };
      });
    }

    if (moduleCfg.alertColumn) {
      alertRows = rows.filter(r => r[moduleCfg.alertColumn] === moduleCfg.alertValue &&
        (!moduleCfg.statusColumnForAlert || r[moduleCfg.statusColumnForAlert] !== moduleCfg.alertExcludeStatus));
    }

    return { total, doneCount, avgProgress, overdue, ownerBreakdown, alertRows, rows };
  }

  function kpiCard(icon, label, value, foot, pct, color, noBar) {
    return `<div class="card kpi"><span class="k-icon">${icon}</span><div class="k-label">${esc(label)}</div>
      <div class="k-value">${value}</div><div class="k-foot">${esc(foot)}</div>
      ${noBar ? "" : `<div class="k-bar"><div style="width:${clamp(pct, 0, 100)}%;background:${color}"></div></div>`}</div>`;
  }

  function renderDashboard(root, allModules, roleFilter) {
    const stats = {};
    allModules.forEach(m => { stats[m.id] = computeModuleStats(m, roleFilter); });

    const kpiModules = allModules.filter(m => stats[m.id].avgProgress !== null || stats[m.id].alertRows.length || m.dueColumn).slice(0, 4);
    const kpisHtml = allModules.slice(0, 4).map(m => {
      const s = stats[m.id];
      if (s.alertRows && m.alertColumn) {
        return kpiCard(m.icon, m.label, s.alertRows.length, `${s.alertRows.length} mức ${m.alertValue} đang cần xử lý`, 0, "var(--red-500)", true);
      }
      if (s.avgProgress !== null) {
        return kpiCard(m.icon, m.label, s.avgProgress + "%", `${s.doneCount || 0}/${s.total} hoàn thành`, s.avgProgress, pctColor(s.avgProgress));
      }
      return kpiCard(m.icon, m.label, s.total, `${s.total} bản ghi`, 0, "var(--steel-500)", true);
    }).join("");

    const overdueAll = [];
    allModules.forEach(m => { (stats[m.id].overdue || []).forEach(r => overdueAll.push({ row: r, module: m })); });

    const alertAll = [];
    allModules.forEach(m => { (stats[m.id].alertRows || []).forEach(r => alertAll.push({ row: r, module: m })); });

    const ownerModules = allModules.filter(m => m.ownerColumn);

    root.innerHTML = `
      <div class="grid kpi-grid">${kpisHtml}</div>
      <div class="two-col">
        <div>
          <div class="section-title">Tiến độ theo nhà thầu</div>
          <div class="card" id="dashOwner"></div>
          <div class="section-title">Tổng quan theo module</div>
          <div class="card" id="dashModules"></div>
        </div>
        <div>
          <div class="section-title">⏰ Hạng mục quá hạn</div>
          <div class="card" id="dashOverdue"></div>
          <div class="section-title">🔴 Cảnh báo mức cao</div>
          <div class="card" id="dashAlerts"></div>
        </div>
      </div>`;

    const ownerHost = root.querySelector("#dashOwner");
    if (ownerModules.length) {
      const combined = {};
      window.HPC_CONFIG.ROLE_OPTIONS.forEach(w => combined[w] = { total: 0, done: 0 });
      ownerModules.forEach(m => {
        (stats[m.id].ownerBreakdown || []).forEach(b => {
          combined[b.who].total += b.total; combined[b.who].done += b.done;
        });
      });
      ownerHost.innerHTML = Object.keys(combined).map(w => {
        const b = combined[w]; const pct = b.total ? Math.round(b.done / b.total * 100) : 0;
        return `<div class="contractor-row"><div class="c-name">${esc(w)}</div>
          <div class="c-bar"><div class="pbar"><div style="width:${pct}%;background:${pctColor(pct)}"></div></div></div>
          <div class="c-pct">${pct}%</div></div>`;
      }).join("") + `<div style="font-size:11px;color:var(--ink-faint);margin-top:8px">Tổng hợp từ: ${ownerModules.map(m => m.label).join(", ")}</div>`;
    } else ownerHost.innerHTML = `<div class="empty-note">Chưa có module nào gắn cột nhà thầu.</div>`;

    const modHost = root.querySelector("#dashModules");
    modHost.innerHTML = allModules.map(m => {
      const s = stats[m.id];
      const pct = s.avgProgress !== null ? s.avgProgress : 0;
      return `<div class="contractor-row"><div class="c-name" style="width:170px" title="${esc(m.title)}">${esc(m.icon)} ${esc(m.label)}</div>
        <div class="c-bar"><div class="pbar sm"><div style="width:${pct}%;background:${pctColor(pct)}"></div></div></div>
        <div class="c-pct">${s.avgProgress !== null ? pct + "%" : s.total}</div></div>`;
    }).join("");

    const odHost = root.querySelector("#dashOverdue");
    odHost.innerHTML = overdueAll.length ? overdueAll.slice(0, 10).map(({ row, module }) => `
      <div class="alert-item"><div class="alert-dot" style="background:var(--red-500)"></div>
        <div><div class="a-title">${esc(row[module.primaryColumn] || row[module.columns[0].key] || "")}</div>
        <div class="a-meta">${esc(module.label)} · ${esc(row[module.ownerColumn] || "—")} · Hạn: ${fmtDate(row[module.dueColumn])}</div></div></div>`).join("")
      : `<div class="empty-note">✓ Không có hạng mục nào quá hạn.</div>`;

    const alHost = root.querySelector("#dashAlerts");
    alHost.innerHTML = alertAll.length ? alertAll.map(({ row, module }) => `
      <div class="alert-item"><div class="alert-dot" style="background:var(--red-500)"></div>
        <div><div class="a-title">${esc(row[module.primaryColumn] || row[module.columns[0].key] || "")}</div>
        <div class="a-meta">${esc(module.label)} · ${esc(row[module.ownerColumn] || "—")}</div></div></div>`).join("")
      : `<div class="empty-note">✓ Không có cảnh báo nào đang mở.</div>`;
  }

  /* ============================================================================
     WORK CALENDAR — V3 (module.kind === "calendar")
     Tái sử dụng tối đa: buildFlatTable/buildRow/renderCell/renderTable ở trên
     cho chế độ "Danh sách" (= Manager view). Chỉ viết mới phần lưới Ngày/Tuần
     và popup nhập nhanh, vì đây là 2 kiểu hiển thị chưa có sẵn trong engine.
     ============================================================================ */
  const CAL_EMP_KEY = "hpc_current_employee";

  function calGetCurrentEmployee() {
    try { return localStorage.getItem(CAL_EMP_KEY) || ""; } catch (e) { return ""; }
  }
  function calSetCurrentEmployee(name) {
    try { localStorage.setItem(CAL_EMP_KEY, name || ""); } catch (e) { /* ignore */ }
  }

  // Gợi ý danh sách tên nhân viên: hợp nhất tên đã từng nhập trong WorkSchedule
  // + cột Name của sheet Đầu mối liên hệ (nếu có) — không tạo bảng Employee mới.
  function calEmployeeSuggestions(moduleCfg) {
    const names = new Set();
    store.getSheetData(moduleCfg.sheet).rows.forEach(r => { if (r[moduleCfg.employeeColumn]) names.add(String(r[moduleCfg.employeeColumn]).trim()); });
    const hintSheet = window.HPC_CONFIG.EMPLOYEE_HINT_SHEET, hintCol = window.HPC_CONFIG.EMPLOYEE_HINT_COLUMN;
    if (hintSheet && hintCol) {
      store.getSheetData(hintSheet).rows.forEach(r => { if (r[hintCol]) names.add(String(r[hintCol]).trim()); });
    }
    return Array.from(names).filter(Boolean).sort();
  }

  function calTaskOptions(moduleCfg) {
    const srcId = moduleCfg.taskSourceModule;
    const srcModule = (window.HPC_APP.MODULES || []).find(m => m.id === srcId);
    if (!srcModule) return [];
    const rows = store.getSheetData(srcModule.sheet).rows;
    const nameKey = srcModule.primaryColumn || "Name";
    return rows.filter(r => r[nameKey]).map(r => ({ id: r.ID, name: (r.Code ? r.Code + " — " : "") + r[nameKey] }));
  }

  function calWeekRange(d) {
    const dt = new Date(d + "T00:00:00");
    const dow = (dt.getDay() + 6) % 7; // 0 = Thứ Hai
    const mon = new Date(dt); mon.setDate(dt.getDate() - dow);
    const days = [];
    for (let i = 0; i < 7; i++) { const x = new Date(mon); x.setDate(mon.getDate() + i); days.push(x.toISOString().slice(0, 10)); }
    return days;
  }

  function calStatusBadgeClass(moduleCfg, status) {
    const color = (moduleCfg.statusColorMap || {})[status] || "gray";
    return badgeColor(color);
  }

  function calEventCard(moduleCfg, row, opts) {
    opts = opts || {};
    const div = document.createElement("div");
    div.className = "cal-event";
    div.innerHTML = `
      <div class="cal-event-time">${esc(row[moduleCfg.startColumn] || "")}${row[moduleCfg.endColumn] ? "–" + esc(row[moduleCfg.endColumn]) : ""}</div>
      <div class="cal-event-body">
        <div class="cal-event-title">${esc(row[moduleCfg.titleColumn] || "(chưa đặt tên)")}</div>
        <div class="cal-event-meta">${opts.showEmployee ? esc(row[moduleCfg.employeeColumn] || "—") + " · " : ""}${esc(row[moduleCfg.taskNameColumn] || row[moduleCfg.projectColumn] || "")}</div>
      </div>
      <span class="badge ${calStatusBadgeClass(moduleCfg, row[moduleCfg.statusColumn])}">${esc(row[moduleCfg.statusColumn] || "")}</span>
      <span class="row-del cal-event-del" title="Xoá">✕</span>`;
    div.querySelector(".cal-event-del").onclick = e => {
      e.stopPropagation();
      if (!confirm("Xoá công việc này?")) return;
      store.deleteRow(moduleCfg.sheet, row.ID);
      window.HPC_APP.refreshNavCounts();
      if (opts.onDelete) opts.onDelete();
    };
    div.onclick = e => { if (e.target.closest(".cal-event-del")) return; if (opts.onEdit) opts.onEdit(row); };
    return div;
  }

  function calPopupForm(moduleCfg, opts) {
    opts = opts || {};
    const editing = opts.row || null;
    const backdrop = document.createElement("div");
    backdrop.className = "hpc-modal-backdrop";
    const taskOpts = calTaskOptions(moduleCfg);
    const defaultDate = (editing && editing[moduleCfg.dateColumn]) || opts.date || todayStr();
    backdrop.innerHTML = `
      <div class="hpc-modal">
        <div class="hpc-modal-title">${editing ? "Sửa công việc" : "+ Thêm công việc"}</div>
        <div class="form-row"><label>Ngày</label><input type="date" class="form-field" id="calfDate" value="${esc(defaultDate)}"></div>
        <div class="form-row two"><div><label>Từ</label><input type="time" class="form-field" id="calfStart" value="${esc((editing && editing[moduleCfg.startColumn]) || "08:00")}"></div>
          <div><label>Đến</label><input type="time" class="form-field" id="calfEnd" value="${esc((editing && editing[moduleCfg.endColumn]) || "09:00")}"></div></div>
        <div class="form-row"><label>Dự án</label><input type="text" class="form-field" id="calfProject" value="${esc((editing && editing[moduleCfg.projectColumn]) || window.HPC_CONFIG.PROJECT_NAME)}" readonly></div>
        <div class="form-row"><label>Task liên quan (nếu có)</label>
          <select class="form-field" id="calfTask">
            <option value="">— Không chọn —</option>
            ${taskOpts.map(t => `<option value="${esc(t.id)}" ${editing && editing[moduleCfg.taskIdColumn] === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}
          </select></div>
        <div class="form-row"><label>Công việc</label><input type="text" class="form-field" id="calfTitle" placeholder="Nhập nội dung công việc" value="${esc((editing && editing[moduleCfg.titleColumn]) || "")}"></div>
        <div class="form-row"><label>Trạng thái</label>
          <select class="form-field" id="calfStatus">
            ${(moduleCfg.statusOptions || []).map(s => `<option ${editing ? (editing[moduleCfg.statusColumn] === s ? "selected" : "") : (s === "Chưa thực hiện" ? "selected" : "")}>${esc(s)}</option>`).join("")}
          </select></div>
        <div class="form-row"><label>Ghi chú</label><textarea class="form-field" id="calfNote" rows="2">${esc((editing && editing[moduleCfg.noteColumn]) || "")}</textarea></div>
        <div class="hpc-modal-actions">
          ${editing ? `<button class="btn danger-ghost sm" id="calfDelete">Xoá</button>` : "<span></span>"}
          <span style="flex:1"></span>
          <button class="btn sm" id="calfCancel">Huỷ</button>
          <button class="btn primary sm" id="calfSave">Lưu</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", e => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector("#calfCancel").onclick = () => backdrop.remove();
    if (editing) {
      backdrop.querySelector("#calfDelete").onclick = () => {
        if (!confirm("Xoá công việc này?")) return;
        store.deleteRow(moduleCfg.sheet, editing.ID);
        window.HPC_APP.refreshNavCounts();
        backdrop.remove();
        if (opts.onSaved) opts.onSaved();
      };
    }
    backdrop.querySelector("#calfSave").onclick = () => {
      const title = backdrop.querySelector("#calfTitle").value.trim();
      if (!title) { backdrop.querySelector("#calfTitle").focus(); return; }
      const taskId = backdrop.querySelector("#calfTask").value;
      const taskName = taskId ? (taskOpts.find(t => t.id === taskId) || {}).name || "" : "";
      const data = {
        [moduleCfg.employeeColumn]: opts.employee || (editing && editing[moduleCfg.employeeColumn]) || "",
        [moduleCfg.dateColumn]: backdrop.querySelector("#calfDate").value,
        [moduleCfg.startColumn]: backdrop.querySelector("#calfStart").value,
        [moduleCfg.endColumn]: backdrop.querySelector("#calfEnd").value,
        [moduleCfg.projectColumn]: window.HPC_CONFIG.PROJECT_NAME,
        [moduleCfg.taskIdColumn]: taskId,
        [moduleCfg.taskNameColumn]: taskName,
        [moduleCfg.titleColumn]: title,
        [moduleCfg.statusColumn]: backdrop.querySelector("#calfStatus").value,
        [moduleCfg.noteColumn]: backdrop.querySelector("#calfNote").value.trim(),
      };
      if (editing) { Object.keys(data).forEach(k => store.updateField(moduleCfg.sheet, editing.ID, k, data[k])); }
      else { store.addRow(moduleCfg.sheet, data); }
      window.HPC_APP.refreshNavCounts();
      backdrop.remove();
      if (opts.onSaved) opts.onSaved();
    };
    backdrop.querySelector("#calfTitle").focus();
  }

  function renderCalendar(root, moduleCfg) {
    if (!CAL_STATE.anchorDate) CAL_STATE.anchorDate = todayStr();
    let currentEmployee = calGetCurrentEmployee();

    const wrap = document.createElement("div");
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar cal-toolbar";
    toolbar.innerHTML = `
      <span style="font-size:12.3px;color:var(--ink-soft);font-weight:600">Bạn là:</span>
      <input list="calEmpList" class="search-box" id="calEmployeeInput" style="min-width:170px" placeholder="Nhập tên của bạn…" value="${esc(currentEmployee)}">
      <datalist id="calEmpList"></datalist>
      <span class="filter-chip${CAL_STATE.mode === "day" ? " active" : ""}" data-mode="day">Ngày</span>
      <span class="filter-chip${CAL_STATE.mode === "week" ? " active" : ""}" data-mode="week">Tuần</span>
      <span class="filter-chip${CAL_STATE.mode === "list" ? " active" : ""}" data-mode="list">Danh sách (Manager view)</span>
      <span class="spacer" style="flex:1"></span>
      <button class="btn sm" id="calPrev">‹</button>
      <button class="btn sm" id="calToday">Hôm nay</button>
      <button class="btn sm" id="calNext">›</button>
      <button class="btn primary sm" id="calAdd">+ Thêm công việc</button>
    `;
    wrap.appendChild(toolbar);
    const host = document.createElement("div");
    host.style.marginTop = "12px";
    wrap.appendChild(host);
    root.appendChild(wrap);

    const empList = toolbar.querySelector("#calEmpList");
    empList.innerHTML = calEmployeeSuggestions(moduleCfg).map(n => `<option value="${esc(n)}">`).join("");
    toolbar.querySelector("#calEmployeeInput").addEventListener("change", e => {
      currentEmployee = e.target.value.trim();
      calSetCurrentEmployee(currentEmployee);
      draw();
    });

    toolbar.querySelectorAll("[data-mode]").forEach(chip => {
      chip.onclick = () => {
        CAL_STATE.mode = chip.dataset.mode;
        toolbar.querySelectorAll("[data-mode]").forEach(x => x.classList.toggle("active", x === chip));
        draw();
      };
    });
    toolbar.querySelector("#calAdd").onclick = () => {
      calPopupForm(moduleCfg, { date: CAL_STATE.anchorDate, employee: currentEmployee || "(Chưa đặt tên)", onSaved: draw });
    };
    toolbar.querySelector("#calToday").onclick = () => { CAL_STATE.anchorDate = todayStr(); draw(); };
    toolbar.querySelector("#calPrev").onclick = () => { CAL_STATE.anchorDate = shiftDate(CAL_STATE.anchorDate, CAL_STATE.mode === "week" ? -7 : -1); draw(); };
    toolbar.querySelector("#calNext").onclick = () => { CAL_STATE.anchorDate = shiftDate(CAL_STATE.anchorDate, CAL_STATE.mode === "week" ? 7 : 1); draw(); };

    function shiftDate(d, days) { const dt = new Date(d + "T00:00:00"); dt.setDate(dt.getDate() + days); return dt.toISOString().slice(0, 10); }

    function myRows() {
      const rows = store.getSheetData(moduleCfg.sheet).rows;
      if (!currentEmployee) return rows;
      return rows.filter(r => (r[moduleCfg.employeeColumn] || "").trim().toLowerCase() === currentEmployee.toLowerCase());
    }

    function draw() {
      host.innerHTML = "";
      if (CAL_STATE.mode === "day") drawDay(); else if (CAL_STATE.mode === "week") drawWeek(); else drawList();
    }

    function drawDay() {
      const rows = myRows().filter(r => r[moduleCfg.dateColumn] === CAL_STATE.anchorDate)
        .sort((a, b) => (a[moduleCfg.startColumn] || "").localeCompare(b[moduleCfg.startColumn] || ""));
      const card = document.createElement("div");
      card.className = "card cal-daycard";
      const d = new Date(CAL_STATE.anchorDate + "T00:00:00");
      const weekday = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"][d.getDay()];
      card.innerHTML = `<div class="cal-day-heading">${weekday} · ${fmtDate(CAL_STATE.anchorDate)}</div>`;
      const list = document.createElement("div");
      if (!rows.length) list.innerHTML = `<div class="empty-note">Chưa có công việc nào trong ngày này. Bấm "+ Thêm công việc" để bắt đầu.</div>`;
      rows.forEach(r => list.appendChild(calEventCard(moduleCfg, r, {
        onEdit: row => calPopupForm(moduleCfg, { row, employee: currentEmployee, onSaved: draw }),
        onDelete: draw,
      })));
      card.appendChild(list);
      host.appendChild(card);
    }

    function drawWeek() {
      const days = calWeekRange(CAL_STATE.anchorDate);
      const rows = myRows();
      const grid = document.createElement("div");
      grid.className = "cal-weekgrid";
      const weekdayShort = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
      days.forEach((day, i) => {
        const col = document.createElement("div");
        col.className = "cal-weekcol" + (day === todayStr() ? " is-today" : "");
        const dayRows = rows.filter(r => r[moduleCfg.dateColumn] === day)
          .sort((a, b) => (a[moduleCfg.startColumn] || "").localeCompare(b[moduleCfg.startColumn] || ""));
        col.innerHTML = `<div class="cal-weekcol-head">${weekdayShort[i]}<br><span class="mono">${day.slice(8, 10)}/${day.slice(5, 7)}</span></div>`;
        const body = document.createElement("div");
        body.className = "cal-weekcol-body";
        if (!dayRows.length) body.innerHTML = `<div class="cal-weekcol-empty">—</div>`;
        dayRows.forEach(r => {
          const ev = document.createElement("div");
          ev.className = "cal-mini-event badge " + calStatusBadgeClass(moduleCfg, r[moduleCfg.statusColumn]);
          ev.textContent = (r[moduleCfg.startColumn] || "") + " " + (r[moduleCfg.titleColumn] || "");
          ev.title = r[moduleCfg.titleColumn] || "";
          ev.onclick = () => calPopupForm(moduleCfg, { row: r, employee: currentEmployee, onSaved: draw });
          body.appendChild(ev);
        });
        col.appendChild(body);
        const addBtn = document.createElement("button");
        addBtn.className = "cal-weekcol-add"; addBtn.textContent = "+";
        addBtn.onclick = () => calPopupForm(moduleCfg, { date: day, employee: currentEmployee || "(Chưa đặt tên)", onSaved: draw });
        col.appendChild(addBtn);
        grid.appendChild(col);
      });
      host.appendChild(grid);
    }

    function drawList() {
      // Manager view = TÁI SỬ DỤNG NGUYÊN engine.renderTable() có sẵn (search, lọc,
      // sửa inline, thêm/xoá dòng) — không viết lại bảng dữ liệu.
      const note = document.createElement("div");
      note.className = "empty-note";
      note.style.padding = "0 2px 10px";
      note.textContent = "Xem lịch của tất cả nhân viên trong dự án — dùng ô tìm kiếm để lọc theo tên nhân viên.";
      host.appendChild(note);
      renderTable(host, Object.assign({}, moduleCfg, { ownerColumn: undefined, groupByColumn: undefined }), "ALL");
    }

    draw();
    return draw;
  }

  // Widget "Công việc hôm nay" cho Dashboard — gọi RIÊNG từ app.js, KHÔNG sửa
  // renderDashboard() hiện tại để không ảnh hưởng Dashboard đang hoạt động.
  function renderTodayWorkWidget(root, moduleCfg) {
    if (!moduleCfg) return;
    const rows = store.getSheetData(moduleCfg.sheet).rows.filter(r => r[moduleCfg.dateColumn] === todayStr());
    const byStatus = {};
    (moduleCfg.statusOptions || []).forEach(s => byStatus[s] = 0);
    rows.forEach(r => { const s = r[moduleCfg.statusColumn]; if (s in byStatus) byStatus[s]++; });

    const section = document.createElement("div");
    section.innerHTML = `<div class="section-title">📅 Công việc hôm nay <span class="tag">${fmtDate(todayStr())}</span></div>`;
    const card = document.createElement("div");
    card.className = "card";
    const summary = document.createElement("div");
    summary.className = "cal-today-summary";
    summary.innerHTML = `
      <div class="cal-today-stat"><div class="v">${rows.length}</div><div class="l">Tổng công việc</div></div>
      ${(moduleCfg.statusOptions || []).map(s => `<div class="cal-today-stat"><div class="v">${byStatus[s] || 0}</div><div class="l">${esc(s)}</div></div>`).join("")}
    `;
    card.appendChild(summary);

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar"; toolbar.style.marginTop = "12px";
    const employees = calEmployeeSuggestions(moduleCfg);
    toolbar.innerHTML = `
      <select class="cell-select" id="calDashEmp"><option value="">Tất cả nhân viên</option>${employees.map(e => `<option>${esc(e)}</option>`).join("")}</select>
      <select class="cell-select" id="calDashStatus"><option value="">Tất cả trạng thái</option>${(moduleCfg.statusOptions || []).map(s => `<option>${esc(s)}</option>`).join("")}</select>
    `;
    card.appendChild(toolbar);

    const list = document.createElement("div");
    list.style.marginTop = "8px";
    card.appendChild(list);

    function drawList() {
      const emp = toolbar.querySelector("#calDashEmp").value;
      const st = toolbar.querySelector("#calDashStatus").value;
      let items = rows.slice();
      if (emp) items = items.filter(r => r[moduleCfg.employeeColumn] === emp);
      if (st) items = items.filter(r => r[moduleCfg.statusColumn] === st);
      items.sort((a, b) => (a[moduleCfg.startColumn] || "").localeCompare(b[moduleCfg.startColumn] || ""));
      list.innerHTML = "";
      if (!items.length) { list.innerHTML = `<div class="empty-note">Không có công việc nào khớp bộ lọc hôm nay.</div>`; return; }
      items.forEach(r => list.appendChild(calEventCard(moduleCfg, r, { showEmployee: true })));
    }
    toolbar.querySelector("#calDashEmp").onchange = drawList;
    toolbar.querySelector("#calDashStatus").onchange = drawList;
    drawList();

    section.appendChild(card);
    root.appendChild(section);
  }

  return {
    renderTable, renderDashboard, renderCalendar, renderTodayWorkWidget,
    computeModuleStats, resolveColumns, inferColumn, esc, fmtDate, todayStr, contractorMatches,
  };
})();
