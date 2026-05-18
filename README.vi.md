# NoMoreTabs

**[🇬🇧 English](README.md)**

![NoMoreTabs Banner](https://img.bibica.net/srvMVjnP.png)

Browser extension giúp chặn các tab mới, popup và tự động chuyển hướng ngoài ý muốn.

## Cách hoạt động
Khi một trang web cố mở tab mới, cửa sổ mới, hoặc điều hướng sang trang khác, một hộp thoại xác nhận sẽ hiện ra ngay trong tab hiện tại.

### Nút hành động
* **Allow this time** (xanh lá): Cho phép yêu cầu này một lần.
* **Block this time** (đỏ): Chặn yêu cầu này một lần.

### Checkbox (Lưu quy tắc vĩnh viễn)
Khi chọn một checkbox, nút hành động ngược lại sẽ tự động bị tắt:
* **Always allow [nguồn] to open new tabs**: Tự động cho phép mọi yêu cầu mở tab/popup từ trang này trong tương lai. (Tự động tắt nút *Block this time*).
* **Always block [nguồn] from opening new tabs**: Tự động chặn mọi yêu cầu mở tab/popup từ trang này trong tương lai mà không cần hỏi. (Tự động tắt nút *Allow this time*).
* **Block all network requests to [đích]**: Chặn hoàn toàn tất cả request (script, ảnh, iframe, v.v.) đến tên miền đích ở tầng mạng (declarativeNetRequest). Hộp thoại chỉ hiển thị checkbox này khi tên miền đích khác tên miền nguồn. Nếu chọn, trang sẽ tự động tải lại sau khi ấn **Block this time**. *(Các domain thuộc danh sách mặc định như shopee.vn, tiktok.com... sẽ tự động được bỏ qua).*

---

## Popup tiện ích
Nhấn vào biểu tượng tiện ích trên thanh công cụ để quản lý thủ công:

* **Thẻ trạng thái động**: Tự động nhận diện tên miền hiện tại đang chặn hay mở (Blocked, Allowed, Network, Default hoặc No rule), cần thay đổi gì thì click trực tiếp vào nút tương ứng (Block, Allow, Clear) để lưu cấu hình cực nhanh.
* **Các tab quản lý trực quan**:
  * **All**: Tất cả quy tắc tự thiết lập + danh sách mặc định.
  * **Blocked**: Tên miền nguồn bị chặn popup (`popupBlock`).
  * **Allowed**: Tên miền nguồn được cho phép (`popupAllow`).
  * **Network**: Tên miền đích bị chặn ở tầng mạng (`navBlock`).
  * **Default**: Danh sách trắng mặc định (`allowlist.json`), gồm các tên miền uy tín (Google, Facebook, ngân hàng...) luôn được phép và không thể chặn để tránh lỗi trang.
* **Nhập thủ công**: Hỗ trợ tên miền thường `example.com` và wildcard `*.example.com`.
* Nhìn chung, bạn chỉ cần quản lý theo thông báo hiển thị khi duyệt web là đủ. Khi nào lỡ thêm hoặc chặn nhầm domain thì mới cần vào popup chỉnh lại. Tiện ích có sẵn thanh tìm kiếm nên thao tác rất nhanh, không phức tạp.

---

## Cài đặt
1. Tải xuống và giải nén **[NoMoreTabs.zip](https://github.com/bibicadotnet/NoMoreTabs/releases/latest/download/NoMoreTabs.zip)**.
2. Mở `chrome://extensions/` trong trình duyệt của bạn.
3. Bật **Chế độ nhà phát triển** (Developer mode).
4. Nhấp vào **Load unpacked** và chọn thư mục đã giải nén.

*Lưu ý: Tiện ích này cần cài đặt thủ công (không có trên Chrome Web Store vì phí đăng ký tài khoản tốn $5 :]])*
