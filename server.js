// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import XLSX from "xlsx";
import { buildTimePref } from "./controllers/timepref.js";
import fs from "fs";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// ===== body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
// ===== view engine =====
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ===== multer untuk file upload =====

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    },
});

const upload = multer({ storage: storage });

// ===== halaman utama =====
// FIXME: sementara saja
app.get("/", (req, res) => {
    // login, home, penjadwalan
    res.render("login", {
        title: "Optimasi Jadwal",
        year: new Date().getFullYear(),
        error: null,
    });
});

app.get("/login", (req, res) => {
    res.render("login", {
        title: "Login",
        year: new Date().getFullYear(),
        error: null,
    });
});

app.post("/login", (req, res) => {
    console.log("Body:", req.body);
    const { username, password } = req.body;
    console.log("Login attempt:", username, password);
    if (
        username &&
        password &&
        username.trim() === "1" &&
        password.trim() === "1"
    ) {
        console.log("Login successful, redirecting to /");
        res.render("home_1", {
            title: "Home",
            year: new Date().getFullYear(),
        });
    } else {
        console.log("Login failed");
        res.render("login", {
            title: "Login",
            year: new Date().getFullYear(),
            error: "Invalid username or password",
        });
    }
});

app.get("/penjadwalan_1", (req, res) => {
    res.render("penjadwalan_1", {
        title: "Hasil Penjadwalan",
        year: new Date().getFullYear(),
    });
});

// ===== halaman home =====
app.get("/home_1", (req, res) => {
    res.render("home_1", {
        title: "Home",
        year: new Date().getFullYear(),
    });
});

// ===== halaman home2 =====
app.get("/home_2", (req, res) => {
    res.render("home_2", {
        title: "Home 2",
        year: new Date().getFullYear(),
    });
});

// ===== halaman penjadwalan2 =====
app.get("/penjadwalan_2", (req, res) => {
    res.render("penjadwalan_2", {
        title: "Penjadwalan 2",
        year: new Date().getFullYear(),
    });
});

// ===== halaman penjadwalan3 =====
app.get("/penjadwalan_3", (req, res) => {
    res.render("penjadwalan_3", {
        title: "Penjadwalan 3",
        year: new Date().getFullYear(),
    });
});

// ===== API to get comparison results from JSON files =====
app.get("/api/comparison-results", (req, res) => {
    try {
        const greedyPath = path.join(process.cwd(), "hasil_sampel_greedy.json");
        const gurobiPath = path.join(process.cwd(), "hasil_sampel_gurobi.json");

        // Check if files exist
        if (!fs.existsSync(greedyPath) || !fs.existsSync(gurobiPath)) {
            return res.json({ ok: false, message: "No results available yet" });
        }

        // Read the JSON files
        const greedyResults = JSON.parse(fs.readFileSync(greedyPath, "utf8"));
        const gurobiResults = JSON.parse(fs.readFileSync(gurobiPath, "utf8"));

        // Combine results
        const results = greedyResults.map((greedy, index) => ({
            sample: greedy.sample,
            sampleSize: greedy.sampleSize,
            greedy: {
                time: greedy.time,
                assigned: greedy.assigned,
                unassigned: greedy.unassigned,
                objective: greedy.objective,
            },
            gurobi: {
                time: gurobiResults[index].time,
                assigned: gurobiResults[index].assigned,
                unassigned: gurobiResults[index].unassigned,
                objective: gurobiResults[index].objective,
            },
        }));

        res.json({ ok: true, results });
    } catch (error) {
        console.error("Error reading comparison results:", error);
        res.status(500).json({ ok: false, error: "Failed to read results" });
    }
});

// ===== API routes =====
app.post(
    "/api/timepref",
    upload.fields([
        { name: "fileMahasiswa", maxCount: 1 },
        { name: "filePreferensi", maxCount: 1 },
    ]),
    buildTimePref
);

