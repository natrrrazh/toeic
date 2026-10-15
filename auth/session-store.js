const session = require("express-session");
const db = require("../db");

class MySQLSessionStore extends session.Store {
    constructor() {
        super();
    }

    get(sid, callback) {
        db.query(
            `SELECT session_data
             FROM user_sessions
             WHERE session_id = ?
               AND expires_at > UTC_TIMESTAMP()
             LIMIT 1`,
            [sid]
        )
        .then(([rows]) => {
            if (!rows.length) return callback(null, null);

            try {
                callback(null, JSON.parse(rows[0].session_data));
            } catch (error) {
                callback(error);
            }
        })
        .catch(callback);
    }

    set(sid, sessionData, callback = () => {}) {
        try {
            const expiresAt = sessionData.cookie?.expires
                ? new Date(sessionData.cookie.expires)
                : new Date(Date.now() + 24 * 60 * 60 * 1000);

            const formattedDate = expiresAt
                .toISOString()
                .slice(0, 19)
                .replace("T", " ");

            db.query(
                `INSERT INTO user_sessions
                 (session_id, expires_at, session_data)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    expires_at = VALUES(expires_at),
                    session_data = VALUES(session_data)`,
                [
                    sid,
                    formattedDate,
                    JSON.stringify(sessionData)
                ]
            )
            .then(() => callback(null))
            .catch(callback);
        } catch (error) {
            callback(error);
        }
    }

    destroy(sid, callback = () => {}) {
        db.query(
            "DELETE FROM user_sessions WHERE session_id = ?",
            [sid]
        )
        .then(() => callback(null))
        .catch(callback);
    }

    touch(sid, sessionData, callback = () => {}) {
        this.set(sid, sessionData, callback);
    }

    clearExpired() {
        return db.query(
            "DELETE FROM user_sessions WHERE expires_at <= UTC_TIMESTAMP()"
        );
    }
}

module.exports = MySQLSessionStore;