/**
 * ============================================================
 *  API QUẢN LÝ DỮ LIỆU TỪNG CLB  (dự án Apps Script ĐỘC LẬP)
 * ============================================================
 *  Mục tiêu: người dùng KHÔNG sửa trực tiếp Google Sheets nữa. Mọi thao tác thêm/sửa/xóa đi qua API này,
 *  có mật khẩu riêng cho từng CLB, có nhật ký và thùng rác để khôi phục.
 *
 *  Cài đặt (làm một lần):
 *   1. Tạo dự án mới tại https://script.new và dán toàn bộ file này vào (xóa code mẫu).
 *   2. Project Settings -> Script properties, thêm 2 dòng:
 *        SHEET_ID  = mã của file Google Sheets (đoạn giữa /d/ và /edit trên thanh địa chỉ)
 *        SUPER_KEY = mật khẩu quản trị tổng do bạn tự đặt (từ 12 ký tự trở lên)
 *   3. Chọn hàm khoiTao() và bấm Chạy, cho phép quyền. Xem Nhật ký thực thi để biết CLB nào chưa có tab.
 *   4. Triển khai -> Triển khai mới -> Ứng dụng web:  Thực thi với tư cách = Tôi,  Người có quyền truy cập = Bất kỳ ai.
 *   5. Dán link /exec vào file clb-config.js trong repo, rồi vào trang quantri-tong.html để cấp mật khẩu cho từng CLB.
 *   6. Trong Google Sheets: gỡ quyền CHỈNH SỬA của mọi người khác (chỉ để mình bạn sửa được).
 *
 *  Khi sửa code: Triển khai -> Quản lý các bản triển khai -> bút chì -> Phiên bản mới (đừng tạo triển khai mới để giữ nguyên link).
 * ============================================================
 */

// ---------- CẤU HÌNH ----------
var MASTER_SHEET = "DS_CLB_VD";                      // Tab tổng: cột A = STT (dùng làm ?id=), B = tên CLB, C = khu vực
var LOG_SHEET = "NHAT_KY_CLB";                       // Tab nhật ký (tự tạo, tự ẩn)
var ID_HEADER = "Mã định danh (không sửa)";          // Cột mã ổn định cho từng võ sinh (tự thêm vào cuối mỗi tab CLB)
var TOKEN_TTL_MS = 8 * 60 * 60 * 1000;               // Đăng nhập có hiệu lực 8 giờ
var MAX_FAILS = 5;                                   // Sai mật khẩu quá số lần này thì tạm khóa
var LOCK_SECONDS = 15 * 60;                          // Thời gian tạm khóa (giây)
var MAX_TEXT_CHARS = 500;                            // Giới hạn ô văn bản ngắn
var MAX_LONG_CHARS = 10000;                          // Giới hạn ô văn bản dài (ghi chú, danh sách bài)
var PUBLIC_HIDDEN_ROLES = ["note", "height", "weight", "id"];   // Cột KHÔNG hiện ở trang xem công khai
var GENDER_OPTIONS = ["Nam", "Nữ"];

// Nhận diện vai trò cột theo tên tiêu đề (không phân biệt hoa/thường). Cột lạ vẫn được hỗ trợ như ô văn bản.
var ROLE_RULES = [
  ["id", /^mã định danh/],
  ["stt", /^stt$/],
  ["name", /^họ và tên$/],
  ["dharma", /^pháp danh$/],
  ["birth", /năm sinh|ngày sinh/],
  ["unit", /^đơn vị$/],
  ["belt", /^cấp đai/],
  ["done", /^những bài đã hoàn thành/],
  ["todo", /^những bài chưa hoàn thành/],
  ["pct", /^tỷ lệ hoàn thành/],
  ["updated", /^ngày cập nhật/],
  ["gender", /^giới tính/],
  ["register", /đăng ký thi/],
  ["note", /^ghi chú/],
  ["photo", /ảnh đại diện/],
  ["link", /^link/],
  ["height", /^chiều cao/],
  ["weight", /^cân nặng/]
];

// ---------- LỖI CÓ MÃ ----------
function AppError(code, message) { this.code = code; this.message = message; }

function fail_(err) {
  if (err instanceof AppError) return { ok: false, code: err.code, error: err.message };
  var ref = Utilities.getUuid().slice(0, 8);
  Logger.log("LỖI [" + ref + "]: " + (err && err.stack ? err.stack : err));
  return { ok: false, code: "SERVER", error: "Lỗi máy chủ (mã " + ref + "). Vui lòng thử lại." };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  ĐIỂM VÀO WEB APP
// ============================================================
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.action === "clubs") return json_({ ok: true, clubs: getClubs_() });
    if (p.action === "view") return json_(viewClub_(p.id));
    throw new AppError("INVALID", "Hành động không hợp lệ.");
  } catch (err) {
    return json_(fail_(err));
  }
}

