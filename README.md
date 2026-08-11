# HELIX Project Control — V2
Backend Google Sheets + Apps Script · Đồng bộ 2 chiều · Schema-driven (nhân rộng dự án không cần sửa code)

---

## 0. Kiến trúc tổng quan

```
index.html          → khung giao diện (không chứa logic)
css/styles.css       → toàn bộ giao diện
js/config.js          ★ FILE DUY NHẤT CẦN SỬA KHI NHÂN RỘNG DỰ ÁN
js/api.js             → gọi Google Apps Script Web App (GET/POST)
js/store.js           → bộ nhớ dữ liệu phía client + hàng đợi đồng bộ 2 chiều
js/engine.js          → bộ máy vẽ bảng + Dashboard, DÙNG CHUNG cho mọi module
js/export.js          → xuất Excel (SheetJS, nhúng sẵn — không cần mạng)
js/app.js             → khởi động, routing tab, sidebar, topbar
js/vendor/xlsx.full.min.js → thư viện xuất Excel (nhúng sẵn, không phụ thuộc CDN)
backend/Code.gs        ★ DÁN VÀO GOOGLE APPS SCRIPT (backend)
seed/HPC_Seed_GoogleSheet_Import.xlsx → dữ liệu mẫu để Import vào Google Sheet mới
```

Nguyên tắc cốt lõi: **Google Sheet là nguồn dữ liệu thật (source of truth)**.
- Mỗi **tab Sheet** = 1 module trên giao diện.
- **Dòng 1 của mỗi tab = tên cột** (header). Engine đọc thẳng từ header này.
- Muốn **thêm/bớt cột**: chỉ cần sửa trên Google Sheet (thêm/xoá cột, đổi header) —
  KHÔNG cần sửa file .js/.css nào. Cột mới sẽ tự hiện ra trên giao diện (dạng
  văn bản, hoặc tự suy luận ngày/%/checkbox nếu tên cột gợi ý đúng — xem mục 4).
- Muốn **thêm 1 module/chức năng hoàn toàn mới**: chỉ cần thêm 1 tab mới trong
  Google Sheet — nó sẽ tự xuất hiện trên sidebar (mục "KHÁC (TỰ PHÁT HIỆN)").

---

## 1. Cài đặt lần đầu cho dự án BVĐK Bình Dương (hoặc dự án đang có)

### Bước 1 — Tạo Google Sheet
1. Tạo 1 Google Sheet mới (trống).
2. Menu **File > Import** > tải lên file `seed/HPC_Seed_GoogleSheet_Import.xlsx`
   > Chọn **"Insert new sheet(s)"** để giữ nguyên 8 tab dữ liệu mẫu (đã có sẵn
   > toàn bộ dữ liệu hiện tại của dự án BVĐK Bình Dương, đúng cấu trúc cột).
3. Xoá tab "Sheet1" mặc định trống nếu Google tự tạo thêm.

### Bước 2 — Cài Backend (Apps Script)
1. Trong Google Sheet: **Tiện ích mở rộng (Extensions) > Apps Script**.
2. Xoá hết code mẫu (`function myFunction(){}`), dán toàn bộ nội dung file
   `backend/Code.gs` vào.
3. Bấm **Triển khai (Deploy) > Triển khai mới (New deployment)**:
   - Loại: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Bấm **Deploy**, cấp quyền (Authorize) khi được hỏi.
5. Copy link kết thúc bằng `/exec`.

> ⚠️ Link bạn gửi (`.../AKfycbwi.../exec`) hiện trả về lỗi 404 — nghĩa là chưa
> có Web App nào đang chạy tại đó (có thể AppSheet tạo ra link khác cơ chế, hoặc
> deployment cũ đã gỡ). Bạn cần Deploy lại theo đúng 4 bước trên **từ chính
> Apps Script gắn với Google Sheet chứa dữ liệu**, để chắc chắn API khớp với
> `backend/Code.gs` này. Sau khi deploy, dán link `/exec` mới vào bước 3.

### Bước 3 — Trỏ Frontend vào đúng Sheet
Mở `js/config.js`, sửa dòng:
```js
API_URL: "http://localhost:8899/",
```
thành link `/exec` vừa copy ở Bước 2.

### Bước 4 — Chạy
Mở `index.html` (khuyến khích chạy qua 1 static server nhỏ thay vì mở file
trực tiếp, để tránh một số trình duyệt chặn `fetch` từ `file://`):
```bash
# Cách nhanh nhất — Python có sẵn trên hầu hết máy:
cd hpc_v2
python3 -m http.server 8080
# rồi mở http://localhost:8080 trên trình duyệt
```
Hoặc host lên GitHub Pages / Netlify / bất kỳ static hosting nào — hoạt động
y hệt vì toàn bộ tool chỉ là HTML/CSS/JS tĩnh, dữ liệu nằm hết ở Google Sheet.

