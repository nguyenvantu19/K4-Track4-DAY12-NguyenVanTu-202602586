# REPORT — Lab Day 12

> Báo cáo của Nguyễn Văn Tứ, sử dụng số liệu chạy với MSSV `202602586`, 5 seed huấn luyện và toàn bộ dữ liệu. Các số được làm tròn để trình bày; giá trị gốc nằm trong `evidence/*.json`.

| | |
|---|---|
| Họ và tên | Nguyễn Văn Tứ |
| MSSV (đúng bằng `--student-id` bạn đã chạy) | `202602586` |
| GitHub | [nguyenvantu19](https://github.com/nguyenvantu19) |
| Seed chia dữ liệu / seed mô hình (xem `evidence/closedloop.json`, mục `student`) | 714 / 8779, 8780, 8781, 8782, 8783 |
| Số seed huấn luyện bạn dùng (`--seeds`) | 5, chạy đầy đủ, không dùng `--quick` |

## Kết quả cuối

Nguồn: `evidence/closedloop.json`, `openloop.json`, `gate.json`; L2 từng seed của PercMLP+ và khung AEB được tính bổ sung từ model/log đã lưu, ghi tự động trong `evidence/report_details.json`. Tỷ lệ dưới đây là phần trăm; dải thể hiện biến thiên qua 5 seed, không phải khoảng tin cậy.

| Bộ điều khiển | L2 vòng hở (m) | Va chạm vòng kín trên log (%) | Quyết định cổng |
|---|---|---|---|
| constant-velocity | 1,2713 | 20,7770 | BLOCK: R2, R3, R4, R6 |
| IDM | 1,4852 | 0,0347 | Baseline |
| EgoMLP | 0,7649–0,7697 (TB 0,7670) | 16,8228–26,6389 | BLOCK: R2–R6 |
| PercMLP | 0,6197–0,6264 (TB 0,6228) | 0,6243–3,8502 | BLOCK: R2–R6 |
| PercMLP+ (sau khi sửa) | 0,7888–0,8422 (TB 0,8062) | 0,1734–0,2428 | RELEASE: đạt cả 7 quy tắc |

## Câu 1 · Dữ liệu
Bước 0 bạn phát hiện những vấn đề gì ở dữ liệu? Vì sao không dùng cột `Acc_LV`, và bạn thay bằng gì? Bao nhiêu quỹ đạo bị loại vì trùng, và vì sao chia theo quỹ đạo?

Theo `evidence/data_audit.json`, dữ liệu có 992.679 dòng và 9.993 quỹ đạo; loại 383 quỹ đạo trùng còn 9.610.
Tương quan của `Acc_LV` với đạo hàm tốc độ chỉ 0,04535, trong khi cột của xe theo sau đạt 0,92909: dùng trực tiếp `Acc_LV` sẽ khai thác sai sự kiện phanh.
Tôi thay bằng `a_lead`, lấy sai phân trung tâm từ `Speed_LV` đã làm mượt bằng trung bình trượt; không lấy đạo hàm xuyên qua ranh giới hai quỹ đạo.
Các đoạn dài 70–109 mẫu, trung vị 106, lấy mẫu mỗi 0,1 s; phần đệm NaN phải được loại khỏi phép thống kê.
Quỹ đạo trùng ở hai tập làm rò rỉ dữ liệu, còn chia từng khung khiến các trạng thái gần như giống nhau xuất hiện ở cả train và test.
Vì vậy phải loại trùng trước rồi chia theo toàn bộ quỹ đạo bằng seed 714; kiểm tra hình học cũng xác nhận khoảng cách bằng chênh vị trí trừ chiều dài xe khoảng 4,5 m.

## Câu 2 · Phát lại
Bản refactor float32 khác bit ở bao nhiêu đoạn, vượt dung sai ở bao nhiêu? Thay đổi AEB làm lệch bao nhiêu đoạn, và vì sao lệch ở đúng những khung đó (mở một đoạn ra xem)? Phát theo thời gian thật làm lộ ra điều gì mà phát nhanh nhất che đi?

Theo `evidence/replay.json`, chạy lại cùng mã giống hệt cả 600 đoạn; refactor float32 khác giá trị chính xác ở 600/600 đoạn nhưng không đoạn nào vượt dung sai.
Sai khác cực đại của refactor khoảng 4,0×10⁻⁴ m/s²; tiêu chí là từng lệnh nằm trong `1e-3 + 1e-3 * |golden|`, hai NaN đệm cùng vị trí được coi là bằng nhau.
AEB làm lệch 11/600 đoạn. Mở đoạn 63 trong `work/replay_log.jsonl` theo chỉ số được lưu ở `behaviour_change_aeb.differing_segments` thấy lệch tại khung 75–77.
TTC tính lại ở ba khung lần lượt khoảng 1,475; 1,462; 1,436 s, đều dưới ngưỡng 1,5 s; AEB đổi gia tốc khoảng −4,38/−4,36/−4,35 thành −6,00 m/s².
Các số theo khung được tính trực tiếp từ log tái tạo và ghi tự động trong `evidence/report_details.json`, mục `aeb_example`; các khung khác không kích hoạt AEB hoặc đã phanh mạnh hơn nên không đổi lệnh.
Phát nhanh nhất có 0 khung trễ và 0 khung rớt, còn phát theo thời gian ghi log có 582 khung trễ và 579 khung rớt trên 59.760 khung, khiến 371 đoạn thay đổi.
Trong mô phỏng thời gian xử lý, tác vụ vượt deadline hoặc còn bận ở khung kế tiếp buộc giữ lệnh cũ; chế độ nhanh nhất bỏ qua lịch đến của cảm biến nên che khuất lỗi này.

## Câu 3 · Kịch bản
Lưới của bạn (tốc độ cruise, giới hạn khoảng cách, số ô): bao nhiêu % ô **không ai tránh được**? Độ trễ phản ứng 0 → 0,6 s làm vùng đâm của IDM tăng bao nhiêu? Log có phủ vùng khó không? (dẫn giới hạn phanh mạnh nhất của người lái trong log, và phần lưới đòi hỏi hơn thế)

Theo `evidence/scenarios.json`, lưới có tốc độ cruise 10 m/s, khoảng cách 2,760–59,312 m và tốc độ tiến gần 0–10 m/s; 60×45 = 2.700 ô.
Biên bất khả thi là `gap < dv*t_react + dv²/(2*b_max)` với `dv > 0`; phần đầu là quãng co khoảng cách lúc chưa phản ứng, phần sau là lúc phanh tối đa.
Độ trễ 0 s có 0,963% ô bất khả thi; tăng lên 0,6 s thành 5,148%. IDM tăng diện tích đâm tương ứng từ 0,963% lên 5,148%, tức tăng 4,185 điểm phần trăm.
Cả hai lần kiểm chứng phanh tối đa đều có 0 ô lệch ngoài vùng sát biên; IDM có diện tích va chạm tránh được bằng 0, nên phải tách giới hạn vật lý khỏi lỗi điều khiển.
Khai thác được 614 ca phanh, chiếm 6,389% quỹ đạo; đỉnh giảm tốc xe dẫn có trung vị −2,535 m/s² và phân vị mạnh 1% khoảng −4,211 m/s².
Ngưỡng phanh mạnh của người theo sau tại phân vị 99,9% là 3,625 m/s², thấp hơn khả năng cơ cấu chấp hành 9 m/s²; 5,222% lưới đòi phanh mạnh hơn ngưỡng đó.
Các điểm trắng trong `evidence/scenarios_idm.png` chủ yếu ở vùng tốc độ tiến gần thấp: log bám xe có ca phanh nhưng không phủ đều các ca cắt vào với khoảng cách ngắn, chênh tốc cao.

## Câu 4 · Vòng hở và vòng kín
Dán bảng L2 và tỷ lệ va chạm của bốn bộ điều khiển (kèm hạng ở mỗi cách chấm). Cặp nào đổi thứ tự? Vì sao IDM có L2 như vậy mà vẫn lái tốt? Vì sao EgoMLP có L2 tốt hơn constant-velocity mà vẫn đâm?

Số liệu từ `evidence/openloop.json` và `evidence/closedloop.json`; hạng vòng kín dùng tỷ lệ trung bình qua seed, cùng 2.883 quỹ đạo test:

| Bộ điều khiển | L2 trung bình (m) | Hạng L2 | Va chạm trung bình (%) | Dải va chạm qua seed (%) | Hạng vòng kín |
|---|---:|---:|---:|---:|---:|
| constant-velocity | 1,2713 | 3 | 20,7770 | 20,7770 | 3 |
| IDM | 1,4852 | 4 | 0,0347 | 0,0347 | 1 |
| EgoMLP | 0,7670 | 2 | 21,1030 | 16,8228–26,6389 | 4 |
| PercMLP | 0,6228 | 1 | 1,4915 | 0,6243–3,8502 | 2 |

Các cặp đảo thứ tự trong `ranking.order_flips` là constant-velocity/IDM, constant-velocity/EgoMLP, IDM/EgoMLP và IDM/PercMLP.
IDM chủ động giữ khoảng cách và phanh theo tương tác, nên không tái hiện chính xác quãng đường người lái; L2 cao không đồng nghĩa điều khiển nguy hiểm.
EgoMLP chỉ thấy lịch sử tốc độ bản thân: học được xu hướng chạy xe nên L2 tốt hơn giữ tốc độ, nhưng không biết khoảng cách và xe trước đang chậm lại để phanh kịp.
Khi tự lái, sai số làm trạng thái khác log rồi tiếp tục tác động lên dự báo sau; vòng hở luôn cho lịch sử thật nên không phơi bày đầy đủ quá trình tích luỹ này.
Trên 71.872 cửa sổ test, lát cắt sắp phanh chỉ chiếm 4,713%; L2 PercMLP tăng từ 0,6228 lên 0,8622 m trên lát cắt, cho thấy trung bình che các trường hợp khó.

## Câu 5 · Một lần chạy chưa đủ
EgoMLP dao động bao nhiêu giữa các seed? Khoảng tin cậy Wilson nói gì? Nếu bạn chỉ chạy đúng một seed thì có thể báo kết quả nào, và vì sao điều đó nguy hiểm?

Theo `evidence/closedloop.json`, EgoMLP trên các seed 8779–8783 có tỷ lệ va chạm lần lượt 17,4124%; 16,8228%; 26,6389%; 20,9851%; 23,6559%.
Dải 16,8228–26,6389% rộng 9,8162 điểm phần trăm dù cùng tập test 2.883 quỹ đạo; trung bình là 21,1030%.
Seed tốt nhất 8780 đâm 485 lần, Wilson 95% là [15,5016%; 18,2322%]; seed xấu nhất 8781 đâm 768 lần, khoảng [25,0571%; 28,2829%].
Hai khoảng không chồng nhau: biến thiên do huấn luyện lớn hơn độ bất định lấy mẫu biểu hiện ở các khoảng này; Wilson của một seed không bao quát sự bất ổn giữa seed.
Chỉ chọn seed 8780 có thể báo 16,8228%, trông tốt hơn constant-velocity 20,7770%; chọn seed 8781 lại báo 26,6389%, kém hơn rõ rệt.
Vì vậy cần công bố cả dải, trung bình và khoảng tin cậy từng seed; cổng dùng seed xấu nhất và R5 yêu cầu dải không quá 1 điểm phần trăm để tránh chọn kết quả thuận lợi.

## Câu 6 · Tác nhân phản ứng
Dán bảng "xe sau phát lại" và "xe sau phản ứng". `T` bạn hiệu chỉnh là bao nhiêu, xe sau chân thực đến mức nào so với xe không phản ứng? Vì sao IDM bị tính "va chạm giả" khi xe sau chỉ phát lại, và điều này làm đổi kết luận về bộ điều khiển ra sao?

Theo `evidence/agents.json`, hiệu chỉnh được `T = 1,4 s`, Wasserstein-1 = 0,34062, so với 0,84614 của xe không phản ứng; trung vị time headway người lái là 1,84284 s.
T = 1,2 s cũng gần tương đương (W1 = 0,34144), nên đây là lựa chọn tốt nhất trên lưới thử, chưa phải chứng minh mô hình khớp mọi kiểu người lái.
Bảng dưới lấy tại độ trễ ego 0,6 s, xe sau cách 16 m và phản ứng trễ 0,6 s; các tỷ lệ là phần trăm của toàn bộ 2.700 ô:

| Bộ điều khiển | Bất kỳ va chạm: xe sau phát lại (%) | Va chạm sau: phát lại (%) | Bất kỳ va chạm: xe sau phản ứng (%) | Va chạm sau: phản ứng (%) |
|---|---:|---:|---:|---:|
| constant-velocity | 73,370 | 0,000 | 73,370 | 0,000 |
| IDM | 70,074 | 64,926 | 5,148 | 0,000 |
| EgoMLP | 73,296 | 0,000 | 73,296 | 0,000 |
| PercMLP | 71,815 | 46,222 | 27,519 | 0,000 |

IDM phanh để tránh xe cắt vào, nhưng xe sau phát lại vẫn giữ tốc độ, tạo 64,926% ô bị đâm phía sau; khi xe sau phản ứng thì tỷ lệ này về 0 trong mô hình.
Ở độ trễ ego 0 s, cùng hiện tượng làm IDM có tổng va chạm 69,556% với xe sau phát lại và chỉ 0,963% với xe sau phản ứng.
Trong cả hai thế giới IDM vẫn tốt hơn constant-velocity về tổng va chạm của lưới này, nhưng khoảng cách từ 73,370% thu hẹp còn 70,074% ở thế giới phát lại, làm che khuất phần lớn lợi ích phanh.
Không thể nói mọi va chạm sau ngoài đời đều giả; kết quả chỉ cho thấy tác nhân không phản ứng áp đặt hậu quả không nhất quán khi ego thay đổi hành vi, và có thể gây kết luận sai về nguyên nhân lỗi.

## Câu 7 · Cổng phát hành và sửa
Quy tắc nào chặn PercMLP và nguyên nhân gốc là gì (dẫn số)? Bạn sửa bằng gì và vì sao nó chữa đúng nguyên nhân? Sau khi qua cổng, PercMLP+ có **tốt hơn** IDM không? Nó có nên được phát hành không, và bạn đề xuất làm gì trước khi quyết định?

Theo `evidence/gate.json`, PercMLP rớt R2–R6; constant-velocity rớt R2, R3, R4, R6; EgoMLP rớt R2–R6. R1 và R7 đều đạt, nên không phải do công cụ replay hay thiếu số kịch bản.
R4 và R6 bộc lộ thiếu ca cắt vào khó trong log: vùng va chạm tránh được của PercMLP là 22,3704%, và tổng va chạm khi xe sau phản ứng là 27,5185% tại độ trễ 0,6 s.
R2/R3 phản ánh lỗi tích luỹ khi tự lái: seed xấu nhất đâm 111/2.883 log, gồm 26/192 ca phanh, mặc dù L2 trung bình chỉ 0,6228 m; R5 cho thấy dải seed rộng 3,2258 điểm phần trăm.
Tôi bổ sung nhãn IDM từ 20.000 ca cắt vào và 2 vòng DAgger trên log train: cách thứ nhất mở rộng miền tình huống, cách thứ hai dạy phục hồi ngay tại trạng thái mô hình tự đi vào; không dùng test để tạo nhãn.
Cổng giữ nguyên ngưỡng, lấy seed xấu nhất; sau sửa cả 5 quy tắc từng rớt đều chuyển sang đạt (nguồn `gate.json`, `closedloop.json`, `agents.json`):

| Quy tắc / đại lượng xét (%) | PercMLP | PercMLP+ | Ngưỡng phải ≤ (%) |
|---|---:|---:|---:|
| R2: cận trên Wilson va chạm trên log | 4,6161 | 0,5004 | 1,0347 |
| R3: cận trên Wilson trên lát cắt phanh | 19,1022 | 2,8908 | 5,5208 |
| R4: diện tích va chạm tránh được | 22,3704 | 0,1111 | 2,0000 |
| R5: dải tỷ lệ va chạm giữa seed (điểm phần trăm) | 3,2258 | 0,0694 | 1,0000 |
| R6: tổng va chạm khi xe sau phản ứng | 27,5185 | 5,2593 | 7,1481 |

L2 vòng hở lại tăng từ 0,6228 lên 0,8062 m, nhưng tỷ lệ va chạm log giảm từ dải 0,6243–3,8502% xuống 0,1734–0,2428%; điểm bắt chước người lái không thay thế phép đo điều khiển.
PercMLP+ học từ IDM và vẫn có 5–7 va chạm/seed trong khi IDM có 1; qua cổng chỉ là không kém hơn trong biên cho phép, không chứng minh tốt hơn thầy. Hai cách sửa được áp dụng chung nên chưa tách được đóng góp bằng ablation.
Tôi chấp nhận RELEASE theo đúng cổng của lab, nhưng chưa đề xuất thay IDM ngoài thực tế: cần đánh giá độc lập trên tình huống chưa dùng thiết kế/sửa mô hình, tốc độ ngoài miền, cảm nhận và động học thực hơn trước khi quyết định triển khai.

## Câu 8 · Bài lab này không chứng minh được gì
Chọn **ít nhất ba** giới hạn quan trọng nhất đối với việc quyết định phát hành và giải thích vì sao mỗi cái làm kết luận của bạn kém chắc chắn. Điều gì cần làm tiếp để thu hẹp khoảng cách đến thế giới thật?

Thứ nhất, mô phỏng chỉ có chuyển động dọc: 2.700 ô kiểm tra khoảng cách/chênh tốc ở cruise 10 m/s không bao phủ đánh lái, đường cong, giao lộ, người đi bộ hay quá trình cắt ngang; cần thêm kịch bản đa chiều và tác nhân hỗn hợp.
Thứ hai, đầu vào gần như trạng thái thật; thử nhiễu khoảng cách 1 m và tốc độ xe dẫn 0,5 m/s trong `evidence/closedloop.json` chưa đại diện cho che khuất, mất đối tượng, sai đồng bộ hay lỗi hệ thống kéo dài; cần kiểm thử cả chuỗi cảm nhận và độ trễ đo được.
Thứ ba, log sạch chỉ có 9.610 quỹ đạo ngắn, lấy mẫu 0,1 s, và test có 2.883 quỹ đạo: không đủ để suy ra rủi ro hiếm trên hành trình dài hoặc mọi điều kiện thời tiết; cần dữ liệu ngoài miền, thử nghiệm dài và khoảng tin cậy theo đơn vị tình huống độc lập.
Thứ tư, xe dẫn vẫn phát lại log, còn xe sau được rút gọn bằng một IDM với T = 1,4 s; hiệu chỉnh W1 = 0,34062 chỉ so một phân bố headway, không xác thực phản ứng khi bất ngờ hay mức độ hung hăng; cần nhiều kiểu tác nhân và đối chiếu hành vi thực.
Thứ năm, cổng chỉ chứng minh không kém baseline trong các biên sai số đã chọn, không chứng minh an toàn tuyệt đối: chính IDM vẫn có 1 va chạm trên 2.883 log và vùng bất khả thi tăng lên 5,148% khi trễ 0,6 s.
Kiểm tra ngoài miền trong `evidence/fix.json` minh hoạ giới hạn tổng quát hoá: tại 20 m/s, vượt tốc độ huấn luyện cắt vào tối đa 16 m/s, PercMLP+ vẫn có 0,4074–1,8519% ô va chạm tránh được, còn IDM là 0%; PercMLP gốc là 29,1852–44,7037%.
Vì vậy kết quả qua cổng của một ứng viên chỉ hỗ trợ chuyển sang đánh giá ngoài mẫu, mô phỏng trung thực hơn và chạy shadow/test có giám sát; chưa đủ để quyết định thay bộ điều khiển đang dùng ngoài thực tế.