function doPost(e) {
  try {
    var req = {};
    try { req = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (x) { throw new AppError("INVALID", "Dữ liệu gửi lên không hợp lệ."); }
    switch (req.action) {
      case "login": return json_(login_(req));
      case "list": return json_(adminList_(req));
      case "create": return json_(adminCreate_(req));
      case "update": return json_(adminUpdate_(req));
      case "delete": return json_(adminDelete_(req));
      case "grade": return json_(adminGrade_(req));
      case "trash": return json_(adminTrash_(req));
      case "restore": return json_(adminRestore_(req));
      case "sa_clubs": return json_(superClubs_(req));
      case "sa_setpw": return json_(superSetPw_(req));
      case "sa_clearpw": return json_(superClearPw_(req));
      case "sa_bulkpw": return json_(superBulkPw_(req));
      case "sa_log": return json_(superLog_(req));
      default: throw new AppError("INVALID", "Hành động không hợp lệ.");
    }
  } catch (err) {
    return json_(fail_(err));
  }
}

// ============================================================
//  CÀI ĐẶT / KIỂM TRA (chạy tay trong trình soạn thảo)
// ============================================================
function khoiTao() {
  var props = PropertiesService.getScriptProperties();
  var problems = [];
  if (!props.getProperty("SHEET_ID")) problems.push("Chưa có Script property SHEET_ID");
  var sk = props.getProperty("SUPER_KEY");
  if (!sk) problems.push("Chưa có Script property SUPER_KEY"); else if (sk.length < 12) problems.push("SUPER_KEY quá ngắn (cần từ 12 ký tự)");
  if (problems.length) { Logger.log("CHƯA SẴN SÀNG:\n - " + problems.join("\n - ")); return; }

  getSecret_();
  getLogSheet_();
  var ss = open_();
  var clubs = getClubs_(true), noTab = [], ok = 0;
  clubs.forEach(function (c) { if (findTab_(ss, c)) ok++; else noTab.push(c.id + ". " + c.name); });
  Logger.log("Đã khởi tạo. " + clubs.length + " CLB trong " + MASTER_SHEET + ", " + ok + " CLB có tab khớp tên.");
  if (noTab.length) Logger.log("CLB CHƯA có tab khớp tên (sẽ không quản lý được): " + noTab.join(" | "));
  Logger.log("Bước tiếp theo: Triển khai -> Ứng dụng web, rồi dán link /exec vào clb-config.js.");
}

// ============================================================
//  TIỆN ÍCH CHUNG
// ============================================================
var _ssCache = null;
function open_() {
  if (_ssCache) return _ssCache;
  var id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  if (!id) throw new AppError("CONFIG", "Chưa cấu hình SHEET_ID.");
  _ssCache = SpreadsheetApp.openById(id);
  return _ssCache;
}

function norm_(value) {
  return String(value == null ? "" : value).normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Khóa so khớp tên CLB: bỏ khác biệt hoa/thường, khoảng trắng, kiểu dấu gạch ngang, kiểu gõ dấu. */
function normKey_(value) {
  return String(value == null ? "" : value)
    .normalize("NFC")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { throw new AppError("BUSY", "Hệ thống đang bận, vui lòng thử lại sau vài giây."); }
  try { return fn(); } finally { lock.releaseLock(); }
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ((b < 0 ? b + 256 : b) + 0x100).toString(16).slice(1); }).join("");
}

function safeEq_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// ============================================================
//  DANH SÁCH CLB  (tab DS_CLB_VD)
// ============================================================
function getClubs_(noCache) {
  var cache = CacheService.getScriptCache();
  if (!noCache) {
    var hit = cache.get("clubs");
    if (hit) return JSON.parse(hit);
  }
  var master = open_().getSheetByName(MASTER_SHEET);
  if (!master) throw new AppError("CONFIG", "Không tìm thấy tab " + MASTER_SHEET + ".");
  var data = master.getDataRange().getValues();
  var clubs = [], seen = {};
  for (var i = 1; i < data.length; i++) {
    var name = data[i][1] == null ? "" : String(data[i][1]).trim();
    if (!name) continue;
    var id = parseInt(data[i][0], 10);
    if (!(id > 0)) id = i;                           // Ô STT trống thì dùng số dòng - 1
    if (seen[id]) continue;                          // Trùng STT: giữ dòng đầu tiên
    seen[id] = true;
    clubs.push({ id: id, name: name, region: data[i][2] ? String(data[i][2]).trim() : "Chưa rõ" });
  }
  try { cache.put("clubs", JSON.stringify(clubs), 60); } catch (e) {}
  return clubs;
}

function findClub_(id) {
  var n = parseInt(id, 10);
  var club = getClubs_().filter(function (c) { return c.id === n; })[0];
  if (!club) throw new AppError("NOT_FOUND", "Không tìm thấy CLB có STT " + id + ".");
  return club;
}

function findTab_(ss, club) {
  var key = normKey_(club.name), sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName().trim();
    if (name === MASTER_SHEET || name === LOG_SHEET) continue;
    if (normKey_(name.replace(/^\d+\.\s*/, "")) === key) return sheets[i];
  }
  return null;
}

