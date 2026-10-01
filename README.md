# Check Face - eKYC Face Diagnostics Studio 🚀

Hệ thống xác thực khuôn mặt sinh trắc học và kiểm định thực thể sống (Liveness Detection & eKYC Anti-Spoofing) 100% chạy Client-side trên trình duyệt Web bằng WebGL/WebAssembly AI.

## ✨ Tính Năng Nổi Bật

- **100% Chạy Trực Tiếp Trên Trình Duyệt (Client-Side):** Không cần server backend xử lý ảnh, bảo mật tuyệt đối dữ liệu người dùng.
- **Tích Hợp 3 Model AI Cốt Lõi (~8.9 MB):**
  - `blazeface`: Nhận diện khuôn mặt thời gian thực cực nhanh.
  - `facemesh`: Tái tạo lưới 3D 468 điểm mốc sinh học, đo độ cong sống mũi và độ sâu không gian 3D.
  - `faceres`: Trích xuất vector đặc trưng 1024 chiều (1024D Embeddings) để đối sánh danh tính chính xác.
- **Thử Thách Hành Vi Ngẫu Nhiên (Random Liveness Challenge):**
  - Nhiệm vụ hành vi ngẫu nhiên: Quay trái, Quay phải, Ngẩng lên.
  - Đếm ngược thời gian phiên (mặc định 10 giây).
  - Tự động chuyển lượt mới khi hoàn thành hoặc hết thời gian.
- **Chống Giả Mạo 3D Sinh Học (Anti-Spoofing):**
  - Phân tích khối lồi 3D của khuôn mặt, ngăn chặn ảnh in 2D và video giả mạo trên màn hình điện thoại.
- **Lưu Trữ Lịch Sử Kiểm Định Dạng Mini Thumbnails:**
  - Hiển thị trực quan các lượt Pass/Fail kèm tooltip chi tiết.
  - Hỗ trợ xuất dữ liệu báo cáo audit dạng JSON phục vụ tối ưu thuật toán.

## 🛠️ Công Nghệ Sử Dụng

- **Vite** + **React 19** + **TypeScript**
- **@vladmandic/human** (TensorFlow.js WebGL backend)
- **Lucide Icons**
- **CSS-First Architecture** với giao diện Dark Mode tối ưu cho cả Desktop & Mobile

## 🚀 Cài Đặt & Chạy Cục Bộ

```bash
# Cài đặt thư viện
npm install

# Chạy server phát triển
npm run dev

# Đóng gói sản phẩm
npm run build
```

## 🌐 Triển Khai GitHub Pages

Dự án đã được cấu hình sẵn GitHub Actions tự động build và deploy lên GitHub Pages mỗi khi push code lên nhánh `main`.

---
*Phát triển bởi [nguyenxuanhoa493](https://github.com/nguyenxuanhoa493)*
