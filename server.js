require("dotenv").config();



const express = require("express");

const cors = require("cors");

const path = require("path");

const session = require("express-session");



const db = require("./db");

const MySQLSessionStore = require("./auth/session-store");

const authRoutes = require("./auth/routes");

const adminRoutes = require("./admin/routes");
const writingRoutes = require("./writing/routes");



const app = express();

const PORT = Number(process.env.PORT || 3000);



// ========================================

// 1. CAU HINH SESSION SECRET

// ========================================

if (

    !process.env.SESSION_SECRET ||

    process.env.SESSION_SECRET.length < 32

) {

    throw new Error(

        "SESSION_SECRET phai co it nhat 32 ky tu trong .env"

    );

}



// ========================================

// 2. MIDDLEWARE CO BAN

// ========================================

app.use(cors());

app.use(express.json({ limit: "32kb" }));

app.use(express.urlencoded({ extended: true }));



// ========================================

// 3. SESSION MYSQL

// ========================================

const sessionStore = new MySQLSessionStore();



app.use(session({

    name: "toeic.sid",

    secret: process.env.SESSION_SECRET,

    store: sessionStore,

    resave: false,

    saveUninitialized: false,

    cookie: {

        httpOnly: true,

        secure: process.env.NODE_ENV === "production",

        sameSite: "lax",

        maxAge: 24 * 60 * 60 * 1000

    }

}));



// Don session het han moi gio

const cleanupTimer = setInterval(() => {

    sessionStore.clearExpired().catch(error => {

        console.error(

            "Loi don session:",

            error.message

        );

    });

}, 60 * 60 * 1000);



cleanupTimer.unref();



// ========================================

// 4. AUTH + ADMIN ROUTES

// ========================================

app.use("/api/auth", authRoutes);

app.use("/api/admin", adminRoutes);
app.use("/api/writing", writingRoutes);



// 5 FRONTEND

// Landing Page
app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "landing.html")
    );
});

// Trang đăng nhập / đăng ký
app.get(["/login", "/register"], (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "auth.html")
    );
});

// Trang học - yêu cầu đăng nhập
app.get("/learn", (req, res) => {

    if (!req.session?.userId) {
        return res.redirect("/login");
    }

    res.sendFile(
        path.join(__dirname, "public", "learn.html")
    );
});

// Ngăn mở trực tiếp file học khi chưa đăng nhập
app.get(["/learn.html", "/index.html"], (req, res) => {
    if (!req.session?.userId) {
        return res.redirect("/login");
    }

    return res.redirect("/learn");
});

// Static files
app.use(express.static(
    path.join(__dirname, "public"),
    { index: false }
));
// ========================================

// 6. MIDDLEWARE YEU CAU DANG NHAP

// ========================================

function requireLogin(req, res, next) {

    if (!req.session?.userId) {

        return res.status(401).json({

            success: false,

            message: "Vui lòng đăng nhập."

        });

    }



    next();

}



// ========================================

// 7. KIEM TRA BACKEND + MYSQL

// ========================================

app.get("/api/health", async (req, res, next) => {

    try {

        await db.query("SELECT 1");



        res.json({

            success: true,

            message: "Backend va MySQL hoat dong."

        });

    } catch (error) {

        next(error);

    }

});



// ========================================

// 8. DANH SACH CHU DE TU VUNG

// ========================================

app.get(

    "/api/vocabulary/categories",

    async (req, res, next) => {

        try {

            const [rows] = await db.query(`

                SELECT DISTINCT category

                FROM vocabulary

                WHERE category IS NOT NULL

                  AND TRIM(category) <> ''

                ORDER BY category ASC

            `);



            res.json({

                success: true,

                total: rows.length,

                data: rows.map(row => row.category)

            });

        } catch (error) {

            next(error);

        }

    }

);



// ========================================

// 9. TU VUNG TOEIC

// ========================================