function clubSheet_(club) {
  var sheet = findTab_(open_(), club);
  if (!sheet) throw new AppError("NOT_FOUND", "CLB \"" + club.name + "\" chưa có tab khớp tên trong Google Sheets.");
  return sheet;
}

// ============================================================
//  ĐỌC CẤU TRÚC + DỮ LIỆU MỘT TAB CLB
// ============================================================
/** Phân tích dòng tiêu đề thành danh sách cột có vai trò/kiểu nhập. */
function readMeta_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var fields = [], width = 0;
  headerRow.forEach(function (h, i) {
    var text = h == null ? "" : String(h).trim();
    if (!text) return;
    width = i + 1;
    var key = norm_(text), role = "";
    for (var r = 0; r < ROLE_RULES.length; r++) if (ROLE_RULES[r][1].test(key)) { role = ROLE_RULES[r][0]; break; }
    var f = { key: text, col: i + 1, role: role, type: "text" };
    if (role === "stt") { f.type = "auto"; f.readonly = true; }
    else if (role === "name") { f.required = true; }
    else if (role === "birth") { f.type = "date"; }
    else if (role === "unit") { f.type = "readonly"; f.readonly = true; }
    else if (role === "belt") { f.type = "belt"; }
    else if (role === "done" || role === "todo" || role === "pct" || role === "updated") { f.type = "progress"; f.readonly = true; }
    else if (role === "gender") { f.type = "select"; f.options = GENDER_OPTIONS.slice(); }
    else if (role === "register") { f.type = "checkbox"; }
    else if (role === "note") { f.type = "textarea"; }
    else if (role === "photo" || role === "link") { f.type = "url"; }
    else if (role === "id") { f.type = "hidden"; f.readonly = true; }
    fields.push(f);
  });
  // Cột lạ: dùng quy tắc kiểm tra dữ liệu (dropdown / checkbox) của chính Google Sheets để dựng ô nhập phù hợp
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var rules = sheet.getRange(2, 1, Math.min(lastRow - 1, 60), Math.max(width, 1)).getDataValidations();
    fields.forEach(function (f) {
      if (f.role) return;
      for (var r = 0; r < rules.length; r++) {
        var rule = rules[r][f.col - 1];
        if (!rule) continue;
        var ct = rule.getCriteriaType();
        if (ct === SpreadsheetApp.DataValidationCriteria.CHECKBOX) { f.type = "checkbox"; break; }
        if (ct === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
          var vals = rule.getCriteriaValues()[0];
          if (vals && vals.length) { f.type = "select"; f.options = vals.map(String); break; }
        }
      }
    });
  }
  var byRole = {};
  fields.forEach(function (f) { if (f.role && !byRole[f.role]) byRole[f.role] = f; });
  return { fields: fields, width: width, byRole: byRole, idField: byRole.id || null };
}

/** Thêm cột "Mã định danh" vào cuối tiêu đề nếu chưa có. */
function ensureIdColumn_(sheet, meta) {
  if (meta.idField) return meta;
  if (meta.width + 1 > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), meta.width + 1 - sheet.getMaxColumns());
  sheet.getRange(1, meta.width + 1).setValue(ID_HEADER);
  return readMeta_(sheet);
}

function cellOut_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, "dd/MM/yyyy");
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  return v;                                           // number / boolean
}

function pctOf_(v) {
  if (v === "" || v === null || v === undefined) return 0;
  var n = typeof v === "number" ? v : parseFloat(String(v).replace("%", "").replace(",", "."));
  if (isNaN(n)) return 0;
  if (typeof v === "number" && n <= 1) n = n * 100;   // ô định dạng % lưu 0..1
  return Math.max(0, Math.min(100, Math.round(n)));
}

function rowVersion_(values) {
  return sha256Hex_(JSON.stringify(values)).slice(0, 12);
}

/** Đọc toàn bộ võ sinh (bỏ dòng trống tên). */
function readRows_(sheet, meta, tz) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || !meta.byRole.name) return [];
  var raw = sheet.getRange(2, 1, lastRow - 1, meta.width).getValues();
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var nameCell = raw[i][meta.byRole.name.col - 1];
    if (nameCell === null || nameCell === undefined || String(nameCell).trim() === "") continue;
    var values = {};
    meta.fields.forEach(function (f) { if (f.role !== "id") values[f.key] = cellOut_(raw[i][f.col - 1], tz); });
    var pctField = meta.byRole.pct;
    out.push({
      row: i + 2,
      id: meta.idField ? String(raw[i][meta.idField.col - 1] || "") : "",
      values: values,
      pct: pctField ? pctOf_(raw[i][pctField.col - 1]) : 0,
      version: rowVersion_(values)
    });
  }
  return out;
}

function publicFieldInfo_(f) {
  var o = { key: f.key, role: f.role, type: f.type };
  if (f.required) o.required = true;
  if (f.readonly) o.readonly = true;
  if (f.options) o.options = f.options;
  return o;
}

