/**
 * ============================================================
 *  API DASHBOARD PQQ  -  bản có CACHE
 * ============================================================
 *  Cách hoạt động:
 *   - rebuildCache()  : quét toàn bộ tab CLB (CHẬM, 20-60 giây), gom thành JSON
 *                       và lưu vào 1 file trên Google Drive. Chỉ chạy khi cập nhật.
 *   - doGet()         : chỉ đọc file JSON đã lưu (NHANH, ~1 giây) rồi trả về web.
 *
 *  Khi nào rebuildCache() chạy?
 *   1. Tự động mỗi tuần (chạy setupWeeklyTrigger() MỘT LẦN để cài).
 *   2. Bấm tay khi vừa sửa dữ liệu (menu Google Sheets, xem onOpen bên dưới).
 *   3. Tự chạy 1 lần nếu chưa có cache (lần đầu tiên sau khi dán code).
 * ============================================================
 */

// ---------- CẤU HÌNH ----------
var MASTER_SHEET = "DS_CLB_VD";                    // Tab tổng (Tên CLB -> Khu vực)
var CACHE_FILE_NAME = "dashboard_cache.json";      // Tên file cache trên Drive
var CACHE_FILE_ID_PROP = "DASHBOARD_CACHE_FILE_ID";
var LAST_COL = 21;                                 // Chỉ đọc đến cột U (Link ảnh đại diện)

// ---------- ĐẨY data.json LÊN GITHUB (để web đọc trực tiếp, không cần chờ Apps Script) ----------
// Token KHÔNG viết vào code. Vào Project Settings -> Script properties -> thêm GITHUB_TOKEN = <token>.
// Token: GitHub -> Settings -> Developer settings -> Fine-grained tokens, chỉ chọn repo bên dưới,
// quyền Contents: Read and write.
var GITHUB_OWNER = "lelevietnam99";
var GITHUB_REPO = "TONGHOPX";                      // Repo chứa index.html của Dashboard
var GITHUB_BRANCH = "main";
var GITHUB_DATA_PATH = "data.json";                // Nằm cùng thư mục với index.html

// ---------- API CHO WEB ----------
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    if (params.action === "refresh") return handleAdminRefresh_(params.key);  // Từ trang admin.html
    if (params.action === "status") return handleAdminStatus_(params.key);
    var payload = readCache_();
    if (!payload) payload = buildAndSave_();       // Lần đầu chưa có cache
    return ContentService.createTextOutput(payload)
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ---------- CẬP NHẬT CACHE ----------
/** Chạy hàm này (từ menu / trigger / trình soạn thảo) để làm mới dữ liệu Dashboard. */
function rebuildCache() {
  var r = refreshAll_();
  Logger.log(r.message);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(r.message, "Dashboard"); } catch (err) {}
}

/**
 * Yêu cầu "cập nhật dữ liệu" từ trang admin.html (gọi qua doGet).
 * Việc quét mất ~30-60 giây nên KHÔNG chạy ngay trong yêu cầu web (chờ lâu dễ bị Google trả về trang lỗi HTML).
 * Thay vào đó: đặt một trigger chạy sau ~1 giây rồi trả lời ngay; trang admin sẽ hỏi tiến độ bằng action=status.
 * Cần đặt Script property ADMIN_KEY = <mật khẩu tự chọn>.
 * Cố ý KHÔNG dùng doPost để không đè lên doPost của các file .gs khác trong dự án.
 */
function handleAdminRefresh_(key) {
  try {
    var denied = checkAdminKey_(key);
    if (denied) return denied;

    var props = PropertiesService.getScriptProperties();
    var current = JSON.parse(props.getProperty("REFRESH_STATE") || "null");
    // Đang có lượt cập nhật chạy dở (dưới 10 phút) thì không tạo thêm
    if (current && current.state === "running" && Date.now() - current.runId < 10 * 60 * 1000) {
      return adminJson_({ status: "success", started: false, runId: current.runId });
    }

    var runId = Date.now();
    props.setProperty("REFRESH_STATE", JSON.stringify({ runId: runId, state: "running" }));
    ScriptApp.newTrigger("runScheduledRefresh_").timeBased().after(1000).create();
    return adminJson_({ status: "success", started: true, runId: runId });
  } catch (err) {
    return adminJson_({ status: "error", message: err.toString() });
  }
}

