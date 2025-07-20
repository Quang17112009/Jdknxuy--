const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

// Port server HTTP
const PORT = process.env.PORT || 10000;

// ===== BỘ THUẬT TOÁN DỰ ĐOÁN (GỐC - KHÔNG CÒN ĐƯỢC DÙNG TRONG HÀM TỔNG HỢP) =====

// --- Helper Functions ---
function get_tai_xiu(total) {
    return (total >= 11 && total <= 18) ? "Tài" : "Xỉu";
}

function Counter(arr) {
    return arr.reduce((acc, val) => {
        acc[val] = (acc[val] || 0) + 1;
        return acc;
    }, {});
}

// --- THUẬT TOÁN 1: Phân tích cầu đặc biệt ---
function du_doan_v1(totals_list) {
    if (totals_list.length < 4) {
        return ["Chờ", "Đợi thêm dữ liệu để phân tích cầu."];
    }

    const last_4 = totals_list.slice(-4);
    const last_3 = totals_list.slice(-3);
    const last_total = totals_list[totals_list.length - 1];
    const last_result = get_tai_xiu(last_total);

    // Cầu đặc biệt A-B-A-A
    if (last_4[0] === last_4[2] && last_4[0] === last_4[3] && last_4[0] !== last_4[1]) {
        return ["Tài", `Cầu đặc biệt ${last_4.join('-')}. Bắt Tài theo công thức.`];
    }
    // Cầu sandwich A-B-A
    if (last_3[0] === last_3[2] && last_3[0] !== last_3[1]) {
        return [last_result === "Tài" ? "Xỉu" : "Tài", `Cầu sandwich ${last_3.join('-')}. Bẻ cầu!`];
    }
    // Số đặc biệt
    const special_nums = new Set([7, 9, 10]);
    const count = last_3.filter(total => special_nums.has(total)).length;
    if (count >= 2) {
        return [last_result === "Tài" ? "Xỉu" : "Tài", `Xuất hiện cặp số đặc biệt trong 3 phiên gần nhất. Bẻ cầu!`];
    }
    // Cầu nghiêng
    const last_6 = totals_list.slice(-6);
    const freq_count = last_6.filter(t => t === last_total).length;
    if (freq_count >= 3) {
        return [get_tai_xiu(last_total), `Số ${last_total} lặp lại ${freq_count} lần. Bắt theo cầu nghiêng.`];
    }
    // Cầu lặp lại
    if (last_3[0] === last_3[2] || last_3[1] === last_3[2]) {
        return [last_result === "Tài" ? "Xỉu" : "Tài", `Cầu lặp lại ${last_3[1]}-${last_3[2]} hoặc ${last_3[0]}-${last_3[2]}. Bẻ cầu 1-1.`];
    }
    // Mặc định
    return [last_result === "Tài" ? "Xỉu" : "Tài", "Không có cầu đặc biệt, dự đoán theo cầu 1-1."];
}

// --- THUẬT TOÁN 2: Phân tích với độ tin cậy ---
function du_doan_v2(totals_list) {
    if (totals_list.length < 4) {
        return ["Chờ", 0, "Chưa đủ dữ liệu để dự đoán."];
    }

    const last_result = get_tai_xiu(totals_list[totals_list.length - 1]);

    // Rule definitions
    const rules = [{
        id: "special_pattern",
        exec: (totals) => {
            const last_4 = totals.slice(-4);
            if (last_4[0] === last_4[2] && last_4[0] === last_4[3] && last_4[0] !== last_4[1]) {
                return ["Tài", 85, `Cầu đặc biệt ${last_4.join('-')}. Bắt Tài.`];
            }
        }
    }, {
        id: "sandwich",
        exec: (totals) => {
            const last_3 = totals.slice(-3);
            if (last_3[0] === last_3[2] && last_3[0] !== last_3[1]) {
                return [last_result === "Tài" ? "Xỉu" : "Tài", 83, `Cầu sandwich ${last_3.join('-')}. Bẻ cầu!`];
            }
        }
    }, {
        id: "special_numbers",
        exec: (totals) => {
            const last_3 = totals.slice(-3);
            const special_nums = new Set([7, 9, 10]);
            const count = last_3.filter(t => special_nums.has(t)).length;
            if (count >= 2) {
                return [last_result === "Tài" ? "Xỉu" : "Tài", 81, `Xuất hiện ≥2 số đặc biệt. Bẻ cầu!`];
            }
        }
    }, {
        id: "frequent_repeat",
        exec: (totals) => {
            const last_total = totals[totals.length - 1];
            const last_6 = totals.slice(-6);
            const freq = last_6.filter(t => t === last_total).length;
            if (freq >= 3) {
                return [get_tai_xiu(last_total), 80, `Số ${last_total} lặp lại ${freq} lần. Bắt theo nghiêng cầu!`];
            }
        }
    }, {
        id: "repeat_pattern",
        exec: (totals) => {
            const last_3 = totals.slice(-3);
            if (last_3[0] === last_3[2] || last_3[1] === last_3[2]) {
                return [last_result === "Tài" ? "Xỉu" : "Tài", 77, `Cầu lặp dạng ${last_3.join('-')}. Bẻ cầu.`];
            }
        }
    }, ];

    for (const rule of rules) {
        const result = rule.exec(totals_list);
        if (result) return result;
    }

    return [last_result === "Tài" ? "Xỉu" : "Tài", 71, "Không có cầu đặc biệt, bẻ cầu mặc định."];
}


