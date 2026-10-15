const express = require("express");
const db = require("../db");
const requireAdmin = require("../auth/require-admin");

const router = express.Router();

// Tat ca API ben duoi deu yeu cau quyen admin
router.use(requireAdmin);

// Thong ke tong quan
router.get("/stats", async (req, res, next) => {
    try {
        const [[users]] = await db.query(`
            SELECT
                COUNT(*) AS totalUsers,
                SUM(role = 'student') AS totalStudents,
                SUM(role = 'teacher') AS totalTeachers,
                SUM(role = 'admin') AS totalAdmins
            FROM users
        `);

        const [[vocabulary]] = await db.query(`
            SELECT COUNT(*) AS totalVocabulary
            FROM vocabulary
        `);

        const [[lessons]] = await db.query(`
            SELECT COUNT(*) AS totalLessons
            FROM lessons
        `);

        const [[questions]] = await db.query(`
            SELECT COUNT(*) AS totalQuestions
            FROM quiz_questions
        `);

        res.json({
            success: true,
            data: {
                totalUsers: Number(users.totalUsers || 0),
                totalStudents: Number(users.totalStudents || 0),
                totalTeachers: Number(users.totalTeachers || 0),
                totalAdmins: Number(users.totalAdmins || 0),
                totalVocabulary: Number(vocabulary.totalVocabulary || 0),
                totalLessons: Number(lessons.totalLessons || 0),
                totalQuestions: Number(questions.totalQuestions || 0)
            }
        });
    } catch (error) {
        next(error);
    }
});

// Danh sach tai khoan
router.get("/users", async (req, res, next) => {
    try {
        const [rows] = await db.query(`
            SELECT id, full_name, email, role, created_at
            FROM users
            ORDER BY id DESC
            LIMIT 100
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

// Chi tiet mot tai khoan
router.get("/users/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({
                success: false,
                message: "ID không hợp lệ."
            });
        }

        const [rows] = await db.query(
            `SELECT id, full_name, email, role, created_at
             FROM users
             WHERE id = ?
             LIMIT 1`,
            [id]
        );

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy tài khoản."
            });
        }

        res.json({
            success: true,
            data: rows[0]
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;