/** Trang admin hỏi tiến độ lượt cập nhật gần nhất (?action=status&key=...). */
function handleAdminStatus_(key) {
  var denied = checkAdminKey_(key);
  if (denied) return denied;
  var state = JSON.parse(PropertiesService.getScriptProperties().getProperty("REFRESH_STATE") || "null");
  return adminJson_({ status: "success", state: state });
}

/** Được trigger gọi: làm việc thật rồi ghi kết quả vào REFRESH_STATE. */
function runScheduledRefresh_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "runScheduledRefresh_") ScriptApp.deleteTrigger(t);
  });
  var props = PropertiesService.getScriptProperties();
  var state = JSON.parse(props.getProperty("REFRESH_STATE") || "{}");
  try {
    var r = refreshAll_();
    state.state = r.error ? "error" : "done";
    state.message = r.message; state.count = r.count; state.pushed = r.pushed; state.updatedAt = r.updatedAt; state.warnings = r.warnings;
  } catch (err) {
    state.state = "error";
    state.message = err.toString();
  }
  props.setProperty("REFRESH_STATE", JSON.stringify(state));
}

/** Trả về JSON lỗi nếu chưa đặt / sai mật khẩu; trả về null nếu hợp lệ. */
function checkAdminKey_(key) {
  var adminKey = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  if (!adminKey) return adminJson_({ status: "error", message: "Chưa đặt ADMIN_KEY trong Script properties." });
  if (!key || key !== adminKey) return adminJson_({ status: "error", message: "Sai mật khẩu quản trị." });
  return null;
}

/** Chạy MỘT LẦN để cài lịch tự động cập nhật mỗi thứ Hai lúc 2h sáng. */
function setupWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "rebuildCache") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("rebuildCache")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(2)
    .create();
}

/*
 * Nếu file đã có sẵn hàm onOpen (menu "Công cụ Admin"), hãy THÊM dòng addItem bên dưới vào menu đó.
 * Nếu chưa có thì bỏ dấu comment đoạn này.
 *
 * function onOpen() {
 *   SpreadsheetApp.getUi().createMenu("Công cụ Admin")
 *     .addItem("Cập nhật dữ liệu Dashboard", "rebuildCache")
 *     .addToUi();
 * }
 */

// ---------- HÀM NỘI BỘ ----------
function adminJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Quét sheet -> lưu cache Drive -> đẩy data.json lên GitHub. Dùng chung cho menu, trigger và admin.html. */
function refreshAll_() {
  var payload = buildAndSave_();
  var parsed = JSON.parse(payload);
  var w = parsed.warnings || {};
  w.tabsNotInMaster = w.tabsNotInMaster || []; w.clubsWithoutTab = w.clubsWithoutTab || []; w.emptyTabs = w.emptyTabs || [];
  var result = {
    count: parsed.data.length, updatedAt: parsed.updatedAt, pushed: false, error: null,
    // Script property giới hạn ~9KB nên chỉ giữ tối đa 15 tên mỗi loại để hiển thị trên trang admin
    warnings: {
      tabsNotInMaster: w.tabsNotInMaster.slice(0, 15), tabsNotInMasterTotal: w.tabsNotInMaster.length,
      clubsWithoutTab: w.clubsWithoutTab.slice(0, 15), clubsWithoutTabTotal: w.clubsWithoutTab.length,
      emptyTabs: w.emptyTabs.slice(0, 15), emptyTabsTotal: w.emptyTabs.length
    }
  };
  var msg = "Đã cập nhật " + result.count + " võ sinh";
  try {
    result.pushed = pushToGitHub_(payload);
    msg += result.pushed ? " và đẩy data.json lên GitHub" : " (chưa cấu hình GITHUB_TOKEN nên chưa đẩy lên GitHub)";
  } catch (err) {
    result.error = err.toString();
    msg += " (LỖI đẩy lên GitHub: " + err + ")";
  }
  result.message = msg;
  return result;
}

