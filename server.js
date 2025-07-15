const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;

let currentData = {
  "phien_truoc": null,
  "ket_qua": "",
  "Dice": [],
  "phien_hien_tai": null,
  "du_doan": "",
  "do_tin_cay": "",
  "cau": "",
  "ngay": "",
  "Id": "ApiSunWin-by @nhutquangdz🪼"
};

let id_phien_chua_co_kq = null;
let history = []; // Sử dụng mảng đối tượng thay vì chuỗi

// ---

// === Biến lưu trạng thái cho thuật toán ===
// Lưu dãy T/X gần nhất (lên đến 200 phiên). Đây là lịch sử kết quả Tài/Xỉu.
let patternHistory = []; 
// Lưu lịch sử các mặt xúc xắc chi tiết (d1, d2, d3).
let diceHistory = []; 

// === Thuật toán dự đoán nâng cao (GIỮ NGUYÊN) ===
/**
 * Phân tích lịch sử kết quả Tài/Xỉu và đưa ra dự đoán cho phiên tiếp theo.
 * @param {Array<string>} history Mảng chứa lịch sử các kết quả 'T' (Tài) hoặc 'X' (Xỉu).
 * @returns {object} Đối tượng chứa thông tin phân tích, dự đoán cuối cùng và độ tin cậy.
 */
function analyzeAndPredict(history) {
  const analysis = {
    totalResults: history.length, // Tổng số kết quả trong lịch sử
    taiCount: history.filter(r => r === 'T').length, // Số lần Tài
    xiuCount: history.filter(r => r === 'X').length, // Số lần Xỉu
    last50Pattern: history.slice(-50).join(''), // Chuỗi 50 kết quả gần nhất
    last200Pattern: history.join(''), // Chuỗi 200 kết quả gần nhất (hoặc tất cả nếu ít hơn 200)
    predictionDetails: [] // Chi tiết về các phân tích dẫn đến dự đoán
  };

  let prediction = "?"; // Dự đoán mặc định là không xác định
  let confidence = 0; // Độ tin cậy của dự đoán, từ 0 đến 1

  // Chiến lược 1: Phân tích cầu lặp (trong 50 phiên gần nhất)
  const recentHistory = history.slice(-50);
  const patternsToCheck = [
    { name: "Cầu Bệt Tài", pattern: "TTTT", predict: "T" },
    { name: "Cầu Bệt Xỉu", pattern: "XXXX", predict: "X" },
    { name: "Cầu 1-1 (T)", pattern: "XTXTXTX", predict: "T" },
    { name: "Cầu 1-1 (X)", pattern: "TXTXTXT", predict: "X" },
    { name: "Cầu 2-1 (TX)", pattern: "TTXT", predict: "X" },
    { name: "Cầu 2-1 (XT)", pattern: "XXTX", predict: "T" },
    { name: "Cầu 2-2 (TX)", pattern: "TTXXTT", predict: "X" },
    { name: "Cầu 2-2 (XT)", pattern: "XXTTXX", predict: "T" },
  ];

  for (const p of patternsToCheck) {
    if (recentHistory.join('').endsWith(p.pattern)) {
      prediction = p.predict;
      confidence += 0.4;
      analysis.predictionDetails.push(`Phát hiện: ${p.name}, Dự đoán: ${p.predict}`);
      break;
    }
  }

  // Chiến lược 2: Phân tích xu hướng (trong 20 phiên gần nhất)
  const last20 = history.slice(-20);
  const taiIn20 = last20.filter(r => r === 'T').length;
  const xiuIn20 = last20.filter(r => r === 'X').length;

  if (taiIn20 > xiuIn20 + 5) {
    if (prediction === "T") confidence += 0.2;
    else if (prediction === "?") { prediction = "T"; confidence += 0.2; }
    analysis.predictionDetails.push(`Xu hướng 20 phiên: Nghiêng về Tài (${taiIn20} Tài / ${xiuIn20} Xỉu)`);
  } else if (xiuIn20 > taiIn20 + 5) {
    if (prediction === "X") confidence += 0.2;
    else if (prediction === "?") { prediction = "X"; confidence += 0.2; }
    analysis.predictionDetails.push(`Xu hướng 20 phiên: Nghiêng về Xỉu (${taiIn20} Tài / ${xiuIn20} Xỉu)`);
  } else if (prediction === "?") {
      analysis.predictionDetails.push(`Xu hướng 20 phiên: Khá cân bằng (${taiIn20} Tài / ${xiuIn20} Xỉu)`);
  }

  // Chiến lược 3: Dự đoán dựa trên các mặt xúc xắc và tổng điểm (Cần dữ liệu diceHistory)
  if (diceHistory.length > 0) {
    const lastResult = diceHistory[diceHistory.length -1];
    const total = lastResult.d1 + lastResult.d2 + lastResult.d3;
    analysis.predictionDetails.push(`Kết quả xúc xắc gần nhất: ${lastResult.d1}-${lastResult.d2}-${lastResult.d3} (Tổng: ${total})`);
  }

  // Nếu chưa có dự đoán rõ ràng từ các chiến lược trên, quay lại dự đoán dựa trên lặp lại đơn giản hơn.
  if (prediction === "?" && history.length >= 6) {
    const last3 = history.slice(-3).join('');
    const last4 = history.slice(-4).join('');

    const count3 = history.join('').split(last3).length - 1;
    if (count3 >= 2 && last3.length === 3) {
      prediction = last3[0];
      confidence += 0.1;
      analysis.predictionDetails.push(`Phát hiện lặp 3 cuối: ${last3}, Dự đoán: ${prediction}`);
    }

    const count4 = history.join('').split(last4).length - 1;
    if (count4 >= 2 && last4.length === 4) {
      prediction = last4[0];
      confidence += 0.1;
      analysis.predictionDetails.push(`Phát hiện lặp 4 cuối: ${last4}, Dự đoán: ${prediction}`);
    }
  }

  analysis.finalPrediction = prediction;
  analysis.confidence = Math.min(confidence, 1);

  return analysis;
}

