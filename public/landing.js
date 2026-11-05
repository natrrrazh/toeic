// =====================================
// TOEIC NOVA - LANDING PAGE
// =====================================

// Năm hiện tại
document.getElementById("year").textContent =
    new Date().getFullYear();


// =====================================
// COURSE FILTER
// =====================================

const filterButtons =
    document.querySelectorAll(".filter");

const courseCards =
    document.querySelectorAll(".course-card");


filterButtons.forEach(button => {

    button.addEventListener("click", () => {

        const selectedFilter =
            button.dataset.filter;

        // Cập nhật nút đang chọn
        filterButtons.forEach(btn => {
            btn.classList.remove("active");
        });

        button.classList.add("active");

        // Hiển thị khóa học phù hợp
        courseCards.forEach(card => {

            const courseType =
                card.dataset.kind;

            if (
                selectedFilter === "all" ||
                courseType === selectedFilter
            ) {
                card.hidden = false;
            } else {
                card.hidden = true;
            }

        });

    });

});