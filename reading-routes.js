const express = require("express");
const crypto = require("node:crypto");

const router = express.Router();

// Lưu bài và đáp án ở backend, không gửi đáp án trước khi nộp
const readingTests = new Map();
const TIME_LIMIT = 30 * 60 * 1000;

const OPTIONS = ["A", "B", "C", "D"];

// Tạo bài Reading bằng n8n
router.post("/generate", async (req, res) => {
  try {
    const { topic = "Office", level = "Beginner" } = req.body;
    const count = 3;

if (
  typeof topic !== "string" ||
  !topic.trim() ||
  topic.length > 100 ||
  !["Beginner", "Intermediate", "Advanced"].includes(level)
) {
      return res.status(400).json({
        success: false,
        message: "Thông số bài Reading không hợp lệ"
      });
    }

    const webhook = process.env.N8N_READING_WEBHOOK_URL;

    if (!webhook) {
      return res.status(500).json({
        success: false,
        message: "Chưa cấu hình webhook n8n"
      });
    }

    const response = await fetch(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ topic, level, count }),
      signal: AbortSignal.timeout(120000)
    });

    if (!response.ok) {
      throw new Error("n8n HTTP " + response.status);
    }

    const result = await response.json();

    if (result.success === false) {
      throw new Error(result.message || "n8n trả về lỗi");
    }

    const reading = result.reading || result;

    // Kiểm tra dữ liệu AI
    if (
      !reading.passage ||
      !Array.isArray(reading.questions) ||
      reading.questions.length !== count ||
      !reading.questions.every(q =>
        q.question &&
        OPTIONS.includes(q.answer) &&
        OPTIONS.every(key => q.options?.[key]) &&
        typeof q.explanation === "string" &&
        typeof q.evidence === "string"
      )
    ) {
      throw new Error("AI trả về bài đọc không hợp lệ");
    }

    const attemptId = crypto.randomUUID();

    readingTests.set(attemptId, {
      reading,
      userId: req.session?.userId || null,
      createdAt: Date.now()
    });

    // Chỉ gửi câu hỏi và lựa chọn xuống trình duyệt
    const questions = reading.questions.map((q, index) => ({
      id: index + 1,
      question: q.question,
      options: q.options
    }));

    return res.json({
      success: true,
      data: {
        attemptId,
        title: reading.title,
        passage: reading.passage,
        questions
      }
    });

  } catch (error) {
    console.error("Reading AI:", error.message);

    return res.status(502).json({
      success: false,
      message: "Không tạo được bài Reading. Kiểm tra n8n và Gemini."
    });
  }
});

// Chấm bài Reading
router.post("/submit", (req, res) => {
  const { attemptId, answers } = req.body;

  const test = readingTests.get(attemptId);

  if (!test) {
    return res.status(404).json({
      success: false,
      message: "Không tìm thấy bài Reading"
    });
  }

  if (Date.now() - test.createdAt > TIME_LIMIT) {
    readingTests.delete(attemptId);

    return res.status(410).json({
      success: false,
      message: "Bài Reading đã hết hạn"
    });
  }

  if (test.userId !== (req.session?.userId || null)) {
    return res.status(403).json({
      success: false,
      message: "Bạn không có quyền nộp bài này"
    });
  }

  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return res.status(400).json({
      success: false,
      message: "Dữ liệu câu trả lời không hợp lệ"
    });
  }

  const reading = test.reading;
  let score = 0;

  const details = reading.questions.map((q, index) => {
    const selected = answers[String(index + 1)] || null;
    const correct = selected === q.answer;

    if (correct) score++;

    return {
      id: index + 1,
      selected,
      answer: q.answer,
      correct,
      explanation: q.explanation,
      evidence: q.evidence,
      wrongOptions: q.wrongOptions || {}
    };
  });

  // Không cho chấm lại cùng một đề
  readingTests.delete(attemptId);

  return res.json({
    success: true,
    data: {
      score,
      total: reading.questions.length,
      details,
      translation: reading.translation || "",
      vocabulary: reading.vocabulary || []
    }
  });
});

module.exports = router;