app.get("/api/vocabulary", async (req, res, next) => {

    try {

        const category = String(

            req.query.category || ""

        ).trim();



        const search = String(

            req.query.search || ""

        ).trim();



        const page = Math.max(

            1,

            parseInt(req.query.page, 10) || 1

        );



        const limit = Math.min(

            100,

            Math.max(

                1,

                parseInt(req.query.limit, 10) || 100

            )

        );



        const offset = (page - 1) * limit;



        let whereSql = " WHERE 1 = 1 ";

        const params = [];



        if (

            category &&

            category.toLowerCase() !== "all"

        ) {

            whereSql += " AND category = ? ";

            params.push(category);

        }



        if (search) {

            whereSql += `

                AND (

                    word LIKE ?

                    OR meaning_vi LIKE ?

                    OR example_en LIKE ?

                    OR example_vi LIKE ?

                )

            `;



            const keyword = `%${search}%`;



            params.push(

                keyword,

                keyword,

                keyword,

                keyword

            );

        }



        const [countRows] = await db.query(

            `SELECT COUNT(*) AS total

             FROM vocabulary

             ${whereSql}`,

            params

        );



        const total = Number(countRows[0].total);



        const [rows] = await db.query(

            `SELECT

                id,

                word,

                pronunciation,

                meaning_vi,

                example_en,

                example_vi,

                category

             FROM vocabulary

             ${whereSql}

             ORDER BY category ASC, word ASC

             LIMIT ? OFFSET ?`,

            [...params, limit, offset]

        );



        res.json({

            success: true,

            total,

            page,

            limit,

            totalPages: Math.ceil(total / limit),

            data: rows

        });

    } catch (error) {

        next(error);

    }

});



// ========================================

// 10. BAI HOC

// ========================================

app.get("/api/lessons", async (req, res, next) => {

    try {

        const [rows] = await db.query(`

            SELECT

                id,

                section,

                title,

                description,

                content

            FROM lessons

            ORDER BY id ASC

        `);



        res.json({

            success: true,

            total: rows.length,

            data: rows

        });

    } catch (error) {

        next(error);

    }

});



// ========================================

// 11. CAU HOI TRAC NGHIEM

// ========================================

app.get("/api/questions", async (req, res, next) => {

    try {

        const section = String(

            req.query.section || ""

        ).trim();



        let sql = `

            SELECT

                id,

                section,

                question,

                option_a,

                option_b,

                option_c,

                option_d,

                correct_option,

                explanation

            FROM quiz_questions

        `;



        const params = [];



        if (section) {

            sql += " WHERE section = ?";

            params.push(section);

        }



        sql += " ORDER BY id ASC";



        const [rows] = await db.query(sql, params);



        res.json({

            success: true,

            total: rows.length,

            data: rows

        });

    } catch (error) {

        next(error);

    }

});



// ========================================

// 12. XEM TIEN DO HOC

// ========================================

app.get(

    "/api/progress",

    requireLogin,

    async (req, res, next) => {

        try {

            const userKey =

                `user:${req.session.userId}`;



            const [rows] = await db.query(

                `SELECT

                    id,

                    user_key,

                    activity_type,

                    item_id,

                    score,

                    total,

                    created_at

                 FROM study_progress

                 WHERE user_key = ?

                 ORDER BY created_at DESC

                 LIMIT 100`,

                [userKey]

            );



            res.json({

                success: true,

                total: rows.length,

                data: rows

            });

        } catch (error) {

            next(error);

        }

    }

);



// ========================================

// 13. LUU TIEN DO HOC

// ========================================

app.post(

    "/api/progress",

    requireLogin,

    async (req, res, next) => {

        try {

            const userKey =

                `user:${req.session.userId}`;



            const activityType = String(

                req.body.activity_type || ""

            ).trim();



            const itemId = Number(

                req.body.item_id ?? 0

            );



            const score = Number(req.body.score);

            const total = Number(req.body.total);



            const validTypes = [

                "quiz",

                "vocabulary",

                "listening",

                "reading"

            ];



            if (

                !validTypes.includes(activityType) ||

                !Number.isSafeInteger(itemId) ||

                itemId < 0 ||

                !Number.isFinite(score) ||

                !Number.isFinite(total) ||

                score < 0 ||

                total < 0 ||

                score > total

            ) {

                return res.status(400).json({

                    success: false,

                    message:

                        "Du lieu tien do khong hop le."

                });

            }



            const [result] = await db.query(

                `INSERT INTO study_progress

                 (

                    user_key,

                    activity_type,

                    item_id,

                    score,

                    total

                 )

                 VALUES (?, ?, ?, ?, ?)`,

                [

                    userKey,

                    activityType,

                    itemId,

                    score,

                    total

                ]

            );



            res.status(201).json({

                success: true,

                message: "Da luu tien do hoc.",

                id: result.insertId

            });

        } catch (error) {

            next(error);

        }

    }

);



