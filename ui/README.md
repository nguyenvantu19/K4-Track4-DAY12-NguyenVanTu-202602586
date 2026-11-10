# Looplab — giao diện local

Từ thư mục gốc dự án, chạy:

```powershell
python scripts/export_viz.py
python ui/serve.py
```

Mở **http://localhost:8080**. Đổi cổng bằng `python ui/serve.py --port 8081`.
Dừng server bằng `Ctrl+C` trong terminal đã khởi động.

Dashboard dùng HTML/CSS/JavaScript và Python chuẩn, không cần npm hay build.
Server chỉ lắng nghe tại `127.0.0.1`, đọc trực tiếp các JSON trong `evidence/` khi tải trang.
Chạy lại pipeline lab rồi tải lại trang để cập nhật kết quả; dashboard không sửa bằng chứng hoặc huấn luyện model.

- **Tổng quan:** so sánh 5 bộ điều khiển, lọc theo seed và lát cắt phanh, chọn điểm trên biểu đồ để xem chi tiết.
- **Kịch bản:** mở ba ca chen vào làn bên cạnh trong mô phỏng 2D BEV. Chỉnh khoảng cách, tốc độ tiến gần và độ trễ để khảo sát TTC và biên bất khả thi của lưới bài lab.
- **Phát lại log:** xem sai khác float32, các đoạn AEB thay đổi và khung xử lý trễ/rớt.
- **Cổng phát hành:** chọn ứng viên để xem đủ 7 quy tắc và số liệu quyết định.
- **Dữ liệu:** xem cách chia train/test, chất lượng cột gia tốc, tải bằng chứng và các hình kết quả.

Nút **Mở mô phỏng vòng kín** mở `/viz/` trên cùng server, dùng model đã xuất từ lần chạy của bạn. Trang mở ở góc nhìn 2D BEV. Chọn **Mở góc nhìn 3D** để đổi cách xem. Góc nhìn 3D tải Three.js qua internet.
Nếu model chưa xuất, chạy `python scripts/export_viz.py` rồi tải lại tab mô phỏng.

Các file trong `ui/` độc lập với 10 hàm TODO và nội dung chấm bài gốc. Mô phỏng trong `viz/` có chế độ **Tự lái bằng bàn phím**: W/↑ tăng tốc, S/↓ phanh, A/D hoặc ←/→ đánh lái, Space phanh gấp, P tạm dừng, R chạy lại. Chế độ này không thay đổi bằng chứng chấm bài hay vật lý gốc.
