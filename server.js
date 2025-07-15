const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

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
  phan_tich: {} // Thêm trường phân tích chi tiết
};
let id_phien_chua_co_kq = null;
let patternHistory = []; // Lưu dãy T/X gần nhất (lên đến 200 phiên)
let diceHistory = []; // Lưu lịch sử các mặt xúc xắc

// === Danh sách tin nhắn gửi lên server WebSocket đã được CẬP NHẬT ===
const messagesToSend = [
  [1, "MiniGame", "SC_thataoduocko112233", "112233", {
    "info": "{\"ipAddress\":\"2402:800:62cd:ef90:a445:40de:a24a:765e\",\"userId\":\"1a46e9cd-135d-4f29-9cd5-0b61bd2fb2a9\",\"username\":\"SC_thataoduocko112233\",\"timestamp\":1752257356729,\"refreshToken\":\"fe70e712cf3c4737a4ae22cbb3700c8e.f413950acf984ed6b373906f83a4f796\"}",
    "signature": "16916AC7F4F163CD00B319824B5B90FFE11BC5E7D232D58E7594C47E271A5CDE0492BB1C3F3FF20171B3A344BEFEAA5C4E9D28800CF18880FEA6AC3770016F2841FA847063B80AF8C8A747A689546CE75E99A7B559612BC30FBA5FED9288B69013C099FD6349ABC2646D5ECC2D5B2A1C5A9817FE5587844B41C752D0A0F6F304"
  }],
  [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
  [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

// === Thuật toán dự đoán nâng cao (giữ nguyên như phiên bản trước) ===
function analyzeAndPredict(history) {
  const analysis = {
    totalResults: history.length,
    taiCount: history.filter(r => r === 'T').length,
    xiuCount: history.filter(r => r === 'X').length,
    last50Pattern: history.slice(-50).join(''),
    last200Pattern: history.join(''),
    predictionDetails: []
  };

  let prediction = "?";
  let confidence = 0; // Độ tin cậy của dự đoán

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
      confidence += 0.4; // Tăng độ tin cậy
      analysis.predictionDetails.push(`Phát hiện: ${p.name}, Dự đoán: ${p.predict}`);
      break; // Ưu tiên cầu gần nhất
    }
  }

  // Chiến lược 2: Phân tích xu hướng (trong 20 phiên gần nhất)
  const last20 = history.slice(-20);
  const taiIn20 = last20.filter(r => r === 'T').length;
  const xiuIn20 = last20.filter(r => r === 'X').length;

  if (taiIn20 > xiuIn20 + 5) { // Nếu Tài nhiều hơn đáng kể
    if (prediction === "T") confidence += 0.2;
    else if (prediction === "?") { prediction = "T"; confidence += 0.2; }
    analysis.predictionDetails.push(`Xu hướng 20 phiên: Nghiêng về Tài (${taiIn20} Tài / ${xiuIn20} Xỉu)`);
  } else if (xiuIn20 > taiIn20 + 5) { // Nếu Xỉu nhiều hơn đáng kể
    if (prediction === "X") confidence += 0.2;
    else if (prediction === "?") { prediction = "X"; confidence += 0.2; }
    analysis.predictionDetails.push(`Xu hướng 20 phiên: Nghiêng về Xỉu (${taiIn20} Tài / ${xiuIn20} Xỉu)`);
  } else if (prediction === "?") {
      analysis.predictionDetails.push(`Xu hướng 20 phiên: Khá cân bằng (${taiIn20} Tài / ${xiuIn20} Xỉu)`);
  }

  if (diceHistory.length > 0) {
    const lastResult = diceHistory[diceHistory.length -1];
    const total = lastResult.d1 + lastResult.d2 + lastResult.d3;
    analysis.predictionDetails.push(`Kết quả xúc xắc gần nhất: ${lastResult.d1}-${lastResult.d2}-${lastResult.d3} (Tổng: ${total})`);
  }


  // Nếu chưa có dự đoán rõ ràng, quay lại dự đoán đơn giản hơn (nếu có đủ lịch sử)
  if (prediction === "?" && history.length >= 6) {
    const last3 = history.slice(-3).join('');
    const last4 = history.slice(-4).join('');

    const count3 = history.join('').split(last3).length - 1;
    if (count3 >= 2) {
      prediction = last3[0];
      confidence += 0.1;
      analysis.predictionDetails.push(`Phát hiện lặp 3 cuối: ${last3}, Dự đoán: ${prediction}`);
    }

    const count4 = history.join('').split(last4).length - 1;
    if (count4 >= 2) {
      prediction = last4[0];
      confidence += 0.1;
      analysis.predictionDetails.push(`Phát hiện lặp 4 cuối: ${last4}, Dự đoán: ${prediction}`);
    }
  }

  analysis.finalPrediction = prediction;
  analysis.confidence = Math.min(confidence, 1); // Đảm bảo confidence không vượt quá 1

  return analysis;
}

// === WebSocket ===
let ws = null;
let pingInterval = null;
let reconnectTimeout = null;
let isManuallyClosed = false;

function connectWebSocket() {
  // Đã cập nhật URL WebSocket tại đây!
  ws = new WebSocket("wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfdGhhdGFvZHVvY2tvMTEyMjMzIn0.1x7oXyG4y2_D_Lz5C9qL9fA7cM6N8L7k8n0t7J4gJ8A", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Origin": "https://play.sun.win"
    }
  });

  ws.on('open', () => {
    console.log('[✅] WebSocket kết nối');
    isManuallyClosed = false;
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
          const result = total > 10 ? "T" : "X"; // T hoặc X để khớp với logic dự đoán

          // Lưu lịch sử xúc xắc
          diceHistory.push({ d1, d2, d3, total, result });
          if (diceHistory.length > 200) diceHistory.shift(); // Giữ 200 phiên gần nhất

          // Lưu pattern
          patternHistory.push(result);
          if (patternHistory.length > 200) patternHistory.shift(); // Giữ 200 phiên gần nhất

          const text = `${d1}-${d2}-${d3} = ${total} (${result === 'T' ? 'Tài' : 'Xỉu'})`;

          // Dự đoán và phân tích
          const analysis = analyzeAndPredict(patternHistory);

          currentData = {
            id: "binhtool90",
            id_phien: id_phien_chua_co_kq,
            ket_qua: text,
            pattern: patternHistory.join(''),
            du_doan: analysis.finalPrediction === "T" ? "Tài" : analysis.finalPrediction === "X" ? "Xỉu" : "?",
            phan_tich: analysis // Thêm kết quả phân tích chi tiết
          };

          console.log(`Phiên ${id_phien_chua_co_kq}: ${text} → Dự đoán tiếp: ${currentData.du_doan} (Độ tin cậy: ${(analysis.confidence * 100).toFixed(0)}%)`);
          analysis.predictionDetails.forEach(detail => console.log(`  - ${detail}`));
          id_phien_chua_co_kq = null;
        }
      }
    } catch (e) {
      console.error('[Lỗi xử lý tin nhắn]:', e.message);
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
    ws.close();
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