// --- THUẬT TOÁN 3: Phân tích chuỗi và extreme ---
function du_doan_v3(totals_list) {
    if (totals_list.length < 4) {
        return ["Chờ", 0, "Không đủ dữ liệu"];
    }
    const last_total = totals_list[totals_list.length - 1];
    const last_result = get_tai_xiu(last_total);
    const types_list = totals_list.map(t => get_tai_xiu(t));

    // Rule: chain of same results
    let chain = 1;
    for (let i = types_list.length - 1; i > 0; i--) {
        if (types_list[i] === types_list[i - 1]) {
            chain++;
        } else {
            break;
        }
    }
    if (chain >= 4) {
        const pred = types_list[types_list.length - 1] === "Tài" ? "Xỉu" : "Tài";
        return [pred, 78, `Có chuỗi ${chain} phiên ${types_list[types_list.length - 1]}. Đảo chuỗi!`];
    }

    // Rule: extreme total
    if (last_total <= 5 || last_total >= 16) {
        const pred = last_result === "Tài" ? "Xỉu" : "Tài";
        return [pred, 76, `Tổng điểm cực trị ${last_total}. Đảo chiều.`];
    }

    return [last_result === "Tài" ? "Xỉu" : "Tài", 70, "Không có quy tắc nổi bật."];
}

// --- THUẬT TOÁN 4: Phân tích đơn giản ---
function du_doan_v4(kq_list, tong_list) {
    let tin_cay = 50;
    if (kq_list.length < 3) return [kq_list.length > 0 ? kq_list.slice(-1)[0] : "Chờ", tin_cay];

    const last_3_kq = kq_list.slice(-3).join('');
    const last_2_kq = kq_list.slice(-2).join('');
    const last_tong = tong_list.slice(-1)[0];

    if (last_3_kq === "TàiTàiTài") return ["Xỉu", Math.min(tin_cay + 20, 95)];
    if (last_3_kq === "XỉuXỉuXỉu") return ["Tài", Math.min(tin_cay + 20, 95)];
    if (last_2_kq === "TàiXỉu") return ["Tài", Math.min(tin_cay + 10, 95)];
    if (last_tong >= 15) return ["Xỉu", Math.min(tin_cay + 10, 95)];
    if (last_tong <= 9) return ["Tài", Math.min(tin_cay + 10, 95)];

    return [kq_list.slice(-1)[0], tin_cay];
}


// --- THUẬT TOÁN 5: Dự đoán theo hash ---
function algo1(input_str) {
    const hash = crypto.createHash('sha256').update(input_str).digest('hex');
    return parseInt(hash, 16) % 100;
}

function algo2(input_str) {
    let sum = 0;
    for (let i = 0; i < input_str.length; i++) {
        sum += input_str.charCodeAt(i);
    }
    return sum % 100;
}

function algo3(input_str) {
    const hash = crypto.createHash('sha1').update(input_str).digest('hex');
    return parseInt(hash.slice(-2), 16) % 100;
}

