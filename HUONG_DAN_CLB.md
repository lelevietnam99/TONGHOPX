# Hướng dẫn: quản lý dữ liệu từng CLB an toàn (không sửa trực tiếp Google Sheets)

## Các trang mới

| Trang | Ai dùng | Mục đích |
|---|---|---|
| `clb.html?id=12` | Mọi người | Xem danh sách võ sinh của CLB có STT 12 (không cần mật khẩu, đã ẩn dữ liệu nhạy cảm) |
| `clb-admin.html?id=12` | Quản lý CLB | Đăng nhập bằng mật khẩu riêng của CLB: thêm, sửa, xóa, chấm tiến độ, khôi phục (thùng rác) |
| `quantri-tong.html` | Chủ hệ thống | Cấp / đặt lại mật khẩu từng CLB, tải danh sách mật khẩu, xem nhật ký thay đổi |

`id` chính là **STT của CLB trong tab `DS_CLB_VD`** (cột A).

## Cách hoạt động và vì sao an toàn hơn

- Dữ liệu vẫn nằm trong Google Sheets, nhưng **chỉ một dự án Apps Script riêng (CLB API) được phép ghi**. Bạn gỡ quyền chỉnh sửa của mọi người khác.
- Mỗi CLB có **mật khẩu riêng**; hệ thống chỉ lưu bản mã hóa (băm + muối), không ai xem lại được. Sai 5 lần thì khóa 15 phút. Đăng nhập có hiệu lực 8 giờ và tự hết hiệu lực khi đổi mật khẩu.
- Quản lý CLB này **không thể** sửa hay xóa dữ liệu của CLB khác (kể cả khi cố tình gửi yêu cầu giả).
- Mọi thao tác thêm / sửa / chấm / xóa / khôi phục được ghi vào tab ẩn `NHAT_KY_CLB`. **Xóa nhầm hay xóa cố ý đều khôi phục được** trong "Thùng rác" (hoặc từ tab nhật ký, nơi lưu trọn dữ liệu trước khi xóa).
- Hai người cùng sửa một võ sinh: người đến sau được báo xung đột và không ghi đè.
- Võ sinh được nhận diện bằng **mã định danh** (cột "Mã định danh (không sửa)" tự thêm vào cuối mỗi tab CLB), không dùng số dòng, nên xóa/chèn dòng không làm ghi nhầm người.
- Trang xem công khai **ẩn** các cột `Ghi chú`, `Chiều cao`, `Cân nặng` và chỉ hiện **năm sinh** (không hiện ngày tháng).
- Chống chèn công thức: ô nhập bắt đầu bằng `=`, `+`, `-`, `@` được lưu như văn bản.

## Cài đặt (làm một lần)

1. **Tạo dự án Apps Script mới** tại https://script.new, đặt tên "CLB API", xóa code mẫu và dán toàn bộ file `apps-script/clb-api/Code.gs`.
   Đây là dự án **độc lập**, không đụng tới dự án Apps Script đang chạy Dashboard.
2. **Project Settings (bánh răng) → Script properties → Add**:
   - `SHEET_ID`: mã file Google Sheets (đoạn giữa `/d/` và `/edit` trên thanh địa chỉ).
   - `SUPER_KEY`: mật khẩu quản trị tổng do bạn tự đặt, **từ 12 ký tự**. Chỉ bạn biết.
3. Chọn hàm **`khoiTao`** → **Chạy** → cho phép quyền. Đọc **Nhật ký thực thi**: nó cho biết CLB nào chưa có tab khớp tên (sửa tên tab hoặc tên trong `DS_CLB_VD` cho giống nhau).
4. **Triển khai → Triển khai mới → Ứng dụng web**: *Thực thi với tư cách = Tôi*, *Người có quyền truy cập = Bất kỳ ai*. Copy link `/exec`.
5. Dán link vào **`clb-config.js`** (`window.CLB_API_URL = "..."`), commit lên GitHub.
6. Mở **`quantri-tong.html`**, nhập `SUPER_KEY`, bấm **Cấp mật khẩu cho … CLB chưa có**, tải file CSV và gửi từng CLB link quản lý + mật khẩu của riêng họ.
7. **Khóa Google Sheets**: bấm Chia sẻ, gỡ quyền *Người chỉnh sửa* của mọi người (chỉ để mình bạn). Bước này mới thật sự ngăn việc sửa/xóa trực tiếp.
8. **Vô hiệu hóa API cũ không có mật khẩu** của trang `BAOCAOTIENDO` (link `AKfycbxoWTm…`): vào Apps Script của nó → Triển khai → Quản lý các bản triển khai → Lưu trữ. Nếu không, bất kỳ ai biết link cũ vẫn ghi được.

Sau khi sửa code Apps Script: **Triển khai → Quản lý các bản triển khai → bút chì → Phiên bản mới** (đừng tạo triển khai mới để giữ nguyên link).

## Lưu ý khi dùng

- **Đừng đổi tên dòng tiêu đề** các cột trong tab CLB (`Họ và tên`, `Cấp đai hiện tại`, `Những bài đã hoàn thành`, …): hệ thống nhận cột theo tên tiêu đề. Cột nào có thêm sau này (ví dụ cột thứ R, S, T) sẽ **tự xuất hiện** trong form; cột có dropdown/checkbox trong Sheets cũng hiện đúng kiểu.
- Cột `Cấp đai hiện tại` dùng danh sách 19 cấp trong `chuong-trinh.js`; muốn thêm/sửa bài học thì sửa file này (mọi CLB dùng chung).
- Bảng chấm tiến độ tách danh sách bài dựa trên chương trình học, nên các bài có dấu phẩy trong tên (ví dụ *"Ôn tập: Các bài quyền môn phái, Liên đoàn đã học"*) được nhận đúng. Trang cũ bị lỗi ở các bài này.
- Quên mật khẩu CLB: vào `quantri-tong.html` bấm **Đặt lại** để cấp mật khẩu mới.
- Thùng rác trên trang quản lý hiển thị các lần xóa gần nhất (khoảng 500 thao tác gần nhất của toàn hệ thống). Xóa cũ hơn vẫn nằm trong tab `NHAT_KY_CLB` (chuột phải thanh tab → Hiện sheet).
- Nên đặt tên phiên bản định kỳ (**Tệp → Lịch sử phiên bản → Đặt tên phiên bản hiện tại**) hoặc tạo bản sao file mỗi tuần để có thêm một lớp sao lưu.

## Giới hạn hiện tại

- Mỗi CLB dùng **một mật khẩu chung** (chưa có tài khoản riêng từng người). Ai biết mật khẩu thì quản lý được CLB đó; nhật ký ghi theo CLB, không ghi tên người.
- Người có quyền **chỉnh sửa** file Google Sheets vẫn sửa trực tiếp được (hệ thống cố ý không chặn chủ file). Vì vậy bước 7 ở trên là bắt buộc.
- Trang xem công khai vẫn hiển thị họ tên, pháp danh, cấp đai, tiến độ và ảnh của võ sinh (giống Dashboard hiện tại). Muốn ẩn thêm cột nào, sửa hằng số `PUBLIC_HIDDEN_ROLES` trong `Code.gs`.
