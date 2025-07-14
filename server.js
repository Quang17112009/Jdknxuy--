Const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const { predictNext } = require('./matchrandom.js'); // Import thuật toán từ file riêng

const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;

// === Biến lưu trạng thái ===
let currentData = {
  "phien_truoc": null,
  "ket_qua": "Đang chờ...",
  "Dice": [],
  "phien_hien_tai": null,
  "du_doan": "Đang chờ phiên mới...",
  "do_tin_cay": "0%",
  "percent_tai": "0%",
  "percent_xiu": "0%",
  "cau": "Chưa có dữ liệu",
  "ngay": "",
  "Id": "@nhutquangdz"
};
let history = []; // Lịch sử các phiên (tối đa 100)

// === Danh sách tin nhắn gửi lên server WebSocket ===
const messagesToSend = [
  [1, "MiniGame", "SC_apisunwin123", "binhlamtool90", {
    "info": "{\"ipAddress\":\"2a09:bac1:7aa0:10::2e5:4d\",\"userId\":\"d93d3d84-f069-4b3f-8dac-b4714d812143\",\"username\":\"SC_apisunwin123\",\"timestamp\":1752045925640,\"refreshToken\":\"dd38d05401bb48b4ac3c2f6dc37f36d9.f22dccad89bb4e039814b7de64b05d63\"}",
    "signature": "6FAD7CF6196AFBF0380BC69B59B653A05153D3D0E4E9A07BA43890CC3FB665B92C2E09E5B34B31FD8D74BDCB3B03A29255C5A5C7DFB426A8D391836CF9DCB7E5CEA743FE07521075DED70EFEC7F78C8993BDBF8626D58D3E68D36832CA4823F516B7E41DB353EA79290367D34DF98381089E69EA7C67FB3588B39C9C4D7174B2"
  }],
  [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
  [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

// === Hàm phân tích xuất hiện (pt_xh) ===
function pt_xh(ls) {
    if (ls.length < 3) return "Chưa đủ dữ liệu";
    const dem_t = ls.filter(s => s.result === "Tài").length;
    const dem_x = ls.length - dem_t;
    const kq_ht = ls[0].result;
    let chuoi_ht = 0;
    for (const item of ls) {
        if (item.result === kq_ht) chuoi_ht++;
        else break;
    }
    const tt_chuoi = chuoi_ht >= 3 ? `Cầu ${kq_ht} ${chuoi_ht}` : "Cầu ngắn";
    const mo_ta_xh = dem_t > dem_x ? `Thiên Tài (${dem_t}-${dem_x})` : dem_x > dem_t ? `Thiên Xỉu (${dem_x}-${dem_t})` : `Cân bằng (${dem_t}-${dem_x})`;
    return `${mo_ta_xh}, ${tt_chuoi}`;
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
        const content = data[1];

        if (cmd === 1008 && content.sid) {
          currentData.phien_hien_tai = content.sid;
          
          // Gọi hàm dự đoán và nhận kết quả từ matchrandom.js
          const [prediction, confidence, percentTai, percentXiu] = predictNext(history);

          // Cập nhật dữ liệu
          currentData.du_doan = prediction;
          currentData.do_tin_cay = `${parseFloat(confidence).toFixed(2)}%`;
          currentData.percent_tai = `${parseFloat(percentTai).toFixed(2)}%`;
          currentData.percent_xiu = `${parseFloat(percentXiu).toFixed(2)}%`;
          currentData.ngay = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

          console.log(`\n[PHIÊN MỚI] Bắt đầu phiên ${content.sid}. Dự đoán: ${prediction} (${confidence.toFixed(2)}%)`);
        }

        if (cmd === 1003 && content.gBB) {
          const { d1, d2, d3, sid } = content;
          if (!history.some(h => h.sid === sid)) { // Đảm bảo không thêm trùng lặp
              const total = d1 + d2 + d3;
              const result = total > 10 ? "Tài" : "Xỉu";
              
              // Lưu đầy đủ thông tin vào lịch sử
              history.unshift({ result, total, sid, dice: [d1, d2, d3] });
              if (history.length > 100) history.pop(); // Giới hạn lịch sử 100 phiên

              currentData.phien_truoc = sid;
              currentData.ket_qua = result;
              currentData.Dice = [d1, d2, d3];
              currentData.cau = pt_xh(history);
              
              console.log(`[KẾT QUẢ] Phiên ${sid}: ${result} (${total})`);
          }
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
  res.send(`<h2>API Tài Xỉu - V2.1 by nhutquangdz</h2><p><a href="/taixiu">Xem JSON</a></p>`);
});

// === Khởi động server ===
app.listen(PORT, () => {
  console.log(`[🌐] Server chạy tại http://localhost:${PORT}`);
  connectWebSocket();
});