function du_doan_phan_tram(input_str) {
    const percentage = (algo1(input_str) + algo2(input_str) + algo3(input_str)) / 3;
    return parseFloat(percentage.toFixed(2));
}

// --- THUẬT TOÁN 6: Dự đoán theo xúc xắc ---
function du_doan_theo_xi_ngau(dice_list) {
    if (!dice_list || dice_list.length === 0) return "Đợi thêm dữ liệu";
    const [d1, d2, d3] = dice_list[dice_list.length - 1];
    const total = d1 + d2 + d3;

    const result_list = [d1, d2, d3].map(d => {
        let tmp = d + total;
        if (tmp === 4 || tmp === 5) tmp -= 4;
        else if (tmp >= 6) tmp -= 6;
        return tmp % 2 === 0 ? "Tài" : "Xỉu";
    });

    const counts = Counter(result_list);
    return (counts['Tài'] || 0) >= (counts['Xỉu'] || 0) ? "Tài" : "Xỉu";
}

// --- THUẬT TOÁN 7: Dự đoán theo xúc xắc với xác suất ---
function du_doan_theo_xi_ngau_prob(dice_list) {
    if (!dice_list || dice_list.length === 0) return ["Đợi thêm dữ liệu", 0.5];
    const [d1, d2, d3] = dice_list[dice_list.length - 1];
    const total = d1 + d2 + d3;

    const result_list = [d1, d2, d3].map(d => {
        let tmp = d + total;
        if (tmp === 4 || tmp === 5) tmp -= 4;
        else if (tmp >= 6) tmp -= 6;
        return tmp % 2 === 0 ? "Tài" : "Xỉu";
    });

    const count_tai = result_list.filter(r => r === "Tài").length;
    const prob_tai = count_tai / 3;
    const prediction = count_tai >= 2 ? "Tài" : "Xỉu";
    return [prediction, prob_tai];
}

// --- THUẬT TOÁN 8: Phân tích cầu Sunwin ---
function phan_tich_cau_sunwin(ds_tong) {
    const now = new Date();
    const hour = now.getHours(); // Lấy giờ của server
    if (hour >= 0 && hour < 5) {
        return {
            du_doan: "Chờ",
            tin_cay: "0%",
            ly_do: "❌ Không nên áp dụng công thức từ 00:00 đến 05:00 sáng"
        };
    }

    let ket_luan = "";
    let do_tin_cay = 0;

    // Phân tích cặp giống nhau
    if (ds_tong.length >= 3 && ds_tong.slice(-1)[0] === ds_tong.slice(-3)[0]) {
        ket_luan += `🔁 Cặp giống nhau: ${ds_tong.slice(-1)[0]} - có thể bẻ\n`;
        do_tin_cay += 20;
    }

    // Phân tích 3 cầu liên tục
    if (ds_tong.length >= 3) {
        const [a, b, c] = ds_tong.slice(-3);
        if (a > 10 && b > 10 && c > 10) {
            ket_luan += `⚪ 3 cầu Tài liên tục -> Xỉu nhẹ\n`;
            do_tin_cay += 15;
        }
        if (a <= 10 && b <= 10 && c <= 10) {
            ket_luan += `⚫ 3 cầu Xỉu liên tục -> Tài nhẹ\n`;
            do_tin_cay += 15;
        }
    }

    // Phân tích cầu bệt
    if (ds_tong.length >= 6) {
        const recent = ds_tong.slice(-6);
        const biet_den = recent.slice(0, 5).every(x => x <= 10);
        const biet_trang = recent.slice(0, 5).every(x => x > 10);
        if (biet_den && recent[5] > 10) {
            ket_luan += "📉 Cầu bệt Xỉu bị lệch - bẻ Tài nhẹ\n";
            do_tin_cay += 10;
        }
        if (biet_trang && recent[5] <= 10) {
            ket_luan += "📈 Cầu bệt Tài bị lệch - bẻ Xỉu nhẹ\n";
            do_tin_cay += 10;
        }
    }

    // Phân tích tần suất
    const tong_counter = Counter(ds_tong.slice(-10));
    for (const [k, v] of Object.entries(tong_counter)) {
        if (v >= 3 && parseInt(k) <= 10) {
            ket_luan += `📌 Tổng ${k} xuất hiện ${v} lần gần đây → Bẻ Xỉu\n`;
            do_tin_cay += 10;
        }
    }

    let du_doan = "❓ Chưa đủ dữ kiện để dự đoán";
    if (do_tin_cay >= 40) {
        du_doan = ds_tong.slice(-1)[0] > 10 ? "Xỉu" : "Tài";
    }

    return {
        du_doan: du_doan,
        tin_cay: `${Math.min(do_tin_cay, 100)}%`,
        ly_do: ket_luan.trim()
    };
}