app.post(
    "/api/generate",
    upload.fields([
        { name: "fileMahasiswa", maxCount: 1 },
        { name: "filePreferensi", maxCount: 1 },
    ]),
    async (req, res) => {
        try {
            const {
                jumlahRuangan,
                jumlahHari,
                jumlahSlot,
                tanggalMulai,
                kapasitasRuangan,
                preferences,
            } = req.body;

            // Save config
            const config = {
                C: parseInt(kapasitasRuangan) || 5,
                D: 3, // minimal dosen per sesi
                H: parseInt(jumlahHari) || 9,
                M: parseInt(jumlahSlot) || 7, // slot per hari
                R: parseInt(jumlahRuangan) || 3,
                start_date: tanggalMulai || null,
                limit_stu: 30,
                ALPHA: 0.0,
                BETA: 0.5,
                GAMMA: 0.5,
            };
            const configPath = path.join(process.cwd(), "config.json");
            fs.writeFileSync(configPath, JSON.stringify(config));

            // Save uploaded mahasiswa file if exists
            if (req.files.fileMahasiswa) {
                const stuPath = path.join(uploadDir, "stu.xlsx");
                fs.renameSync(req.files.fileMahasiswa[0].path, stuPath);
                console.log("Mahasiswa file saved to:", stuPath);
            }

            // Handle preferences: prioritize table data over uploaded file
            if (preferences) {
                // Save preferences from table to pref.csv
                console.log("Preferences received:", preferences);
                console.log("Dosen names received:", req.body.dosenNames);

                const prefData = JSON.parse(preferences);
                const dosenNames = req.body.dosenNames
                    ? JSON.parse(req.body.dosenNames)
                    : [];

                console.log("Parsed preferences:", prefData);
                console.log("Parsed dosen names:", dosenNames);

                // Convert preferences object to CSV format with dosen names
                const dosenCount = Object.keys(prefData).length;
                const slotsPerDay = parseInt(jumlahSlot) || 7; // M
                const days = parseInt(jumlahHari) || 9; // H
                const totalSlots = days * slotsPerDay;

                console.log(
                    `Generating CSV: ${dosenCount} dosen, ${totalSlots} slots`
                );

                let csvContent = "";
                for (
                    let dosenIndex = 0;
                    dosenIndex < dosenCount;
                    dosenIndex++
                ) {
                    const dosenPrefs = prefData[dosenIndex.toString()] || {};
                    const row = [];

                    // Add dosen name as first column (quoted)
                    const dosenName =
                        dosenNames[dosenIndex] || `Dosen ${dosenIndex + 1}`;
                    row.push(`"${dosenName}"`);

                    // Add preference values
                    for (let slot = 0; slot < totalSlots; slot++) {
                        row.push(dosenPrefs[slot.toString()] || 0);
                    }
                    csvContent += row.join(",") + "\n";
                }

                const prefPath = path.join(uploadDir, "pref.csv");
                fs.writeFileSync(prefPath, csvContent);
                console.log("CSV saved to:", prefPath);
                console.log(
                    "CSV content preview:",
                    csvContent.substring(0, 200)
                );
            } else if (req.files.filePreferensi) {
                // Fall back to uploaded file if no table preferences
                const prefPath = path.join(uploadDir, "pref.csv");
                fs.renameSync(req.files.filePreferensi[0].path, prefPath);
                console.log("Uploaded pref file saved to:", prefPath);
            } else {
                console.log("No preferences provided (neither table nor file)");
            }

            // Run Python script
            const result = await runPythonScript();
            if (result) {
                // Add config to result for frontend use
                result.config = config;
                res.json({ ok: true, result: result });
            } else {
                res.status(500).json({
                    error: "Gagal menjalankan algoritma greedy",
                });
            }
        } catch (error) {
            console.error("Error in generate:", error);
            res.status(500).json({ error: "Gagal generate jadwal" });
        }
    }
);

