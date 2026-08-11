/* ==========================================================================
   HELIX PROJECT CONTROL — V2
   app.js — Khởi động ứng dụng: nạp cấu hình, tự phát hiện module, vẽ sidebar/
   topbar, điều phối render. File này KHÔNG cần sửa khi nhân rộng dự án.
   ========================================================================== */

window.HPC_APP = (function () {
  const cfg = window.HPC_CONFIG;
  const store = window.HPC_STORE;
  const engine = window.HPC_ENGINE;

  let MODULES = [];              // danh sách module cuối cùng (config + tự phát hiện)
  let CURRENT_TAB = "dashboard";
  let ROLE = "ALL";
  let currentDraw = null;        // hàm draw() của view hiện tại, gọi lại khi có dữ liệu mới
  let syncBadgeTimer = null;

  function esc(s) { return engine.esc(s); }

  /* ------------------------- tự phát hiện module mới ------------------------- */
  // Bất kỳ tab Google Sheet nào KHÔNG được khai báo trong config.js MODULES sẽ
  // tự động xuất hiện như 1 module chung chung. Nhờ đó thêm 1 tab mới trong
  // Google Sheet = có ngay 1 màn hình quản lý mới, không cần sửa code.
  function buildModuleList() {
    const declaredSheets = cfg.MODULES.map(m => m.sheet);
    const autoModules = store.getAllSheetNames()
      .filter(name => !declaredSheets.includes(name))
      .map(name => ({
        id: "auto_" + name, sheet: name, label: name, icon: "▧",
        group: "KHÁC (TỰ PHÁT HIỆN)", kind: "table",
        title: name, sub: "Module tự phát hiện từ tab \"" + name + "\" trong Google Sheet",
      }));
    MODULES = cfg.MODULES.concat(autoModules);
  }

  function moduleById(id) { return MODULES.find(m => m.id === id) || MODULES[0]; }

  function groupedNav() {
    const order = [];
    const byGroup = {};
    MODULES.forEach(m => {
      if (!byGroup[m.group]) { byGroup[m.group] = []; order.push(m.group); }
      byGroup[m.group].push(m);
    });
    return order.map(g => ({ group: g, items: byGroup[g] }));
  }

  function countFor(m) {
    if (m.id === "dashboard") return "";
    const data = store.getSheetData(m.sheet);
    return data.rows.length;
  }

  /* ------------------------------- render sidebar ------------------------------- */
  function renderSidebar() {
    document.getElementById("brandShort").textContent = cfg.BRAND_SHORT;
    document.getElementById("brandName").textContent = cfg.BRAND_NAME;
    document.getElementById("brandProj").innerHTML = esc(cfg.PROJECT_NAME) + "<br>" + esc(cfg.ORG_LINE);

    const nav = document.getElementById("navTabs");
    nav.innerHTML = "";
    const dashLbl = document.createElement("div");
    dashLbl.className = "grp-label"; dashLbl.textContent = "ĐIỀU HÀNH";
    nav.appendChild(dashLbl);
    nav.appendChild(navBtn({ id: "dashboard", label: "Dashboard", icon: "◈" }));

    groupedNav().forEach(g => {
      const lbl = document.createElement("div");
      lbl.className = "grp-label"; lbl.textContent = g.group;
      nav.appendChild(lbl);
      g.items.forEach(m => nav.appendChild(navBtn(m)));
    });
  }

  function navBtn(m) {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (m.id === CURRENT_TAB ? " active" : "");
    btn.innerHTML = `<span class="ic">${m.icon}</span><span>${esc(m.label)}</span><span class="cnt">${countFor(m)}</span>`;
    btn.onclick = () => { CURRENT_TAB = m.id; render(); };
    return btn;
  }

  function refreshNavCounts() { renderSidebar(); }

  /* ------------------------------- render topbar ------------------------------- */
  function renderTopbar() {
    const sel = document.getElementById("roleFilter");
    sel.innerHTML = `<option value="ALL">👁 Toàn liên danh (PM view)</option>` +
      cfg.ROLE_OPTIONS.map(c => `<option value="${esc(c)}">${esc(c)} — chỉ việc của mình</option>`).join("");
    sel.value = ROLE;
    sel.onchange = () => { ROLE = sel.value; render(); };

    if (CURRENT_TAB === "dashboard") {
      document.getElementById("pageTitle").textContent = "Dashboard";
      document.getElementById("pageSub").textContent = "Tổng quan điều hành dự án — Real-time từ Google Sheet";
    } else {
      const m = moduleById(CURRENT_TAB);
      document.getElementById("pageTitle").textContent = m.title || m.label;
      document.getElementById("pageSub").textContent = m.sub || "";
    }
    renderSyncPill();
  }

  function renderSyncPill() {
    const pill = document.getElementById("syncPill");
    const state = store.syncState;
    pill.className = "sync-pill " + (state === "syncing" ? "syncing" : state === "synced" ? "synced" : state === "error" ? "error" : "");
    const label = { idle: "Chưa tải dữ liệu", syncing: "Đang đồng bộ…", synced: "Đã đồng bộ với Google Sheet", error: "Lỗi đồng bộ: " + (store.lastError || "") }[state] || state;
    pill.innerHTML = `<span class="dot"></span><span>${esc(label)}</span>`;
  }

  function refreshSyncBadgeSoon() {
    clearTimeout(syncBadgeTimer);
    syncBadgeTimer = setTimeout(renderSyncPill, 150);
  }

  /* --------------------------------- render main --------------------------------- */
  function render() {
    renderSidebar();
    renderTopbar();
    const root = document.getElementById("viewRoot");
    root.innerHTML = "";
    if (CURRENT_TAB === "dashboard") {
      currentDraw = () => {
        engine.renderDashboard(root, cfg.MODULES.filter(m => m.kind === "table"), ROLE);
        // Widget "Công việc hôm nay" — bổ sung riêng, không sửa renderDashboard() gốc.
        const calModule = MODULES.find(m => m.kind === "calendar");
        if (calModule) engine.renderTodayWorkWidget(root, calModule);
      };
      currentDraw();
    } else {
      const m = moduleById(CURRENT_TAB);
      currentDraw = (m.kind === "calendar") ? engine.renderCalendar(root, m) : engine.renderTable(root, m, ROLE);
    }
  }

  function softRefresh() {
    // gọi khi auto-pull kéo được dữ liệu mới: vẽ lại view hiện tại + đếm số dòng ở sidebar
    refreshNavCounts();
    renderTopbar();
    if (CURRENT_TAB === "dashboard") render(); else if (currentDraw) currentDraw();
  }

  /* ----------------------------------- init ----------------------------------- */
  async function init() {
    document.getElementById("btnForceSync").onclick = async () => {
      await store.forceFlush();
      renderSyncPill();
    };
    document.getElementById("btnRefresh").onclick = async () => {
      try { await store.loadAll(); buildModuleList(); softRefresh(); }
      catch (e) { alert("Không tải được dữ liệu: " + e.message); }
    };
    document.getElementById("btnOpenSheet").onclick = () => {
      window.open(cfg.API_URL.replace("/exec", "/edit"), "_blank");
    };
    document.getElementById("btnExportExcel").onclick = () => window.HPC_EXPORT.exportExcel(MODULES);

    store.onChange(() => { renderSyncPill(); });

    // Ghi nhận mọi tương tác của người dùng (gõ phím, click, chọn ô...) để
    // auto-pull hoãn lại, tránh render đè lên dữ liệu đang gõ dở. Xem
    // store.js -> markActivity() / startAutoPull().
    ["input", "keydown", "click", "change"].forEach(evt => {
      document.addEventListener(evt, () => store.markActivity(), { passive: true });
    });

    try {
      await store.loadAll();
      buildModuleList();
      document.getElementById("loadingScreen").style.display = "none";
      render();
      // Chỉ vẽ lại view khi auto-pull thực sự có dữ liệu MỚI TỪ XA — KHÔNG
      // vẽ lại khi chỉ đơn thuần là push (lưu) dòng mình vừa sửa/thêm xong,
      // để không làm mất ô đang gõ dở ở dòng/ô khác.
      store.onDataChange(() => softRefresh());
    } catch (e) {
      document.getElementById("loadingScreen").innerHTML = `
        <div class="disp" style="font-size:16px">Không kết nối được Google Sheet</div>
        <div style="font-size:12.5px;color:#9DBBD6;max-width:420px;text-align:center;line-height:1.6">
          Lỗi: ${esc(e.message)}<br><br>
          Kiểm tra lại <b>API_URL</b> trong js/config.js đã trỏ đúng link Apps Script Web App
          (đuôi <b>/exec</b>) và đã Deploy với quyền truy cập "Anyone" chưa.
        </div>
        <button class="btn primary" onclick="location.reload()">Thử lại</button>`;
    }
  }

  return { init, render, refreshNavCounts, refreshSyncBadgeSoon, moduleById, get MODULES() { return MODULES; } };
})();

document.addEventListener("DOMContentLoaded", () => {
  // Chỉ chạy app khi đã đăng nhập; auth.js tự gọi lại init() sau khi nhập đúng
  // mật khẩu. Xem js/auth.js — không đổi gì trong logic init() bên trên.
  if (window.HPC_AUTH.check(window.HPC_APP.init)) window.HPC_APP.init();
});