---

## 2. Nhân rộng cho dự án mới (bệnh viện khác)

**Không viết lại code.** Các bước:

1. Tạo Google Sheet mới cho dự án mới — có thể copy Sheet cũ
   (**File > Make a copy**) rồi xoá/sửa dữ liệu cũ, hoặc tạo mới hoàn toàn
   theo đúng cấu trúc cột ở mục 4.
2. Copy y nguyên `backend/Code.gs` vào Apps Script của Sheet mới, Deploy Web app
   như Bước 2 ở trên → được 1 link `/exec` mới.
3. Copy nguyên cả thư mục `hpc_v2/` sang project mới, chỉ sửa **`js/config.js`**:
   - `API_URL` → link `/exec` mới
   - `PROJECT_NAME`, `ORG_LINE`, `BRAND_SHORT`, `BRAND_NAME`
   - `ROLE_OPTIONS` → danh sách nhà thầu/liên danh của dự án mới
   - `MODULES` → giữ nguyên nếu cấu trúc quản lý giống nhau; hoặc sửa
     `sheet`, `columns` cho khớp tên tab & cột Sheet mới (xem mục 3).
4. Xong — không cần đụng tới `api.js`, `store.js`, `engine.js`, `app.js`,
   `export.js`, `styles.css`, `Code.gs`.

---

## 3. Cấu trúc 1 "module" trong `config.js`

```js
{
  id: "tasks",                 // định danh nội bộ, duy nhất
  sheet: "TienDoThiCong",      // PHẢI khớp CHÍNH XÁC tên tab Google Sheet
  label: "Tiến độ Thi công",   // tên hiện trên sidebar
  icon: "▤",
  group: "CÔNG VIỆC & PHỤ THUỘC", // nhóm hiển thị trên sidebar
  kind: "table",
  title: "Tiến độ Thi công Liên danh",  // tiêu đề trang
  sub: "Mô tả ngắn dưới tiêu đề",

  groupByColumn: "Phase",   // (tuỳ chọn) gom nhóm theo cột này → khối có thể thu gọn/đổi tên/xoá cả khối
  ownerColumn: "Contractor",// (tuỳ chọn) cột nhà thầu → bật bộ lọc vai trò + gộp vào Dashboard "Tiến độ theo nhà thầu"
  doneColumn: "Done",       // (tuỳ chọn) cột đánh dấu hoàn thành → tính % trên Dashboard
  dueColumn: "Due",         // (tuỳ chọn) cột hạn → liệt kê "quá hạn" trên Dashboard
  progressColumns: ["SurveyPct","InstallPct","TrainPct"], // (tuỳ chọn) nếu có nhiều cột % thay vì 1 cột Done
  filterColumn: "Status",   // (tuỳ chọn) hiện các nút lọc nhanh theo trạng thái
  filterOptions: [...],     // (tuỳ chọn) danh sách giá trị lọc cố định, nếu bỏ trống sẽ tự lấy giá trị có trong dữ liệu
  alertColumn: "Level", alertValue: "HIGH", alertExcludeStatus: "CLOSED", statusColumnForAlert: "Status",
                              // (tuỳ chọn) đưa vào khối "Cảnh báo mức cao" trên Dashboard
  defaultSort: "Date:desc",  // (tuỳ chọn)

  columns: [                 // (tuỳ chọn) khai báo để có nhãn tiếng Việt đẹp + đúng kiểu + đúng thứ tự
    { key: "Code", label: "#", type: "text", width: "52px" },
    { key: "Name", label: "Hạng mục công việc", type: "text", primary: true },
    { key: "Contractor", label: "Nhà thầu", type: "select", options: [...] },
    { key: "Start", label: "Bắt đầu", type: "date" },
    { key: "SurveyPct", label: "%KS", type: "percent" },
    { key: "Done", label: "Xong", type: "checkbox" },
    { key: "Level", label: "Mức", type: "status",
      options: ["HIGH","MEDIUM","LOW"],
      colorMap: { HIGH:"red", MEDIUM:"amber", LOW:"green" } },
  ]
}
```

**Kiểu cột (`type`) hỗ trợ:** `text` (mặc định), `textarea` (ô nhiều dòng),
`date`, `percent` (0–100, có thanh %), `checkbox`, `select` (dropdown thường),
`status` (dropdown có tô màu theo `colorMap`: `green|amber|red|gray|blue`).

