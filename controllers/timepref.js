import XLSX from "xlsx";
import fs from "fs";
import path from "path";

// --- helper kecil ---
function normalizeName(s) {
    return (s || "").toString().toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Ekstrak kata-kata signifikan dari nama dosen (tanpa gelar)
 * @param {string} fullName - Nama lengkap dosen dengan gelar
 * @returns {Array<string>} - Array kata-kata signifikan (lowercase)
 */
function extractSignificantTokens(fullName) {
    // Daftar gelar yang akan diabaikan
    const gelar = [
        "dr",
        "ir",
        "prof",
        "s.kom",
        "mt",
        "m.sc",
        "mmsi",
        "m.psi",
        "ph.d",
        "pe",
        "m.asce",
        "m.eng",
        "st",
        "m.kom",
        "mti",
        "s.si",
        "dra",
        "mm",
        "ing",
    ];

    const normalized = normalizeName(fullName);
    // Pisahkan berdasarkan spasi dan tanda koma
    const tokens = normalized
        .replace(/[,.\(\)]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 0);

    // Filter token yang bukan gelar dan memiliki panjang > 1
    const significant = tokens.filter((token) => {
        return !gelar.includes(token) && token.length > 1;
    });

    return significant;
}

/**
 * Build name map untuk matching cepat
 * Membuat mapping dari setiap token signifikan ke nama lengkap
 * @param {Array<string>} dosenList - Array nama lengkap dosen
 * @returns {Object} - Map dari token ke nama lengkap
 */
function buildNameMap(dosenList) {
    const nameMap = {};

    for (const fullName of dosenList) {
        const tokens = extractSignificantTokens(fullName);

        // Map setiap token ke nama lengkap
        for (const token of tokens) {
            if (!nameMap[token]) {
                nameMap[token] = fullName;
            }
        }

        // Juga map kombinasi 2 kata berurutan untuk nama lengkap yang lebih spesifik
        for (let i = 0; i < tokens.length - 1; i++) {
            const combo = tokens[i] + " " + tokens[i + 1];
            if (!nameMap[combo]) {
                nameMap[combo] = fullName;
            }
        }
    }

    return nameMap;
}

/**
 * Match input name dengan daftar nama lengkap dosen
 * @param {string} inputName - Nama input (bisa singkat atau dengan variasi gelar)
 * @param {Object} nameMap - Map dari token ke nama lengkap (hasil buildNameMap)
 * @returns {string|null} - Nama lengkap yang cocok atau null
 */
function matchDosenName(inputName, nameMap) {
    const cleanInput = normalizeName(inputName);

    // 1️⃣ Cek exact match dulu (kalau input sudah lengkap)
    for (const [token, fullName] of Object.entries(nameMap)) {
        if (normalizeName(fullName) === cleanInput) {
            return fullName;
        }
    }

    // 2️⃣ Ekstrak token signifikan dari input
    const inputTokens = extractSignificantTokens(inputName);

    // 3️⃣ Cek setiap token langsung
    for (const token of inputTokens) {
        if (nameMap[token]) {
            return nameMap[token];
        }
    }

    // 4️⃣ Cek kombinasi 2 token berurutan
    for (let i = 0; i < inputTokens.length - 1; i++) {
        const combo = inputTokens[i] + " " + inputTokens[i + 1];
        if (nameMap[combo]) {
            return nameMap[combo];
        }
    }

    // 5️⃣ Cek kombinasi 3 token (untuk nama panjang seperti "jap tji beng")
    for (let i = 0; i < inputTokens.length - 2; i++) {
        const combo =
            inputTokens[i] +
            " " +
            inputTokens[i + 1] +
            " " +
            inputTokens[i + 2];
        if (nameMap[combo]) {
            return nameMap[combo];
        }
    }

    // 6️⃣ Fallback: cek apakah semua token input ada di salah satu nama lengkap
    for (const [_, fullName] of Object.entries(nameMap)) {
        const fullTokens = extractSignificantTokens(fullName);
        const allTokensMatch = inputTokens.every((inputToken) =>
            fullTokens.some(
                (fullToken) =>
                    fullToken.includes(inputToken) ||
                    inputToken.includes(fullToken)
            )
        );

        if (allTokensMatch && inputTokens.length > 0) {
            return fullName;
        }
    }

    return null;
}

// --- helper kecil ---

function parseCsvFlexible(raw) {
    // Simple CSV parser that handles quoted fields
    let text = raw
        .replace(/^\uFEFF/, "")
        .replace(/\r/g, "")
        .trim();
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];

    const rows = [];
    for (const line of lines) {
        const row = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"'; // escaped quote
                    i++; // skip next
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === "," && !inQuotes) {
                row.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
        row.push(current.trim());
        rows.push(row);
    }

    // Skip header if looks like header
    const looksLikeHeader =
        rows.length > 1 && rows[0].slice(1).some((x) => !/^[01]$/.test(x));
    return looksLikeHeader ? rows.slice(1) : rows;
}

