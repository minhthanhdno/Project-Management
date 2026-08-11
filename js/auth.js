/* ==========================================================================
   HELIX PROJECT CONTROL — V3
   auth.js — Màn hình chặn mật khẩu đơn giản (Phương án 2), KHÔNG phân quyền.
   File MỚI, không sửa app.js/engine.js/store.js — chỉ app.js gọi 1 hàm ở đây
   trước khi init() (xem cuối app.js).

   Cơ chế: nhập đúng SITE_PASSWORD (config.js) -> lưu cờ vào sessionStorage ->
   cho phép app.js chạy tiếp. Đóng trình duyệt / tab là mất phiên, phải nhập lại.
   ========================================================================== */

window.HPC_AUTH = (function () {
  const FLAG_KEY = "hpc_authed_v1";

  function isAuthed() {
    return sessionStorage.getItem(FLAG_KEY) === "1";
  }

  // Trả về true nếu đã đăng nhập (app.js chạy init() ngay).
  // Nếu chưa, hiển thị màn hình nhập mật khẩu và tự gọi onSuccess() khi đúng.
  function check(onSuccess) {
    if (isAuthed()) return true;
    renderGate(onSuccess);
    return false;
  }

  function renderGate(onSuccess) {
    const box = document.createElement("div");
    box.className = "auth-gate";
    box.innerHTML = `
      <div class="auth-card">
        <div class="auth-brand">${window.HPC_CONFIG.BRAND_SHORT || "HX"}</div>
        <h2>${window.HPC_CONFIG.BRAND_NAME || "Project Control"}</h2>
        <p>Nhập mật khẩu để tiếp tục</p>
        <input type="password" class="auth-input" placeholder="Mật khẩu" autofocus>
        <button class="auth-btn">Vào xem</button>
        <div class="auth-err" style="display:none">Sai mật khẩu, thử lại nhé.</div>
      </div>`;
    document.body.appendChild(box);

    const input = box.querySelector(".auth-input");
    const err = box.querySelector(".auth-err");
    const submit = () => {
      if (input.value === window.HPC_CONFIG.SITE_PASSWORD) {
        sessionStorage.setItem(FLAG_KEY, "1");
        box.remove();
        onSuccess();
      } else {
        err.style.display = "block";
        input.value = "";
        input.focus();
      }
    };
    box.querySelector(".auth-btn").onclick = submit;
    input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    input.focus();
  }

  return { check };
})();