// ========================================

// 14. AI TUTOR - N8N / GEMINI

// ========================================

app.post("/api/ai/chat", async (req, res, next) => {

    try {

        const question = req.body?.question;



        if (

            typeof question !== "string" ||

            !question.trim() ||

            question.length > 2000

        ) {

            return res.status(400).json({

                success: false,

                message:

                    "Cau hoi phai co tu 1 den 2000 ky tu."

            });

        }



        const webhookUrl =

            process.env.N8N_CHAT_WEBHOOK_URL;



        if (!webhookUrl) {

            return res.status(503).json({

                success: false,

                message:

                    "Chua cau hinh N8N_CHAT_WEBHOOK_URL."

            });

        }



        const controller = new AbortController();



        const timeout = setTimeout(() => {

            controller.abort();

        }, 60000);



        try {

            const response = await fetch(webhookUrl, {

                method: "POST",

                headers: {

                    "Content-Type": "application/json"

                },

                body: JSON.stringify({

                    question: question.trim()

                }),

                signal: controller.signal

            });



            const raw = await response.text();



            let data;



            try {

                data = JSON.parse(raw);

            } catch {

                data = {

                    answer: raw

                };

            }



            if (!response.ok) {

                return res.status(502).json({

                    success: false,

                    message:

                        "AI Tutor tam thoi khong phan hoi."

                });

            }



            res.json(data);

        } finally {

            clearTimeout(timeout);

        }

    } catch (error) {

        if (error.name === "AbortError") {

            return res.status(504).json({

                success: false,

                message:

                    "AI Tutor phan hoi qua lau."

            });

        }



        next(error);

    }

});


/* ========================================
   WF03 - AI VOCABULARY RAG
   Website -> Express -> n8n -> Qdrant/Gemini
======================================== */

app.post("/api/ai/vocabulary", async (req, res) => {

  const { topic, level, count } = req.body || {};

  const allowedTopics = [
    "Office",
    "Travel",
    "Finance",
    "Recruitment"
  ];

  const allowedLevels = [
    "Beginner",
    "Intermediate",
    "Advanced"
  ];

  // Kiểm tra dữ liệu đầu vào
  if (
    !allowedTopics.includes(topic) ||
    !allowedLevels.includes(level) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 10
  ) {
    return res.status(400).json({
      success: false,
      message: "Dữ liệu đầu vào không hợp lệ"
    });
  }

  const webhookUrl = process.env.N8N_VOCAB_WEBHOOK_URL;
  const webhookKey = process.env.N8N_VOCAB_WEBHOOK_KEY;

  if (!webhookUrl || !webhookKey) {
    return res.status(503).json({
      success: false,
      message: "Chưa cấu hình n8n trong .env"
    });
  }

  // Chỉ gửi khóa bảo mật qua HTTPS
 
let target;

try {
  target = new URL(webhookUrl);

  // Cho phép HTTP khi cả backend và n8n chạy local
  const isLocalDev =
    process.env.NODE_ENV !== "production" &&
    target.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(target.hostname);

  if (target.protocol !== "https:" && !isLocalDev) {
    throw new Error("Webhook URL không an toàn");
  }

} catch {
  return res.status(503).json({
    success: false,
    message: "Webhook URL không hợp lệ"
  });
}


  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 120000);

  try {
    // Gửi yêu cầu đến Workflow 3
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-toeic-key": webhookKey
      },
      body: JSON.stringify({
        topic,
        level,
        count
      }),
      signal: controller.signal
    });


const raw = await response.text();