app.post(
    "/api/generate2",
    upload.fields([
        { name: "config1_fileMahasiswa", maxCount: 1 },
        { name: "config1_filePreferensi", maxCount: 1 },
        { name: "config2_fileMahasiswa", maxCount: 1 },
        { name: "config2_filePreferensi", maxCount: 1 },
        { name: "config3_fileMahasiswa", maxCount: 1 },
        { name: "config3_filePreferensi", maxCount: 1 },
    ]),
    async (req, res) => {
        try {
            const summaries = [];
            const tables = [];
            const results = []; // Store full results with pythonLogs

            // Process each of the 3 configurations
            for (let i = 1; i <= 3; i++) {
                const prefix = `config${i}_`;
                const stuKey = `${prefix}fileMahasiswa`;
                const prefKey = `${prefix}filePreferensi`;

                // Get parameters for this configuration
                const jumlahRuangan =
                    parseInt(req.body[`${prefix}jumlahRuangan`]) || 3;
                const jumlahHari =
                    parseInt(req.body[`${prefix}jumlahHari`]) || 9;
                const jumlahSlot =
                    parseInt(req.body[`${prefix}jumlahSlot`]) || 7;
                const tanggalMulai = req.body[`${prefix}tanggalMulai`] || null;
                const kapasitasRuangan =
                    parseInt(req.body[`${prefix}kapasitasRuangan`]) || 5;

                // Save config for this run
                const config = {
                    C: kapasitasRuangan,
                    D: 3, // minimal dosen per sesi
                    H: jumlahHari,
                    M: jumlahSlot, // slot per hari
                    R: jumlahRuangan,
                    start_date: tanggalMulai,
                    limit_stu: 3,
                    ALPHA: 0.0,
                    BETA: 0.5,
                    GAMMA: 0.5,
                };
                const configPath = path.join(process.cwd(), "config.json");
                fs.writeFileSync(configPath, JSON.stringify(config));

                if (req.files[stuKey] && req.files[prefKey]) {
                    // Rename files to standard names
                    const stuPath = path.join(uploadDir, "stu.xlsx");
                    const prefPath = path.join(uploadDir, "pref.csv");
                    fs.renameSync(req.files[stuKey][0].path, stuPath);
                    fs.renameSync(req.files[prefKey][0].path, prefPath);

                    // Run Python script
                    console.log(
                        `\n[Config ${i}] Running greedy algorithm with H=${jumlahHari}, M=${jumlahSlot}, R=${jumlahRuangan}`
                    );
                    const result = await runPythonScript();

                    if (result) {
                        const table = result.table || [];
                        const unassignedTable = result.unassigned_table || [];
                        const assigned = result.assigned || 0;
                        const unassignedCount = result.unassigned || 0;
                        const students = assigned + unassignedCount;
                        const slots = config.H * config.M * config.R;
                        const objective = result.objective || 0;

                        summaries.push({
                            name: `Konfigurasi ${i}`,
                            config: {
                                H: jumlahHari,
                                M: jumlahSlot,
                                R: jumlahRuangan,
                                C: kapasitasRuangan,
                                startDate: tanggalMulai,
                            },
                            slots: slots,
                            students: students,
                            time: result.time || 0,
                            assigned: assigned,
                            unassigned: unassignedCount,
                            objective: objective,
                        });
                        tables.push({
                            assigned: table,
                            unassigned: unassignedTable,
                        });
                        // Store full result with pythonLogs
                        results.push(result);
                    } else {
                        summaries.push({
                            name: `Konfigurasi ${i}`,
                            config: {
                                H: jumlahHari,
                                M: jumlahSlot,
                                R: jumlahRuangan,
                                C: kapasitasRuangan,
                                startDate: tanggalMulai,
                            },
                            slots: 0,
                            students: 0,
                            time: 0,
                            assigned: 0,
                            unassigned: 0,
                            objective: 0,
                        });
                        tables.push({
                            assigned: [],
                            unassigned: [],
                        });
                        results.push(null); // No result for failed config
                    }
                } else {
                    summaries.push({
                        name: `Konfigurasi ${i}`,
                        config: {
                            H: jumlahHari,
                            M: jumlahSlot,
                            R: jumlahRuangan,
                            C: kapasitasRuangan,
                            startDate: tanggalMulai,
                        },
                        slots: 0,
                        students: 0,
                        time: 0,
                        assigned: 0,
                        unassigned: 0,
                        objective: 0,
                        error: "File tidak lengkap",
                    });
                    tables.push({
                        assigned: [],
                        unassigned: [],
                    });
                    results.push(null); // No result for incomplete files
                }
            }

            res.json({ ok: true, result: { summaries, tables, results } });
        } catch (error) {
            console.error("Error in generate2:", error);
            res.status(500).json({
                error: "Gagal generate penjadwalan 2: " + error.message,
            });
        }
    }
);