/** Ghi payload thành file data.json trong repo GitHub. Trả về false nếu chưa có token. */
function pushToGitHub_(payload) {
  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) return false;

  var url = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + GITHUB_DATA_PATH;
  var headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };

  // Cần sha của file cũ (nếu đã tồn tại) thì GitHub mới cho ghi đè
  var body = {
    message: "Cập nhật dữ liệu dashboard " + new Date().toISOString(),
    content: Utilities.base64Encode(Utilities.newBlob(payload).getBytes()),
    branch: GITHUB_BRANCH
  };
  var getRes = UrlFetchApp.fetch(url + "?ref=" + encodeURIComponent(GITHUB_BRANCH), { headers: headers, muteHttpExceptions: true });
  if (getRes.getResponseCode() === 200) body.sha = JSON.parse(getRes.getContentText()).sha;
  else if (getRes.getResponseCode() !== 404) throw new Error("GitHub GET " + getRes.getResponseCode() + ": " + getRes.getContentText());

  var putRes = UrlFetchApp.fetch(url, {
    method: "put", headers: headers, contentType: "application/json",
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  var code = putRes.getResponseCode();
  if (code !== 200 && code !== 201) throw new Error("GitHub PUT " + code + ": " + putRes.getContentText());
  return true;
}

function buildAndSave_() {
  var lock = LockService.getScriptLock();          // Tránh 2 lần cập nhật chạy chồng nhau
  lock.waitLock(60000);
  try {
    var dashboard = collectDashboard_();
    var payload = JSON.stringify({
      status: "success",
      updatedAt: new Date().toISOString(),
      data: dashboard.students,
      warnings: dashboard.warnings
    });
    writeCache_(payload);
    return payload;
  } finally {
    lock.releaseLock();
  }
}

/** Giữ tên cũ cho code khác đang gọi: chỉ trả về danh sách võ sinh. */
function buildDashboardData_() {
  return collectDashboard_().students;
}

/**
 * Chuẩn hóa tên CLB để so khớp giữa tên tab và tab DS_CLB_VD:
 * bỏ khác biệt chữ hoa/thường, khoảng trắng thừa, kiểu dấu gạch ngang và kiểu gõ dấu tiếng Việt (NFC/NFD).
 */
function normKey_(value) {
  return String(value == null ? "" : value)
    .normalize("NFC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")        // các loại dấu gạch ngang -> "-"
    .replace(/\s*-\s*/g, " - ")                    // "A-B" và "A - B" coi như nhau
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Trả về { students: [...], warnings: { tabsNotInMaster: [...], clubsWithoutTab: [...] } } */
function collectDashboard_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = ss.getSheetByName(MASTER_SHEET);
  var warnings = { tabsNotInMaster: [], clubsWithoutTab: [], emptyTabs: [] };
  if (!masterSheet) return { students: [], warnings: warnings };

  var tz = ss.getSpreadsheetTimeZone();

  // 1. Bản đồ đối chiếu: Tên CLB (đã chuẩn hóa) -> { tên gốc, khu vực } (cột B, C của tab tổng)
  var masterData = masterSheet.getDataRange().getValues();
  var clubMap = {};
  for (var i = 1; i < masterData.length; i++) {
    var clubName = masterData[i][1];
    var region = masterData[i][2];
    if (clubName && clubName.toString().trim()) {
      clubMap[normKey_(clubName)] = {
        name: clubName.toString().trim(),
        region: region ? region.toString().trim() : "Chưa rõ",
        hasTab: false
      };
    }
  }

  // 2. Quét từng tab CLB
  var allStudents = [];
  var sheets = ss.getSheets();

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var originalSheetName = sheet.getName().trim();
    if (originalSheetName === MASTER_SHEET) continue;

    // Bỏ số thứ tự ở đầu tên tab: "1. CLB Bảo Quang" -> "CLB Bảo Quang"
    var cleanSheetName = originalSheetName.replace(/^\d+\.\s*/, "").trim();
    var club = clubMap[normKey_(cleanSheetName)];
    if (!club) {
      warnings.tabsNotInMaster.push(originalSheetName);
      continue;
    }
    club.hasTab = true;

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) { warnings.emptyTabs.push(originalSheetName); continue; }
    var countBefore = allStudents.length;

    // Chỉ đọc đúng vùng cần (dòng 2 -> cuối, cột A -> U) thay vì cả tab
    var rows = sheet.getRange(2, 1, lastRow - 1, LAST_COL).getValues();

    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      var name = cellText_(row[1], tz);              // Cột B: Họ và tên
      if (!name) continue;

      allStudents.push({
        id: allStudents.length + 1,
        name: name,
        dharma: cellText_(row[2], tz),               // Cột C: Pháp danh
        birthYear: cellText_(row[3], tz) || "Trống", // Cột D: Năm sinh
        club: cleanSheetName,
        region: club.region,
        belt: cellText_(row[5], tz) || "Chưa cập nhật", // Cột F: Cấp đai
        profile: cellText_(row[11], tz),             // Cột L: Link profile
        gender: cellText_(row[13], tz) || "Chưa rõ", // Cột N: Giới tính
        photo: photoRef_(row[20])                    // Cột U: Link ảnh đại diện (lưu ID file Drive cho gọn)
      });
    }
    // Tab khớp tên nhưng chưa có võ sinh nào (cột B trống) -> CLB sẽ không hiện trên Dashboard
    if (allStudents.length === countBefore) warnings.emptyTabs.push(originalSheetName);
  }

  // CLB có trong DS_CLB_VD nhưng không có tab nào khớp tên
  Object.keys(clubMap).forEach(function (key) {
    if (!clubMap[key].hasTab) warnings.clubsWithoutTab.push(clubMap[key].name);
  });

  if (warnings.tabsNotInMaster.length) Logger.log("Tab bị bỏ qua (không khớp DS_CLB_VD): " + warnings.tabsNotInMaster.join(" | "));
  if (warnings.emptyTabs.length) Logger.log("Tab khớp tên nhưng chưa có võ sinh nào: " + warnings.emptyTabs.join(" | "));
  if (warnings.clubsWithoutTab.length) Logger.log("CLB có trong DS_CLB_VD nhưng chưa có tab: " + warnings.clubsWithoutTab.join(" | "));
  return { students: allStudents, warnings: warnings };
}

