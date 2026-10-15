const db = require("../db");

// ========================================
// MIDDLEWARE KIEM TRA QUYEN ADMIN
// ========================================
async function requireAdmin(req, res, next) {
    try {
        // 1. Kiem tra nguoi dung da dang nhap chua
        if (!req.session?.userId) {
            console.log("ADMIN DEBUG: Chua dang nhap");

            return res.status(401).json({
                success: false,
                message: "Vui lòng đăng nhập."
            });
        }

        // 2. Lay thong tin tai khoan tu MySQL
        const [rows] = await db.query(
            "SELECT id, role FROM users WHERE id = ? LIMIT 1",
            [req.session.userId]
        );

        // 3. In thong tin de kiem tra loi
        console.log("ADMIN DEBUG:", {
            sessionUserId: req.session.userId,
            databaseUser: rows[0],
            roleValue: rows[0]?.role,
            roleLength: rows[0]?.role?.length,
            isAdmin: rows[0]?.role === "admin"
        });

        // 4. Kiem tra tai khoan co ton tai khong
        if (!rows.length) {
            return res.status(403).json({
                success: false,
                message: "Tài khoản không tồn tại hoặc không có quyền quản trị."
            });
        }

        // 5. Kiem tra quyen admin
        if (rows[0].role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Bạn không có quyền quản trị."
            });
        }

        // 6. Cho phep truy cap API Admin
        return next();

    } catch (error) {
        console.error("ADMIN MIDDLEWARE ERROR:", error);
        return next(error);
    }
}

module.exports = requireAdmin;