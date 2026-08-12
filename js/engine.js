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
  let CAL_STATE = { mode: "day", anchorDate: null, fromDate: null, toDate: null };

  function esc(s) { return (s === undefined || s === null) ? "" : String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function toNum(v, d) { const n = parseFloat(v); return isNaN(n) ? d : n; }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function fmtDate(s) { if (!s) return ""; const d = new Date(s + "T00:00:00"); if (isNaN(d)) return s; return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }); }

  /* --------------------------- suy luận cột tự động --------------------------- */
 function inferColumn(headerName) {
    const h = headerName.toLowerCase();
    if (h === "id") return null;
    if (/(done|xong|hoàn thành|confirm|xác nhận)/i.test(h)) return { key: headerName, label: headerName, type: "checkbox", width: "70px" };
    if (/(date|ngày|due|hạn|start|end|bắt đầu)/i.test(h)) return { key: headerName, label: headerName, type: "date" };
    if (/(pct|percent|%)/i.test(h)) return { key: headerName, label: headerName, type: "percent", width: "64px" };
    
    // THÊM DÒNG NÀY:
    if (/(evidence|minh chứng|file|hồ sơ)/i.test(h)) return { key: headerName, label: headerName, type: "file" };
    
    return { key: headerName, label: headerName, type: "text" };
  }

  // Kết hợp cấu hình module.columns (nếu có) với cột thực tế đang có trên Sheet:
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

  /* ---------------------- V3: thứ tự kéo-thả + mã tự động ---------------------- */
  function sortByOrder(rows) {
    if (!rows.some(r => r.Order !== undefined && r.Order !== "")) return rows;
    return rows.slice().sort((a, b) => toNum(a.Order, 1e9) - toNum(b.Order, 1e9));
  }

  function letterFor(zeroBasedIndex) {
    let n = zeroBasedIndex + 1, s = "";
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  function recomputeCodes(moduleCfg) {
    if (!moduleCfg.groupByColumn || !moduleCfg.columns || moduleCfg.columns[0].label !== "#") return;
    const codeKey = moduleCfg.columns[0].key;
    const sheetData = store.getSheetData(moduleCfg.sheet);
    const groups = uniqueValues(sheetData.rows, moduleCfg.groupByColumn);
    groups.forEach((g, gi) => {
      const groupCode = letterFor(gi) + "1";
      const items = sortByOrder(sheetData.rows.filter(r => r[moduleCfg.groupByColumn] === g));
      items.forEach((r, ii) => {
        const newCode = groupCode + "." + (ii + 1);
        if (r[codeKey] !== newCode) store.updateField(moduleCfg.sheet, r.ID, codeKey, newCode);
      });
    });
  }

  function enableDragReorder(tbody, moduleCfg) {
    let dragId = null;
    Array.from(tbody.children).forEach(tr => {
      const handle = tr.querySelector(".drag-handle");
      if (!handle) return;
      handle.addEventListener("mousedown", () => { tr.draggable = true; });
      tr.addEventListener("dragend", () => { tr.draggable = false; tr.classList.remove("dragging"); clearDragOverMarks(tbody); });
      tr.addEventListener("dragstart", e => {
        dragId = tr.dataset.id;
        e.dataTransfer.effectAllowed = "move";
        tr.classList.add("dragging");
      });
      tr.addEventListener("dragover", e => {
        e.preventDefault();
        if (tr.dataset.id === dragId) return;
        clearDragOverMarks(tbody);
        const before = (e.clientY - tr.getBoundingClientRect().top) < tr.offsetHeight / 2;
        tr.classList.add(before ? "drag-over-top" : "drag-over-bottom");
      });
      tr.addEventListener("drop", e => {
        e.preventDefault();
        clearDragOverMarks(tbody);
        if (!dragId || tr.dataset.id === dragId) return;
        const before = (e.clientY - tr.getBoundingClientRect().top) < tr.offsetHeight / 2;
        const dragTr = tbody.querySelector(`tr[data-id="${dragId}"]`);
        if (!dragTr) return;
        tbody.insertBefore(dragTr, before ? tr : tr.nextSibling);
        Array.from(tbody.children).forEach((row, idx) => {
          store.updateField(moduleCfg.sheet, row.dataset.id, "Order", (idx + 1) * 10);
        });
        recomputeCodes(moduleCfg);
        window.HPC_APP.refreshSyncBadgeSoon();
        window.HPC_APP.render();
      });
    });
  }
  function clearDragOverMarks(tbody) {
    tbody.querySelectorAll(".drag-over-top,.drag-over-bottom").forEach(el => el.classList.remove("drag-over-top", "drag-over-bottom"));
  }

  /* ================================ TABLE VIEW ================================ */
  /* ================================ TABLE & KANBAN VIEW ================================ */
  function renderTable(root, moduleCfg, roleFilter) {
    const sheetData = store.getSheetData(moduleCfg.sheet);
    const columns = resolveColumns(moduleCfg, sheetData.columns);

    const wrap = document.createElement("div");
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";

    let search = "";
    let contractorChip = null;
    let statusChip = "ALL";
    let isKanban = false; // Trạng thái xem (Mặc định là Bảng)

    const canKanban = !!moduleCfg.filterColumn && !!moduleCfg.filterOptions;

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
      ${canKanban ? `<button class="btn sm" id="btnToggleKanban" style="margin-left: 8px; background: var(--navy-900); color: #fff;">▥ Kanban</button>` : ""}
      <span class="spacer" style="flex:1"></span>
      ${moduleCfg.groupByColumn ? `<button class="btn sm" data-act="add-group">+ Thêm nhóm</button>` : `<button class="btn sm" data-act="add-row">+ Thêm dòng</button>`}
    `;
    wrap.appendChild(toolbar);
    const host = document.createElement("div");
    wrap.appendChild(host);
    root.appendChild(wrap);

    const btnToggleKanban = toolbar.querySelector("#btnToggleKanban");
    if (btnToggleKanban) {
      btnToggleKanban.onclick = () => {
        isKanban = !isKanban;
        btnToggleKanban.innerHTML = isKanban ? "▤ Dạng bảng" : "▥ Kanban";
        draw();
      };
    }

    function filteredRows() {
      let rows = sheetData.rows.slice();
      if (roleFilter && roleFilter !== "ALL" && moduleCfg.ownerColumn) {
        rows = rows.filter(r => contractorMatches(r[moduleCfg.ownerColumn], roleFilter));
      }
      if (contractorChip) rows = rows.filter(r => contractorMatches(r[moduleCfg.ownerColumn], contractorChip));
      if (!isKanban && moduleCfg.filterColumn && statusChip !== "ALL") rows = rows.filter(r => r[moduleCfg.filterColumn] === statusChip);
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
      recomputeCodes(moduleCfg); 
      const rows = filteredRows();
      host.innerHTML = "";
      
      // BỔ SUNG: Render Kanban thay vì Bảng nếu đang bật
      if (isKanban && canKanban) {
        host.appendChild(buildKanbanBoard(moduleCfg, columns, rows));
        return;
      }

      // Giữ nguyên logic render Bảng cũ
      if (moduleCfg.groupByColumn) {
        const groups = uniqueValues(sheetData.rows, moduleCfg.groupByColumn);
        uniqueValues(rows, moduleCfg.groupByColumn).forEach(g => { if (!groups.includes(g)) groups.push(g); });
        if (!groups.length) { host.innerHTML = `<div class="card"><div class="empty-note">Chưa có dữ liệu. Bấm "+ Thêm nhóm" để bắt đầu.</div></div>`; return; }
        groups.forEach(g => {
          const items = sortByOrder(rows.filter(r => r[moduleCfg.groupByColumn] === g));
          if (!items.length && (search || contractorChip || statusChip !== "ALL")) return;
          host.appendChild(buildGroupBlock(moduleCfg, columns, g, items));
        });
      } else {
        host.appendChild(buildFlatTable(moduleCfg, columns, sortByOrder(rows)));
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
    return draw; 
  }

  ////////////////////////////
  function buildKanbanBoard(moduleCfg, columns, rows) {
    const board = document.createElement("div");
    board.className = "kanban-board";
    const statuses = moduleCfg.filterOptions;
    let dragCardId = null;

    statuses.forEach(status => {
      const col = document.createElement("div");
      col.className = "kanban-col";
      
      const colRows = rows.filter(r => r[moduleCfg.filterColumn] === status);
      
      col.innerHTML = `
        <div class="kanban-head">
          <span class="badge ${calStatusBadgeClass(moduleCfg, status)}">${esc(status)}</span>
          <span class="mono" style="color:var(--ink-faint); font-size:11px">${colRows.length} thẻ</span>
        </div>
        <div class="kanban-body"></div>
      `;
      
      const body = col.querySelector(".kanban-body");
      colRows.forEach(row => {
        const card = document.createElement("div");
        card.className = "kanban-card";
        card.draggable = true;
        card.dataset.id = row.ID;
        
        const titleKey = moduleCfg.primaryColumn || (columns[1] ? columns[1].key : columns[0].key);
        const metaKey = moduleCfg.ownerColumn || "";
        const dateKey = moduleCfg.dueColumn || "";
        
        card.innerHTML = `
          <div class="kanban-card-title">${esc(row[titleKey] || "(Chưa có tiêu đề)")}</div>
          <div class="kanban-card-meta">
            <span style="font-weight: 500">${metaKey ? esc(row[metaKey] || "") : ""}</span>
            <span style="${row[dateKey] && row[dateKey] < todayStr() ? 'color:var(--red-500); font-weight:600' : ''}">${dateKey ? fmtDate(row[dateKey]) : ""}</span>
          </div>
        `;
        
        // Sự kiện kéo thả
        card.addEventListener("dragstart", e => { dragCardId = row.ID; e.dataTransfer.effectAllowed = "move"; setTimeout(() => card.style.opacity = "0.5", 0); });
        card.addEventListener("dragend", () => { dragCardId = null; card.style.opacity = "1"; });
        
        body.appendChild(card);
      });
      
      // Xử lý cột nhận thẻ thả vào
      col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("drag-over"); });
      col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
      col.addEventListener("drop", e => {
        e.preventDefault();
        col.classList.remove("drag-over");
        if (dragCardId) {
          store.updateField(moduleCfg.sheet, dragCardId, moduleCfg.filterColumn, status);
          window.HPC_APP.refreshSyncBadgeSoon();
          window.HPC_APP.render();
        }
      });
      
      board.appendChild(col);
    });
    
    return board;
  }
  /////////////////////

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
    table.innerHTML = `<thead><tr><th style="width:28px"></th>${columns.map(c => `<th style="${c.width ? "width:" + c.width : ""}">${esc(c.label)}</th>`).join("")}<th style="width:30px"></th></tr></thead>`;
    const tbody = document.createElement("tbody");
    rows.forEach(row => tbody.appendChild(buildRow(moduleCfg, columns, row)));
    table.appendChild(tbody);
    tblWrap.appendChild(table);
    enableDragReorder(tbody, moduleCfg);

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
    const handleTd = document.createElement("td");
    handleTd.className = "drag-handle";
    handleTd.title = "Kéo để đổi thứ tự";
    handleTd.textContent = "☰";
    tr.appendChild(handleTd);
    columns.forEach(col => {
      const td = document.createElement("td");
      // Bổ sung thuộc tính data-label để phục vụ giao diện Mobile Card View
      td.setAttribute("data-label", col.label);
      
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

    // --- BỔ SUNG: Trực quan hóa màu sắc cho cả dòng (Row Highlighting) ---
    if (moduleCfg.doneColumn && truthy(row[moduleCfg.doneColumn])) {
      tr.style.opacity = "0.55";
      tr.style.background = "var(--bg)"; // Làm mờ và đổi nền dòng đã xong
    }
    if (moduleCfg.alertColumn && row[moduleCfg.alertColumn] === moduleCfg.alertValue && row[moduleCfg.statusColumnForAlert] !== moduleCfg.alertExcludeStatus) {
      tr.style.boxShadow = "inset 4px 0 0 var(--red-500)"; // Viền đỏ cảnh báo mức HIGH
    }
    // ----------------------------------------------------------------------

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
      // --- BỔ SUNG: Thanh progress bar nằm chìm dưới ô nhập liệu ---
      td.classList.add("cell-progress-bg");
      const fill = document.createElement("div");
      fill.className = "pct-fill";
      const pctValue = clamp(toNum(val, 0), 0, 100);
      fill.style.width = pctValue + "%";
      fill.style.background = pctColor(pctValue);
      td.appendChild(fill);
      
      const inp = document.createElement("input");
      inp.type = "number"; inp.min = 0; inp.max = 100; inp.className = "pct-input"; inp.value = val || 0;
      inp.addEventListener("change", () => {
        const newVal = clamp(toNum(inp.value, 0), 0, 100);
        fill.style.width = newVal + "%";
        fill.style.background = pctColor(newVal);
        onCommit(newVal);
      });
      td.appendChild(inp);
      td.appendChild(Object.assign(document.createElement("span"), { textContent: "%", style: "color:var(--ink-faint);font-size:10.5px;margin-left:2px; position:relative; z-index:2" }));
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
    
    
    } else if (col.type === "file") {
      td.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.style.display = "flex"; wrap.style.gap = "6px"; wrap.style.alignItems = "center";
      
      const inp = document.createElement("input");
      inp.className = "cell-input";
      inp.value = val || "";
      inp.style.flex = "1";
      inp.style.minWidth = "100px";
      inp.addEventListener("blur", () => onCommit(inp.value.trim()));
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
      
      const btn = document.createElement("button");
      btn.className = "btn sm";
      btn.textContent = "📎";
      btn.title = "Tải file lên Google Drive";
      btn.style.padding = "2px 6px";
      
      const fileInp = document.createElement("input");
      fileInp.type = "file";
      fileInp.style.display = "none";
      fileInp.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { alert("File quá lớn! Vui lòng chọn file dưới 5MB."); return; } // Giới hạn 5MB để không treo browser
        btn.textContent = "⌛"; btn.disabled = true;
        try {
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = reader.result.split(",")[1];
            const res = await window.HPC_API.upload(file.name, file.type || "application/octet-stream", base64);
            if (res && res.url) { inp.value = res.url; onCommit(res.url); }
            btn.textContent = "📎"; btn.disabled = false;
          };
          reader.readAsDataURL(file);
        } catch (err) {
          alert("Lỗi tải file: " + err.message);
          btn.textContent = "📎"; btn.disabled = false;
        }
      };
      
      btn.onclick = () => fileInp.click();
      
      // Thêm nút mở link nhanh nếu đã có link
      if (val && val.startsWith("http")) {
        const link = document.createElement("a");
        link.href = val; link.target = "_blank"; link.textContent = "↗";
        link.style.textDecoration = "none"; link.style.color = "var(--teal-500)";
        link.style.fontWeight = "bold";
        wrap.appendChild(link);
      }
      
      wrap.appendChild(inp);
      wrap.appendChild(btn);
      wrap.appendChild(fileInp);
      td.appendChild(wrap);
    
    } 

    
    
    
    else {
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
    let totalIssues = 0, openIssues = 0, inProgIssues = 0, closedIssues = 0;

    allModules.forEach(m => { 
      stats[m.id] = computeModuleStats(m, roleFilter); 
      
      // Trích xuất riêng data cho Biểu đồ Issue & Rủi ro
      if (m.id === "issues") {
        const rows = store.getSheetData(m.sheet).rows;
        let filtered = rows;
        if (roleFilter && roleFilter !== "ALL" && m.ownerColumn) {
          filtered = rows.filter(r => contractorMatches(r[m.ownerColumn], roleFilter));
        }
        totalIssues = filtered.length;
        openIssues = filtered.filter(r => r.Status === "OPEN").length;
        inProgIssues = filtered.filter(r => r.Status === "IN_PROGRESS").length;
        closedIssues = filtered.filter(r => r.Status === "CLOSED").length;
      }
    });

    const kpiModules = allModules.filter(m => stats[m.id].avgProgress !== null || stats[m.id].alertRows.length || m.dueColumn).slice(0, 4);
    const kpisHtml = allModules.slice(0, 4).map(m => {
      const s = stats[m.id];
      if (s.alertRows && m.alertColumn) {
        return kpiCard(m.icon, m.label, s.alertRows.length, `${s.alertRows.length} mức ${m.alertValue} cần xử lý`, 0, "var(--red-500)", true);
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

    // Xử lý html cho Biểu đồ Donut (CSS thuần)
    let issueChartHtml = `<div class="empty-note">Chưa có dữ liệu Issue.</div>`;
    if (totalIssues > 0) {
      const pOpen = Math.round((openIssues / totalIssues) * 100);
      const pInProg = Math.round((inProgIssues / totalIssues) * 100);
      const pClosed = Math.round((closedIssues / totalIssues) * 100);

      const deg1 = Math.round((openIssues / totalIssues) * 360);
      const deg2 = deg1 + Math.round((inProgIssues / totalIssues) * 360);

      issueChartHtml = `
        <div style="display:flex; align-items:center; gap: 30px; padding: 10px 0; justify-content: center;">
          <div style="position:relative; width: 130px; height: 130px; border-radius: 50%; background: conic-gradient(var(--red-500) 0deg ${deg1}deg, var(--amber-500) ${deg1}deg ${deg2}deg, var(--green-500) ${deg2}deg 360deg); box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
            <div style="position:absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 85px; height: 85px; background: var(--card); border-radius: 50%; display:flex; align-items:center; justify-content:center; flex-direction:column; box-shadow: inset 0 2px 5px rgba(0,0,0,0.05);">
              <b style="font-size:22px; font-family:'Space Grotesk'; color:var(--navy-900); line-height: 1;">${totalIssues}</b>
              <span style="font-size:10px; color:var(--ink-soft); text-transform:uppercase; font-weight: 600; margin-top: 2px;">Issues</span>
            </div>
          </div>
          <div class="chart-legend">
            <div class="legend-item"><div class="legend-dot" style="background:var(--red-500)"></div><span><b>${openIssues}</b> OPEN (${pOpen}%)</span></div>
            <div class="legend-item"><div class="legend-dot" style="background:var(--amber-500)"></div><span><b>${inProgIssues}</b> IN PROGRESS (${pInProg}%)</span></div>
            <div class="legend-item"><div class="legend-dot" style="background:var(--green-500)"></div><span><b>${closedIssues}</b> CLOSED (${pClosed}%)</span></div>
          </div>
        </div>`;
    }

    root.innerHTML = `
      <div class="grid kpi-grid">${kpisHtml}</div>
      <div class="two-col" style="margin-bottom: 14px;">
        <div>
          <div class="section-title">🍩 Trạng thái Issue & Rủi ro</div>
          <div class="card" style="height: 190px; display: flex; align-items: center; justify-content: center;">${issueChartHtml}</div>
        </div>
        <div>
          <div class="section-title">📊 Tiến độ theo nhà thầu</div>
          <div class="card" id="dashOwner" style="height: 190px; overflow-y: auto;"></div>
        </div>
      </div>
      <div class="two-col">
        <div>
          <div class="section-title">📦 Tổng quan theo phân hệ</div>
          <div class="card" id="dashModules"></div>
        </div>
        <div>
          <div class="section-title">⏰ Hạng mục quá hạn & Cảnh báo</div>
          <div class="card" id="dashAlertsOd" style="max-height: 320px; overflow-y: auto; padding-right: 8px;"></div>
        </div>
      </div>`;

    // Render Contractor Progress
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
      }).join("") + `<div style="font-size:11px;color:var(--ink-faint);margin-top:12px; text-align: right;">Tổng hợp từ: ${ownerModules.map(m => m.label).join(", ")}</div>`;
    } else ownerHost.innerHTML = `<div class="empty-note">Chưa có module nào gắn cột nhà thầu.</div>`;

    // Render Module Progress
    const modHost = root.querySelector("#dashModules");
    modHost.innerHTML = allModules.map(m => {
      const s = stats[m.id];
      const pct = s.avgProgress !== null ? s.avgProgress : 0;
      return `<div class="contractor-row"><div class="c-name" style="width:170px" title="${esc(m.title)}">${esc(m.icon)} ${esc(m.label)}</div>
        <div class="c-bar"><div class="pbar sm"><div style="width:${pct}%;background:${pctColor(pct)}"></div></div></div>
        <div class="c-pct">${s.avgProgress !== null ? pct + "%" : s.total}</div></div>`;
    }).join("");

    // Render Alerts & Overdue (Gộp chung để tối ưu UX)
    const alHost = root.querySelector("#dashAlertsOd");
    let alertsHtml = "";
    
    if (overdueAll.length) {
      alertsHtml += `<div class="alert-section-title">Quá hạn (${overdueAll.length})</div>`;
      alertsHtml += overdueAll.slice(0, 15).map(({ row, module }) => `
        <div class="alert-item"><div class="alert-dot" style="background:var(--red-500); animation: pulse 1s infinite;"></div>
          <div><div class="a-title">${esc(row[module.primaryColumn] || row[module.columns[0].key] || "")}</div>
          <div class="a-meta">${esc(module.label)} · ${esc(row[module.ownerColumn] || "—")} · Hạn: <b style="color:var(--red-500)">${fmtDate(row[module.dueColumn])}</b></div></div></div>`).join("");
    }
    
    if (alertAll.length) {
      alertsHtml += `<div class="alert-section-title">Cảnh báo Mức Cao (${alertAll.length})</div>`;
      alertsHtml += alertAll.map(({ row, module }) => `
        <div class="alert-item"><div class="alert-dot" style="background:var(--amber-500)"></div>
          <div><div class="a-title">${esc(row[module.primaryColumn] || row[module.columns[0].key] || "")}</div>
          <div class="a-meta">${esc(module.label)} · ${esc(row[module.ownerColumn] || "—")}</div></div></div>`).join("");
    }
    
    if (!alertsHtml) alertsHtml = `<div class="empty-note" style="text-align: center; padding: 30px 10px;">🎉<br><br>Tuyệt vời!<br>Không có hạng mục nào trễ hạn hay cảnh báo rủi ro.</div>`;
    
    alHost.innerHTML = alertsHtml;
  }

  /* ============================================================================
     WORK CALENDAR — V3 (module.kind === "calendar")
     ============================================================================ */
  const CAL_EMP_KEY = "hpc_current_employee";

  function calGetCurrentEmployee() {
    try { return localStorage.getItem(CAL_EMP_KEY) || ""; } catch (e) { return ""; }
  }
  function calSetCurrentEmployee(name) {
    try { localStorage.setItem(CAL_EMP_KEY, name || ""); } catch (e) { /* ignore */ }
  }

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

  function calStatusBadgeClass(moduleCfg, status, row) {
    const color = (moduleCfg.statusColorMap || {})[status] || "gray";
    let badge = badgeColor(color);
    // Logic trễ hạn: Ngày việc < Hôm nay VÀ chưa Hoàn thành/Hủy
    if (row && row[moduleCfg.dateColumn] && row[moduleCfg.dateColumn] < todayStr() && status !== "Hoàn thành" && status !== "Hủy") {
      badge += " b-overdue";
    }
    return badge;
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
      <span class="badge ${calStatusBadgeClass(moduleCfg, row[moduleCfg.statusColumn], row)}">${esc(row[moduleCfg.statusColumn] || "")}</span>
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
        
        <div class="form-row"><label>Nơi làm việc / Dự án</label>
          <input list="calProjectList" class="form-field" id="calfProject" value="${esc((editing && editing[moduleCfg.projectColumn]) || window.HPC_CONFIG.PROJECT_NAME)}">
          <datalist id="calProjectList">
            ${(window.HPC_CONFIG.PROJECT_OPTIONS || [window.HPC_CONFIG.PROJECT_NAME]).map(p => `<option value="${esc(p)}">`).join("")}
          </datalist>
        </div>

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
        [moduleCfg.projectColumn]: backdrop.querySelector("#calfProject").value.trim() || window.HPC_CONFIG.PROJECT_NAME,
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
    if (!CAL_STATE.anchorDate) {
      CAL_STATE.anchorDate = todayStr();
      const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1);
      CAL_STATE.fromDate = d.toISOString().slice(0, 10);
      const d2 = new Date(d); d2.setDate(d.getDate() + 6);
      CAL_STATE.toDate = d2.toISOString().slice(0, 10);
    }
    let currentEmployee = calGetCurrentEmployee();

    const wrap = document.createElement("div");
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar cal-toolbar";
    toolbar.innerHTML = `
      <span style="font-size:12.3px;color:var(--ink-soft);font-weight:600">Bạn là:</span>
      <input list="calEmpList" class="search-box" id="calEmployeeInput" style="min-width:140px" placeholder="Nhập tên…" value="${esc(currentEmployee)}">
      <datalist id="calEmpList"></datalist>
      <span class="filter-chip${CAL_STATE.mode === "day" ? " active" : ""}" data-mode="day">Ngày</span>
      <span class="filter-chip${CAL_STATE.mode === "week" ? " active" : ""}" data-mode="week">Tuần</span>
      <span class="filter-chip${CAL_STATE.mode === "list" ? " active" : ""}" data-mode="list">Tổng quan (Manager)</span>
      
      <span class="spacer" style="flex:1"></span>

      <span id="calDateFilters" style="display:flex; gap: 8px; align-items:center; margin-right: 12px; ${CAL_STATE.mode === 'list' ? '' : 'display:none'}">
        <input type="date" class="search-box" style="padding:4px 8px" id="calFromDate" value="${CAL_STATE.fromDate}">
        <span>-</span>
        <input type="date" class="search-box" style="padding:4px 8px" id="calToDate" value="${CAL_STATE.toDate}">
      </span>

      <button class="btn sm" id="calPrev" ${CAL_STATE.mode === 'list' ? 'style="display:none"' : ''}>‹</button>
      <button class="btn sm" id="calToday" ${CAL_STATE.mode === 'list' ? 'style="display:none"' : ''}>Hôm nay</button>
      <button class="btn sm" id="calNext" ${CAL_STATE.mode === 'list' ? 'style="display:none"' : ''}>›</button>
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
        toolbar.querySelector("#calDateFilters").style.display = CAL_STATE.mode === "list" ? "flex" : "none";
        toolbar.querySelector("#calPrev").style.display = CAL_STATE.mode === "list" ? "none" : "";
        toolbar.querySelector("#calToday").style.display = CAL_STATE.mode === "list" ? "none" : "";
        toolbar.querySelector("#calNext").style.display = CAL_STATE.mode === "list" ? "none" : "";
        draw();
      };
    });

    toolbar.querySelector("#calFromDate").onchange = e => { CAL_STATE.fromDate = e.target.value; draw(); };
    toolbar.querySelector("#calToDate").onchange = e => { CAL_STATE.toDate = e.target.value; draw(); };

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
          ev.className = "cal-mini-event badge " + calStatusBadgeClass(moduleCfg, r[moduleCfg.statusColumn], r);
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
      const from = CAL_STATE.fromDate;
      const to = CAL_STATE.toDate;
      if (!from || !to || from > to) {
        host.innerHTML = `<div class="empty-note">Vui lòng chọn khoảng thời gian hợp lệ.</div>`; return;
      }

      const allRows = store.getSheetData(moduleCfg.sheet).rows;
      const rowsInRange = allRows.filter(r => r[moduleCfg.dateColumn] >= from && r[moduleCfg.dateColumn] <= to);
      const displayRows = currentEmployee ? rowsInRange.filter(r => (r[moduleCfg.employeeColumn] || "").trim().toLowerCase() === currentEmployee.toLowerCase()) : rowsInRange;

      const dateList = [];
      let curr = new Date(from);
      const end = new Date(to);
      while (curr <= end && dateList.length < 31) { 
        dateList.push(curr.toISOString().slice(0, 10));
        curr.setDate(curr.getDate() + 1);
      }

      const emps = uniqueValues(displayRows, moduleCfg.employeeColumn).filter(Boolean).sort();
      if (!emps.length) emps.push(currentEmployee || "Tất cả nhân viên");

      const wrapper = document.createElement("div");
      wrapper.style.overflowX = "auto";
      wrapper.style.background = "var(--card)";
      wrapper.style.borderRadius = "var(--radius)";
      wrapper.style.border = "1px solid var(--line)";
      wrapper.style.padding = "0";

      let html = `<table class="cal-timeline-table"><thead><tr>
        <th style="position:sticky; left:0; z-index:2;">Nhân viên</th>
        ${dateList.map(d => {
          const wd = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][new Date(d).getDay()];
          return `<th>${wd}<br><span class="mono">${d.slice(8, 10)}/${d.slice(5, 7)}</span></th>`;
        }).join("")}
      </tr></thead><tbody>`;

      emps.forEach(emp => {
        html += `<tr>
          <td class="cal-timeline-emp" style="position:sticky; left:0; background:#fff; z-index:1;">${esc(emp)}</td>
          ${dateList.map(d => {
            const tasks = displayRows.filter(r => (r[moduleCfg.employeeColumn] || "") === (emp === "Tất cả nhân viên" ? "" : emp) && r[moduleCfg.dateColumn] === d);
            tasks.sort((a, b) => (a[moduleCfg.startColumn] || "").localeCompare(b[moduleCfg.startColumn] || ""));
            let cellHtml = tasks.map(t => {
              const badge = calStatusBadgeClass(moduleCfg, t[moduleCfg.statusColumn], t);
              return `<div class="cal-mini-event badge ${badge}" style="margin-bottom:5px; white-space:normal; cursor:pointer;" 
                           title="[${esc(t[moduleCfg.projectColumn])}] ${esc(t[moduleCfg.titleColumn])}" 
                           onclick="window._editCalEvent('${t.ID}')">
                <b class="mono" style="font-size:10px">${esc(t[moduleCfg.startColumn])}</b> ${esc(t[moduleCfg.titleColumn])}
              </div>`;
            }).join("");
            return `<td>${cellHtml}</td>`;
          }).join("")}
        </tr>`;
      });

      html += `</tbody></table>`;
      wrapper.innerHTML = html;
      host.appendChild(wrapper);

      window._editCalEvent = (id) => {
         const r = allRows.find(x => x.ID === id);
         if(r) calPopupForm(moduleCfg, { row: r, employee: r[moduleCfg.employeeColumn], onSaved: draw });
      };
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