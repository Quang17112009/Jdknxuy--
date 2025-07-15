Const WebSocket = require('ws');
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

// === Danh sách tin nhắn gửi lên server WebSocket ===
const messagesToSend = [
  [1, "MiniGame", "SC_apisunwin123", "binhlamtool90", {
    "info": "{\"ipAddress\":\"2a09:bac1:7aa0:10::2e5:4d\",\"userId\":\"d93d3d84-f069-4b3f-8dac-b4716a812143\",\"username\":\"SC_apisunwin123\",\"timestamp\":1752045925640,\"refreshToken\":\"dd38d05401bb48b4ac3c2f6dc37f36d9.f22dccad89bb4e039814b7de64b05d63\"}",
    "signature": "6FAD7CF6196AFBF0380BC69B59B653A05153D3D0E4E9A07BA43890CC3FB665B92C2E09E5B34B31FD8D74BDCB3B03A29255C5A5C7DFB426A8D391836CF9DCB7E5CEA743FE07521075DED70EFEC7F78C8993BDBF8626D58D3E68D36832CA4823F516B7E41DB353EA79290367D34DF98381089E69EA7C67FB3588B39C9C4D7174B2"
  }],
  [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
  [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

// === Thuật toán dự đoán nâng cao ===
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


  // Chiến lược 3: Dự đoán dựa trên các mặt xúc xắc và tổng điểm (Cần dữ liệu diceHistory)
  // Để triển khai đầy đủ phần này, cần lưu chi tiết các mặt xúc xắc (d1, d2, d3) vào diceHistory
  // Ví dụ:
  // if (diceHistory.length > 5) {
  //   const lastDice = diceHistory[diceHistory.length - 1];
  //   // Phân tích các mặt xúc xắc cụ thể, ví dụ: nếu hay ra 3 con 1, 3 con 6
  //   // Nếu tổng điểm hay ra ở mức thấp (4-7) hoặc cao (14-17)
  //   // Điều này yêu cầu phân tích thống kê sâu hơn
  // }
  if (diceHistory.length > 0) {
    const lastResult = diceHistory[diceHistory.length -1];
    const total = lastResult.d1 + lastResult.d2 + lastResult.d3;
    analysis.predictionDetails.push(`Kết quả xúc xắc gần nhất: ${lastResult.d1}-${lastResult.d2}-${lastResult.d3} (Tổng: ${total})`);
    // Ví dụ về phân tích xúc xắc:
    // Nếu tổng điểm thường xuyên nằm ở khoảng 8-13 (khó đoán hơn), hoặc 4-7 (xỉu), 14-17 (tài)
    // Cần thống kê tần suất xuất hiện của tổng điểm
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

  // Điều chỉnh trọng số/độ tin cậy (Tự học hỏi - Cần lưu trữ kết quả dự đoán và kết quả thực tế)
  // Đây là phần phức tạp nhất, yêu cầu một cơ sở dữ liệu nhỏ hoặc lưu vào file để ghi lại
  // "Nếu tôi dự đoán X và nó ra X, thì tăng trọng số cho chiến lược đó."
  // "Nếu tôi dự đoán X và nó ra T, thì giảm trọng số cho chiến lược đó."
  // Hiện tại, chỉ tăng confidence nếu có các mẫu rõ ràng.

  analysis.finalPrediction = prediction;
  analysis.confidence = Math.min(confidence, 1); // Đảm bảo confidence không vượt quá 1

  return analysis;
}

function connectWebSocket() {
  ws = new WebSocket("wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Origin": "https://play.sun.win"
    }
  });

  ws.on('open', () => {
    console.log('[✅] WebSocket kết nối');
    isManuallyClosed = false; // Đặt lại cờ khi kết nối thành công
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
    ws.close(); // Đảm bảo đóng kết nối để kích hoạt reconnect
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
