require("dotenv").config();

const db = require("../db");

async function main() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                session_id VARCHAR(128) NOT NULL PRIMARY KEY,
                expires_at DATETIME NOT NULL,
                session_data TEXT NOT NULL,
                INDEX idx_expires_at (expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        console.log("Da tao/kiem tra bang user_sessions thanh cong.");
    } catch (error) {
        console.error("Loi tao bang:", error.message);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
}

main();