function cellText_(value, tz) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Utilities.formatDate(value, tz, "dd/MM/yyyy");
  return value.toString().trim();
}

/**
 * Chuẩn hóa ô "LINK ẢNH ĐẠI DIỆN":
 *  - Link Google Drive (file/d/ID, open?id=ID, uc?id=ID, thumbnail?id=ID) hoặc chỉ dán ID -> trả về ID file
 *  - Link ảnh khác (https://...) -> giữ nguyên link
 *  - Ô trống / link thư mục / nội dung lạ -> "" (web sẽ hiện ảnh mặc định)
 */
function photoRef_(value) {
  var text = (value === null || value === undefined) ? "" : value.toString().trim();
  if (!text) return "";
  var m = text.match(/\/file\/d\/([-\w]{20,})/) || text.match(/\/d\/([-\w]{20,})/) || text.match(/[?&]id=([-\w]{20,})/);
  if (m) return m[1];
  if (/^[-\w]{20,}$/.test(text)) return text;
  if (/^https?:\/\/(?!drive\.google\.com\/drive\/)/i.test(text)) return text;
  return "";
}

function readCache_() {
  var id = PropertiesService.getScriptProperties().getProperty(CACHE_FILE_ID_PROP);
  if (!id) return null;
  try {
    var file = DriveApp.getFileById(id);
    if (file.isTrashed()) return null;
    return file.getBlob().getDataAsString("UTF-8") || null;
  } catch (err) {
    return null;
  }
}

function writeCache_(payload) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(CACHE_FILE_ID_PROP);
  var file = null;
  if (id) {
    try {
      file = DriveApp.getFileById(id);
      if (file.isTrashed()) file = null;
    } catch (err) {
      file = null;
    }
  }
  if (file) {
    file.setContent(payload);
  } else {
    file = DriveApp.createFile(CACHE_FILE_NAME, payload, MimeType.PLAIN_TEXT);
    props.setProperty(CACHE_FILE_ID_PROP, file.getId());
  }
}
