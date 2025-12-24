// penjadwalan2.js - Comparison of 3 configurations
document.addEventListener("DOMContentLoaded", () => {
    const btnKembali = document.getElementById("btn-kembali");
    const summaryTableBody = document.querySelector("#summaryTable tbody");

    // Load data from localStorage
    const comparisonResult = localStorage.getItem("comparisonResult");
    if (!comparisonResult) {
        alert("Tidak ada data perbandingan. Kembali ke halaman home2.");
        window.location.href = "/home_2";
        return;
    }

    const data = JSON.parse(comparisonResult);

    // Display Python logs in browser console if available for each config
    if (Array.isArray(data.results)) {
        data.results.forEach((config, index) => {
            if (config && config.pythonLogs) {
                console.log(
                    `%c=== CONFIG ${index + 1} - PYTHON GREEDY LOGS ===`,
                    "color: blue; font-weight: bold; font-size: 14px;"
                );
                console.log(config.pythonLogs);
                console.log(
                    `%c=== END CONFIG ${index + 1} LOGS ===`,
                    "color: blue; font-weight: bold; font-size: 14px;"
                );
            }
        });
    }

    const summaries = data.summaries || [];
    const tables = data.tables || [];

    console.log("Loaded comparison data:", data);

    // Render summary table
    summaries.forEach((summary, index) => {
        const successRate =
            summary.students > 0
                ? ((summary.assigned / summary.students) * 100).toFixed(1)
                : "0.0";

        const configInfo = summary.config
            ? `H=${summary.config.H}, M=${summary.config.M}, R=${summary.config.R}, C=${summary.config.C}`
            : "N/A";

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${summary.name}</strong></td>
            <td>${configInfo}</td>
            <td>${summary.slots}</td>
            <td>${summary.students}</td>
            <td>${summary.time ? summary.time.toFixed(3) : "0.000"}s</td>
            <td class="success">${summary.assigned}</td>
            <td class="error">${summary.unassigned}</td>
            <td>${
                summary.objective !== undefined
                    ? summary.objective.toFixed(2)
                    : "-"
            }</td>
        `;
        summaryTableBody.appendChild(tr);
    });

    // Render detail tables for each configuration
    tables.forEach((tableData, index) => {
        const configNum = index + 1;
        const assignedTableBody = document.querySelector(
            `#table${configNum}-assigned tbody`
        );
        const unassignedTableBody = document.querySelector(
            `#table${configNum}-unassigned tbody`
        );

        // Render assigned students
        if (tableData.assigned && tableData.assigned.length > 0) {
            tableData.assigned.forEach((row) => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${row.Hari || "-"}</td>
                    <td>${row.Slot || "-"}</td>
                    <td>${row.Ruangan || "-"}</td>
                    <td>${row.NIM || "-"}</td>
                    <td>${row.Nama || "-"}</td>
                    <td>${row.Type || "-"}</td>
                    <td>${row.Pembimbing || "-"}</td>
                    <td>${row["Dosen yang Hadir"] || "-"}</td>
                `;
                assignedTableBody.appendChild(tr);
            });
        } else {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="8" class="no-data">Tidak ada mahasiswa terjadwal</td>`;
            assignedTableBody.appendChild(tr);
        }

        // Render unassigned students
        if (tableData.unassigned && tableData.unassigned.length > 0) {
            tableData.unassigned.forEach((row) => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${row.NIM || "-"}</td>
                    <td>${row.Nama || "-"}</td>
                    <td>${row.Type || "-"}</td>
                    <td>${row.Pembimbing || "-"}</td>
                `;
                unassignedTableBody.appendChild(tr);
            });
        } else {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="4" class="no-data">Semua mahasiswa terjadwal</td>`;
            unassignedTableBody.appendChild(tr);
        }
    });

    // Tab switching functionality
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const tabId = btn.getAttribute("data-tab");

            // Remove active class from all tabs and contents
            tabButtons.forEach((b) => b.classList.remove("active"));
            tabContents.forEach((c) => c.classList.remove("active"));

            // Add active class to clicked tab and corresponding content
            btn.classList.add("active");
            document.getElementById(`tab-${tabId}`).classList.add("active");
        });
    });

    // Button handler
    btnKembali.addEventListener("click", () => {
        window.location.href = "/home_2";
    });
});
