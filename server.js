Const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;

// === Biến lưu trạng thái ===
let currentData = {
  id: "nhutquangdz",
  id_phien: null,
  ket_qua: "",
  pattern: "",
  du_doan: "?",
  confidence: 0,
  percentTai: 0,
  percentXiu: 0
};
let id_phien_chua_co_kq = null;
let patternHistory = []; // Lưu dãy T/X gần nhất
let fullHistory = []; // Lưu đầy đủ lịch sử để phục vụ predictNext

// === Danh sách tin nhắn gửi lên server WebSocket ===
const messagesToSend = [
  [1, "MiniGame", "SC_apisunwin123", "binhlamtool90", {
    "info": "{\"ipAddress\":\"2a09:bac1:7aa0:10::2e5:4d\",\"userId\":\"d93d3d84-f069-4b3f-8dac-b4714a812143\",\"username\":\"SC_apisunwin123\",\"timestamp\":1752045925640,\"refreshToken\":\"dd38d05401bb48b4ac3c2f6dc37f36d9.f22dccad89bb4e039814b7de64b05d63\"}",
    "signature": "6FAD7CF6196AFBF0380BC69B59B653A05153D3D0E4E9A07BA43890CC3FB665B92C2E09E5B34B31FD8D74BDCB3B03A29255C5A5C7DFB426A8D391836CF9DCB7E5CEA743FE07521075DED70EFEC7F78C8993BDBF8626D58D3E68D36832CA4823F516B7E41DB353EA79290367D34DF98381089E69EA7C67FB3588B39C9C4D7174B2"
  }],
  [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
  [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

/**
 * =================================================================
 * BỘ THUẬT TOÁN DỰ ĐOÁN MỚI V2.2 (CHUYỂN THỂ TỪ PYTHON & TỐI ƯU)
 * Tác giả: VanwNhat & Rinkivana & Gemini
 * Phiên bản: V2.2 - Thêm nhiều thuật toán, tối ưu predictNext
 * =================================================================
 */

// Helper function: Xác định Tài hay Xỉu từ tổng điểm
function getTaiXiu(total) {
  return total > 10 ? "Tài" : "Xỉu";
}

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
  const [d1, d2, d3] = dice_list.at(-1);
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
 * @returns {Array} - [dự đoán cuối cùng (string: "Tài" hoặc "Xỉu"), độ tin cậy (number), % tài (number), % xỉu (number)]
 */
function predictNext(history) {
  // Tạo bản sao và đảo ngược lịch sử để các thuật toán con xử lý dữ liệu mới nhất ở cuối
  // Các thuật toán con sẽ nhận mảng đã đảo ngược, tức là phần tử cuối cùng là mới nhất
  const processed_history = [...history].reverse();

  // 1. Tính toán thống kê cơ bản
  const counts = processed_history.reduce((acc, val) => {
    const result_text = val.result === 'T' ? 'Tài' : 'Xỉu';
    acc[result_text] = (acc[result_text] || 0) + 1;
    return acc;
  }, { "Tài": 0, "Xỉu": 0 });
  const totalGames = processed_history.length || 1;
  const percentTai = (counts["Tài"] / totalGames) * 100;
  const percentXiu = (counts["Xỉu"] / totalGames) * 100;

  // 2. Luôn đưa ra dự đoán ngay cả khi lịch sử ngắn
  if (processed_history.length < 5) {
    if (processed_history.length === 0) {
      return ["Tài", 40, percentTai, percentXiu]; // Mặc định Tài nếu không có lịch sử
    }
    const lastResultText = processed_history[0].result === 'T' ? 'Tài' : 'Xỉu';
    const prediction = lastResultText === "Tài" ? "Xỉu" : "Tài"; // Bẻ cầu nếu lịch sử ít
    const confidence = 40 + processed_history.length * 3; // Tăng nhẹ độ tin cậy theo số lượng
    return [prediction, confidence, percentTai, percentXiu];
  }

  // 3. Chuẩn bị dữ liệu đầu vào cho các thuật toán
  // Lưu ý: Các hàm thuật toán con mong đợi dữ liệu mới nhất ở CUỐI MẢNG.
  // Vì processed_history đã đảo ngược (mới nhất ở index 0), ta cần đảo ngược lại một lần nữa
  // HOẶC điều chỉnh logic của hàm con để xử lý mảng đã đảo ngược.
  // Hiện tại, các hàm con được viết để nhận mảng mới nhất ở cuối, nên ta sẽ truyền mảng gốc `history`
  // hoặc tạo bản sao để tránh làm thay đổi `history`.
  const totals_list = history.map(h => h.total);
  const kq_list = history.map(h => h.result === 'T' ? 'Tài' : 'Xỉu');
  const dice_list = history.map(h => h.dice).filter(Boolean);
  const ma_phien = history.at(-1).sid; // Lấy sid của phiên gần nhất

  // 4. Chạy tất cả các thuật toán và thu thập dự đoán cùng độ tin cậy
  const algorithm_results = []; // Mảng chứa { prediction: "Tài"/"Xỉu", confidence: number }

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
    return [lastResultText === "Tài" ? "Xỉu" : "Tài", 50, percentTai, percentXiu];
  }

  let total_tai_score = 0;
  let total_xiu_score = 0;
  let total_confidence_sum = 0;

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

  // Đảm bảo độ tin cậy nằm trong khoảng hợp lý
  final_confidence = Math.max(50, Math.min(99, final_confidence));

  return [final_prediction, final_confidence, percentTai, percentXiu];
}


// === WebSocket ===
let ws = null;
let pingInterval = null;
let reconnectTimeout = null;
let isManuallyClosed = false;

function connectWebSocket() {
  ws = new WebSocket("wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Origin": "https://play.sun.win"
    }
  });

  ws.on('open', () => {
    console.log('[✅] WebSocket kết nối');
    messagesToSend.forEach((msg, i) => {
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      }, i * 600);
    });

    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 15000);
  });

  ws.on('pong', () => {
    console.log('[📶] Ping OK');
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (Array.isArray(data) && typeof data[1] === 'object') {
        const cmd = data[1].cmd;

        if (cmd === 1008 && data[1].sid) {
          id_phien_chua_co_kq = data[1].sid;
        }

        if (cmd === 1003 && data[1].gBB) {
          const { d1, d2, d3 } = data[1];
          const total = d1 + d2 + d3;
          const result = total > 10 ? "T" : "X"; // Tài / Xỉu

          // Lưu pattern và lịch sử đầy đủ
          patternHistory.push(result);
          if (patternHistory.length > 20) patternHistory.shift();

          fullHistory.push({
            result: result,
            total: total,
            sid: id_phien_chua_co_kq,
            dice: [d1, d2, d3]
          });
          if (fullHistory.length > 50) fullHistory.shift(); // Giới hạn lịch sử để tránh quá tải bộ nhớ

          const text = `${d1}-${d2}-${d3} = ${total} (${result === 'T' ? 'Tài' : 'Xỉu'})`;

          // Dự đoán bằng thuật toán mới
          const [du_doan, confidence, percentTai, percentXiu] = predictNext(fullHistory);

          currentData = {
            id: "nhutquangdz",
            id_phien: id_phien_chua_co_kq,
            ket_qua: text,
            pattern: patternHistory.join(''),
            du_doan: du_doan,
            confidence: confidence,
            percentTai: parseFloat(percentTai.toFixed(2)),
            percentXiu: parseFloat(percentXiu.toFixed(2))
          };

          console.log(`Phiên ${id_phien_chua_co_kq}: ${text} → Dự đoán tiếp: ${currentData.du_doan} (${currentData.confidence.toFixed(2)}%)`);
          id_phien_chua_co_kq = null;
        }
      }
    } catch (e) {
      console.error('[Lỗi]:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[🔌] WebSocket ngắt. Đang kết nối lại...');
    clearInterval(pingInterval);
    if (!isManuallyClosed) {
      reconnectTimeout = setTimeout(connectWebSocket, 2500);
    }
  });

  ws.on('error', (err) => {
    console.error('[❌] WebSocket lỗi:', err.message);
  });
}

// === API ===
app.get('/taixiu', (req, res) => {
  res.json(currentData);
});

app.get('/', (req, res) => {
  res.send(`<h2>🎯 Kết quả Sunwin Tài Xỉu</h2><p><a href="/taixiu">Xem kết quả JSON</a></p>`);
});

// === Khởi động server ===
app.listen(PORT, () => {
  console.log(`[🌐] Server chạy tại http://localhost:${PORT}`);
  connectWebSocket();
});
