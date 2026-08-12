/* ==========================================================================
   HELIX PROJECT CONTROL — V2
   config.js — FILE DUY NHẤT CẦN SỬA KHI NHÂN RỘNG SANG DỰ ÁN MỚI.

   Khi làm dự án mới, bạn chỉ cần:
   1) Tạo Google Sheet mới theo đúng cấu trúc (xem README.md + seed/*.xlsx mẫu)
   2) Dán backend/Code.gs vào Apps Script của Sheet đó, Deploy > Web app
   3) Đổi API_URL bên dưới bằng link Web app mới
   4) Đổi PROJECT_NAME / ROLE_OPTIONS cho đúng dự án
   => KHÔNG cần sửa bất kỳ file .js/.css nào khác. Cột dữ liệu thêm/bớt trực
      tiếp trên Google Sheet sẽ tự động xuất hiện trên giao diện (xem README).
   ========================================================================== */

window.HPC_CONFIG = {

  // 1. Link Apps Script Web App (đuôi /exec) — backend đọc/ghi Google Sheet.
  //    Sau khi dán backend/Code.gs vào Apps Script và Deploy, dán link vào đây.
  //    Xem README.md mục 1. Muốn thử nhanh không cần Google Sheet thật: chạy
  //    `python3 dev/mock_server.py` rồi để nguyên giá trị localhost bên dưới.
  API_URL: "https://script.google.com/macros/s/AKfycbyvDWqNxdgap0R80QkO9Q4w_CUhInA21-lQkEShNtQedtTb6ZEaGX_JyKmS_ZR4S2-b/exec",  // ⚠️ THAY BẰNG LINK APPS SCRIPT WEB APP THẬT CỦA BẠN TRƯỚC KHI DÙNG THẬT

  // 1b. ĐĂNG NHẬP ĐƠN GIẢN (không phân quyền theo người dùng):
  //     - SITE_PASSWORD: mật khẩu để mở được giao diện (chặn người lạ có link) — xem js/auth.js
  //     - ACCESS_TOKEN: mã bí mật gửi kèm mọi request lên backend — PHẢI TRÙNG
  //       với ACCESS_TOKEN khai báo trong backend/Code.gs, để ai đó có link Apps
  //       Script cũng không gọi thẳng lấy được dữ liệu nếu không có mã này.
  //     ⚠️ Đây KHÔNG phải bảo mật cấp doanh nghiệp (mật khẩu/token nằm trong
  //     source JS, ai xem F12 vẫn thấy được) — chỉ đủ để chặn người lạ tình cờ
  //     có link hoặc dò tìm ngẫu nhiên. Nhớ đổi 2 giá trị dưới đây trước khi dùng.
  SITE_PASSWORD: "helix2026",
  ACCESS_TOKEN: "hpc-secret-8f3a1c",

  // 2. Thông tin hiển thị chung
  PROJECT_NAME: "BVĐK Bình Dương — 1.500 giường",
  // THÊM DÒNG NÀY: Danh sách các dự án/nơi làm việc để chọn linh hoạt trong Lịch công việc
  PROJECT_OPTIONS: ["BVĐK Bình Dương — 1.500 giường", "Việc văn phòng (Internal)", "Dự án Khác", "Việc cá nhân"],
  
  ORG_LINE: "Liên danh: HELIX · Thành An 96 · Sao Nam An",
  BRAND_SHORT: "HX",
  BRAND_NAME: "HELIX PC",

  // 3. Danh sách "vai trò" dùng để lọc theo nhà thầu trên toàn bộ tool.
  //    Phải khớp với cách viết tên nhà thầu trong dữ liệu (không phân biệt hoa/thường).
  ROLE_OPTIONS: ["HELIX", "Thành An 96", "Sao Nam An"],

  // 3b. WORK CALENDAR: nguồn gợi ý tên nhân viên khi chọn "Bạn là ai" — tái sử
  //     dụng cột Name của sheet Đầu mối liên hệ (không tạo bảng Employee mới).
  //     Không bắt buộc phải có dữ liệu sẵn; người dùng vẫn có thể tự nhập tên.
  EMPLOYEE_HINT_SHEET: "DauMoiLienHe", EMPLOYEE_HINT_COLUMN: "Name",

  // 4. Tự động đồng bộ kéo dữ liệu mới từ Google Sheet mỗi N giây (đồng bộ 2 chiều:
  //    ai sửa trực tiếp trên Google Sheet / AppSheet cũng sẽ thấy trên tool).
  //    Đặt 0 để tắt tự động, chỉ đồng bộ khi bấm nút "Làm mới".
  AUTO_PULL_SECONDS: 20,

  // 4b. CHỈ thực sự tự đồng bộ khi người dùng NGƯNG tương tác (gõ/click/chọn)
  //     liên tục trong khoảng này (giây) — tránh render đè lên ô đang gõ dở.
  AUTO_PULL_IDLE_SECONDS: 120, // 2 phút

  // 5. Độ trễ gộp trước khi đẩy 1 thay đổi lên Google Sheet (ms). Gõ liên tục
  //    trong khoảng này chỉ gửi 1 lần lên server, tránh spam request.
  PUSH_DEBOUNCE_MS: 600,

  /* ------------------------------------------------------------------------
     6. MODULES — mỗi module = 1 tab Google Sheet + 1 tab giao diện.
     - "sheet" phải trùng CHÍNH XÁC tên tab trong Google Sheet.
     - "columns" là TÙY CHỌN: nếu bỏ trống, engine tự đọc toàn bộ cột từ dòng
       header của Sheet và hiển thị dạng text (kiểu dữ liệu ngày/%/checkbox/
       dropdown sẽ được suy luận tự động — xem js/engine.js -> inferColumn()).
       Khai báo "columns" ở đây chỉ để đặt nhãn tiếng Việt đẹp + ép kiểu chính
       xác + thứ tự cột mong muốn.
     - Bất kỳ tab Sheet nào KHÔNG được khai báo dưới đây vẫn tự động hiện ra
       như 1 module chung chung (generic) — xem app.js -> autoDiscoverModules().
  ------------------------------------------------------------------------ */
  MODULES: [
    {
      id: "tasks", sheet: "TienDoThiCong", label: "Tiến độ Thi công", icon: "▤",
      group: "CÔNG VIỆC & PHỤ THUỘC", kind: "table",
      title: "Tiến độ Thi công Liên danh",
      sub: "WBS: Giai đoạn → Hạng mục — theo dõi ngày bắt đầu / hạn hoàn thành",
      groupByColumn: "Phase", primaryColumn: "Name", ownerColumn: "Contractor",
      doneColumn: "Done", dueColumn: "Due",
      columns: [
        { key: "Code", label: "#", type: "text", width: "52px" },
        { key: "Name", label: "Hạng mục công việc", type: "text", primary: true },
        { key: "Contractor", label: "Nhà thầu", type: "select", options: ["HELIX", "Thành An 96", "Sao Nam An", "Tất cả", "CĐT, HELIX", "Cả 3 nhà thầu"] },
        { key: "HospitalPIC", label: "Nhân sự BV/TVGS", type: "text" },
        { key: "Start", label: "Bắt đầu", type: "date" },
        { key: "Duration", label: "Số ngày", type: "text", width: "70px" },
        { key: "Due", label: "Hạn hoàn thành", type: "date" },
        { key: "Evidence", label: "Minh chứng", type: "file" }
        { key: "Note", label: "Ghi chú PM", type: "text" },
        { key: "Done", label: "Xong", type: "checkbox", width: "56px" },
      ]
    },
    {
      id: "checklist", sheet: "ChecklistHoSoTT", label: "Checklist Hồ sơ TT", icon: "☑",
      group: "CÔNG VIỆC & PHỤ THUỘC", kind: "table",
      title: "Checklist Hồ sơ Thanh toán",
      sub: "Minh chứng / hồ sơ bắt buộc gắn với từng mốc thanh toán",
      groupByColumn: "Phase", primaryColumn: "Name", ownerColumn: "Contractor",
      doneColumn: "Done", dueColumn: "End",
      columns: [
        { key: "Code", label: "#", type: "text", width: "52px" },
        { key: "Name", label: "Hạng mục công việc", type: "text", primary: true },
        { key: "Contractor", label: "Nhân sự nhà thầu", type: "text" },
        { key: "HospitalPIC", label: "Nhân sự BV/TVGS", type: "text" },
        { key: "Start", label: "Bắt đầu", type: "date" },
        { key: "End", label: "Hoàn thành", type: "date" },
        { key: "Evidence", label: "Minh chứng / Hồ sơ TT bắt buộc", type: "text" },
        { key: "Risk", label: "Rủi ro / Chú ý PM", type: "text" },
        { key: "Done", label: "Xong", type: "checkbox", width: "56px" },
      ]
    },
    {
      id: "issues", sheet: "IssueRuiRo", label: "Issue & Rủi ro", icon: "⚠",
      group: "CHẤT LƯỢNG & SỰ CỐ", kind: "table",
      title: "Issue & Risk Management",
      sub: "Sự cố đã xảy ra và rủi ro tiềm ẩn — theo dõi đến khi CLOSED",
      ownerColumn: "Contractor", dueColumn: "DueDate",
      filterColumn: "Status", filterOptions: ["OPEN", "IN_PROGRESS", "CLOSED"],
      alertColumn: "Level", alertValue: "HIGH", alertExcludeStatus: "CLOSED", statusColumnForAlert: "Status",
      columns: [
        { key: "Code", label: "Mã", type: "text", width: "80px" },
        { key: "Category", label: "Loại", type: "select", options: ["Issue", "Risk"], width: "80px" },
        { key: "Title", label: "Tiêu đề", type: "text", primary: true },
        { key: "Impact", label: "Ảnh hưởng", type: "text" },
        { key: "Level", label: "Mức", type: "status", options: ["HIGH", "MEDIUM", "LOW"],
          colorMap: { HIGH: "red", MEDIUM: "amber", LOW: "green" }, width: "100px" },
        { key: "Contractor", label: "Nhà thầu", type: "text" },
        { key: "Owner", label: "Owner", type: "text" },
        { key: "Status", label: "Trạng thái", type: "status", options: ["OPEN", "IN_PROGRESS", "CLOSED"],
          colorMap: { OPEN: "red", IN_PROGRESS: "amber", CLOSED: "green" }, width: "110px" },
        { key: "DueDate", label: "Hạn xử lý", type: "date" },
        { key: "Solution", label: "Phương án xử lý", type: "text" },
      ]
    },
    {
      id: "software", sheet: "PhanMem", label: "16 Phần mềm", icon: "▦",
      group: "PHẦN MỀM", kind: "table",
      title: "Tiến độ Phần mềm",
      sub: "Khảo sát → Cài đặt & Tích hợp → Đào tạo & UAT",
      groupByColumn: "Group", primaryColumn: "Name", ownerColumn: "Contractor",
      doneColumn: "Done", progressColumns: ["SurveyPct", "InstallPct", "TrainPct"],
      columns: [
        { key: "Stt", label: "#", type: "text", width: "40px" },
        { key: "Name", label: "Tên phần mềm / hệ thống", type: "text", primary: true },
        { key: "Contractor", label: "Nhà thầu", type: "select", options: ["HELIX", "Thành An 96", "Sao Nam An"] },
        { key: "Supplier", label: "Đơn vị cung cấp", type: "text" },
        { key: "Pic", label: "Người phụ trách", type: "text" },
        { key: "DeployDate", label: "Ngày triển khai", type: "date" },
        { key: "SurveyPct", label: "%KS", type: "percent", width: "64px" },
        { key: "InstallPct", label: "%Cài đặt", type: "percent", width: "64px" },
        { key: "TrainPct", label: "%UAT", type: "percent", width: "64px" },
        { key: "Note", label: "Ghi chú & Rủi ro", type: "text" },
        { key: "Done", label: "Xong", type: "checkbox", width: "56px" },
      ]
    },
    {
      id: "dailylog", sheet: "NhatKyThiCong", label: "Nhật ký Thi công", icon: "✎",
      group: "HIỆN TRƯỜNG & HỒ SƠ", kind: "table",
      title: "Nhật ký Thi công Hiện trường",
      sub: "Nhật ký hàng ngày — xác nhận TVGS / PM",
      ownerColumn: "Contractor", dueColumn: "Date", defaultSort: "Date:desc",
      columns: [
        { key: "Date", label: "Ngày", type: "date", width: "110px" },
        { key: "Contractor", label: "Nhà thầu", type: "select", options: ["HELIX", "Thành An 96", "Sao Nam An", "Cả 3 nhà thầu"] },
        { key: "Location", label: "Vị trí / hạng mục", type: "text" },
        { key: "Content", label: "Nội dung công việc", type: "textarea", primary: true },
        { key: "Evidence", label: "Minh chứng", type: "file" }
        { key: "TvgsConfirm", label: "TVGS xác nhận", type: "checkbox", width: "70px" },
        { key: "PmConfirm", label: "PM xác nhận", type: "checkbox", width: "70px" },
        { key: "Note", label: "Ghi chú", type: "text" },
      ]
    },
    {
      id: "documents", sheet: "HoSoDuAn", label: "Hồ sơ Dự án", icon: "▥",
      group: "HIỆN TRƯỜNG & HỒ SƠ", kind: "table",
      title: "Document Center — Hồ sơ Dự án",
      sub: "Hợp đồng, công văn, biên bản, mẫu TK01–TK09",
      groupByColumn: "Group", primaryColumn: "Name",
      filterColumn: "Status",
      columns: [
        { key: "Stt", label: "#", type: "text", width: "40px" },
        { key: "Name", label: "Tên hồ sơ / biên bản", type: "text", primary: true },
        { key: "Category", label: "Phân loại / Mẫu", type: "text" },
        { key: "Unit", label: "Đơn vị chuẩn bị", type: "select", options: ["HELIX", "Thành An 96", "Sao Nam An", "Ban QLDA BV", "Cả Liên danh", "Nhóm Kỹ thuật", "Tổ Phân tích", "Tổ Đào tạo", "Các bên"] },
        { key: "Status", label: "Trạng thái", type: "status", options: ["Đã có", "Chờ ký", "Cần gửi sớm", "Chưa có", "Không áp dụng"],
          colorMap: { "Đã có": "green", "Chờ ký": "amber", "Cần gửi sớm": "amber", "Chưa có": "red", "Không áp dụng": "gray" } },
        { key: "Link", label: "Link lưu trữ / Ghi chú", type: "text" },
      ]
    },
    {
      id: "finance", sheet: "MocThanhToan", label: "Mốc Thanh toán", icon: "฿",
      group: "TÀI CHÍNH & LIÊN HỆ", kind: "table",
      title: "Financial & Milestone",
      sub: "Tiến độ nghiệm thu gắn với dòng tiền",
      columns: [
        { key: "Name", label: "Mốc thanh toán", type: "text", primary: true },
        { key: "Pct", label: "% HĐ", type: "percent", width: "70px" },
        { key: "Condition", label: "Điều kiện nghiệm thu", type: "text" },
        { key: "Status", label: "Trạng thái", type: "status", options: ["Chưa đạt", "Đang chờ nghiệm thu", "Đã nhận"],
          colorMap: { "Chưa đạt": "gray", "Đang chờ nghiệm thu": "amber", "Đã nhận": "green" } },
        { key: "Date", label: "Ngày", type: "date" },
      ]
    },
    {
      id: "contacts", sheet: "DauMoiLienHe", label: "Đầu mối Liên hệ", icon: "☎",
      group: "TÀI CHÍNH & LIÊN HỆ", kind: "table",
      title: "Đầu mối Liên hệ Dự án",
      sub: "Bệnh viện · Nhà thầu · Tư vấn giám sát",
      groupByColumn: "Side", primaryColumn: "Name",
      columns: [
        { key: "Role", label: "Phụ trách", type: "text" },
        { key: "Name", label: "Họ tên", type: "text", primary: true },
        { key: "Phone", label: "Điện thoại", type: "text" },
        { key: "Note", label: "Ghi chú", type: "text" },
      ]
    },
    /* ------------------------------------------------------------------
       WORK CALENDAR — V3. Lịch công việc cá nhân + Manager view.
       kind:"calendar" -> engine.renderCalendar() thay vì renderTable().
       Chế độ "Danh sách" bên trong tái sử dụng NGUYÊN engine.renderTable()
       (không viết lại) vì cấu trúc {columns,rows} giống hệt module bảng.
       Không tạo Project/Task/Employee mới: Project lấy từ PROJECT_NAME,
       Task lấy từ module "tasks" (TienDoThiCong) qua taskSourceModule.
    ------------------------------------------------------------------ */
    {
      id: "calendar", sheet: "WorkSchedule", label: "Lịch Công việc", icon: "📅",
      group: "LỊCH CÔNG VIỆC", kind: "calendar",
      title: "Lịch Công việc",
      sub: "Lịch cá nhân hàng ngày — liên kết Dự án & Task hiện có",
      taskSourceModule: "tasks",     // module id dùng làm nguồn "Task" (không tạo Task mới)
      employeeColumn: "Employee",
      dateColumn: "Date", startColumn: "StartTime", endColumn: "EndTime",
      titleColumn: "Title", statusColumn: "Status", noteColumn: "Note",
      projectColumn: "Project", taskIdColumn: "TaskId", taskNameColumn: "TaskName",
      hiddenColumns: ["TaskId"], // ID nội bộ dùng để liên kết Task, không cần hiện trên bảng
      statusOptions: ["Chưa thực hiện", "Đang thực hiện", "Hoàn thành", "Hủy"],
      statusColorMap: { "Chưa thực hiện": "gray", "Đang thực hiện": "amber", "Hoàn thành": "green", "Hủy": "red" },
      columns: [
        { key: "Employee", label: "Nhân viên", type: "text", primary: true },
        { key: "Date", label: "Ngày", type: "date", width: "110px" },
        { key: "StartTime", label: "Từ", type: "text", width: "70px" },
        { key: "EndTime", label: "Đến", type: "text", width: "70px" },
        { key: "Project", label: "Dự án", type: "text" },
        { key: "TaskName", label: "Task liên quan", type: "text" },
        { key: "Title", label: "Công việc", type: "text" },
        { key: "Status", label: "Trạng thái", type: "status",
          options: ["Chưa thực hiện", "Đang thực hiện", "Hoàn thành", "Hủy"],
          colorMap: { "Chưa thực hiện": "gray", "Đang thực hiện": "amber", "Hoàn thành": "green", "Hủy": "red" } },
        { key: "Note", label: "Ghi chú", type: "text" },
      ]
    },
  ],
};