// ============================================================
//  TRANG XEM CÔNG KHAI  (không cần mật khẩu, đã ẩn dữ liệu nhạy cảm)
// ============================================================
function viewClub_(id) {
  var club = findClub_(id);
  var cache = CacheService.getScriptCache();
  var hit = cache.get("view_" + club.id);
  if (hit) return JSON.parse(hit);

  var sheet = clubSheet_(club), tz = open_().getSpreadsheetTimeZone();
  var meta = readMeta_(sheet);
  var visible = meta.fields.filter(function (f) { return PUBLIC_HIDDEN_ROLES.indexOf(f.role) < 0; });
  var rows = readRows_(sheet, meta, tz).map(function (r) {
    var v = {};
    visible.forEach(function (f) {
      var val = r.values[f.key];
      if (f.role === "birth") { var m = String(val).match(/(\d{4})/); val = m ? m[1] : ""; }   // Trang công khai chỉ hiện NĂM sinh
      v[f.key] = val;
    });
    return { values: v, pct: r.pct };
  });
  var result = { ok: true, club: club, fields: visible.map(publicFieldInfo_), rows: rows, generatedAt: new Date().toISOString() };
  try { cache.put("view_" + club.id, JSON.stringify(result), 60); } catch (e) {}   // Quá 100KB thì bỏ qua cache
  return result;
}

// ============================================================
//  MẬT KHẨU + ĐĂNG NHẬP
// ============================================================
function getSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty("TOKEN_SECRET");
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty("TOKEN_SECRET", s);
  }
  return s;
}

function pwRecord_(id) {
  var raw = PropertiesService.getScriptProperties().getProperty("PW_" + id);
  return raw ? JSON.parse(raw) : null;
}

function setPw_(id, password) {
  var salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty("PW_" + id, JSON.stringify({ salt: salt, hash: sha256Hex_(salt + ":" + password), at: new Date().toISOString() }));
}

function genPassword_() {
  var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";   // bỏ ký tự dễ nhầm: 0 O 1 l I
  var hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ""), out = "";
  for (var i = 0; i < 12; i++) out += alphabet.charAt(parseInt(hex.substr(i * 2, 2), 16) % alphabet.length);
  return out;
}

function checkNotLocked_(key) {
  var n = parseInt(CacheService.getScriptCache().get("fail_" + key) || "0", 10);
  if (n >= MAX_FAILS) throw new AppError("LOCKED", "Nhập sai quá " + MAX_FAILS + " lần. Vui lòng thử lại sau " + Math.round(LOCK_SECONDS / 60) + " phút.");
}
function recordFail_(key) {
  var cache = CacheService.getScriptCache();
  var n = parseInt(cache.get("fail_" + key) || "0", 10) + 1;
  cache.put("fail_" + key, String(n), LOCK_SECONDS);
}
function clearFails_(key) { CacheService.getScriptCache().remove("fail_" + key); }

function pwVersion_(rec) { return rec.hash.slice(0, 8); }

function makeToken_(clubId, rec) {
  var payload = JSON.stringify({ c: clubId, e: Date.now() + TOKEN_TTL_MS, v: pwVersion_(rec) });
  var p64 = Utilities.base64EncodeWebSafe(Utilities.newBlob(payload).getBytes());
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(p64, getSecret_()));
  return { token: p64 + "." + sig, expiresAt: Date.now() + TOKEN_TTL_MS };
}

/** Trả về CLB tương ứng với token hợp lệ. */
function requireClub_(token) {
  var bad = new AppError("AUTH", "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  if (!token || typeof token !== "string" || token.indexOf(".") < 0) throw bad;
  var parts = token.split(".");
  if (parts.length !== 2) throw bad;
  var expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], getSecret_()));
  if (!safeEq_(expected, parts[1])) throw bad;
  var payload;
  try { payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); } catch (e) { throw bad; }
  if (!payload || payload.e < Date.now()) throw bad;
  var rec = pwRecord_(payload.c);
  if (!rec || pwVersion_(rec) !== payload.v) throw bad;     // Đổi/xóa mật khẩu thì token cũ mất hiệu lực
  return findClub_(payload.c);
}

function login_(req) {
  var club = findClub_(req.id);
  var key = "club" + club.id;
  checkNotLocked_(key);
  var rec = pwRecord_(club.id), pw = typeof req.password === "string" ? req.password : "";
  if (!rec || !safeEq_(sha256Hex_(rec.salt + ":" + pw), rec.hash)) {
    recordFail_(key);
    throw new AppError("AUTH", rec ? "Sai mật khẩu." : "CLB này chưa được cấp mật khẩu. Vui lòng liên hệ quản trị viên.");
  }
  clearFails_(key);
  var t = makeToken_(club.id, rec);
  return { ok: true, token: t.token, expiresAt: t.expiresAt, club: club };
}

// ============================================================
//  NHẬT KÝ + THÙNG RÁC
// ============================================================
function getLogSheet_() {
  var ss = open_(), sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.getRange(1, 1, 1, 10).setValues([["Thời gian", "Mã nhật ký", "STT CLB", "Tên CLB", "Hành động", "Mã võ sinh", "Tên võ sinh", "Trước (JSON)", "Sau (JSON)", "Trạng thái"]]);
    try { sh.hideSheet(); } catch (e) {}
  }
  return sh;
}