**Không khai báo `columns`?** Engine tự đọc mọi cột từ Sheet, tự đoán kiểu
theo tên cột (`inferColumn()` trong `engine.js`):
- Tên chứa `done/xong/hoàn thành/confirm/xác nhận` → checkbox
- Tên chứa `date/ngày/due/hạn/start/end/bắt đầu` → ngày
- Tên chứa `pct/percent/%` → phần trăm
- Còn lại → văn bản

---

## 4. Thêm/bớt cột dữ liệu — KHÔNG CẦN SỬA CODE

**Thêm cột:** Vào Google Sheet, thêm 1 cột mới với tên header rõ ràng (không
dấu cách đặc biệt, viết liền hoặc PascalCase, ví dụ `SoLuong`, `NgayNghiemThu`).
Tải lại trang tool → cột mới tự hiện ra (dạng suy luận). Nếu muốn có nhãn
tiếng Việt đẹp / kiểu dữ liệu chính xác / vị trí cột mong muốn, thêm khai báo
tương ứng vào mảng `columns` của module đó trong `config.js` (không bắt buộc).

**Bớt cột:** Xoá cột trên Google Sheet — cột biến mất khỏi giao diện. (Nếu
cột đó có khai báo riêng trong `config.js`, có thể xoá luôn khai báo đó cho
gọn, không bắt buộc vì engine tự bỏ qua cột không còn tồn tại trên Sheet.)

**Thêm cả 1 module/chức năng mới:** Thêm 1 tab mới trong Google Sheet, dòng 1
là tên cột (nhớ để trống cột `ID`, hệ thống tự tạo). Tool tự phát hiện tab
mới này và thêm 1 mục vào sidebar (nhóm "KHÁC (TỰ PHÁT HIỆN)"). Muốn nó có
icon/tên nhóm/Dashboard đẹp như các module khác → thêm 1 khối vào `MODULES`
trong `config.js` theo mẫu ở mục 3.

---

## 5. Cơ chế đồng bộ 2 chiều

- **Kéo về (PULL):** khi mở trang, và định kỳ mỗi `AUTO_PULL_SECONDS` giây
  (mặc định 20s, chỉnh trong `config.js`), tool gọi API lấy toàn bộ dữ liệu
  mới nhất từ Google Sheet — mọi thay đổi trực tiếp trên Sheet hoặc từ
  AppSheet đều sẽ hiện ra trên tool.
- **Đẩy lên (PUSH):** mọi chỉnh sửa trên tool được lưu local ngay (mượt,
  không chờ mạng), gộp các lần sửa liên tiếp trên cùng 1 dòng trong
  `PUSH_DEBOUNCE_MS` (mặc định 600ms) thành 1 lần gọi API để tránh spam.
- Trong lúc 1 dòng đang chờ đồng bộ lên server, PULL định kỳ sẽ **không ghi
  đè** dòng đó (tránh giật/mất thao tác đang gõ dở).
- Nút **"⇧ Đồng bộ ngay"**: đẩy ngay tất cả thay đổi đang chờ, không cần chờ
  debounce.
- Nút **"⟳ Làm mới"**: kéo ngay dữ liệu mới nhất từ Sheet.
- **Xung đột:** cơ chế hiện tại là "ai lưu sau thắng" (last-write-wins) —
  phù hợp với nhóm nhỏ, ít khi 2 người sửa đúng cùng 1 ô cùng lúc. Không có
  khoá dòng thời gian thực.
- Đèn trạng thái góc trên phải (●) cho biết: đang đồng bộ / đã đồng bộ / lỗi.

---

## 6. Vai trò & phân quyền