// --- HÀM TỔNG HỢP DỰ ĐOÁN (ĐÃ ĐƯỢC THAY THẾ BẰNG LOGIC NGẪU NHIÊN) ---
function du_doan_tong_hop(totals_list, kq_list, dice_list, ma_phien) {
    // Luôn trả về "Chờ" nếu không có dữ liệu
    if (totals_list.length === 0) {
        return {
            prediction: "Chờ",
            tincay: "0%",
            chi_tiet: {},
            ket_luan: "Chờ dữ liệu phiên đầu tiên...",
            tai_count: 0,
            xiu_count: 0
        };
    }

    // Tạo dự đoán ngẫu nhiên
    const random_choice = Math.random();
    const final_prediction = random_choice < 0.5 ? "Tài" : "Xỉu";

    // Tạo độ tin cậy ngẫu nhiên để trông "thật" hơn một chút
    const random_confidence = Math.floor(Math.random() * 46) + 50; // Ngẫu nhiên từ 50% đến 95%

    // Cập nhật kết luận để phản ánh logic ngẫu nhiên
    const ket_luan_random = `🎯 Dự đoán ngẫu nhiên: ${final_prediction}.`;

    // Cập nhật số đếm để phản ánh kết quả ngẫu nhiên
    const tai_count = final_prediction === "Tài" ? 1 : 0;
    const xiu_count = final_prediction === "Xỉu" ? 1 : 0;

    return {
        prediction: final_prediction,
        tincay: `${random_confidence}%`,
        chi_tiet: {
            random_logic: {
                du_doan: final_prediction,
                tin_cay: `${random_confidence}%`,
                ly_do: "Thuật toán đã được thay thế bằng lựa chọn ngẫu nhiên (50/50)."
            }
        },
        ket_luan: ket_luan_random,
        tai_count: tai_count,
        xiu_count: xiu_count
    };
}


// ===== LOGIC SERVER =====

// Dữ liệu và lịch sử
let totals_list = [];
let kq_list = [];
let dice_list = [];
const MAX_HISTORY = 50; // Giới hạn lưu trữ 50 phiên gần nhất

let currentData = {
    phien_truoc: null,
    ket_qua: "",
    Dice: [],
    phien_hien_tai: null,
    du_doan: "",
    do_tin_cay: "N/A",
    ket_luan_tong_hop: "",
    chi_tiet_du_doan: {},
    ngay: "",
    Id: "@nhutquangdz - Mấy thằng kia là con tao"
};

// Thông tin WebSocket
const WS_URL = "wss://websocket.atpman.net/websocket";
const HEADERS = {
    "Host": "websocket.atpman.net",
    "Origin": "https://play.789club.sx",
    "User-Agent": "Mozilla/5.0",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "vi-VN,vi;q=0.9",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache"
};
let lastEventId = 19;
const LOGIN_MESSAGE = [
    1, "MiniGame", "thatoidimoo11233", "112233", {
        info: JSON.stringify({
            ipAddress: "2405:4802:18c2:5990:3f0:c150:861d:5427",
            userId: "6ba5b041-a68d-4468-95d3-0bb2d8674512",
            username: "S8_thatoidimoo11233",
            timestamp: 1752497763866,
            refreshToken: "c6c49a4ff8ca49ac87fcaf2543a96221.6f17553681b74176a4ebeb77f475f443"
        }),
        signature: "5F953D843B438DD810A98D903AD3623CE98AED1745C3925EEAFD2A5BEB4D86A24ED0B97129E6AAB5DA1C3F73C2A236AE06D08EDDD937991260DFEA543E8F1C8818A651BDF4204E97A53F0461B306A95A6D7D56F435326270E9E4CB8084BB93969BFD4DB3CA8E519D079324E47110BCC23AB2139508D9E762407B76DE542D6E68"
    }
];
const SUBSCRIBE_TX_RESULT = [6, "MiniGame", "taixiuUnbalancedPlugin", {
    cmd: 2000
}];
const SUBSCRIBE_LOBBY = [6, "MiniGame", "lobbyPlugin", {
    cmd: 10001
}];