function writeLog_(club, action, rowId, studentName, before, after) {
  var sh = getLogSheet_(), tz = open_().getSpreadsheetTimeZone();
  var logId = "L" + Utilities.getUuid().replace(/-/g, "").slice(0, 10);
  sh.appendRow([
    Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss"), logId, club.id, club.name, action,
    rowId || "", studentName || "",
    before ? JSON.stringify(before).slice(0, 45000) : "", after ? JSON.stringify(after).slice(0, 45000) : "", ""
  ]);
  return logId;
}

function readLogs_(limit) {
  var sh = getLogSheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  var n = Math.min(limit, last - 1);
  var raw = sh.getRange(last - n + 1, 1, n, 10).getValues();
  return raw.map(function (r, i) {
    return { sheetRow: last - n + 1 + i, time: String(r[0]), logId: String(r[1]), clubId: Number(r[2]), clubName: String(r[3]),
             action: String(r[4]), rowId: String(r[5]), student: String(r[6]), before: String(r[7]), after: String(r[8]), status: String(r[9]) };
  }).reverse();                                        // Mới nhất lên đầu
}

// ============================================================
//  GHI DỮ LIỆU: kiểm tra + chuyển kiểu
// ============================================================
function safeText_(s) {
  // Chặn chèn công thức (=, +, -, @ ở đầu) bằng dấu nháy đơn; số âm/số có dấu + vẫn giữ nguyên.
  if (/^[=+\-@]/.test(s) && !/^[+\-]?\d[\d.,\s]*$/.test(s)) return "'" + s;
  return s;
}

function isRealDate_(d, m, y) {
  var dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Chuyển giá trị người dùng nhập thành giá trị ghi vào ô theo kiểu của cột. Ném lỗi INVALID nếu sai. */
function coerce_(field, raw, tz) {
  var label = field.key;
  if (field.type === "checkbox") return raw === true || raw === "true" || raw === "on" || raw === 1 || raw === "1";
  if (raw === null || raw === undefined) raw = "";
  if (typeof raw === "object") throw new AppError("INVALID", "Giá trị của \"" + label + "\" không hợp lệ.");
  var s = String(raw).trim();
  var limit = (field.type === "textarea" || field.type === "progress") ? MAX_LONG_CHARS : MAX_TEXT_CHARS;
  if (s.length > limit) throw new AppError("INVALID", "\"" + label + "\" quá dài (tối đa " + limit + " ký tự).");
  if (field.type !== "textarea" && field.type !== "progress") s = s.replace(/[\r\n]+/g, " ");
  if (s === "") return "";

  if (field.type === "date") {
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      if (!isRealDate_(+m[1], +m[2], +m[3])) throw new AppError("INVALID", "\"" + label + "\" không phải ngày hợp lệ.");
      return Utilities.parseDate(s, tz, "dd/MM/yyyy");
    }
    if (/^\d{4}$/.test(s)) return s;                    // Chỉ có năm sinh
    throw new AppError("INVALID", "\"" + label + "\" nhập theo dạng dd/mm/yyyy hoặc chỉ năm (ví dụ 2012).");
  }
  if (field.type === "url") {
    var isPhotoId = field.role === "photo" && /^[-\w]{20,}$/.test(s);
    if (!isPhotoId && !/^https?:\/\/[^\s]+$/i.test(s)) throw new AppError("INVALID", "\"" + label + "\" phải là đường link bắt đầu bằng http:// hoặc https://.");
    return s;
  }
  if (field.type === "select" && field.options && field.options.indexOf(s) < 0) {
    throw new AppError("INVALID", "\"" + label + "\" chỉ nhận một trong: " + field.options.join(", ") + ".");
  }
  return safeText_(s);
}

function sameValue_(current, next, tz) {
  if (next instanceof Date) return current === Utilities.formatDate(next, tz, "dd/MM/yyyy");
  if (typeof next === "boolean") return current === next;
  return String(current) === String(next).replace(/^'/, "");
}

function writeCell_(sheet, rowNum, field, value) {
  var cell = sheet.getRange(rowNum, field.col);
  if (field.role === "pct") { cell.setValue(value); cell.setNumberFormat("0%"); return; }
  if (value instanceof Date) { cell.setValue(value); cell.setNumberFormat("dd/MM/yyyy"); return; }
  cell.setValue(value);
}

function stampNow_(tz) { return Utilities.formatDate(new Date(), tz, "HH:mm - dd/MM/yyyy"); }

function lastDataRow_(sheet, meta) {
  var last = sheet.getLastRow();
  if (last < 2 || !meta.byRole.name) return 1;
  var names = sheet.getRange(2, meta.byRole.name.col, last - 1, 1).getValues();
  for (var i = names.length - 1; i >= 0; i--) if (String(names[i][0] == null ? "" : names[i][0]).trim() !== "") return i + 2;
  return 1;
}

function ensureRows_(sheet, target) {
  if (target > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), target - sheet.getMaxRows());
}

