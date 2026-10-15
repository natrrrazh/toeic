const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db");

const router = express.Router();

// ========================================
// 1. DANG KY HOC SINH
// ========================================
router.post("/register", async (req, res, next) => {
    try {
        const { full_name, email, password } = req.body || {};

        if (
            typeof full_name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !full_name.trim() ||
            !email.trim() ||
            password.length < 8
        ) {
            return res.status(400).json({
                success: false,
                message: "Thông tin không hợp lệ. Mật khẩu cần ít nhất 8 ký tự."
            });
        }

        const name = full_name.trim();
        const normalizedEmail = email.trim().toLowerCase();

        if (
            name.length > 100 ||
            normalizedEmail.length > 150 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
            Buffer.byteLength(password, "utf8") > 72
        ) {
            return res.status(400).json({
                success: false,
                message: "Tên, email hoặc mật khẩu không hợp lệ."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const [result] = await db.query(
            "INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'student')",
            [name, normalizedEmail, passwordHash]
        );

        return res.status(201).json({
            success: true,
            message: "Đăng ký thành công.",
            user: {
                id: result.insertId,
                full_name: name,
                email: normalizedEmail,
                role: "student"
            }
        });

    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                success: false,
                message: "Email này đã được đăng ký."
            });
        }

        next(error);
    }
});

// ========================================
// 2. DANG NHAP
// ========================================
router.post("/login", async (req, res, next) => {
    try {
        const { email, password } = req.body || {};

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: "Email hoặc mật khẩu không hợp lệ."
            });
        }

        // SQL viet tren mot dong de tranh loi ky tu la
        const [rows] = await db.query(
            "SELECT id, full_name, email, password_hash, role FROM users WHERE email = ? LIMIT 1",
            [email.trim().toLowerCase()]
        );

        const user = rows[0];

        if (
            !user ||
            !(await bcrypt.compare(password, user.password_hash))
        ) {
            return res.status(401).json({
                success: false,
                message: "Email hoặc mật khẩu không đúng."
            });
        }

        // Tao session moi sau khi dang nhap
        req.session.regenerate((error) => {
            if (error) {
                return next(error);
            }

            req.session.userId = user.id;

            req.session.save((error) => {
                if (error) {
                    return next(error);
                }

                return res.json({
                    success: true,
                    message: "Đăng nhập thành công.",
                    user: {
                        id: user.id,
                        full_name: user.full_name,
                        email: user.email,
                        role: user.role
                    }
                });
            });
        });

    } catch (error) {
        next(error);
    }
});

// ========================================
// 3. THONG TIN TAI KHOAN
// ========================================
router.get("/me", async (req, res, next) => {
    try {
        if (!req.session?.userId) {
            return res.status(401).json({
                success: false,
                message: "Chưa đăng nhập."
            });
        }

        const [rows] = await db.query(
            "SELECT id, full_name, email, role FROM users WHERE id = ? LIMIT 1",
            [req.session.userId]
        );

        if (!rows.length) {
            return res.status(401).json({
                success: false,
                message: "Tài khoản không tồn tại."
            });
        }

        return res.json({
            success: true,
            user: rows[0]
        });

    } catch (error) {
        next(error);
    }
});

// ========================================
// 4. DANG XUAT
// ========================================
router.post("/logout", (req, res, next) => {
    if (!req.session) {
        return res.status(500).json({
            success: false,
            message: "Chưa cấu hình session."
        });
    }

    req.session.destroy((error) => {
        if (error) {
            return next(error);
        }

        res.clearCookie("toeic.sid", {
            path: "/"
        });

        return res.json({
            success: true,
            message: "Đăng xuất thành công."
        });
    });
});

module.exports = router;