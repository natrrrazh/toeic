
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ========================================
// 1. KIỂM TRA BACKEND VÀ MYSQL
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
// 2. DANH SÁCH CHỦ ĐỀ TỪ VỰNG
// Đặt trước route /api/vocabulary
// ========================================
app.get("/api/vocabulary/categories", async (req, res, next) => {
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
});

// ========================================
// 3. TỪ VỰNG TOEIC
// Hỗ trợ category, search, page, limit
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
            Math.max(1, parseInt(req.query.limit, 10) || 100)
        );

        const offset = (page - 1) * limit;

        let whereSql = " WHERE 1 = 1 ";
        const params = [];

        if (category && category.toLowerCase() !== "all") {
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
            `SELECT id, word, pronunciation, meaning_vi,
                    example_en, example_vi, category
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
// 4. DANH SÁCH BÀI HỌC
// ========================================
app.get("/api/lessons", async (req, res, next) => {
    try {
        const [rows] = await db.query(`
            SELECT id, section, title, description, content
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
// 5. CÂU HỎI TRẮC NGHIỆM
// Hỗ trợ lọc theo section
// ========================================
app.get("/api/questions", async (req, res, next) => {
    try {
        const section = String(
            req.query.section || ""
        ).trim();

        let sql = `
            SELECT id, section, question,
                   option_a, option_b, option_c, option_d,
                   correct_option, explanation
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
// 6. XEM TIẾN ĐỘ HỌC
// ========================================
app.get("/api/progress", async (req, res, next) => {
    try {
        const userKey = String(
            req.query.user_key || "guest"
        ).slice(0, 100);

        const [rows] = await db.query(
            `SELECT id, user_key, activity_type,
                    item_id, score, total, created_at
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
});

// ========================================
// 7. LƯU TIẾN ĐỘ HỌC
// ========================================
app.post("/api/progress", async (req, res, next) => {
    try {
        const userKey = String(
            req.body.user_key || "guest"
        ).slice(0, 100);

        const activityType = String(
            req.body.activity_type || ""
        ).trim();

        const itemId = Number(req.body.item_id ?? 0);
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
            !Number.isInteger(itemId) ||
            itemId < 0 ||
            !Number.isFinite(score) ||
            !Number.isFinite(total) ||
            score < 0 ||
            total < 0 ||
            score > total
        ) {
            return res.status(400).json({
                success: false,
                message: "Du lieu tien do khong hop le."
            });
        }

        const [result] = await db.query(
            `INSERT INTO study_progress
             (user_key, activity_type, item_id, score, total)
             VALUES (?, ?, ?, ?, ?)`,
            [userKey, activityType, itemId, score, total]
        );

        res.status(201).json({
            success: true,
            message: "Da luu tien do hoc.",
            id: result.insertId
        });
    } catch (error) {
        next(error);
    }
});

// ========================================
// 8. TOEIC AI CHAT
// EXPRESS -> N8N -> GOOGLE GEMINI
// ========================================
app.post("/api/ai/chat", async (req, res) => {
    const question = req.body?.question;

    if (
        typeof question !== "string" ||
        !question.trim() ||
        question.length > 2000
    ) {
        return res.status(400).json({
            success: false,
            message: "Cau hoi phai co tu 1 den 2000 ky tu."
        });
    }

    const webhookUrl = process.env.N8N_CHAT_WEBHOOK_URL;

    if (!webhookUrl) {
        return res.status(503).json({
            success: false,
            message: "Chua cau hinh N8N_CHAT_WEBHOOK_URL."
        });
    }

    // Thời gian chờ Gemini tối đa 60 giây
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

        if (!response.ok) {
            console.error(
                "n8n HTTP status:",
                response.status
            );

            return res.status(502).json({
                success: false,
                message: "Khong the lay cau tra loi tu n8n."
            });
        }

        const data = await response.json();

        if (
            typeof data.answer !== "string" ||
            !data.answer.trim()
        ) {
            return res.status(502).json({
                success: false,
                message: "n8n khong tra ve cau tra loi hop le."
            });
        }

        return res.json({
            success: true,
            answer: data.answer
        });
    } catch (error) {
        console.error(
            "TOEIC AI error:",
            error.message
        );

        return res.status(502).json({
            success: false,
            message: error.name === "AbortError"
                ? "AI phan hoi qua lau. Hay thu lai."
                : "Khong the ket noi den TOEIC AI."
        });
    } finally {
        clearTimeout(timeout);
    }
});

// ========================================
// 9. API KHÔNG TỒN TẠI
// ========================================
app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        message: "Khong tim thay API.",
        path: req.originalUrl
    });
});

// ========================================
// 10. XỬ LÝ LỖI
// ========================================
app.use((error, req, res, next) => {
    console.error("API error:", error.message);

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({
        success: false,
        message: "Co loi xu ly. Hay kiem tra terminal va MySQL."
    });
});

// ========================================
// 11. KHỞI ĐỘNG SERVER
// ========================================
app.listen(PORT, () => {
    console.log(
        `TOEIC Nova dang chay tai http://localhost:${PORT}`
    );
});