// Function to run Python script
function runPythonScript() {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn("python", ["greedy.py"], {
            cwd: process.cwd(),
            stdio: ["pipe", "pipe", "pipe"],
        });

        let output = "";
        let errorOutput = "";

        pythonProcess.stdout.on("data", (data) => {
            output += data.toString();
        });

        pythonProcess.stderr.on("data", (data) => {
            errorOutput += data.toString();
            // Log stderr to console immediately for debugging
            console.error(data.toString());
        });

        pythonProcess.on("close", (code) => {
            // Print accumulated stderr output for visibility
            if (errorOutput) {
                console.error("=== Python stderr output ===");
                console.error(errorOutput);
                console.error("=== End of Python stderr ===");
            }

            if (code === 0) {
                try {
                    // Extract JSON from the output by finding the start of the JSON object
                    const jsonStart = output.indexOf('{"');
                    if (jsonStart !== -1) {
                        const jsonString = output.substring(jsonStart).trim();
                        const result = JSON.parse(jsonString);
                        // Include stderr in result for client-side logging
                        result.pythonLogs = errorOutput;
                        resolve(result);
                    } else {
                        console.error("No JSON found in output");
                        resolve(null);
                    }
                } catch (e) {
                    console.error("Parse error:", e.message);
                    console.error("Output length:", output.length);
                    console.error("JSON start position:", output.indexOf('{"'));
                    resolve(null);
                }
            } else {
                console.error("Python error:", errorOutput);
                resolve(null);
            }
        });
    });
}

