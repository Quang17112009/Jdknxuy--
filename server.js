const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto'); // Thêm dòng này để import crypto

const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;

// === Biến lưu trạng thái ===
let currentData = {
  id: "binhtool90",
  id_phien: null,
  ket_qua: "",
  pattern: "",
  du_doan: "?",
  do_tin_cay: 0,
  phan_tram_tai: 0,
  phan_tram_xiu: 0
};
let id_phien_chua_co_kq = null;
// Thay đổi patternHistory thành historyResults để lưu trữ đầy đủ dữ liệu
let historyResults = []; // Lưu dãy T/X gần nhất cùng tổng và dice

// === Danh sách tin nhắn gửi lên server WebSocket ===
const messagesToSend = [
  [1, "MiniGame", "SC_apisunwin123", "binhlamtool90", {
    "info": "{\"ipAddress\":\"2a09:bac1:7aa0:10::2e5:4d\",\"userId\":\"d93d3d84-f069-4b3f-8dac-b4716a812143\",\"username\":\"SC_apisunwin123\",\"timestamp\":1752045925640,\"refreshToken\":\"dd38d05401bb48b4ac3c2f6dc37f36d9.f22dccad89bb4e039814b7de64b05d63\"}",
    "signature": "6FAD7CF6196AFBF0380BC69B59B653A05153D3D0E4E9A07BA43890CC3FB665B92C2E09E5B34B31FD8D74BDCB3B03A29255C5A5C7DFB426A8D391836CF9DCB7E5CEA743FE07521075DED70EFEC7F78C8993BDBF8626D58D3E68D36832CA4823F516B7E41DB353EA79290367D34DF98381089E69EA7C67FB3588B39C9C4D7174B2"
  }],
  [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
  [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

// Helper function: Xác định Tài hay Xỉu từ tổng điểm
function getTaiXiu(total) {
  return total > 10 ? "Tài" : "Xỉu";
}

// ===== CÁC THUẬT TOÁN CON =====
function du_doan_v1(totals_list) {
  if (totals_list.length < 4) return ["Chờ", "Đợi thêm dữ liệu"];
  const last_result = getTaiXiu(totals_list.at(-1));
  const last_3 = totals_list.slice(-3);
  if (last_3[0] === last_3[2] && last_3[0] !== last_3[1]) {
    return [last_result === "Tài" ? "Xỉu" : "Tài", `Cầu sandwich ${last_3.join('-')}`];
  }
  return [last_result === "Tài" ? "Xỉu" : "Tài", "Cầu 1-1 mặc định"];
}

function du_doan_v2(totals_list) {
  if (totals_list.length < 4) return ["Chờ", 0, "Chưa đủ dữ liệu"];
  const last_result = getTaiXiu(totals_list.at(-1));
  const last_3 = totals_list.slice(-3);
  const last_4 = totals_list.slice(-4);
  if (last_4[0] === last_4[2] && last_4[0] === last_4[3] && last_4[0] !== last_4[1]) {
    return ["Tài", 85, `Cầu đặc biệt ${last_4.join('-')}`];
  }
  if (last_3[0] === last_3[2] && last_3[0] !== last_3[1]) {
    return [last_result === "Tài" ? "Xỉu" : "Tài", 83, `Cầu sandwich ${last_3.join('-')}`];
  }
  return [last_result === "Tài" ? "Xỉu" : "Tài", 71, "Không có cầu đặc biệt, bẻ cầu 1-1"];
}

function du_doan_v3(totals_list) {
  if (totals_list.length < 4) return ["Chờ", 0, "Không đủ dữ liệu"];
  const last_result = getTaiXiu(totals_list.at(-1));
  const types_list = totals_list.map(t => getTaiXiu(t));
  let chain = 1;
  for (let i = types_list.length - 1; i > 0; i--) {
    if (types_list[i] === types_list[i-1]) chain++;
    else break;
  }
  if (chain >= 4) {
    return [last_result === "Tài" ? "Xỉu" : "Tài", 78, `Chuỗi ${chain} ${types_list.at(-1)}`];
  }
  return [last_result === "Tài" ? "Xỉu" : "Tài", 70, "Không có quy tắc nổi bật"];
}

function du_doan_v4(kq_list, tong_list) {
  if (kq_list.length < 3) return ["Chờ", 50];
  const last_3_kq = kq_list.slice(-3);
  const last_tong = tong_list.at(-1);
  if (last_3_kq.join(',') === 'Tài,Tài,Tài') return ["Xỉu", 70];
  if (last_3_kq.join(',') === 'Xỉu,Xỉu,Xỉu') return ["Tài", 70];
  if (last_tong >= 15) return ["Xỉu", 60];
  if (last_tong <= 9) return ["Tài", 60];
  return [kq_list.at(-1), 50];
}

function du_doan_phan_tram(ma_phien) {
  if (!ma_phien) return ["Tài", 50];
  const algo1 = parseInt(crypto.createHash('sha256').update(ma_phien.toString()).digest('hex'), 16) % 100;
  const algo2 = [...ma_phien.toString()].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 100;
  const algo3 = parseInt(crypto.createHash('sha1').update(ma_phien.toString()).digest('hex').slice(-2), 16) % 100;
  const confidence = (algo1 + algo2 + algo3) / 3;
  return [confidence >= 50 ? "Tài" : "Xỉu", confidence];
}

function du_doan_v7(dice_list) {
    if (!dice_list || dice_list.length === 0) return ["Chờ", 50];
    const [d1, d2, d3] = dice_list.at(-1);
    const total = d1 + d2 + d3;
    const results = [d1, d2, d3].map(d => ((d + total) % 6) % 2 === 0 ? "Tài" : "Xỉu");
    const tai_count = results.filter(r => r === "Tài").length;
    const prediction = tai_count >= 2 ? "Tài" : "Xỉu";
    const confidence = (tai_count / 3) * 100;
    return [prediction, confidence];
}

function du_doan_v8(ds_tong) {
  let do_tin_cay = 0;
  const now = new Date();
  if (now.getHours() >= 0 && now.getHours() < 5) {
      return ["Chờ", 0, "Không áp dụng công thức vào 0h-5h sáng"];
  }
  if (ds_tong.length < 3) return ["Chờ", 0, "Không đủ dữ liệu"];
  if (ds_tong.at(-1) > 10 && ds_tong.at(-2) > 10 && ds_tong.at(-3) > 10) do_tin_cay += 15;
  if (ds_tong.at(-1) <= 10 && ds_tong.at(-2) <= 10 && ds_tong.at(-3) <= 10) do_tin_cay += 15;
  const du_doan = ds_tong.at(-1) > 10 ? "Xỉu" : "Tài";
  return [du_doan, Math.min(do_tin_cay, 100)];
}

/**
 * Hàm dự đoán chính, tổng hợp từ nhiều thuật toán con.
 * @param {Array} history - Mảng lịch sử kết quả, mỗi phần tử là { result, total, sid, dice }
 * @returns {Array} - [dự đoán cuối cùng, độ tin cậy, % tài, % xỉu]
 */
function predictNext(history) {
  // 1. Tính toán thống kê cơ bản
  const counts = history.reduce((acc, val) => {
    acc[val.result] = (acc[val.result] || 0) + 1;
    return acc;
  }, { "Tài": 0, "Xỉu": 0 });
  const totalGames = history.length || 1;
  const percentTai = (counts["Tài"] / totalGames) * 100;
  const percentXiu = (counts["Xỉu"] / totalGames) * 100;

  // 2. Luôn đưa ra dự đoán ngay cả khi lịch sử ngắn
  if (history.length < 5) {
    if (history.length === 0) {
      return ["Tài", 40, 0, 0];
    }
    // Chuyển đổi 'T'/'X' sang 'Tài'/'Xỉu' để phù hợp với hàm getTaiXiu
    const lastResultText = history[0].result === 'T' ? 'Tài' : 'Xỉu';
    const prediction = lastResultText === "Tài" ? "Xỉu" : "Tài";
    const confidence = 40 + history.length * 5; 
    return [prediction, confidence, percentTai, percentXiu];
  }

  // 3. Chuẩn bị dữ liệu đầu vào cho các thuật toán
  // Đảm bảo dữ liệu mới nhất ở cuối mảng cho các thuật toán con (dùng .reverse() khi lấy dữ liệu)
  const totals_list = history.map(h => h.total);
  const kq_list = history.map(h => h.result === 'T' ? 'Tài' : 'Xỉu'); // Chuyển đổi 'T'/'X' sang 'Tài'/'Xỉu'
  const dice_list = history.map(h => h.dice).filter(Boolean);
  const ma_phien = history.at(-1).sid; // Lấy sid của phiên gần nhất

  // 4. Chạy tất cả các thuật toán
  const predictions = [];
  predictions.push(du_doan_v1(totals_list)[0]);
  predictions.push(du_doan_v2(totals_list)[0]);
  predictions.push(du_doan_v3(totals_list)[0]);
  predictions.push(du_doan_v4(kq_list, totals_list)[0]);
  predictions.push(du_doan_phan_tram(ma_phien)[0]);
  if(dice_list.length > 0) predictions.push(du_doan_v7(dice_list)[0]);
  predictions.push(du_doan_v8(totals_list)[0]);
  
  const valid_predictions = predictions.filter(p => p === "Tài" || p === "Xỉu");

  // 5. Tổng hợp kết quả
  const tai_count = valid_predictions.filter(p => p === "Tài").length;
  const xiu_count = valid_predictions.filter(p => p === "Xỉu").length;

  let final_prediction;
  let confidence;

  if (tai_count > xiu_count) {
    final_prediction = "Tài";
    confidence = (tai_count / valid_predictions.length) * 100;
  } else if (xiu_count > tai_count) {
    final_prediction = "Xỉu";
    confidence = (xiu_count / valid_predictions.length) * 100;
  } else {
    // Nếu số lượng Tài và Xỉu bằng nhau, dự đoán ngược lại với kết quả gần nhất
    final_prediction = kq_list.at(-1) === "Tài" ? "Xỉu" : "Tài";
    confidence = 55;
  }

  confidence = Math.max(55, Math.min(98, confidence));

  return [final_prediction, confidence, percentTai, percentXiu];
}


// === WebSocket ===
let ws = null;
let pingInterval = null;
let reconnectTimeout = null;
let isManuallyClosed = false;

// Hàm duDoanTiepTheo cũ đã bị xoá
// function duDoanTiepTheo(pattern) { ... } // Đã loại bỏ

function connectWebSocket() {
  ws = new WebSocket("wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu3rRu", {
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
          const result_char = total > 10 ? "T" : "X"; // 'T' cho Tài, 'X' cho Xỉu

          // Cập nhật lịch sử kết quả đầy đủ
          if (id_phien_chua_co_kq) { // Chỉ thêm vào lịch sử nếu có sid của phiên
            historyResults.push({
              sid: id_phien_chua_co_kq,
              result: result_char, // 'T' hoặc 'X'
              total: total,
              dice: [d1, d2, d3]
            });
          }
          
          // Giới hạn lịch sử để tránh quá lớn
          if (historyResults.length > 50) historyResults.shift();

          const text_kq = `${d1}-${d2}-${d3} = ${total} (${result_char === 'T' ? 'Tài' : 'Xỉu'})`;

          // Gọi thuật toán dự đoán chính
          // historyResults cần được đảo ngược để các thuật toán con nhận dữ liệu mới nhất ở cuối
          const [du_doan_final, do_tin_cay_final, phan_tram_tai_final, phan_tram_xiu_final] = predictNext([...historyResults].reverse());

          currentData = {
            id: "binhtool90",
            id_phien: id_phien_chua_co_kq,
            ket_qua: text_kq,
            pattern: historyResults.map(h => h.result).join(''), // Dãy T/X đơn giản
            du_doan: du_doan_final,
            do_tin_cay: do_tin_cay_final,
            phan_tram_tai: phan_tram_tai_final,
            phan_tram_xiu: phan_tram_xiu_final
          };

          console.log(`Phiên ${id_phien_chua_co_kq}: ${text_kq} → Dự đoán tiếp: ${currentData.du_doan} (Độ tin cậy: ${currentData.do_tin_cay.toFixed(2)}%)`);
          id_phien_chua_co_kq = null; // Reset sid sau khi đã xử lý kết quả
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