/**
 * Parse tanggalMulai dari berbagai format yang mungkin dikirim oleh client.
 * Jika parsing gagal, kembalikan null.
 * Mendukung:
 * - ISO (YYYY-MM-DD atau full ISO)
 * - dd/mm/YYYY atau d/m/YY
 * - timestamp (number/string)
 */
function parseDateFlexible(raw) {
    if (!raw && raw !== 0) return null;
    // if already Date
    if (raw instanceof Date) {
        return isNaN(raw.getTime()) ? null : raw;
    }

    const s = String(raw).trim();

    // numeric timestamp
    if (/^-?\d+$/.test(s)) {
        const t = new Date(Number(s));
        return isNaN(t.getTime()) ? null : t;
    }

    // dd/mm/yyyy or d/m/yy
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
        const parts = s.split("/").map((p) => parseInt(p, 10));
        const day = parts[0];
        const month = parts[1] - 1;
        let year = parts[2];
        if (year < 100) year += year < 70 ? 2000 : 1900; // two-digit year heuristic
        const d = new Date(year, month, day);
        return isNaN(d.getTime()) ? null : d;
    }

    // try Date.parse for ISO-like strings
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

export function buildTimePref(req, res) {
    try {
        const {
            jumlahRuangan,
            jumlahHari,
            jumlahSlot,
            tanggalMulai,
            kapasitasRuangan,
        } = req.body;

        if (!req.files || !req.files.fileMahasiswa) {
            return res.status(400).json({ error: "File mahasiswa diperlukan" });
        }

        const mahasiswaPath = path.join(process.cwd(), "uploads", "stu.xlsx");
        fs.renameSync(req.files.fileMahasiswa[0].path, mahasiswaPath);

        let preferensiPath = null;
        if (req.files.filePreferensi) {
            preferensiPath = path.join(process.cwd(), "uploads", "pref.csv");
            fs.renameSync(req.files.filePreferensi[0].path, preferensiPath);
        }

        // --- baca xlsx mahasiswa, bentuk urutan dosen (PB) ---
        const wb = XLSX.readFile(mahasiswaPath);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws);

        // propagate PEMBIMBING ke baris kosong di bawahnya (pattern sering seperti ini)
        let currPB = null;
        const pb_list = [];
        const stu_df_copy = data.map((row) => {
            const r = { ...row };
            if (r.PEMBIMBING && r.PEMBIMBING.toString().trim()) {
                currPB = r.PEMBIMBING;
            } else {
                r.PEMBIMBING = currPB;
            }
            pb_list.push(r.PEMBIMBING);
            return r;
        });

        const unique_pb = [...new Set(pb_list.filter(Boolean))];

        // Build name map dari nama dosen yang ada di Excel (bukan hardcoded)
        const nameMap = buildNameMap(unique_pb);

        // Gunakan nama dosen dari Excel langsung (tidak perlu normalisasi ke daftar hardcoded)
        const dosenList = unique_pb.map((pbName) => {
            // Validasi bahwa nama tidak kosong
            if (!pbName || !pbName.toString().trim()) {
                console.log(`⚠️  Dosen dengan nama kosong ditemukan`);
                return "Unknown Lecturer";
            }
            return pbName.toString().trim();
        });

        const M = parseInt(jumlahSlot) || 7; // slot per hari
        const H = parseInt(jumlahHari) || 9; // jumlah hari
        const totalSlots = M * H; // 63

        // Generate slot array berdasarkan jumlah M
        const allPossibleSlots = [
            "08:00-09:00",
            "09:00-10:00",
            "10:00-11:00",
            "11:00-12:00",
            "13:00-14:00",
            "14:00-15:00",
            "15:00-16:00",
            "16:00-17:00",
            "17:00-18:00",
            "18:00-19:00",
        ];
        const slots = allPossibleSlots.slice(0, M);

        // mapping nama dosen -> index PB (berdasarkan urutan dosenList)
        const pembimbing_to_pb = {};
        dosenList.forEach((pb, idx) => {
            pembimbing_to_pb[normalizeName(pb)] = idx;
        });

        // --- baca CSV preferensi (kalau ada) ---
        let prefData = []; // array 2D: [dosen][0..totalSlots-1] angka 0/1
        if (preferensiPath && fs.existsSync(preferensiPath)) {
            const raw = fs.readFileSync(preferensiPath, "utf8");
            const rows = parseCsvFlexible(raw); // tiap row: [nama, s1, s2, ...]
            // tampung preferensi yang berhasil dipetakan
            const tmp = new Array(dosenList.length)
                .fill(0)
                .map(() => new Array(totalSlots).fill(0));

            for (const r of rows) {
                if (!r.length) continue;
                const inputName = r[0];

                // Coba matching dengan dosenList yang ada
                const matchedName = matchDosenName(inputName, nameMap);

                if (!matchedName) {
                    console.log(
                        `❌ Tidak ada match untuk CSV nama: "${inputName}"`
                    );
                    console.log(
                        `   Available lecturers in Excel:`,
                        dosenList.slice(0, 3).join(", "),
                        "..."
                    );
                    continue;
                }

                // Cari index PB dari nama yang cocok di dosenList
                const pbIdx = dosenList.findIndex(
                    (dosen) =>
                        normalizeName(dosen) === normalizeName(matchedName)
                );

                if (pbIdx === -1) {
                    console.log(
                        `⚠️  Match ditemukan tapi tidak ada di dosenList:`
                    );
                    console.log(
                        `   CSV: "${inputName}" -> Matched: "${matchedName}"`
                    );
                    console.log(`   DosenList length: ${dosenList.length}`);
                    continue;
                }

                console.log(
                    `✅ Match berhasil: "${inputName}" -> "${matchedName}" (Index: ${pbIdx})`
                );

                // Ambil slot dari CSV
                const rawSlots = r
                    .slice(1)
                    .map((x) => (x === "1" || x === 1 ? 1 : 0));

                console.log(
                    `   Raw slots count: ${
                        rawSlots.length
                    }, Sum: ${rawSlots.reduce((a, b) => a + b, 0)}`
                );

                // Deteksi H dan M dari CSV berdasarkan jumlah kolom
                // Coba beberapa kombinasi umum: (H, M)
                const csvTotalSlots = rawSlots.length;
                const possibleConfigs = [
                    { H: 9, M: 7 }, // 63 slots (most common)
                    { H: 7, M: 7 }, // 49 slots
                    { H: 5, M: 7 }, // 35 slots
                    { H: 10, M: 7 }, // 70 slots
                    { H: 9, M: 8 }, // 72 slots
                    { H: 8, M: 9 }, // 72 slots
                    { H: 8, M: 8 }, // 64 slots
                    { H: 6, M: 7 }, // 42 slots
                    { H: 4, M: 7 }, // 28 slots
                ];

                let csvH = H;
                let csvM = M;

                // Cari konfigurasi yang pas dengan prioritas
                let foundMatch = false;
                for (const config of possibleConfigs) {
                    if (config.H * config.M === csvTotalSlots) {
                        csvH = config.H;
                        csvM = config.M;
                        foundMatch = true;
                        break;
                    }
                }

                // Jika tidak ada match, gunakan current H dan hitung M
                if (!foundMatch) {
                    csvH = H;
                    csvM = Math.floor(csvTotalSlots / H) || M;
                    console.log(
                        `   [WARNING] No exact config match for ${csvTotalSlots} slots, using calculated H=${csvH}, M=${csvM}`
                    );
                }

                console.log(
                    `   CSV detected: H=${csvH}, M=${csvM} (${
                        csvH * csvM
                    } slots) | Current: H=${H}, M=${M} (${totalSlots} slots)`
                );

                // Jika M dari CSV sama dengan M sekarang DAN H juga sama, langsung copy
                if (csvM === M && csvH === H) {
                    const fixed =
                        rawSlots.length >= totalSlots
                            ? rawSlots.slice(0, totalSlots)
                            : rawSlots.concat(
                                  new Array(totalSlots - rawSlots.length).fill(
                                      0
                                  )
                              );
                    tmp[pbIdx] = fixed;
                    console.log(`   [OK] Direct copy (same H and M)`);
                } else {
                    // H atau M berbeda, perlu konversi per hari
                    console.log(
                        `   [!] Converting from (H=${csvH}, M=${csvM}) to (H=${H}, M=${M})`
                    );
                    console.log(
                        `   [!] CSV has ${csvTotalSlots} slots, target has ${totalSlots} slots`
                    );
                    const converted = new Array(totalSlots).fill(0);

                    // Gunakan H yang lebih kecil untuk menghindari index out of bounds
                    const daysToProcess = Math.min(csvH, H);
                    console.log(
                        `   [!] Processing ${daysToProcess} days (min of CSV days ${csvH} and target days ${H})`
                    );

                    for (let day = 0; day < daysToProcess; day++) {
                        // Ambil data hari ini dari CSV (dengan csvM slots)
                        const csvDayStart = day * csvM;
                        const csvDayEnd = Math.min(
                            csvDayStart + csvM,
                            rawSlots.length
                        );
                        const csvDaySlots = rawSlots.slice(
                            csvDayStart,
                            csvDayEnd
                        );

                        // Tulis ke posisi hari ini di array baru (dengan M slots)
                        const newDayStart = day * M;
                        const slotsToCopy = Math.min(csvDaySlots.length, M);

                        for (let s = 0; s < slotsToCopy; s++) {
                            const csvValue = csvDaySlots[s];
                            converted[newDayStart + s] =
                                csvValue === 1 || csvValue === "1" ? 1 : 0;
                        }

                        // Debug log for days with available slots
                        const daySum = csvDaySlots
                            .slice(0, slotsToCopy)
                            .reduce((a, b) => (a || 0) + (b || 0), 0);
                        if (daySum > 0) {
                            console.log(
                                `      Day ${
                                    day + 1
                                }: copied ${daySum} slots from CSV[${csvDayStart}-${
                                    csvDayEnd - 1
                                }] to new[${newDayStart}-${
                                    newDayStart + slotsToCopy - 1
                                }]`
                            );
                            console.log(
                                `         CSV day slots: [${csvDaySlots
                                    .slice(0, slotsToCopy)
                                    .join(",")}]`
                            );
                            console.log(
                                `         New day slots: [${converted
                                    .slice(
                                        newDayStart,
                                        newDayStart + slotsToCopy
                                    )
                                    .join(",")}]`
                            );
                        }
                    }

                    const convertedSum = converted.reduce((a, b) => a + b, 0);
                    console.log(
                        `   [OK] Conversion complete: ${convertedSum} total slots available`
                    );

                    // Verify conversion by showing summary per day
                    console.log(
                        `   [VERIFY] Summary per day for converted array:`
                    );
                    for (let d = 0; d < H; d++) {
                        const dayStart = d * M;
                        const dayEnd = dayStart + M;
                        const daySlots = converted.slice(dayStart, dayEnd);
                        const daySum = daySlots.reduce((a, b) => a + b, 0);
                        if (daySum > 0 || d < 3) {
                            // Always show first 3 days
                            console.log(
                                `      Day ${d + 1} [${dayStart}-${
                                    dayEnd - 1
                                }]: ${daySum}/${M} slots = [${daySlots.join(
                                    ","
                                )}]`
                            );
                        }
                    }

                    tmp[pbIdx] = converted;
                }
            }
            prefData = tmp;
        } else {
            // jika tak ada file preferensi, default semua 0
            prefData = new Array(dosenList.length)
                .fill(0)
                .map(() => new Array(totalSlots).fill(0));
        }

        // Debug: Log prefData summary
        console.log("\n📋 PrefData Summary:");
        console.log(`Total dosen: ${prefData.length}`);
        for (let i = 0; i < prefData.length; i++) {
            const sum = prefData[i].reduce((a, b) => a + b, 0);
            console.log(
                `  Dosen ${i} (${dosenList[i]}): ${sum}/${totalSlots} slots available`
            );
        }
        console.log("");

        // label hari untuk UI (validasi tanggalMulai agar tidak menyebabkan
        // Date.toISOString RangeError saat input invalid)
        let startDate = parseDateFlexible(tanggalMulai);
        if (!startDate) {
            console.warn(
                `⚠️  tanggalMulai tidak valid atau kosong: "${tanggalMulai}". Menggunakan tanggal hari ini sebagai fallback.`
            );
            startDate = new Date();
        }

        const days = Array.from({ length: H }, (_, i) => {
            const date = new Date(startDate);
            date.setDate(startDate.getDate() + i);
            // guard: if date is invalid for some reason, fallback to ISO-safe string
            if (isNaN(date.getTime()))
                return new Date().toISOString().split("T")[0];
            return date.toISOString().split("T")[0]; // YYYY-MM-DD
        });

        const tableData = {
            dosen: dosenList,
            days,
            slots,
            preferences: prefData, // [n_dosen][63] -> angka 0/1
            jumlahRuangan: parseInt(jumlahRuangan) || 3,
            jumlahHari: H,
            jumlahSlot: M,
            tanggalMulai,
            kapasitasRuangan: parseInt(kapasitasRuangan) || 5,
        };

        return res.json({ ok: true, tableData });
    } catch (error) {
        console.error("Error in buildTimePref:", error);
        return res.status(500).json({ error: "Gagal memproses file" });
    }
}
