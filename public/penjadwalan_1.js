// penjadwalan.js
document.addEventListener("DOMContentLoaded", () => {
    const tblJadwal = document
        .getElementById("tblJadwal")
        .querySelector("tbody");
    const tblUnassigned = document
        .getElementById("tblUnassigned")
        .querySelector("tbody");
    const tblDosenTidakLengkap = document
        .getElementById("tblDosenTidakLengkap")
        .querySelector("tbody");
    const btnKembali = document.getElementById("btn-kembali");
    const btnSaveXlsx = document.getElementById("btn-save-xlsx");

    // Load data from localStorage
    const jadwalResult = localStorage.getItem("jadwalResult");
    if (!jadwalResult) {
        alert("Tidak ada data jadwal. Kembali ke halaman utama.");
        window.location.href = "/home_1";
        return;
    }

    const data = JSON.parse(jadwalResult);

    // Display Python logs in browser console if available
    if (data.pythonLogs) {
        console.log(
            "%c=== PYTHON GREEDY ALGORITHM LOGS ===",
            "color: green; font-weight: bold; font-size: 14px;"
        );
        console.log(data.pythonLogs);
        console.log(
            "%c=== END OF PYTHON LOGS ===",
            "color: green; font-weight: bold; font-size: 14px;"
        );
    }

    const rows = Array.isArray(data.table) ? data.table : [];
    const unassigned = Array.isArray(data.unassigned_table)
        ? data.unassigned_table
        : [];
    const stats = data.statistics || {};
    const sortedLecturers = data.sorted_lecturers || [];

    // Render statistics from Python output
    renderStatistics(stats);

    // Render lecturer tables from Python output
    renderLecturerTables(stats);

    // Render sorted lecturers
    renderSortedLecturers(sortedLecturers);

    // Render assigned table
    rows.forEach((row) => {
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
        tblJadwal.appendChild(tr);
    });

    // Render unassigned table
    unassigned.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${row.NIM || "-"}</td>
            <td>${row.Nama || "-"}</td>
            <td>${row.Type || "-"}</td>
            <td>${row.Pembimbing || "-"}</td>
            <td>${row["Alasan Unassigned"] || "-"}</td>
            <td>${row["Time Preference"] || "-"}</td>
        `;
        tblUnassigned.appendChild(tr);
    });

    // Function to render statistics (data from Python)
    function renderStatistics(stats) {
        document.getElementById("stat-slots").textContent =
            stats.slotsUsed || 0;
        document.getElementById("stat-days").textContent = stats.daysUsed || 0;
        document.getElementById("stat-students-assigned").textContent =
            stats.studentsAssigned || 0;
        document.getElementById("stat-students-unassigned").textContent =
            stats.studentsUnassigned || 0;
        document.getElementById("stat-dosen-complete").textContent =
            stats.lecturersComplete || 0;
        document.getElementById("stat-dosen-unassigned").textContent =
            stats.lecturersIncomplete || 0;
    }

    // Function to render lecturer tables (data from Python)
    function renderLecturerTables(stats) {
        const incompleteLecturers = stats.incompleteLecturers || [];

        // Render incomplete lecturers only
        incompleteLecturers.forEach((lecturer, index) => {
            const totalStudents =
                lecturer.assignedCount + lecturer.unassignedCount;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>${lecturer.name}</td>
                <td>${totalStudents}</td>
                <td>${lecturer.assignedCount}</td>
            `;
            tblDosenTidakLengkap.appendChild(tr);
        });

        if (incompleteLecturers.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="4" style="text-align: center;">Semua dosen mahasiswanya lengkap terjadwal</td>`;
            tblDosenTidakLengkap.appendChild(tr);
        }
    }

    // Function to render sorted lecturers
    function renderSortedLecturers(lecturers) {
        const tblUrutanDosen = document
            .getElementById("tblUrutanDosen")
            .querySelector("tbody");

        if (lecturers && lecturers.length > 0) {
            lecturers.forEach((lecturer, index) => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${lecturer}</td>
                `;
                tblUrutanDosen.appendChild(tr);
            });
        } else {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="2" style="text-align: center;">Tidak ada data urutan dosen</td>`;
            tblUrutanDosen.appendChild(tr);
        }
    }

    // Button handlers
    btnKembali.addEventListener("click", (e) => {
        e.preventDefault();
        // Don't clear jadwalResult - keep it for potential future reference
        // Don't clear formInputs or tableData - they will be restored on home page
        window.location.assign("/home_1");
    });

    btnSaveXlsx.addEventListener("click", () => {
        // Create XLSX with multiple sheets using json_to_sheet for better data handling
        const wb = XLSX.utils.book_new();

        // Sheet for assigned
        const assignedData = rows.map((row) => ({
            Hari: row.Hari || "-",
            Slot: row.Slot || "-",
            Ruangan: row.Ruangan || "-",
            NIM: row.NIM || "-",
            Nama: row.Nama || "-",
            Type: row.Type || "-",
            Pembimbing: row.Pembimbing || "-",
            "Dosen yang Hadir": row["Dosen yang Hadir"] || "-",
        }));
        const wsAssigned = XLSX.utils.json_to_sheet(assignedData);
        XLSX.utils.book_append_sheet(wb, wsAssigned, "Jadwal");

        // Sheet for RAW - with 0-based indices
        // Extract slot count from formInputs if available, default to 7
        const formInputs = localStorage.getItem("formInputs");
        let slotCount = 7; // default
        if (formInputs) {
            const inputs = JSON.parse(formInputs);
            slotCount = inputs.slotPerHari || 7;
        }

        const rawData = rows
            .filter((row) => row.NIM !== "-") // Only include actual scheduled students
            .map((row) => {
                // Parse day index from "Hari ke-X" format
                const hariMatch = row.Hari.match(/Hari ke-(\d+)/);
                const dayIndex = hariMatch ? parseInt(hariMatch[1]) - 1 : 0;

                // Parse slot index from slot time or label
                let slotIndex = 0;
                const slotStr = row.Slot || "";
                const slotTimeMap = {
                    "08:00-09:00": 0,
                    "09:00-10:00": 1,
                    "10:00-11:00": 2,
                    "11:00-12:00": 3,
                    "13:00-14:00": 4,
                    "14:00-15:00": 5,
                    "15:00-16:00": 6,
                };
                if (slotTimeMap[slotStr] !== undefined) {
                    slotIndex = slotTimeMap[slotStr];
                } else {
                    // Try to parse "Slot X" format
                    const slotMatch = slotStr.match(/Slot (\d+)/);
                    slotIndex = slotMatch ? parseInt(slotMatch[1]) - 1 : 0;
                }

                // Parse room index from "R1", "R2", etc.
                const ruangMatch = row.Ruangan.match(/R(\d+)/);
                const roomIndex = ruangMatch ? parseInt(ruangMatch[1]) - 1 : 0;

                return {
                    "hari ke-": dayIndex,
                    "slot ke-": slotIndex,
                    "ruangan ke-": roomIndex,
                    NAMA: row.Nama || "-",
                    NIM: row.NIM || "-",
                    MBKM: row.Type || "-",
                    PEMBIMBING: row.Pembimbing || "-",
                    "Dosen yang hadir": row["Dosen yang Hadir"] || "-",
                };
            });

        const wsRaw = XLSX.utils.json_to_sheet(rawData);
        XLSX.utils.book_append_sheet(wb, wsRaw, "RAW");

        // Sheet for unassigned
        const unassignedData = unassigned.map((row) => ({
            NIM: row.NIM || "-",
            Nama: row.Nama || "-",
            Type: row.Type || "-",
            Pembimbing: row.Pembimbing || "-",
            "Alasan Unassigned": row["Alasan Unassigned"] || "-",
            "Time Preference": row["Time Preference"] || "-",
        }));
        const wsUnassigned = XLSX.utils.json_to_sheet(unassignedData);
        XLSX.utils.book_append_sheet(wb, wsUnassigned, "Tidak Terjadwal");

        // Sheet for statistics
        const statisticsData = [
            {
                Keterangan: "Jumlah Slot yang Dipakai",
                Nilai: stats.slotsUsed || 0,
            },
            { Keterangan: "Jumlah Hari", Nilai: stats.daysUsed || 0 },
            {
                Keterangan: "Jumlah Mahasiswa Terjadwal",
                Nilai: stats.studentsAssigned || 0,
            },
            {
                Keterangan: "Jumlah Mahasiswa Tidak Terjadwal",
                Nilai: stats.studentsUnassigned || 0,
            },
            {
                Keterangan: "Jumlah Dosen Lengkap Terjadwal",
                Nilai: stats.lecturersComplete || 0,
            },
            {
                Keterangan: "Jumlah Dosen Tidak Terjadwal",
                Nilai: stats.lecturersIncomplete || 0,
            },
        ];
        const wsStatistics = XLSX.utils.json_to_sheet(statisticsData);
        XLSX.utils.book_append_sheet(wb, wsStatistics, "Statistik");

        // Sheet for sorted lecturers
        if (sortedLecturers && sortedLecturers.length > 0) {
            const sortedLecturersData = sortedLecturers.map((lec, idx) => ({
                No: idx + 1,
                "Nama Dosen": lec,
            }));
            const wsSortedLecturers =
                XLSX.utils.json_to_sheet(sortedLecturersData);
            XLSX.utils.book_append_sheet(wb, wsSortedLecturers, "Urutan Dosen");
        }

        // Sheet for incomplete lecturers
        const incompleteLecturersData = (stats.incompleteLecturers || []).map(
            (lec, idx) => ({
                No: idx + 1,
                "Nama Dosen": lec.name,
                "Total Mahasiswa": lec.assignedCount + lec.unassignedCount,
                "Mahasiswa Terjadwal": lec.assignedCount,
            })
        );
        const wsIncompleteLecturers = XLSX.utils.json_to_sheet(
            incompleteLecturersData
        );
        XLSX.utils.book_append_sheet(
            wb,
            wsIncompleteLecturers,
            "Dosen Tidak Lengkap"
        );

        XLSX.writeFile(wb, "hasil_penjadwalan.xlsx");
    });
});
