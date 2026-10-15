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



// ========================================

// 5. FRONTEND

// ========================================

app.use(express.static(

    path.join(__dirname, "public")

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



// ========================================

// 15. API KHONG TON TAI

// ========================================

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

app.listen(PORT, () => {

    console.log(

        `TOEIC Nova dang chay tai http://localhost:${PORT}`

    );

});