// public/js/form.js
const form = document.getElementById("optForm");
const resultEl = document.getElementById("result");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fd = new FormData(form);

    // log text fields
    const textOnly = {};
    for (const [k, v] of fd.entries()) {
        if (v instanceof File) continue;
        textOnly[k] = v;
    }
    console.log("Form text entries:", textOnly);

    // log file meta
    const fMhs = fd.get("fileMahasiswa");
    if (fMhs && fMhs.name)
        console.log("fileMahasiswa:", {
            name: fMhs.name,
            size: fMhs.size,
            type: fMhs.type,
        });

    try {
        // Change endpoint to /api/generate (the correct one)
        const resp = await fetch("/api/generate", {
            method: "POST",
            body: fd, // multipart/form-data otomatis
        });

        const data = await resp.json();

        if (!resp.ok || !data.ok) {
            const msg =
                data?.error ||
                (data?.errors && data.errors.join(", ")) ||
                "Gagal membuat jadwal";
            resultEl.textContent = "Error: " + msg;
            console.error("API error:", data);
            return;
        }

        console.log("Server response:", data);

        // Save data to localStorage for the penjadwalan page
        const dataToStore = {
            table: data.result.table || [],
            unassigned: data.result.unassigned_table || [],
            config: data.result.config || {},
        };
        console.log(
            "Saving to localStorage, table count:",
            dataToStore.table.length,
            "unassigned count:",
            dataToStore.unassigned.length
        );
        localStorage.setItem("jadwalResult", JSON.stringify(dataToStore));

        // Redirect to penjadwalan page
        window.location.href = "/penjadwalan_1";
    } catch (err) {
        console.error("Fetch failed:", err);
        resultEl.textContent = "Fetch failed: " + err.message;
    }
});