Bộ lọc "Toàn liên danh / HELIX / Thành An 96 / Sao Nam An" ở góc trên phải là
**bộ lọc hiển thị**, dựa vào cột `ownerColumn` (vd. `Contractor`) của từng
module. Đây **không phải bảo mật thật** — ai mở link cũng sửa được mọi dữ
liệu. Nếu cần khoá quyền thật (mỗi nhà thầu chỉ sửa được việc của mình),
cần nâng cấp thêm ở tầng Apps Script (kiểm tra email người gọi qua
`Session.getActiveUser()`, hoặc dùng AppSheet's built-in Security Filter) —
đây là hạng mục V3.

---

## 7. Sự cố thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| "Không kết nối được Google Sheet" khi mở trang | `API_URL` sai, hoặc Deploy chưa xong, hoặc quyền truy cập không phải "Anyone" | Kiểm tra lại link `/exec`, Deploy lại, chọn "Anyone" |
| Sửa dữ liệu nhưng F5 lại mất | Debounce đang chờ (đóng tab quá nhanh) | Bấm "⇧ Đồng bộ ngay" trước khi đóng tab |
| Cột mới thêm trên Sheet không hiện | Trang chưa tải lại / đang cache cũ | Bấm "⟳ Làm mới" hoặc F5 |
| Lỗi CORS trong Console | POST gửi sai `Content-Type` | Không sửa `api.js` — file này đã dùng `text/plain` đúng chuẩn để né lỗi CORS của Apps Script |
| Xuất Excel không chạy | Thiếu file `js/vendor/xlsx.full.min.js` | Đảm bảo copy nguyên thư mục `js/vendor/` khi triển khai |

---

## 8. Công cụ dev (tuỳ chọn, không cần cho production)

`dev/mock_server.py` (nếu có kèm theo) mô phỏng đúng API của `backend/Code.gs`
chạy trên máy local — dùng để test giao diện khi chưa muốn deploy Google Sheet
thật. Chạy `python3 dev/mock_server.py`, trỏ `API_URL` tạm thời về
`http://localhost:8899/` để thử. **Không dùng cho dữ liệu thật.**

---

## 9. WORK CALENDAR (V3) — Lịch Công việc

Module bổ sung ở V3, tuân thủ nguyên tắc **extend, không rewrite**: 100% tái sử
dụng `api.js`, `store.js`, cơ chế đồng bộ 2 chiều, và component bảng
(`renderTable`) đã có sẵn — **không sửa `backend/Code.gs`**.

**Cách hoạt động:**
- 1 tab Google Sheet mới **`WorkSchedule`** (đã có trong file seed mẫu), cột:
  `ID, Employee, Date, StartTime, EndTime, Project, TaskId, TaskName, Title, Status, Note`.
- **Project**: hệ thống hiện chỉ quản lý 1 dự án → cột này tự điền
  `PROJECT_NAME` trong `config.js`, không tạo bảng Project riêng.
- **Task**: lấy từ module `tasks` (sheet `TienDoThiCong`) qua
  `taskSourceModule: "tasks"` trong config — không tạo dữ liệu Task mới.
  Muốn đổi nguồn Task sang module khác (vd. `software`), chỉ cần sửa
  `taskSourceModule` trong khối module `calendar` ở `config.js`.
- **Employee**: chưa có bảng nhân sự trong hệ thống, nên dùng cơ chế nhập tên
  1 lần + ghi nhớ trong trình duyệt (`localStorage`, không gửi lên server).
  Ô "Bạn là" gợi ý tên đã dùng trước đó + tên có sẵn ở cột `Name` của sheet
  `DauMoiLienHe` (`EMPLOYEE_HINT_SHEET`/`EMPLOYEE_HINT_COLUMN` trong config).

**3 chế độ xem trong cùng 1 màn hình** (theo đúng yêu cầu V1, không tạo màn
hình riêng cho Manager View / Project View):
- **Ngày / Tuần**: lịch cá nhân, tự lọc theo tên đang chọn ở "Bạn là".
- **Danh sách (Manager view)**: gọi thẳng `engine.renderTable()` có sẵn —
  xem/lọc/tìm/sửa nhanh lịch của **tất cả** nhân viên, đáp ứng yêu cầu Manager
  View mà không viết thêm bảng mới.
- **Dashboard**: thêm khối "📅 Công việc hôm nay" (tổng số + đếm theo trạng
  thái + lọc theo nhân viên/trạng thái) — vẽ bằng `engine.renderTodayWorkWidget()`
  gọi riêng từ `app.js`, KHÔNG sửa `renderDashboard()` gốc.

**File đã sửa cho module này:** `js/config.js` (thêm khối module), `js/app.js`
(thêm nhánh dispatch `kind:"calendar"` + gọi widget Dashboard), `js/engine.js`
(thêm các hàm `renderCalendar`/`calPopupForm`/…, không sửa hàm cũ),
`js/export.js` (1 dòng, cho phép xuất Excel cả sheet WorkSchedule),
`css/styles.css` (thêm CSS mới ở cuối file). **Không sửa** `api.js`, `store.js`,
`backend/Code.gs`, và không ảnh hưởng 8 module đã có trước đó (đã hồi quy kiểm
tra toàn bộ 9 tab cũ + xuất Excel + đồng bộ 2 chiều, không phát sinh lỗi).

**Giới hạn đã biết (đúng phạm vi V1 theo yêu cầu, chưa làm ở bản này):**
- Không có xác thực đăng nhập thật — "Bạn là" chỉ là lựa chọn hiển thị, ai
  cũng sửa được lịch của người khác nếu đổi tên trong ô đó.
- Bộ lọc "Dự án" trong khối Dashboard không có vì hệ thống hiện chỉ có 1 dự
  án; khi hệ thống có nhiều dự án, chỉ cần sửa `renderTodayWorkWidget()` để
  thêm lại bộ lọc này.

