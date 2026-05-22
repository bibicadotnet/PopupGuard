# PopupGuard

![XS84xGJp](https://img.bibica.net/XS84xGJp.png)

**[🇺🇸 English](README.md)**

> Tiện ích này ngăn chặn các popup không mong muốn, các tab mới tự động mở và các chuyển hướng lén lút, trao cho bạn quyền quyết định cuối cùng

---

## Hướng dẫn Cài đặt

- Truy cập [PopupGuard](https://chromewebstore.google.com/detail/popupguard/ebpnmjkhlljiilkobejkdbhjjmjmjiaf), cài đặt như 1 plugin thông thường

## Tính năng Cốt lõi

Khi một trang web cố mở lén lút tab mới, cửa sổ mới, hoặc điều hướng sang trang khác, một hộp thoại cảnh báo sẽ hiện ra ngay trong tab hiện tại.

![rwT0lHDJ](https://img.bibica.net/rwT0lHDJ.png)

### Nút Hành động
* **Allow this time** (Xanh lá): Cho phép yêu cầu này một lần.
* **Block this time** (Đỏ): Chặn yêu cầu này một lần.

### Checkbox (Ghi nhớ quy tắc)
Lựa chọn của bạn sẽ được lưu lại (bạn có thể thay đổi hoặc xóa bất cứ lúc nào qua biểu tượng tiện ích). Khi đánh dấu vào một ô, lựa chọn đối nghịch sẽ tự động bị bỏ chọn:
* **Always allow `[nguồn]` to open new tabs**: Tự động cho phép mọi nỗ lực mở tab/cửa sổ mới từ tên miền nguồn này trong tương lai.
* **Always block `[nguồn]` from opening new tabs**: Các yêu cầu tự động mở popup (bằng mã ngầm) từ tên miền nguồn này sẽ bị âm thầm chặn lại. Tuy nhiên, nếu bạn **tự tay click (click vật lý)** vào một liên kết, hệ thống vẫn sẽ hiện hộp thoại hỏi để đảm bảo không chặn nhầm các liên kết hợp lệ.
* **Block all network requests to `[đích]`**: Tất cả các kết nối đến tên miền đích (script, hình ảnh, iframe, điều hướng...) sẽ bị chặn hoàn toàn ở tầng mạng (cấp độ DNS). Trang sẽ tự động tải lại sau khi bạn nhấn nút *Block this time* để áp dụng quy tắc.

*(Lưu ý: Các tên miền đi tới danh sách trắng như shopee.vn, tiktok.com, v.v. sẽ tự động được bỏ qua).*

## Bảng điều khiển (Popup tiện ích)

Nhấn vào biểu tượng tiện ích trên thanh công cụ để quản lý thủ công:

![P2g7510N](https://img.bibica.net/P2g7510N.webp)

- **Current Tab:** Xem và thay đổi nhanh quy tắc của tab hiện tại.
- **Allowed / Blocked:** Quản lý danh sách các trang được phép hoặc bị chặn mở popup.
- **Network:** Danh sách các trang bị chặn hoàn toàn ở cấp độ mạng/DNS.
- **Default:** Danh sách trắng các trang uy tín (Google, Facebook...), luôn được phép và không thể chặn.
- **Thêm thủ công:** Hỗ trợ tên miền (`example.com`) hoặc wildcard (`*.example.com`). Ở tab **All**, cho phép thêm rule bằng tùy chọn. Các tab khác, domain thêm vào sẽ mặc định ở tab đó.
- **Tìm kiếm & Xóa:** Lọc và xóa nhanh các quy tắc.

## Trải nghiệm sử dụng

Sau khi cài đặt, bạn hiếm khi cần mở bảng điều khiển. Các hộp thoại cảnh báo sẽ xuất hiện trực tiếp ngay trên trang web để bạn xử lý nhanh (Cho phép/Chặn) mà không làm gián đoạn việc lướt web.

PopupGuard không thiết kế để chặn quảng cáo, hay chặn khi người dùng tự click vào banner quảng cáo, tác dụng của nó là chặn các popup/redirect bị gọi lén

---

## Quyền riêng tư & Bảo mật

Tiện ích hoạt động hoàn toàn offline trên thiết bị của bạn:
* **Không chạy mã từ xa:** Toàn bộ mã nguồn được đóng gói và chạy cục bộ.
* **Không theo dõi:** Không thu thập hay gửi lịch sử duyệt web ra bên ngoài.
* **Lưu trữ an toàn:** Các quy tắc được lưu trực tiếp bằng tính năng `storage.sync` của trình duyệt.
