# BUG FIX: EQUALIZER SLIDER DRAG SENSITIVITY – FULL RANGE JUMP

## 1. Mô tả lỗi

GNOME Extension Music Control & Equalizer hiện có lỗi nghiêm trọng khi kéo chuột để điều chỉnh Gain.

Hiện tượng:
- Kéo chuột một khoảng rất nhỏ nhưng Gain thay đổi cực lớn.
- Có trường hợp Gain nhảy thẳng từ -12dB lên +12dB hoặc ngược lại.
- Lỗi xảy ra trên TOÀN BỘ Slider:
  - 10-band Equalizer.
  - Bass.
  - Treble.
- Mouse Wheel hoạt động hoàn toàn bình thường.

Đây có khả năng là lỗi trong cơ chế xử lý Mouse Drag dùng chung của các Slider.

## 2. Ưu tiên điều tra nguyên nhân

Không mặc định đây chỉ là lỗi sensitivity.

Hãy kiểm tra lần lượt:

### A. Coordinate Mapping

Kiểm tra:
- Event coordinates.
- Stage coordinates.
- Local coordinates.
- Actor position.
- Slider track position.
- Slider track height.
- Thumb position.

Đảm bảo phép tính sử dụng tọa độ tương đối đúng với vùng Slider.

Không trộn lẫn tọa độ Stage và Local.

### B. Gain Mapping Formula

Kiểm tra công thức chuyển đổi tọa độ chuột thành Gain.

Công thức tham chiếu:

```javascript
const normalized = Math.max(
    0,
    Math.min(1, (trackBottom - pointerY) / trackHeight)
);

const gain = minGain + normalized * (maxGain - minGain);
```

Lưu ý: Đây chỉ là công thức tham chiếu. Phải xác định chính xác hệ tọa độ và vùng Track của implementation hiện tại trước khi áp dụng.

Với:
- minGain = -12dB.
- maxGain = +12dB.
- trackHeight = chiều cao vùng kéo thực tế.
- normalized = giá trị trong khoảng 0 đến 1.

Đảm bảo:
- Đầu dưới Track tương ứng -12dB.
- Đầu trên Track tương ứng +12dB.
- Không có phép chia cho 0.
- Không sử dụng chiều cao vùng kéo quá nhỏ.
- Không tính Gain dựa trên toàn bộ cửa sổ hoặc Stage.

### C. Drag Event Handling

Kiểm tra toàn bộ vòng đời:

1. Mouse Press.
2. Drag Start.
3. Mouse Motion.
4. Drag Update.
5. Mouse Release.

Đảm bảo:
- Không mất trạng thái Drag.
- Không nhảy giá trị khi bắt đầu kéo.
- Không cập nhật sai khi chuột di chuyển nhanh.
- Không bị ảnh hưởng bởi việc UI thay đổi kích thước.
- Có thể kéo ra ngoài Track mà không mất điều khiển.

### D. UI Synchronization

Kiểm tra xem quá trình cập nhật Gain có khiến Slider tự thay đổi kích thước hoặc vị trí Thumb hay không.

Không để cập nhật UI làm sai tọa độ Drag đang được sử dụng.

## 3. Yêu cầu sửa chữa

Tạo một cơ chế Drag ổn định và dùng chung cho tất cả Slider.

Ưu tiên:
- Một công thức mapping thống nhất.
- Coordinate mapping chính xác.
- Gain luôn được clamp trong phạm vi hợp lệ.
- Độ chính xác 0.1dB.
- Chuyển động mượt.
- Không nhảy từ Min lên Max khi di chuyển chuột một khoảng ngắn.

Nếu cần cải thiện sensitivity, hãy điều chỉnh dựa trên chiều cao Track thực tế và khoảng Gain, không sử dụng hệ số giảm tùy ý.

## 4. Kiểm thử bắt buộc

Kiểm tra trên tất cả Slider EQ, Bass và Treble:

- Kéo 1 pixel.
- Kéo 5 pixel.
- Kéo 10 pixel.
- Kéo 50 pixel.
- Kéo toàn bộ Track.
- Kéo chậm và kéo nhanh.
- Kéo từ Min lên Max.
- Kéo từ Max xuống Min.
- Nhấn vào giữa Track.
- Kéo trực tiếp Thumb.

Đối chiếu sự thay đổi Gain với khoảng cách di chuyển chuột.

Với Track cao H pixel và dải Gain 24dB, mức thay đổi lý tưởng mỗi pixel là:

24 / H dB.

Ví dụ nếu Track cao 120px:
- 1px ≈ 0.2dB.
- 5px ≈ 1dB.
- 10px ≈ 2dB.

Các giá trị này chỉ là ví dụ để kiểm tra, không phải thông số cố định.

Mouse Wheel phải giữ nguyên hành vi hiện tại.

## 5. Bảo toàn dự án

- Không viết lại toàn bộ Equalizer.
- Không thay đổi Audio Backend.
- Không sửa preset nếu không cần thiết.
- Không thay đổi thiết kế UI.
- Không ảnh hưởng đến chức năng khác.

## 6. Báo cáo

Sau khi sửa, cung cấp:
1. Nguyên nhân gốc thực tế.
2. Đoạn code cũ gây lỗi.
3. Đoạn code mới.
4. Danh sách file thay đổi.
5. Kết quả kiểm thử trên EQ, Bass và Treble.

Không được chỉ giảm độ nhạy để che giấu lỗi. Phải sửa đúng nguyên nhân gốc.

BẮT ĐẦU BẰNG VIỆC KIỂM TRA HÀM XỬ LÝ DRAG ĐANG ĐƯỢC DÙNG CHUNG BỞI CÁC SLIDER.