function maxStt_(rows, meta) {
  var f = meta.byRole.stt, max = 0;
  if (!f) return 0;
  rows.forEach(function (r) { var n = parseInt(r.values[f.key], 10); if (n > max) max = n; });
  return max;
}

function newRowId_() { return "r" + Utilities.getUuid().replace(/-/g, "").slice(0, 10); }

/** Gán mã định danh cho các dòng còn thiếu (một lần ghi duy nhất). */
function assignMissingIds_(sheet, meta, rows) {
  var missing = rows.filter(function (r) { return !r.id; });
  if (!missing.length) return false;
  missing.forEach(function (r) { r.id = newRowId_(); sheet.getRange(r.row, meta.idField.col).setValue(r.id); });
  return true;
}

/**
 * Nạp tab CLB ở chế độ quản trị: đảm bảo có cột mã định danh và mọi dòng đều có mã.
 * locked = true nếu nơi gọi ĐÃ giữ khóa (khóa của Apps Script không cho xin lồng nhau).
 */
function loadAdmin_(club, locked) {
  var sheet = clubSheet_(club), tz = open_().getSpreadsheetTimeZone();
  var meta = readMeta_(sheet);
  if (!meta.byRole.name) throw new AppError("CONFIG", "Tab của CLB không có cột \"Họ và tên\".");
  var rows = readRows_(sheet, meta, tz);
  if (!meta.idField || rows.some(function (r) { return !r.id; })) {
    var fix = function () {
      meta = ensureIdColumn_(sheet, readMeta_(sheet));
      rows = readRows_(sheet, meta, tz);
      assignMissingIds_(sheet, meta, rows);
    };
    if (locked) fix(); else withLock_(fix);
    rows = readRows_(sheet, meta, tz);
  }
  return { sheet: sheet, meta: meta, rows: rows, tz: tz };
}

function findRowById_(ctx, rowId) {
  var r = ctx.rows.filter(function (x) { return x.id === String(rowId); })[0];
  if (!r) throw new AppError("NOT_FOUND", "Không tìm thấy võ sinh này (có thể đã bị xóa hoặc đã đổi). Hãy tải lại danh sách.");
  return r;
}

function checkVersion_(row, version) {
  if (!version || version !== row.version) throw new AppError("CONFLICT", "Dữ liệu võ sinh này vừa được thay đổi ở nơi khác. Hãy tải lại danh sách rồi thao tác lại.");
}

function adminPayload_(club, ctx) {
  return {
    ok: true, club: club, serverTime: new Date().toISOString(),
    fields: ctx.meta.fields.filter(function (f) { return f.role !== "id"; }).map(publicFieldInfo_),
    rows: ctx.rows.map(function (r) { return { id: r.id, values: r.values, pct: r.pct, version: r.version }; })
  };
}

// ============================================================
//  THAO TÁC QUẢN TRỊ CLB
// ============================================================
function adminList_(req) {
  var club = requireClub_(req.token);
  return adminPayload_(club, loadAdmin_(club));
}

function adminCreate_(req) {
  var club = requireClub_(req.token);
  var input = req.values || {};
  return withLock_(function () {
    var ctx = loadAdmin_(club, true), meta = ctx.meta;
    var writes = [], nameVal = "";
    meta.fields.forEach(function (f) {
      if (f.role === "id" || f.type === "auto" || f.type === "readonly" || f.type === "progress") return;
      if (!(f.key in input) && f.type !== "checkbox") return;
      var v = coerce_(f, input[f.key], ctx.tz);
      if (f.role === "name") nameVal = v;
      if (f.required && v === "") throw new AppError("INVALID", "Vui lòng nhập \"" + f.key + "\".");
      if (v !== "" || f.type === "checkbox") writes.push([f, v]);
    });
    if (!nameVal) throw new AppError("INVALID", "Vui lòng nhập họ và tên.");

    var target = lastDataRow_(ctx.sheet, meta) + 1, id = newRowId_();
    ensureRows_(ctx.sheet, target);
    writes.forEach(function (w) { writeCell_(ctx.sheet, target, w[0], w[1]); });
    if (meta.byRole.stt) writeCell_(ctx.sheet, target, meta.byRole.stt, maxStt_(ctx.rows, meta) + 1);
    if (meta.byRole.unit) writeCell_(ctx.sheet, target, meta.byRole.unit, club.name);
    if (meta.byRole.pct) writeCell_(ctx.sheet, target, meta.byRole.pct, 0);
    writeCell_(ctx.sheet, target, meta.idField, id);

    var after = readRows_(ctx.sheet, meta, ctx.tz).filter(function (r) { return r.id === id; })[0];
    writeLog_(club, "create", id, nameVal, null, after ? after.values : null);
    CacheService.getScriptCache().remove("view_" + club.id);
    return { ok: true, row: after ? { id: after.id, values: after.values, pct: after.pct, version: after.version } : null };
  });
}