// ---

// ================== KẾT NỐI VÀ XỬ LÝ DỮ LIỆU (KHÔI PHỤC VỀ TRẠNG THÁI GẦN BAN ĐẦU) =====================

const messagesToSend = [
  [1, "MiniGame", "SC_thataoduocko112233", "112233", {
    "info": "{\"ipAddress\":\"2402:800:62cd:ef90:a445:40de:a24a:765e\",\"userId\":\"1a46e9cd-135d-4f29-9cd5-0b61bd2fb2a9\",\"username\":\"SC_thataoduocko112233\",\"timestamp\":1752257356729,\"refreshToken\":\"fe70e712cf3c4737a4ae22cbb3700c8e.f413950acf984ed6b373906f83a4f796\"}",
    "signature": "16916AC7F4F163CD00B319824B5B90FFE11BC5E7D232D58E7594C47E271A5CDE0492BB1C3F3FF20171B3A344BEFEAA5C4E9D28800CF18880FEA6AC3770016F2841FA847063B80AF8C8A747A689546CE75E99A7B559612BC30FBA5FED9288B69013C099FD6349ABC2646D5ECC2D5B2A1C5A9817FE5587844B41C752D0A0F6F304"
  }],
  [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
  [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

function connectWebSocket() {
  const ws = new WebSocket("wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Origin": "https://play.sun.win"
    }
  });

  ws.on('open', () => {
    console.log('[LOG] WebSocket kết nối');
    messagesToSend.forEach((msg, i) => {
      // Giữ nguyên đoạn kiểm tra readyState để đảm bảo an toàn, không phải là "cải tiến" logic WebSocket
      if (ws.readyState === WebSocket.OPEN) { 
          ws.send(JSON.stringify(msg));
      }
    });

    // Bỏ setInterval cho ping/pong nếu bạn không muốn, nhưng nó giúp giữ kết nối sống.
    // Nếu bạn muốn loại bỏ hoàn toàn, hãy xóa đoạn dưới:
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) { // Giữ nguyên kiểm tra readyState
        ws.ping();
      }
    }, 15000); 
  });

  ws.on('pong', () => console.log('[LOG] Ping OK')); // Giữ lại log nếu bạn giữ ping/pong

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (Array.isArray(data) && typeof data[1] === 'object') {
        const cmd = data[1].cmd;

        if (cmd === 1008 && data[1].sid) {
          id_phien_chua_co_kq = data[1].sid;
          // Cập nhật phien_hien_tai ngay khi có ID phiên mới
          currentData.phien_hien_tai = id_phien_chua_co_kq + 1; 
        }

        if (cmd === 1003 && data[1].gBB) {
          const { d1, d2, d3 } = data[1];
          const total = d1 + d2 + d3;
          const result = total > 10 ? "T" : "X"; 

          patternHistory.push(result);
          if (patternHistory.length > 200) {
            patternHistory.shift();
          }
          diceHistory.push({ d1, d2, d3, total });
          if (diceHistory.length > 200) {
            diceHistory.shift();
          }

          const predictionResult = analyzeAndPredict(patternHistory);

          currentData = {
            phien_truoc: id_phien_chua_co_kq,
            ket_qua: (result === "T" ? "Tài" : "Xỉu"),
            Dice: [d1, d2, d3],
            phien_hien_tai: (id_phien_chua_co_kq ? id_phien_chua_co_kq + 1 : null), // Cập nhật lại cho phiên tiếp theo
            du_doan: (predictionResult.finalPrediction === "T" ? "Tài" : (predictionResult.finalPrediction === "X" ? "Xỉu" : predictionResult.finalPrediction)),
            do_tin_cay: `${(predictionResult.confidence * 100).toFixed(2)}%`,
            cau: predictionResult.predictionDetails.join('; '),
            ngay: new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
            Id: "ApiSunWin-@nhutquangdz🪼"
          };
          
          console.log(`[LOG] Phiên ${id_phien_chua_co_kq} → ${d1}-${d2}-${d3} = ${total} (${(result === "T" ? "Tài" : "Xỉu")}) | Dự đoán: ${currentData.du_doan} (${currentData.do_tin_cay}) - Chi tiết: ${currentData.cau}`);
          id_phien_chua_co_kq = null;
        }
      }
    } catch (err) {
      console.error('[ERROR] Lỗi xử lý dữ liệu:', err.message);
    }
  });

  ws.on('close', (code, reason) => { // Giữ lại code và reason để tiện debug
    console.log(`[WARN] WebSocket mất kết nối. Mã: ${code || 'Không rõ'}, Lý do: ${reason || 'Không rõ'}. Đang thử lại sau 2.5s...`);
    setTimeout(connectWebSocket, 2500); 
  });

  ws.on('error', (err) => {
    console.error('[ERROR] WebSocket lỗi:', err.message);
  });
}

app.get('/taixiu', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json(currentData);
});

app.get('/', (req, res) => {
  res.send(`<h2>Sunwin Tài Xỉu API - By @nhutquangdz🪼</h2><p>Dữ liệu được cập nhật tự động từ WebSocket.</p><p><a href="/taixiu">Xem kết quả JSON hiện tại</a></p>`);
});

app.listen(PORT, () => {
  console.log(`[LOG] Server đang chạy tại http://localhost:${PORT}`);
  connectWebSocket();
});
