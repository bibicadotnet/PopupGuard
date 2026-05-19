# PopupGuard

**[🇺🇸 English](README.md)**

> **Kiểm soát trải nghiệm duyệt web của bạn.** Tiện ích này ngăn chặn các popup không mong muốn, các tab mới tự động mở và các chuyển hướng lén lút, trao cho bạn quyền quyết định cuối cùng trước khi bất kỳ trang nào được mở lên.

---

## Tính năng Cốt lõi

Thay vì chặn mù quáng mọi thứ và làm hỏng các trang web bạn đang dùng, tiện ích này sẽ tạm dừng hành động đó lại và hiển thị một hộp thoại xác nhận rõ ràng ngay trên trang. Bạn sẽ là người quyết định điều gì xảy ra tiếp theo:

- **Hành động một lần:** Chấp nhận (**Cho phép**) hoặc từ chối (**Chặn**) popup chỉ cho một lần click đó.
- **Quy tắc vĩnh viễn Thông minh:** Tích vào ô trước khi click để ghi nhớ lựa chọn của bạn mãi mãi.
  - **Luôn Cho phép / Chặn:** Thiết lập quy tắc popup vĩnh viễn cho trang web bạn đang truy cập.
  - **Chặn ở cấp độ Mạng (Network-Level):** Nếu một trang web cố chuyển hướng bạn đến một đích đến hoàn toàn khác (và thường là mờ ám), bạn có thể chọn chặn tất cả các yêu cầu mạng trong tương lai (script, hình ảnh, iframe) tới tên miền đích đó.

> **Lưu ý:** Các tên miền quan trọng đáng tin cậy như Google, Facebook và các ngân hàng lớn được bảo vệ thông qua một danh sách an toàn (safe list) tích hợp sẵn để đảm bảo việc duyệt web hàng ngày của bạn không bao giờ bị ảnh hưởng.

---

## Hướng dẫn Cài đặt

1. Tải về và giải nén file **[PopupGuard.zip](https://github.com/bibicadotnet/PopupGuard/releases/latest/download/PopupGuard.zip)**.
2. Mở `chrome://extensions/` trên trình duyệt của bạn.
3. Bật **Chế độ dành cho nhà phát triển** (Developer mode).
4. Nhấn **Tải tiện ích đã giải nén** (Load unpacked) và chọn thư mục vừa được giải nén.

---

## Quản lý Đơn giản & Nhanh chóng

Nhấn vào biểu tượng tiện ích trên thanh công cụ để xem bảng điều khiển. Thành thật mà nói, không có nhiều thứ để cấu hình—việc quản lý các quy tắc trực tiếp thông qua các cảnh báo hộp thoại thường là quá đủ. Nhưng khi bạn cần, bảng điều khiển sẽ cung cấp:

- **Thẻ trạng thái Trực tiếp:** Xem ngay quy tắc đang được áp dụng cho tab hiện tại của bạn và thay đổi nó ngay lập tức.
- **Phân loại theo Tab:** Lọc nhanh các quy tắc tùy chỉnh của bạn theo mức độ *Cho phép* (Allowed), *Đã chặn* (Blocked), hoặc *Mạng* (Network).
- **Nhập thủ công Nâng cao:** Thêm các quy tắc tùy chỉnh bằng tên miền chính xác (`example.com`) hoặc ký tự đại diện (`*.example.com`).
- **Tìm kiếm Siêu tốc:** Tìm và xóa ngay lập tức bất kỳ quy tắc nào nếu bạn lỡ thao tác nhầm.

---

## Điều tuyệt vời nhất?

**Cài đặt một lần và quên nó đi.** Bạn sẽ hiếm khi cần mở bảng điều khiển của tiện ích. Hộp thoại xuất hiện trực tiếp đã xử lý 99% công việc một cách mượt mà trong lúc bạn lướt web. Chỉ cần cho phép những gì bạn cần, chặn những gì bạn không muốn, và để tiện ích lo phần còn lại.

---

## Quyền riêng tư & Cấp quyền

PopupGuard được xây dựng với ưu tiên hàng đầu là quyền riêng tư. Tiện ích chạy hoàn toàn cục bộ trên máy tính của bạn.

* **Không chạy mã từ xa:** Tất cả các đoạn mã (script) đều được đóng gói cục bộ.
* **Không theo dõi:** Chúng tôi không thu thập, truyền tải hoặc bán lịch sử duyệt web của bạn.
* **Lưu trữ Cục bộ:** Các quy tắc tùy chỉnh của bạn được lưu bằng API `storage.sync` tích hợp sẵn trên trình duyệt.