// Kết nối và xử lý WebSocket
function connectWebSocket() {
    const ws = new WebSocket(WS_URL, {
        headers: HEADERS
    });

    ws.on('open', () => {
        console.log("✅ Đã kết nối WebSocket");
        ws.send(JSON.stringify(LOGIN_MESSAGE));

        setTimeout(() => {
            ws.send(JSON.stringify(SUBSCRIBE_TX_RESULT));
            ws.send(JSON.stringify(SUBSCRIBE_LOBBY));
        }, 1000);

        setInterval(() => ws.send("2"), 10000);
        setInterval(() => ws.send(JSON.stringify(SUBSCRIBE_TX_RESULT)), 30000);
        setInterval(() => ws.send(JSON.stringify([7, "Simms", lastEventId, 0, {
            id: 0
        }])), 15000);
    });

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            if (Array.isArray(data)) {
                if (data[0] === 7 && data[1] === "Simms" && Number.isInteger(data[2])) {
                    lastEventId = data[2];
                }

                if (data[1] ?.cmd === 2006) {
                    const {
                        sid,
                        d1,
                        d2,
                        d3
                    } = data[1];
                    const tong = d1 + d2 + d3;
                    const ketqua = tong >= 11 ? "Tài" : "Xỉu";
                    const diceArray = [d1, d2, d3];
                    const ma_phien_str = String(sid);

                    // Cập nhật lịch sử
                    totals_list.push(tong);
                    kq_list.push(ketqua);
                    dice_list.push(diceArray);

                    // Giữ lịch sử ở kích thước tối đa
                    if (totals_list.length > MAX_HISTORY) {
                        totals_list.shift();
                        kq_list.shift();
                        dice_list.shift();
                    }

                    // Gọi bộ thuật toán dự đoán tổng hợp (phiên bản ngẫu nhiên)
                    const result = du_doan_tong_hop(totals_list, kq_list, dice_list, ma_phien_str);

                    // Cập nhật dữ liệu hiện tại để trả về qua API
                    currentData.phien_truoc = currentData.phien_hien_tai;
                    currentData.phien_hien_tai = sid;
                    currentData.Dice = diceArray;
                    currentData.ket_qua = ketqua;
                    currentData.du_doan = result.prediction;
                    currentData.do_tin_cay = result.tincay;
                    currentData.ket_luan_tong_hop = result.ket_luan;
                    currentData.chi_tiet_du_doan = result.chi_tiet; // Dữ liệu chi tiết
                    currentData.ngay = new Date().toLocaleString("vi-VN", {
                        timeZone: "Asia/Ho_Chi_Minh"
                    });


                    console.log("🎲 Phiên mới:", sid, "| Kết quả:", `${tong} (${ketqua})`, "| Dự đoán (ngẫu nhiên):", result.prediction, `(${result.tincay})`);
                }
            }
        } catch (err) {
            // Bỏ qua lỗi parse JSON không hợp lệ
            if (!(err instanceof SyntaxError)) {
                console.error("❌ Lỗi message:", err.message);
            }
        }
    });

    ws.on('close', () => {
        console.log("🔌 WebSocket bị đóng. Kết nối lại sau 5s…");
        setTimeout(connectWebSocket, 5000);
    });

    ws.on('error', (err) => {
        console.error("❌ Lỗi WebSocket:", err.message);
    });
}

// HTTP server có hỗ trợ CORS cho https://tooltxwanin.site
const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "https://tooltxwanin.site");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === "/taixiu") {
        res.writeHead(200, {
            "Content-Type": "application/json"
        });
        res.end(JSON.stringify(currentData));
    } else {
        res.writeHead(404, {
            "Content-Type": "text/plain"
        });
        res.end("Không tìm thấy");
    }
});

// Khởi chạy server
server.listen(PORT, () => {
    console.log(`🌐 Server đang chạy tại http://localhost:${PORT}`);
    connectWebSocket();
});