// DEBUG: Xem n8n thực sự trả về gì
if (process.env.NODE_ENV !== "production") {
  console.log("========== N8N DEBUG ==========");
  console.log("HTTP STATUS:", response.status);
  console.log(
    "CONTENT TYPE:",
    response.headers.get("content-type")
  );
  console.log("RESPONSE:", raw.slice(0, 400));
  console.log("===============================");
}

let result;

try {
  result = JSON.parse(raw);
} catch {
  return res.status(502).json({
    success: false,
    message:
      "n8n trả dữ liệu không phải JSON. HTTP " +
      response.status
  });
}


    // Xử lý lỗi từ n8n
    if (!response.ok || result.success === false) {
      const status = [400, 404, 502].includes(response.status)
        ? response.status
        : 502;

      return res.status(status).json({
        success: false,
        message: result.message || "Workflow n8n bị lỗi"
      });
    }

    // Kiểm tra kết quả AI
    if (
      !Array.isArray(result.vocabulary) ||
      result.vocabulary.length === 0 ||
      result.vocabulary.length > count ||
      result.vocabulary.some(item =>
        typeof item?.word !== "string" ||
        typeof item?.meaning !== "string" ||
        typeof item?.question !== "string" ||
        !Array.isArray(item?.options) ||
        item.options.length !== 4 ||
        !Number.isInteger(item?.answerIndex) ||
        item.answerIndex < 0 ||
        item.answerIndex > 3
      )
    ) {
      return res.status(502).json({
        success: false,
        message: "Dữ liệu bài học AI không hợp lệ"
      });
    }

    // Trả bài học về website
    return res.json({
      success: true,
      data: {
        topic: result.topic || topic,
        level: result.level || level,
        requestedCount: count,
        returnedCount: result.vocabulary.length,
        vocabulary: result.vocabulary,
        rag: result.rag || null
      }
    });

  } catch (error) {

    if (error.name === "AbortError") {
      return res.status(504).json({
        success: false,
        message: "n8n xử lý quá 120 giây"
      });
    }

    console.error("Vocabulary AI Error:", error.message);

    return res.status(502).json({
      success: false,
      message: "Không kết nối được n8n"
    });

  } finally {
    clearTimeout(timeout);
  }
});


/* =========================================
   WF04 - AI LISTENING DICTATION
   Generate + Grade qua n8n
========================================= */

async function callDictationWorkflow(payload) {
  const webhookUrl = process.env.N8N_DICTATION_WEBHOOK_URL;
  const webhookKey = process.env.N8N_DICTATION_WEBHOOK_KEY;

  if (!webhookUrl || !webhookKey) {
    const err = new Error(
      "Chưa cấu hình N8N_DICTATION_WEBHOOK_URL/KEY trong .env"
    );
    err.status = 503;
    throw err;
  }

  let url;

  try {
    url = new URL(webhookUrl);

    const localHttp =
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname);

    if (url.protocol !== "https:" && !localHttp) {
      throw new Error("Invalid protocol");
    }
  } catch {
    const err = new Error(
      "URL n8n không hợp lệ hoặc không an toàn"
    );
    err.status = 503;
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    120000
  );

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-toeic-key": webhookKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const raw = await response.text();
    let result;

    try {
      result = JSON.parse(raw);
    } catch {
      const err = new Error(
        "n8n không trả về JSON (HTTP " +
        response.status + ")"
      );
      err.status = 502;
      throw err;
    }

    if (!response.ok || result?.success !== true) {
      const err = new Error(
        result?.message ||
        "n8n báo lỗi HTTP " + response.status
      );

      err.status =
        response.status >= 400 && response.status < 500
          ? response.status
          : 502;

      throw err;
    }

    return result.data;

  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error(
        "n8n phản hồi quá 120 giây"
      );
      timeoutErr.status = 504;
      throw timeoutErr;
    }

    throw err;

  } finally {
    clearTimeout(timeout);
  }
}

function dictationApiError(res, err) {
  console.error("WF04:", err.message);

  const status =
    Number.isInteger(err.status) &&
    err.status >= 400 &&
    err.status <= 599
      ? err.status
      : 502;

  return res.status(status).json({
    success: false,
    message: err.message || "Không thể gọi n8n"
  });
}

