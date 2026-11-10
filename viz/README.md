# viz — mô phỏng lái xe vòng kín

Phần **không bắt buộc và không chấm điểm**. Các cảnh chen làn chạy được bằng IDM trước khi xuất model. Sau bước 7, xe đỏ cũng có thể chạy bằng các model bạn đã huấn luyện (EgoMLP, PercMLP, PercMLP+). Mặc định, trang hiển thị đường, xe và người đi bộ từ trên xuống bằng góc nhìn **2D BEV**. Chọn **Mở góc nhìn 3D** để xem cùng mô phỏng từ camera phối cảnh.

## Chạy

```bash
python3 run_all.py --student-id <MSSV>      # nếu chưa chạy đủ các bước 3, 4, 6, 7
python3 scripts/export_viz.py               # xuất model và kết quả CỦA BẠN sang viz/
python3 viz/serve.py                        # rồi mở http://localhost:8765
```

2D BEV chạy với tài nguyên local. Góc nhìn 3D cần kết nối internet để nạp Three.js từ CDN và trình duyệt có WebGL. `lab_models.js` và `lab_data.js` do bạn tự sinh nên không được commit (đã có trong `.gitignore`).

Nếu `export_viz.py` báo thiếu gì, nó nói rõ phải chạy bước nào. Nếu trang hiện thông báo "chưa nạp được dữ liệu", bạn chưa chạy `export_viz.py` hoặc đã chạy ở thư mục khác.

## Cấu trúc vòng kín

1. **World Model State.** `World.observe()` trong `sim.js` lấy trạng thái tại bước hiện tại gồm vị trí, hướng và tốc độ của từng tác nhân.
2. **Render 2D BEV.** `bev-view.js` vẽ bản đồ và trạng thái đã ghi của bước đó. Cùng dữ liệu được dùng bởi `street-view.js` khi bật 3D.
3. **Ego Action.** `World.egoAction()` tính gia tốc và góc lái từ bộ điều khiển đang chọn hoặc lệnh bàn phím. Model bài lab đọc đặc trưng từ trạng thái mô phỏng, còn ảnh BEV phục vụ người quan sát.
4. **Traffic Agent Simulator.** `World.updateTraffic()` áp dụng IDM và các luật giao thông. Chế độ **Phản ứng** cho phép xe sau điều chỉnh theo xe ta, với độ trễ 0,6 giây trong các cảnh bài lab. Chế độ **Phát lại** giữ tốc độ xe sau theo kịch bản.
5. **Trạng thái kế tiếp.** `World.step()` ghi kết quả và tích phân chuyển động để đưa xe ta và các tác nhân tới bước kế tiếp sau 0,05 giây. Trạng thái mới đi vào vòng lặp tiếp theo.

