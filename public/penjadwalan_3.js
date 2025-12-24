// penjadwalan3.js
document.addEventListener("DOMContentLoaded", () => {
    const btnRunComparison = document.getElementById("btn-run-comparison");
    const btnKembali = document.getElementById("btn-kembali");

    // Load existing results on page load
    loadExistingResults();

    // Function to load existing results from JSON files
    async function loadExistingResults() {
        try {
            const response = await fetch("/api/comparison-results");
            const data = await response.json();

            if (data.ok && data.results) {
                populateComparisonTable(data.results);
                console.log("Loaded existing comparison results");
            } else {
                console.log("No existing results found");
            }
        } catch (error) {
            console.error("Error loading existing results:", error);
        }
    }

    btnRunComparison.addEventListener("click", async () => {
        // Get form data from localStorage (saved from home page)
        const savedData = localStorage.getItem("formInputs");
        if (!savedData) {
            alert(
                "Data form tidak ditemukan. Silakan isi form di halaman home terlebih dahulu."
            );
            window.location.href = "/home_1";
            return;
        }

        const formData = JSON.parse(savedData);

        try {
            // Show loading
            btnRunComparison.disabled = true;
            btnRunComparison.textContent = "Menjalankan perbandingan...";

            const response = await fetch("/api/compare", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(formData),
            });

            const data = await response.json();

            if (data.ok) {
                // Populate the table with results
                populateComparisonTable(data.results);

                // Log Gurobi outputs to console
                console.log("=== GUROBI OUTPUTS ===");
                data.results.forEach((result, index) => {
                    console.log(
                        `Sample ${result.sample} (Size: ${result.sampleSize}):`
                    );
                    console.log(result.gurobi.output);
                    console.log("---");
                });
            } else {
                alert("Error: " + data.error);
            }
        } catch (error) {
            console.error("Error:", error);
            alert("Gagal menjalankan perbandingan");
        } finally {
            // Reset button
            btnRunComparison.disabled = false;
            btnRunComparison.textContent = "Jalankan Perbandingan";
        }
    });

    btnKembali.addEventListener("click", () => {
        window.location.href = "/home_1";
    });

    function populateComparisonTable(results) {
        results.forEach((result, index) => {
            const sampleNum = index + 1;

            // Greedy results
            document.getElementById(`greedy-${sampleNum}-time`).textContent =
                result.greedy.time.toFixed(3) + "s";
            document.getElementById(
                `greedy-${sampleNum}-assigned`
            ).textContent = result.greedy.assigned;
            document.getElementById(
                `greedy-${sampleNum}-unassigned`
            ).textContent = result.greedy.unassigned;
            document.getElementById(
                `greedy-${sampleNum}-objective`
            ).textContent =
                result.greedy.objective !== undefined
                    ? result.greedy.objective.toFixed(2)
                    : "-";

            // Gurobi results
            document.getElementById(`gurobi-${sampleNum}-time`).textContent =
                result.gurobi.time.toFixed(3) + "s";
            document.getElementById(
                `gurobi-${sampleNum}-assigned`
            ).textContent = result.gurobi.assigned;
            document.getElementById(
                `gurobi-${sampleNum}-unassigned`
            ).textContent = result.gurobi.unassigned;
            document.getElementById(
                `gurobi-${sampleNum}-objective`
            ).textContent =
                result.gurobi.objective !== undefined
                    ? result.gurobi.objective.toFixed(2)
                    : "-";
        });
    }
});