function adminUpdate_(req) {
  var club = requireClub_(req.token);
  var input = req.values || {};
  return withLock_(function () {
    var ctx = loadAdmin_(club, true), meta = ctx.meta;
    var row = findRowById_(ctx, req.rowId);
    checkVersion_(row, req.version);
    var changed = {}, before = {}, n = 0;
    meta.fields.forEach(function (f) {
      if (f.role === "id" || f.type === "auto" || f.type === "readonly" || f.type === "progress") return;
      if (!(f.key in input)) return;
      var v = coerce_(f, input[f.key], ctx.tz);
      if (f.required && v === "") throw new AppError("INVALID", "Vui lòng nhập \"" + f.key + "\".");
      if (sameValue_(row.values[f.key], v, ctx.tz)) return;
      before[f.key] = row.values[f.key];
      writeCell_(ctx.sheet, row.row, f, v);
      changed[f.key] = v instanceof Date ? Utilities.formatDate(v, ctx.tz, "dd/MM/yyyy") : v;
      n++;
    });
    var after = readRows_(ctx.sheet, meta, ctx.tz).filter(function (r) { return r.id === row.id; })[0];
    if (n) {
      writeLog_(club, "update", row.id, after ? after.values[meta.byRole.name.key] : "", before, changed);
      CacheService.getScriptCache().remove("view_" + club.id);
    }
    return { ok: true, changed: n, row: { id: after.id, values: after.values, pct: after.pct, version: after.version } };
  });
}

function adminDelete_(req) {
  var club = requireClub_(req.token);
  return withLock_(function () {
    var ctx = loadAdmin_(club, true);
    var row = findRowById_(ctx, req.rowId);
    checkVersion_(row, req.version);
    // Lưu trọn bộ dữ liệu (kèm ô gốc) vào nhật ký để có thể khôi phục
    var snapshot = { id: row.id, values: row.values, pct: row.pct };
    ctx.sheet.deleteRow(row.row);
    writeLog_(club, "delete", row.id, row.values[ctx.meta.byRole.name.key], snapshot, null);
    CacheService.getScriptCache().remove("view_" + club.id);
    return { ok: true };
  });
}

function adminGrade_(req) {
  var club = requireClub_(req.token);
  return withLock_(function () {
    var ctx = loadAdmin_(club, true), meta = ctx.meta;
    var row = findRowById_(ctx, req.rowId);
    checkVersion_(row, req.version);
    var R = meta.byRole;
    if (!R.done || !R.todo || !R.pct) throw new AppError("CONFIG", "Tab của CLB thiếu cột tiến độ (bài đã/chưa hoàn thành, tỷ lệ).");
    var pct = Number(req.pct);
    if (!isFinite(pct) || pct < 0 || pct > 100) throw new AppError("INVALID", "Tỷ lệ hoàn thành không hợp lệ.");
    var done = coerce_({ key: R.done.key, type: "progress", role: "done" }, req.done, ctx.tz);
    var todo = coerce_({ key: R.todo.key, type: "progress", role: "todo" }, req.todo, ctx.tz);

    var before = {}, after = {};
    [[R.done, done], [R.todo, todo]].forEach(function (p) { before[p[0].key] = row.values[p[0].key]; after[p[0].key] = p[1]; writeCell_(ctx.sheet, row.row, p[0], p[1]); });
    before[R.pct.key] = row.pct; after[R.pct.key] = Math.round(pct);
    writeCell_(ctx.sheet, row.row, R.pct, Math.round(pct) / 100);
    if (req.belt && R.belt) {
      var belt = coerce_({ key: R.belt.key, type: "text", role: "belt" }, req.belt, ctx.tz);
      if (belt && belt !== row.values[R.belt.key]) { before[R.belt.key] = row.values[R.belt.key]; after[R.belt.key] = belt; writeCell_(ctx.sheet, row.row, R.belt, belt); }
    }
    if (R.updated) { var stamp = stampNow_(ctx.tz); before[R.updated.key] = row.values[R.updated.key]; after[R.updated.key] = stamp; writeCell_(ctx.sheet, row.row, R.updated, stamp); }

    var fresh = readRows_(ctx.sheet, meta, ctx.tz).filter(function (r) { return r.id === row.id; })[0];
    writeLog_(club, "grade", row.id, row.values[R.name.key], before, after);
    CacheService.getScriptCache().remove("view_" + club.id);
    return { ok: true, row: { id: fresh.id, values: fresh.values, pct: fresh.pct, version: fresh.version } };
  });
}

function adminTrash_(req) {
  var club = requireClub_(req.token);
  var items = readLogs_(500).filter(function (l) { return l.clubId === club.id && l.action === "delete" && !l.status; }).slice(0, 50);
  return { ok: true, items: items.map(function (l) { return { logId: l.logId, time: l.time, student: l.student }; }) };
}