Các vai trò được triển khai bằng JavaScript, Canvas 2D và các bộ điều khiển local của bài lab. Tên AlpaSim, NuRec và Alpamayo trong sơ đồ là tham chiếu kiến trúc NVIDIA. [Thiết kế AlpaSim](https://github.com/NVlabs/alpasim/blob/main/docs/DESIGN.md)

## Trong trang

### Bản đồ kiểm thử định tuyến

Mở `map.html` qua cùng máy chủ để thử **Xe cắt ngang đầu** và **Người đi bộ qua đường**. Hai ca này có vạch dừng và tác nhân chạy theo lịch của kịch bản. Danh sách cũng có **Công trường**, **Ùn tắc giờ cao điểm** và **Phố một chiều**. **3D theo xe** bám phía sau xe như camera của mô phỏng phát lại. Chọn **3D toàn cảnh** để xem toàn bộ mạng đường hoặc **2D BEV** để xem từ trên xuống. Các góc nhìn dùng chung vị trí xe, tuyến và đồng hồ mô phỏng.

Xe dùng Dijkstra để tìm tuyến có tổng thời gian ngắn nhất, tính cả thời gian chờ nhường đường tại điểm giao cắt. Nếu tuyến đi qua giao cắt khi tác nhân đang băng qua, xe dừng trước vạch và chạy tiếp khi vùng giao cắt thông thoáng. Đổi điểm đến hoặc đóng/mở đoạn đường để tính lại tuyến. Khi đang ở giữa đoạn, xe hoàn thành đoạn đó rồi theo lộ trình mới từ giao lộ kế tiếp.

**Về ban đầu** khôi phục vị trí xe, lịch qua đường, đích và các đường đóng mặc định. **Lặp tự động** giữ các điều kiện hiện tại và cho xe xuất phát lại sau khi tới đích. 2D BEV chạy với tài nguyên local. 3D dùng Three.js qua CDN và cần WebGL.

### Tự lái bằng bàn phím

Chọn cảnh muốn thử, rồi bấm **Tự lái bằng bàn phím** để điều khiển xe đỏ trực tiếp.

| Phím | Chức năng |
| --- | --- |
| W / ↑ | Giữ để tăng tốc |
| S / ↓ | Giữ để phanh về đứng yên |
| A / ←, D / → | Đánh lái trái, phải (có thể giữ cùng phím ga/phanh) |
| Space | Phanh gấp, ưu tiên hơn ga |
| P | Tạm dừng / tiếp tục |
| R | Bắt đầu lượt mới |

Nhả ga để xe chậm dần. Mỗi lượt dài 14 giây; xe khác vẫn phản ứng theo vật lý hiện có.
Chuyển tab, mất tiêu điểm cửa sổ hoặc chọn ô nhập liệu sẽ xóa trạng thái phím và tạm dừng; nhấn P để tiếp tục.
Trong chế độ này, thanh tua và tốc độ phát bị khóa ở thời gian thực.
Bấm **Trở về chế độ model tự lái** để xem lại các bộ điều khiển và bảng so sánh.
Chế độ bàn phím chuyển phím thành lệnh ga, phanh và lái trong `keyboard.js`. `app.js` đưa lệnh vào cùng vòng lặp mô phỏng với các model bài lab.
Kiểm tra chức năng bằng `node tests/test_keyboard_drive.cjs` từ thư mục gốc.

### Model và kết quả bài lab

- **Bộ điều khiển và seed:** chọn IDM, constant-velocity, EgoMLP, PercMLP hay PercMLP+, và một trong các seed bạn đã huấn luyện. Cảnh 3D hiển thị bộ đang chọn; bảng so cả năm bộ cùng lúc (với model học là một hàng cho mọi seed, ví dụ "2 / 5 seed").
- **Cảnh bài lab:** *xe dẫn phanh gấp*, *xe cắt vào* (chỉnh khoảng cách và tốc độ tiến gần như lưới bước 2) và *log thật* (xe dẫn theo quỹ đạo Argoverse, xe ta lặp lại người lái trong 2 giây đầu).
- **Chen vào làn bên cạnh:** *Phải sang trái*, *Trái sang phải* và *Chen sát rồi phanh*. Xe bắt đầu ở làn liền kề, chuyển làn lúc 2 giây và hoàn tất sau 0,8–1 giây. Cảnh cuối phanh 6 m/s² khi vào giữa làn. Góc nhìn 2D BEV đánh dấu xe chen làn màu xanh ngọc và thanh thời gian đánh dấu hai mốc chuyển làn. Ba ca dùng để quan sát trong mô phỏng.
- **Xe sau:** *phát lại* (không phản ứng) hay *phản ứng* (IDM, trễ 0,6 s), giống bước 5. Với xe sau phát lại, xe đó đâm xuyên qua xe ta rồi trông như xe phía trước, nên va chạm phía trước xảy ra *sau* cú đâm giả đó không được tính.
- **Nút "Chạy cả … log"** chạy cả năm bộ trên toàn bộ log đã xuất (nhiều log hơn một lần xem nhưng ít hơn bước 4 của bài lab).
- **Bảng cổng** ở cuối là quyết định `evidence/gate.json` của bạn: rê chuột lên dấu ✓ hoặc ✗ để xem số đo.

## Gợi ý để quan sát (có thể đưa vào câu 4 và 7 của báo cáo)

1. Cảnh xe dẫn phanh gấp, kéo mức phanh từ 3 lên 9 m/s²: bộ nào bắt đầu đâm ở mức nào? EgoMLP khác PercMLP ở điểm nào về thứ mà nó nhìn thấy?
2. Đổi seed của EgoMLP: xe có đâm ở mọi seed không? Việc này nói gì về một lần chạy?
3. Cảnh xe cắt vào, tăng tốc độ tiến gần: PercMLP và PercMLP+ khác nhau từ đâu? Điều đó khớp với quy tắc nào của cổng bị rớt và được sửa ở bước 7?
4. Đổi xe sau sang "phát lại": bộ điều khiển an toàn nào bỗng bị "đâm"? Vì sao đó không phải lỗi của nó?

## Lưu ý khi đọc kết quả

- Hai góc nhìn dùng cùng một mô phỏng chuyển động trên mặt đường. Bài lab dùng mô phỏng một chiều và bộ kịch bản khác, nên các chỉ số trong `evidence/` dùng để trích dẫn kết quả bài lab.
- Mô hình của bài lab chỉ biết bám xe. Đèn đỏ và người qua đường do một lớp luật IDM xử lý, vì log không có hai thứ đó.
