const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto'); // Cần import crypto cho thuật toán V9

const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;

let currentData = {
  "phien_truoc": null,
  "ket_qua": "",
  "Dice": [],
  "phien_hien_tai": null,
  "du_doan": "?", // Thay đổi để phản ánh dự đoán thực tế
  "do_tin_cay": 0, // Thay đổi để phản ánh độ tin cậy thực tế
  "cau": "", // Thay đổi để phản ánh phân tích cầu/xu hướng
  "ngay": "",
  "Id": "@nhutquangdz" // Giữ nguyên ID của bạn
};

let id_phien_chua_co_kq = null;
// Lịch sử kết quả đầy đủ cho thuật toán dự đoán
// Mỗi phần tử là { result: 'T'/'X', total: number, sid: string, dice: [d1, d2, d3] }
let fullHistory = [];

// Helper function: Xác định Tài hay Xỉu từ tổng điểm
function getTaiXiu(total) {
  return total > 10 ? "Tài" : "Xỉu";
}

---

## BỘ THUẬT TOÁN DỰ ĐOÁN MỚI V2.2

```javascript
// ===== CÁC THUẬT TOÁN CON (Cập nhật và thêm mới) =====

// V1: Cầu sandwich hoặc 1-1 mặc định
function du_doan_v1(totals_list) {
  if (totals_list.length < 4) return ["Chờ", 50, "Đợi thêm dữ liệu"];
  const last_result = getTaiXiu(totals_list.at(-1));
  const last_3_totals = totals_list.slice(-3);
  const last_3_kq = last_3_totals.map(getTaiXiu);

  if (last_3_kq[0] === last_3_kq[2] && last_3_kq[0] !== last_3_kq[1]) {
    return [last_result === "Tài" ? "Xỉu" : "Tài", 83, `Cầu sandwich ${last_3_kq.join('-')}`];
  }
  return [last_result === "Tài" ? "Xỉu" : "Tài", 71, "Cầu 1-1 mặc định"];
}

// V2: Cầu đặc biệt 4 nhịp hoặc sandwich
function du_doan_v2(totals_list) {
  if (totals_list.length < 4) return ["Chờ", 50, "Chưa đủ dữ liệu"];
  const last_result = getTaiXiu(totals_list.at(-1));
  const last_4_totals = totals_list.slice(-4);
  const last_4_kq = last_4_totals.map(getTaiXiu);

  if (last_4_kq[0] === last_4_kq[2] && last_4_kq[0] === last_4_kq[3] && last_4_kq[0] !== last_4_kq[1]) {
    return ["Tài", 85, `Cầu đặc biệt ${last_4_kq.join('-')}`]; // Có thể tinh chỉnh dự đoán tùy vào quy luật
  }
  return du_doan_v1(totals_list); // Fallback về V1 nếu không có cầu đặc biệt
}

// V3: Chuỗi dài
function du_doan_v3(totals_list) {
  if (totals_list.length < 4) return ["Chờ", 50, "Không đủ dữ liệu"];
  const last_result = getTaiXiu(totals_list.at(-1));
  const types_list = totals_list.map(t => getTaiXiu(t));
  let chain = 1;
  for (let i = types_list.length - 1; i > 0; i--) {
    if (types_list[i] === types_list[i - 1]) chain++;
    else break;
  }
  if (chain >= 4) {
    return [last_result === "Tài" ? "Xỉu" : "Tài", 78, `Chuỗi ${chain} ${types_list.at(-1)}`];
  }
  return ["Chờ", 50, "Không có quy tắc chuỗi nổi bật"];
}

// V4: 3 Tài/Xỉu liên tiếp hoặc tổng cao/thấp
function du_doan_v4(kq_list, tong_list) {
  if (kq_list.length < 3) return ["Chờ", 50, "Không đủ dữ liệu"];
  const last_3_kq = kq_list.slice(-3).join(',');
  const last_tong = tong_list.at(-1);

  if (last_3_kq === 'Tài,Tài,Tài') return ["Xỉu", 75, "3 Tài liên tiếp"];
  if (last_3_kq === 'Xỉu,Xỉu,Xỉu') return ["Tài", 75, "3 Xỉu liên tiếp"];
  if (last_tong >= 15) return ["Xỉu", 65, "Tổng cao (>=15)"];
  if (last_tong <= 6) return ["Tài", 65, "Tổng thấp (<=6)"]; // Thêm điều kiện tổng thấp
  return ["Chờ", 50, "Không áp dụng"];
}

// V5: Cầu bệt dài (chuỗi 5+ liên tiếp)
function du_doan_v5_day_cau_dai(kq_list) {
  if (kq_list.length < 5) return ["Chờ", 50, "Không đủ dữ liệu"];
  const last_5_kq = kq_list.slice(-5);
  const first_in_5 = last_5_kq[0];
  const is_all_same = last_5_kq.every(res => res === first_in_5);

  if (is_all_same) {
    return [first_in_5 === "Tài" ? "Xỉu" : "Tài", 88, `Cầu bệt ${first_in_5} dài ${last_5_kq.length}`];
  }
  return ["Chờ", 50, "Không phải cầu bệt dài"];
}

// V6: Cầu xen kẽ (1-1-1-1)
function du_doan_v6_cau_xen_ke(kq_list) {
  if (kq_list.length < 4) return ["Chờ", 50, "Không đủ dữ liệu"];
  const last_4_kq = kq_list.slice(-4);
  const is_alternating =
    last_4_kq[0] !== last_4_kq[1] &&
    last_4_kq[1] !== last_4_kq[2] &&
    last_4_kq[2] !== last_4_kq[3];

  if (is_alternating) {
    return [last_4_kq.at(-1) === "Tài" ? "Xỉu" : "Tài", 80, `Cầu xen kẽ ${last_4_kq.join('-')}`];
  }
  return ["Chờ", 50, "Không phải cầu xen kẽ"];
}

// V7: Dựa trên vị trí xúc xắc
function du_doan_v7(dice_list) {
  if (!dice_list || dice_list.length === 0) return ["Chờ", 50, "Không có dữ liệu xúc xắc"];
  const last_dice_set = dice_list.at(-1);
  if (!last_dice_set || last_dice_set.length !== 3) return ["Chờ", 50, "Dữ liệu xúc xắc không hợp lệ"];

  const [d1, d2, d3] = last_dice_set;
  const total = d1 + d2 + d3;
  // Simple logic: If sum of two dices is even, predict one way, odd the other
  const sum_d1_d2_even = ((d1 + d2) % 2 === 0);
  let prediction_result = sum_d1_d2_even ? "Tài" : "Xỉu";
  let confidence = 60;

  // Add more complex logic: e.g., if d3 is high/low
  if (d3 >= 4) {
    prediction_result = "Tài";
    confidence += 5;
  } else if (d3 <= 3) {
    prediction_result = "Xỉu";
    confidence += 5;
  }

  return [prediction_result, Math.min(confidence, 80), `Dự đoán từ xúc xắc: ${d1},${d2},${d3}`];
}

// V8: Dựa vào chuỗi 3 kết quả giống nhau liên tiếp (chỉ áp dụng trong khung giờ nhất định)
function du_doan_v8(ds_tong) {
  const now = new Date();
  // Giả sử múi giờ server là GMT+7
  const currentHour = now.getHours();

  if (currentHour >= 0 && currentHour < 5) {
    return ["Chờ", 0, "Không áp dụng công thức vào 0h-5h sáng (ít người chơi)"];
  }
  if (ds_tong.length < 3) return ["Chờ", 0, "Không đủ dữ liệu"];

  const kq1 = getTaiXiu(ds_tong.at(-1));
  const kq2 = getTaiXiu(ds_tong.at(-2));
  const kq3 = getTaiXiu(ds_tong.at(-3));

  if (kq1 === kq2 && kq2 === kq3) {
    // Nếu 3 kết quả gần nhất giống nhau, dự đoán bẻ cầu
    return [kq1 === "Tài" ? "Xỉu" : "Tài", 70, `3 lần ${kq1} liên tiếp, bẻ cầu`];
  }
  return ["Chờ", 50, "Không theo quy tắc 3 giống nhau"];
}

// V9: Thuật toán mã hóa phiên (tương tự du_doan_phan_tram nhưng độc lập hơn)
function du_doan_v9_ma_hoa_phien(ma_phien) {
  if (!ma_phien) return ["Chờ", 50, "Không có mã phiên"];
  try {
    const hash = crypto.createHash('sha256').update(ma_phien.toString()).digest('hex');
    const numericValue = parseInt(hash.slice(0, 8), 16); // Lấy 8 ký tự đầu để tránh số quá lớn
    const prediction_val = numericValue % 100; // Giá trị từ 0-99
    const prediction = prediction_val >= 50 ? "Tài" : "Xỉu";
    // Độ tin cậy dựa trên độ lệch khỏi 50: càng xa 50 càng tự tin
    const confidence = 50 + Math.abs(prediction_val - 50) * 0.8; // Max 50 + 49*0.8 = 89.2
    return [prediction, confidence, `Dự đoán từ mã hóa phiên ${ma_phien}`];
  } catch (e) {
    console.error("Lỗi thuật toán mã hóa phiên:", e);
    return ["Chờ", 50, "Lỗi mã hóa phiên"];
  }
}

// V10: Thuật toán dựa trên hệ số gần đây
function du_doan_v10_he_so_gan_day(kq_list) {
  if (kq_list.length < 5) return ["Chờ", 50, "Không đủ dữ liệu"];

  let tai_score = 0;
  let xiu_score = 0;

  // Gán trọng số giảm dần cho các kết quả cũ hơn
  for (let i = 0; i < kq_list.length; i++) {
    const weight = (i + 1) / kq_list.length; // Trọng số tăng từ cũ đến mới
    if (kq_list[i] === "Tài") {
      tai_score += weight;
    } else {
      xiu_score += weight;
    }
  }

  let prediction;
  let confidence;
  if (tai_score > xiu_score) {
    prediction = "Tài";
    confidence = (tai_score / (tai_score + xiu_score)) * 100;
  } else if (xiu_score > tai_score) {
    prediction = "Xỉu";
    confidence = (xiu_score / (tai_score + xiu_score)) * 100;
  } else {
    prediction = kq_list.at(-1) === "Tài" ? "Xỉu" : "Tài"; // Bẻ cầu nếu hòa
    confidence = 55;
  }
  return [prediction, confidence, "Dựa trên hệ số gần đây"];
}

// V11: Thuật toán tìm chuỗi số trong tổng điểm
function du_doan_v11_chuoi_so(totals_list) {
  if (totals_list.length < 4) return ["Chờ", 50, "Không đủ dữ liệu"];

  const last_4_totals = totals_list.slice(-4);
  const [t1, t2, t3, t4] = last_4_totals;

  // Ví dụ: Chuỗi tổng điểm tăng/giảm đều
  if (t2 - t1 === t3 - t2 && t3 - t2 === t4 - t3 && Math.abs(t2 - t1) > 0) {
    const next_total_guess = t4 + (t4 - t3);
    const prediction = getTaiXiu(next_total_guess);
    return [prediction, 70, `Chuỗi số tăng/giảm đều: ${last_4_totals.join('-')} -> ${next_total_guess}`];
  }
  // Ví dụ: Tổng 2 số gần nhất lặp lại
  if (totals_list.length >= 2 && totals_list.at(-1) === totals_list.at(-2)) {
    return [getTaiXiu(totals_list.at(-1)) === "Tài" ? "Xỉu" : "Tài", 60, "Tổng điểm lặp lại"];
  }

  return ["Chờ", 50, "Không có chuỗi số đặc biệt"];
}


/**
 * Hàm dự đoán chính, tổng hợp từ nhiều thuật toán con.
 * @param {Array} history - Mảng lịch sử kết quả, mỗi phần tử là { result: 'T'/'X', total: number, sid: string, dice: [d1, d2, d3] }
 * Lưu ý: Mảng lịch sử phải được sắp xếp từ CŨ NHẤT đến MỚI NHẤT.
 * Hàm sẽ tự động đảo ngược để các thuật toán con xử lý dữ liệu mới nhất ở cuối.
 * @returns {Array} - [dự đoán cuối cùng (string: "Tài" hoặc "Xỉu"), độ tin cậy (number), % tài (number), % xỉu (number), phân tích cầu (string)]
 */
function predictNext(history) {
  // 1. Tính toán thống kê cơ bản
  // Sử dụng history trực tiếp vì các hàm con đã được điều chỉnh để đọc từ cuối mảng (mới nhất)
  const counts = history.reduce((acc, val) => {
    const result_text = val.result === 'T' ? 'Tài' : 'Xỉu';
    acc[result_text] = (acc[result_text] || 0) + 1;
    return acc;
  }, { "Tài": 0, "Xỉu": 0 });
  const totalGames = history.length || 1;
  const percentTai = (counts["Tài"] / totalGames) * 100;
  const percentXiu = (counts["Xiu"] / totalGames) * 100;

  // 2. Luôn đưa ra dự đoán ngay cả khi lịch sử ngắn
  if (history.length < 5) {
    if (history.length === 0) {
      return ["Tài", 40, percentTai, percentXiu, "Lịch sử ngắn, dự đoán mặc định"];
    }
    const lastResultText = history.at(-1).result === 'T' ? 'Tài' : 'Xỉu';
    const prediction = lastResultText === "Tài" ? "Xỉu" : "Tài"; // Bẻ cầu nếu lịch sử ít
    const confidence = 40 + history.length * 3; // Tăng nhẹ độ tin cậy theo số lượng
    return [prediction, confidence, percentTai, percentXiu, "Lịch sử ngắn, bẻ cầu"];
  }

  // 3. Chuẩn bị dữ liệu đầu vào cho các thuật toán
  const totals_list = history.map(h => h.total);
  const kq_list = history.map(h => h.result === 'T' ? 'Tài' : 'Xỉu');
  const dice_list = history.map(h => h.dice).filter(Boolean);
  const ma_phien = history.at(-1).sid; // Lấy sid của phiên gần nhất

  // 4. Chạy tất cả các thuật toán và thu thập dự đoán cùng độ tin cậy
  const algorithm_results = []; // Mảng chứa { prediction: "Tài"/"Xỉu", confidence: number, source: string }

  const addPrediction = (algo_func, ...args) => {
    const [pred, conf, msg] = algo_func(...args);
    if (pred !== "Chờ" && conf > 0) {
      algorithm_results.push({ prediction: pred, confidence: conf, source: msg });
    }
  };

  addPrediction(du_doan_v1, totals_list);
  addPrediction(du_doan_v2, totals_list);
  addPrediction(du_doan_v3, totals_list);
  addPrediction(du_doan_v4, kq_list, totals_list);
  addPrediction(du_doan_v5_day_cau_dai, kq_list);
  addPrediction(du_doan_v6_cau_xen_ke, kq_list);
  addPrediction(du_doan_v7, dice_list);
  addPrediction(du_doan_v8, totals_list);
  addPrediction(du_doan_v9_ma_hoa_phien, ma_phien);
  addPrediction(du_doan_v10_he_so_gan_day, kq_list);
  addPrediction(du_doan_v11_chuoi_so, totals_list);

  // 5. Tổng hợp kết quả từ các thuật toán
  if (algorithm_results.length === 0) {
    // Nếu không có thuật toán nào đưa ra dự đoán hợp lệ
    const lastResultText = kq_list.at(-1) || "Tài"; // Mặc định nếu chưa có kết quả nào
    return [lastResultText === "Tài" ? "Xỉu" : "Tài", 50, percentTai, percentXiu, "Không có quy tắc nổi bật"];
  }

  let total_tai_score = 0;
  let total_xiu_score = 0;
  let total_confidence_sum = 0;
  let dominant_source = "Tổng hợp"; // Để lưu nguồn dự đoán có độ tin cậy cao nhất

  algorithm_results.forEach(res => {
    const weighted_confidence = res.confidence; // Có thể thêm trọng số cho từng thuật toán ở đây

    if (res.prediction === "Tài") {
      total_tai_score += weighted_confidence;
    } else {
      total_xiu_score += weighted_confidence;
    }
    total_confidence_sum += weighted_confidence;
  });

  let final_prediction;
  let final_confidence;

  if (total_tai_score > total_xiu_score) {
    final_prediction = "Tài";
    final_confidence = (total_tai_score / total_confidence_sum) * 100;
  } else if (total_xiu_score > total_tai_score) {
    final_prediction = "Xỉu";
    final_confidence = (total_xiu_score / total_confidence_sum) * 100;
  } else {
    // Nếu điểm bằng nhau, dự đoán theo kết quả gần nhất nhưng bẻ cầu
    final_prediction = kq_list.at(-1) === "Tài" ? "Xỉu" : "Tài";
    final_confidence = 55; // Độ tin cậy trung bình
  }

  // Lấy nguồn dự đoán có độ tin cậy cao nhất (hoặc đơn giản là nguồn của dự đoán cuối cùng nếu có)
  const best_algo = algorithm_results.sort((a, b) => b.confidence - a.confidence)[0];
  if (best_algo && best_algo.confidence >= final_confidence - 5) { // Chỉ lấy nếu độ tin cậy gần bằng
    dominant_source = best_algo.source;
  }

  // Đảm bảo độ tin cậy nằm trong khoảng hợp lý
  final_confidence = Math.max(50, Math.min(99, final_confidence));

  return [final_prediction, final_confidence, percentTai, percentXiu, dominant_source];
}