function adminRestore_(req) {
  var club = requireClub_(req.token);
  return withLock_(function () {
    var entry = readLogs_(500).filter(function (l) { return l.logId === String(req.logId) && l.clubId === club.id && l.action === "delete"; })[0];
    if (!entry) throw new AppError("NOT_FOUND", "Không tìm thấy mục đã xóa cần khôi phục.");
    if (entry.status) throw new AppError("INVALID", "Mục này đã được khôi phục rồi.");
    var snap;
    try { snap = JSON.parse(entry.before); } catch (e) { throw new AppError("SERVER", "Dữ liệu khôi phục bị hỏng."); }

    var ctx = loadAdmin_(club, true), meta = ctx.meta, target = lastDataRow_(ctx.sheet, meta) + 1;
    ensureRows_(ctx.sheet, target);
    var id = ctx.rows.some(function (r) { return r.id === snap.id; }) ? newRowId_() : snap.id;
    meta.fields.forEach(function (f) {
      if (f.role === "id" || f.role === "stt" || f.role === "unit") return;
      if (!(f.key in snap.values)) return;
      var v = snap.values[f.key];
      if (v === "" && f.type !== "checkbox") return;
      if (f.role === "pct") { writeCell_(ctx.sheet, target, f, pctOf_(v) / 100); return; }
      if (f.type === "date") { var s = String(v); if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) v = Utilities.parseDate(s, ctx.tz, "dd/MM/yyyy"); }
      else if (typeof v === "string") v = safeText_(v);
      writeCell_(ctx.sheet, target, f, v);
    });
    if (meta.byRole.stt) writeCell_(ctx.sheet, target, meta.byRole.stt, maxStt_(ctx.rows, meta) + 1);
    if (meta.byRole.unit) writeCell_(ctx.sheet, target, meta.byRole.unit, club.name);
    writeCell_(ctx.sheet, target, meta.idField, id);

    getLogSheet_().getRange(entry.sheetRow, 10).setValue("Đã khôi phục");
    writeLog_(club, "restore", id, entry.student, null, { fromLog: entry.logId });
    CacheService.getScriptCache().remove("view_" + club.id);
    var fresh = readRows_(ctx.sheet, meta, ctx.tz).filter(function (r) { return r.id === id; })[0];
    return { ok: true, row: fresh ? { id: fresh.id, values: fresh.values, pct: fresh.pct, version: fresh.version } : null };
  });
}

// ============================================================
//  QUẢN TRỊ TỔNG  (chỉ chủ file, dùng SUPER_KEY)
// ============================================================
function requireSuper_(req) {
  checkNotLocked_("super");
  var key = PropertiesService.getScriptProperties().getProperty("SUPER_KEY") || "";
  var given = typeof req.superKey === "string" ? req.superKey : "";
  if (key.length < 12 || !safeEq_(given, key)) {
    recordFail_("super");
    throw new AppError("AUTH", key.length < 12 ? "Chưa cấu hình SUPER_KEY hợp lệ (từ 12 ký tự)." : "Sai mật khẩu quản trị tổng.");
  }
  clearFails_("super");
}

function superClubs_(req) {
  requireSuper_(req);
  var ss = open_();
  return { ok: true, clubs: getClubs_(true).map(function (c) {
    var rec = pwRecord_(c.id);
    return { id: c.id, name: c.name, region: c.region, hasPassword: !!rec, passwordSetAt: rec ? rec.at : "", hasTab: !!findTab_(ss, c) };
  }) };
}

function superSetPw_(req) {
  requireSuper_(req);
  var club = findClub_(req.id);
  var pw = req.password ? String(req.password) : genPassword_();
  if (pw.length < 8) throw new AppError("INVALID", "Mật khẩu phải từ 8 ký tự trở lên.");
  setPw_(club.id, pw);
  clearFails_("club" + club.id);
  writeLog_({ id: club.id, name: club.name }, "set_password", "", "", null, null);
  return { ok: true, id: club.id, name: club.name, password: pw };       // Chỉ hiện đúng một lần, hệ thống chỉ lưu bản băm
}

function superClearPw_(req) {
  requireSuper_(req);
  var club = findClub_(req.id);
  PropertiesService.getScriptProperties().deleteProperty("PW_" + club.id);
  writeLog_({ id: club.id, name: club.name }, "clear_password", "", "", null, null);
  return { ok: true };
}

function superBulkPw_(req) {
  requireSuper_(req);
  var out = [];
  getClubs_(true).forEach(function (c) {
    if (pwRecord_(c.id)) return;
    var pw = genPassword_();
    setPw_(c.id, pw);
    out.push({ id: c.id, name: c.name, region: c.region, password: pw });
  });
  if (out.length) writeLog_({ id: 0, name: "(tất cả)" }, "bulk_password", "", "", null, { count: out.length });
  return { ok: true, items: out };
}

function superLog_(req) {
  requireSuper_(req);
  var limit = Math.max(1, Math.min(parseInt(req.limit, 10) || 100, 300));
  return { ok: true, items: readLogs_(limit).map(function (l) {
    return { time: l.time, clubId: l.clubId, clubName: l.clubName, action: l.action, student: l.student, status: l.status };
  }) };
}