app.post("/api/compare", async (req, res) => {
    try {
        const { jumlahRuangan, jumlahHari, tanggalMulai, kapasitasRuangan } =
            req.body;

        // Save config
        const config = {
            C: parseInt(kapasitasRuangan) || 5,
            D: 3, // minimal dosen per sesi
            H: parseInt(jumlahHari) || 9,
            M: 7, // slot per hari
            R: parseInt(jumlahRuangan) || 3,
            start_date: tanggalMulai || null,
            limit_stu: 3,
            ALPHA: 0.0,
            BETA: 0.5,
            GAMMA: 0.5,
        };
        const configPath = path.join(process.cwd(), "config.json");
        fs.writeFileSync(configPath, JSON.stringify(config));

        const sampleSizes = [3, 5, 10];
        const results = [];

        for (let i = 0; i < sampleSizes.length; i++) {
            const sampleSize = sampleSizes[i];
            const sampleResult = {
                sample: i + 1,
                sampleSize: sampleSize,
                greedy: {
                    time: 0,
                    assigned: 0,
                    unassigned: 0,
                    objective: 0,
                    output: "",
                },
                gurobi: {
                    time: 0,
                    assigned: 0,
                    unassigned: 0,
                    objective: 0,
                    output: "",
                },
            };

            // Run Greedy
            try {
                const greedyData = await runPythonScriptWithLimit(
                    "greedy.py",
                    sampleSize
                );
                if (greedyData.result) {
                    sampleResult.greedy.time = greedyData.result.time || 0;
                    sampleResult.greedy.assigned =
                        greedyData.result.assigned || 0;
                    sampleResult.greedy.unassigned =
                        greedyData.result.unassigned || 0;
                    sampleResult.greedy.objective =
                        greedyData.result.objective || 0;
                }
                sampleResult.greedy.output = greedyData.fullOutput || "999";
            } catch (error) {
                console.error(`Greedy error for sample ${sampleSize}:`, error);
            }

            // Run Gurobi
            try {
                const gurobiData = await runPythonScriptWithLimit(
                    "guroby.py",
                    sampleSize
                );
                if (gurobiData.result) {
                    sampleResult.gurobi.time = gurobiData.result.time || 0;
                    sampleResult.gurobi.assigned =
                        gurobiData.result.assigned || 0;
                    sampleResult.gurobi.unassigned =
                        gurobiData.result.unassigned || 0;
                    sampleResult.gurobi.objective =
                        gurobiData.result.objective || 0;
                }
                sampleResult.gurobi.output = gurobiData.fullOutput || "";
            } catch (error) {
                console.error(`Gurobi error for sample ${sampleSize}:`, error);
            }

            results.push(sampleResult);
        }

        // Save results to JSON files
        const greedyResults = results.map((r) => ({
            sample: r.sample,
            sampleSize: r.sampleSize,
            time: r.greedy.time,
            assigned: r.greedy.assigned,
            unassigned: r.greedy.unassigned,
            objective: r.greedy.objective,
        }));

        const gurobiResults = results.map((r) => ({
            sample: r.sample,
            sampleSize: r.sampleSize,
            time: r.gurobi.time,
            assigned: r.gurobi.assigned,
            unassigned: r.gurobi.unassigned,
            objective: r.gurobi.objective,
        }));

        fs.writeFileSync(
            "hasil_sampel_greedy.json",
            JSON.stringify(greedyResults, null, 2)
        );
        fs.writeFileSync(
            "hasil_sampel_gurobi.json",
            JSON.stringify(gurobiResults, null, 2)
        );

        console.log(
            "Results saved to hasil_sampel_greedy.json and hasil_sampel_gurobi.json"
        );

        res.json({ ok: true, results });
    } catch (error) {
        console.error("Error in compare:", error);
        res.status(500).json({ error: "Gagal menjalankan perbandingan" });
    }
});

// Function to run Python script with student limit
function runPythonScriptWithLimit(scriptName, limit) {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn("python", [scriptName, limit.toString()], {
            cwd: process.cwd(),
            stdio: ["pipe", "pipe", "pipe"],
        });

        let output = "";
        let errorOutput = "";

        pythonProcess.stdout.on("data", (data) => {
            output += data.toString();
        });

        pythonProcess.stderr.on("data", (data) => {
            errorOutput += data.toString();
            // Log stderr to console immediately for debugging
            console.error(data.toString());
        });

        pythonProcess.on("close", (code) => {
            // Print accumulated stderr output for visibility
            if (errorOutput) {
                console.error(`=== Python stderr output (${scriptName}) ===`);
                console.error(errorOutput);
                console.error("=== End of Python stderr ===");
            }

            if (code === 0) {
                try {
                    // Extract JSON from the output by finding the start of the JSON object
                    const jsonStart = output.indexOf('{"');
                    if (jsonStart !== -1) {
                        const jsonString = output.substring(jsonStart).trim();
                        const result = JSON.parse(jsonString);
                        // Return both the parsed result and the full output
                        resolve({
                            result: result,
                            fullOutput: output,
                        });
                    } else {
                        console.error("No JSON found in output");
                        resolve({
                            result: null,
                            fullOutput: output,
                        });
                    }
                } catch (e) {
                    console.error("Parse error:", e.message);
                    console.error("Output length:", output.length);
                    console.error("JSON start position:", output.indexOf('{"'));
                    resolve({
                        result: null,
                        fullOutput: output,
                    });
                }
            } else {
                console.error("Python error:", errorOutput);
                resolve({
                    result: null,
                    fullOutput: output,
                    errorOutput: errorOutput,
                });
            }
        });
    });
}

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
