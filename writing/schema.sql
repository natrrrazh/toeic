-- Run in the SAME database configured by db.js
CREATE TABLE IF NOT EXISTS writing_assignments (
 id INT AUTO_INCREMENT PRIMARY KEY,
 title VARCHAR(200) NOT NULL,
 prompt TEXT NOT NULL,
 min_words INT NOT NULL DEFAULT 50,
 max_words INT NOT NULL DEFAULT 300,
 deadline DATETIME NOT NULL,
 created_by INT NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_deadline (deadline)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS writing_submissions (
 id INT AUTO_INCREMENT PRIMARY KEY,
 assignment_id INT NOT NULL,
 user_id INT NOT NULL,
 image_path VARCHAR(255) NOT NULL,
 image_mime VARCHAR(30) NOT NULL,
 status ENUM('grading','graded','failed') NOT NULL DEFAULT 'grading',
 extracted_text MEDIUMTEXT NULL,
 score INT NULL,
 grammar_score INT NULL,
 vocabulary_score INT NULL,
 content_score INT NULL,
 organization_score INT NULL,
 feedback TEXT NULL,
 errors_json JSON NULL,
 submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 graded_at DATETIME NULL,
 UNIQUE KEY uq_assignment_user (assignment_id,user_id),
 INDEX idx_ranking (assignment_id,status,score,submitted_at),
 FOREIGN KEY (assignment_id) REFERENCES writing_assignments(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
