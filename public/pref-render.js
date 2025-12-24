// pref-render.js
document.addEventListener("DOMContentLoaded", () => {
    const btnTimePref = document.getElementById("btnTimePref");
    const prefContainer = document.getElementById("pref-container");
    const btnGenerate = document.getElementById("btn-generate");
    const btnPreview = document.getElementById("btnPreview");
    const btnGurobi = document.getElementById("btnGurobi");

    // Restore cached table data if available
    const cachedTableData = localStorage.getItem("tableData");
    if (cachedTableData) {
        try {
            const tableData = JSON.parse(cachedTableData);
            renderPreferenceTable(tableData);
        } catch (error) {
            console.error("Error restoring cached table data:", error);
        }
    }

    btnTimePref.addEventListener("click", async () => {
        const form = document.getElementById("mainForm");
        const formData = new FormData(form);

        // Clear old cache to prevent stale data
        localStorage.removeItem("tableData");
        console.log("🧹 Cleared old tableData cache");

        try {
            const response = await fetch("/api/timepref", {
                method: "POST",
                body: formData,
            });

            const data = await response.json();

            if (data.ok) {
                // Validate tableData structure
                const {
                    dosen,
                    days,
                    slots,
                    preferences,
                    jumlahHari,
                    jumlahSlot,
                } = data.tableData;
                const expectedTotalSlots = jumlahHari * jumlahSlot;

                console.log("📊 TableData received:");
                console.log(`  H (jumlahHari): ${jumlahHari}`);
                console.log(`  M (jumlahSlot): ${jumlahSlot}`);
                console.log(`  Expected total slots: ${expectedTotalSlots}`);
                console.log(`  Days array length: ${days.length}`);
                console.log(`  Slots array length: ${slots.length}`);
                console.log(`  Preferences length: ${preferences.length}`);
                if (preferences.length > 0) {
                    console.log(
                        `  Preferences[0] length: ${preferences[0].length}`
                    );
                }

                // Save tableData to localStorage for caching
                localStorage.setItem(
                    "tableData",
                    JSON.stringify(data.tableData)
                );
                renderPreferenceTable(data.tableData);
            } else {
                prefContainer.innerHTML = `<p>Error: ${data.error}</p>`;
            }
        } catch (error) {
            console.error("Error:", error);
            prefContainer.innerHTML = "<p>Gagal memuat tabel preferensi</p>";
        }
    });

    function renderPreferenceTable(tableData) {
        const { dosen, days, slots, preferences, jumlahHari, jumlahSlot } =
            tableData;
        const M = jumlahSlot || slots.length;
        const H = jumlahHari || days.length;

        console.log("=== Rendering Preference Table ===");
        console.log("Dosen count:", dosen.length);
        console.log("Days count:", days.length, "(H:", H, ")");
        console.log("Slots count:", slots.length, "(M:", M, ")");
        console.log("Expected total slots per dosen:", H * M);

        // Debug: Check each dosen's preferences with day breakdown
        preferences.forEach((pref, idx) => {
            const sum = pref.reduce((a, b) => a + b, 0);
            console.log(
                `Dosen ${idx} (${dosen[idx]}): ${sum} slots available out of ${pref.length}`
            );

            // Show per-day breakdown for first dosen
            if (idx === 0) {
                console.log(`  Per-day breakdown for ${dosen[idx]}:`);
                for (let d = 0; d < H; d++) {
                    const dayStart = d * M;
                    const dayEnd = dayStart + M;
                    const daySlots = pref.slice(dayStart, dayEnd);
                    const daySum = daySlots.reduce((a, b) => a + b, 0);
                    if (daySum > 0 || d < 3) {
                        console.log(
                            `    Day ${d + 1} [${dayStart}-${
                                dayEnd - 1
                            }]: [${daySlots.join(",")}] = ${daySum} slots`
                        );
                    }
                }
            }
        });

        // Store tableData globally for download functionality
        window.currentTableData = tableData;

        let html = '<table class="pref-table">';
        html += "<thead><tr><th>Dosen</th><th>Tanggal</th>";

        // Header untuk slot
        slots.forEach((slot, index) => {
            html += `<th>Slot ${index + 1}</th>`;
        });
        html += "</tr></thead><tbody>";

        // Baris untuk setiap dosen dan setiap hari
        dosen.forEach((dosenName, dosenIndex) => {
            days.forEach((day, dayIndex) => {
                if (dayIndex === 0) {
                    html += `<tr><td rowspan="${days.length}">${dosenName}</td><td class="tanggal" data-dosen-index="${dosenIndex}" data-day-index="${dayIndex}">${day}</td>`;
                } else {
                    html += `<tr><td class="tanggal" data-dosen-index="${dosenIndex}" data-day-index="${dayIndex}">${day}</td>`;
                }
                slots.forEach((slot, slotIndex) => {
                    const globalSlotIndex = dayIndex * slots.length + slotIndex;
                    const prefValue =
                        preferences[dosenIndex] &&
                        preferences[dosenIndex][globalSlotIndex];
                    const isChecked = prefValue == 1 ? "checked" : "";

                    // Debug first dosen's first day
                    if (dosenIndex === 0 && dayIndex === 0 && slotIndex < 3) {
                        console.log(
                            `Dosen 0, Day 0, Slot ${slotIndex}: globalIndex=${globalSlotIndex}, value=${prefValue}, checked=${isChecked}`
                        );
                    }

                    html += `<td><input type="checkbox" name="pref_${dosenIndex}_${globalSlotIndex}" ${isChecked}></td>`;
                });
                html += "</tr>";
            });
        });

        html += "</tbody></table>";
        prefContainer.innerHTML = html;

        // Add change event listener to all checkboxes to update cache
        const allCheckboxes = document.querySelectorAll(
            'input[type="checkbox"][name^="pref_"]'
        );
        allCheckboxes.forEach((checkbox) => {
            checkbox.addEventListener("change", updateTableDataCache);
        });

        // Add click event for tanggal cells
        const tanggalCells = document.querySelectorAll(".tanggal");
        tanggalCells.forEach((cell) => {
            cell.style.cursor = "pointer";
            cell.dataset.clickCount = "0";
            cell.addEventListener("click", () => {
                let count = parseInt(cell.dataset.clickCount) + 1;
                if (count > 3) count = 1;
                cell.dataset.clickCount = count.toString();
                const tr = cell.parentElement;
                const checkboxes = tr.querySelectorAll(
                    'input[type="checkbox"]'
                );
                const totalSlots = checkboxes.length;
                const halfSlot = Math.ceil(totalSlots / 2); // Setengah dari total slot (dibulatkan ke atas)

                checkboxes.forEach((cb, idx) => {
                    if (count === 1) {
                        // Slot pagi (setengah pertama)
                        cb.checked = idx < halfSlot;
                    } else if (count === 2) {
                        // Slot siang/sore (setengah kedua)
                        cb.checked = idx >= halfSlot;
                    } else if (count === 3) {
                        // Semua slot tersedia
                        cb.checked = true;
                    } else {
                        // Semua slot tidak tersedia
                        cb.checked = false;
                    }
                });
                // Update cache after bulk change
                updateTableDataCache();
            });
        });
    }

    // Function to update tableData cache with current checkbox values
    function updateTableDataCache() {
        if (!window.currentTableData) return;

        const checkboxes = document.querySelectorAll(
            'input[type="checkbox"][name^="pref_"]'
        );
        const preferences = {};

        checkboxes.forEach((cb) => {
            const [_, dosenIndex, slotIndex] = cb.name.split("_");
            if (!preferences[dosenIndex]) preferences[dosenIndex] = {};
            preferences[dosenIndex][slotIndex] = cb.checked ? 1 : 0;
        });

        // Convert preferences object to array format
        const prefArray = Object.keys(preferences).map((dosenIndex) => {
            const dosenPrefs = preferences[dosenIndex];
            const totalSlots =
                window.currentTableData.days.length *
                window.currentTableData.slots.length;
            const arr = [];
            for (let i = 0; i < totalSlots; i++) {
                arr.push(dosenPrefs[i.toString()] || 0);
            }
            return arr;
        });

        // Update tableData
        window.currentTableData.preferences = prefArray;
        localStorage.setItem(
            "tableData",
            JSON.stringify(window.currentTableData)
        );
    }

    btnGenerate.addEventListener("click", async () => {
        if (!window.currentTableData) {
            alert(
                "Silakan buat tabel preferensi terlebih dahulu dengan klik 'create timePref slot'"
            );
            return;
        }

        // Collect checked preferences from current table state
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        const preferences = {};

        checkboxes.forEach((cb) => {
            const name = cb.name; // pref_dosenIndex_slotIndex
            const [_, dosenIndex, slotIndex] = name.split("_");
            if (!preferences[dosenIndex]) preferences[dosenIndex] = {};
            preferences[dosenIndex][slotIndex] = cb.checked ? 1 : 0;
        });

        // Update tableData with current checkbox values before saving
        const updatedTableData = {
            ...window.currentTableData,
            preferences: Object.keys(preferences).map((dosenIndex) => {
                const dosenPrefs = preferences[dosenIndex];
                const totalSlots =
                    window.currentTableData.days.length *
                    window.currentTableData.slots.length;
                const prefArray = [];
                for (let i = 0; i < totalSlots; i++) {
                    prefArray.push(dosenPrefs[i.toString()] || 0);
                }
                return prefArray;
            }),
        };

        // Save updated tableData to localStorage
        localStorage.setItem("tableData", JSON.stringify(updatedTableData));
        window.currentTableData = updatedTableData;

        // Get form data
        const form = document.getElementById("mainForm");
        const formData = new FormData(form);
        formData.append("preferences", JSON.stringify(preferences));

        // Send dosen names to server for CSV generation
        formData.append(
            "dosenNames",
            JSON.stringify(window.currentTableData.dosen)
        );

        // Save form inputs and preferences to localStorage
        const formInputs = {
            jumlahRuangan: formData.get("jumlahRuangan"),
            jumlahHari: formData.get("jumlahHari"),
            jumlahSlot: formData.get("jumlahSlot"),
            tanggalMulai: formData.get("tanggalMulai"),
            kapasitasRuangan: formData.get("kapasitasRuangan"),
            preferences: preferences,
        };
        localStorage.setItem("formInputs", JSON.stringify(formInputs));

        try {
            const response = await fetch("/api/generate", {
                method: "POST",
                body: formData,
            });

            const data = await response.json();

            if (data.ok) {
                // Save to localStorage and redirect
                localStorage.setItem(
                    "jadwalResult",
                    JSON.stringify(data.result)
                );
                window.location.href = "/penjadwalan_1";
            } else {
                alert("Error: " + data.error);
            }
        } catch (error) {
            console.error("Error:", error);
            alert("Gagal generate jadwal");
        }
    });

    btnPreview.addEventListener("click", () => {
        // Redirect to home2
        window.location.href = "/home_2";
    });

    btnGurobi.addEventListener("click", () => {
        // Redirect to penjadwalan3
        window.location.href = "/penjadwalan_3";
    });

    // Download preferences as CSV
    window.downloadPreferencesCSV = function () {
        if (!window.currentTableData) {
            alert(
                "Tidak ada data preferensi untuk diunduh. Silakan buat tabel terlebih dahulu."
            );
            return;
        }

        const { dosen } = window.currentTableData;

        // Build CSV content - format: "Nama Dosen",0,1,0,1,... (63 values)
        // Read current values from checkboxes in the table
        let csvContent = "";

        // Get all checkboxes and organize by dosen
        const checkboxes = document.querySelectorAll(
            'input[type="checkbox"][name^="pref_"]'
        );

        // Add one row per dosen with all their preference values
        dosen.forEach((dosenName, dosenIndex) => {
            let row = [`"${dosenName}"`];

            // Collect all checkbox values for this dosen (63 slots total)
            const dosenCheckboxes = Array.from(checkboxes).filter((cb) => {
                const [_, cbDosenIndex, __] = cb.name.split("_");
                return parseInt(cbDosenIndex) === dosenIndex;
            });

            // Sort by slot index to maintain order
            dosenCheckboxes.sort((a, b) => {
                const [_, __, slotA] = a.name.split("_");
                const [___, ____, slotB] = b.name.split("_");
                return parseInt(slotA) - parseInt(slotB);
            });

            // Add each checkbox value
            dosenCheckboxes.forEach((checkbox) => {
                row.push(checkbox.checked ? "1" : "0");
            });

            csvContent += row.join(",") + "\n";
        });

        // Create blob and download
        const blob = new Blob([csvContent], {
            type: "text/csv;charset=utf-8;",
        });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);

        link.setAttribute("href", url);
        link.setAttribute("download", "pref.csv");
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
});