/* =========================================
   API 1 - TẠO ĐỀ NGHE
========================================= */

app.post("/api/ai/dictation/generate", async (req, res) => {
  const topic = String(req.body?.topic || "Office");
  const level = String(
    req.body?.level || "Intermediate"
  );

  // Hiện mới có RAG Office - Intermediate
  if (topic !== "Office" || level !== "Intermediate") {
    return res.status(400).json({
      success: false,
      message: "Bản demo mới hỗ trợ Office – Intermediate."
    });
  }

  try {
    const data = await callDictationWorkflow({
      action: "generate",
      topic,
      level
    });

    if (
      !data ||
      !Array.isArray(data.dialogue) ||
      data.dialogue.length !== 4 ||
      data.dialogue.some(line =>
        !["Woman", "Man"].includes(line?.speaker) ||
        typeof line?.text !== "string" ||
        !line.text.trim()
      )
    ) {
      return res.status(502).json({
        success: false,
        message: "n8n trả hội thoại không hợp lệ."
      });
    }

    // Mã định danh lượt chơi
    const challengeId =
      require("node:crypto").randomUUID();

    // Đáp án gốc được lưu vào session phía server
    const referenceText = data.dialogue
      .map(line => line.text.trim())
      .join(" ");

    req.session.dictationChallenge = {
      id: challengeId,
      level,
      topic,
      referenceText,
      graded: false
    };

    return res.json({
      success: true,
      data: {
        challengeId,
        title: String(
          data.title || "TOEIC Dictation"
        ),
        level,
        topic,
        dialogue: data.dialogue,
        vocabularyFocus: data.vocabularyFocus || [],
        rag: data.rag || null
      }
    });

  } catch (err) {
    return dictationApiError(res, err);
  }
});

/* =========================================
   API 2 - CHẤM BÀI DICTATION
========================================= */

app.post("/api/ai/dictation/grade", async (req, res) => {
  const game = req.session?.dictationChallenge;

  const challengeId = String(
    req.body?.challengeId || ""
  );

  const typedText = String(
    req.body?.typedText || ""
  ).trim();

  if (!game || game.id !== challengeId) {
    return res.status(409).json({
      success: false,
      message:
        "Lượt chơi không tồn tại hoặc đã thay đổi. " +
        "Hãy tạo đề mới."
    });
  }



  if (!typedText || typedText.length > 1500) {
    return res.status(400).json({
      success: false,
      message:
        "Hãy nhập đoạn nghe (tối đa 1500 ký tự)."
    });
  }

  try {
    const data = await callDictationWorkflow({
      action: "grade",
      topic: game.topic,
      level: game.level,

      // Lấy đáp án từ session, không lấy từ frontend
      referenceText: game.referenceText,
      typedText
    });

    if (
      !data ||
      !Number.isFinite(data.accuracy) ||
      !Array.isArray(data.comparison) ||
      !Array.isArray(data.mistakes)
    ) {
      return res.status(502).json({
        success: false,
        message: "n8n trả điểm chấm không hợp lệ."
      });
    }

    game.graded = true;

    return res.json({
      success: true,
      data
    });

  } catch (err) {
    return dictationApiError(res, err);
  }
});

// ========================================

// 15. API KHONG TON TAI

// ========================================
app.use("/api/reading", require("./reading-routes"));
app.use("/api", (req, res) => {

    res.status(404).json({

        success: false,

        message: "Khong tim thay API.",

        path: req.originalUrl

    });

});



// ========================================

// 16. XU LY LOI

// ========================================

app.use((error, req, res, next) => {

    console.error(error);



    if (res.headersSent) {

        return next(error);

    }



    res.status(500).json({

        success: false,

        message: "Loi may chu."

    });

});



// ========================================

// 17. KHOI DONG SERVER

// ========================================
// API READING

app.listen(PORT, () => {
  console.log("SERVER FILE:", __filename);
  console.log("WORKING DIRECTORY:", process.cwd());
  console.log("TOEIC Nova dang chay tai http://localhost:" + PORT);
});
