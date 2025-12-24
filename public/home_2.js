// home2.js - Comparison of 3 configurations
document.addEventListener("DOMContentLoaded", () => {
    const btnGenerate = document.getElementById("btn-generate");

    btnGenerate.addEventListener("click", async () => {
        const form1 = document.getElementById("form1");
        const form2 = document.getElementById("form2");
        const form3 = document.getElementById("form3");

        // Validate all forms
        if (!form1.checkValidity()) {
            alert("Mohon lengkapi semua field di Konfigurasi 1");
            form1.reportValidity();
            return;
        }
        if (!form2.checkValidity()) {
            alert("Mohon lengkapi semua field di Konfigurasi 2");
            form2.reportValidity();
            return;
        }
        if (!form3.checkValidity()) {
            alert("Mohon lengkapi semua field di Konfigurasi 3");
            form3.reportValidity();
            return;
        }

        // Create combined FormData
        const formData = new FormData();

        // Add data from form1 with prefix "config1_"
        const formData1 = new FormData(form1);
        for (let [key, value] of formData1.entries()) {
            formData.append(`config1_${key}`, value);
        }

        // Add data from form2 with prefix "config2_"
        const formData2 = new FormData(form2);
        for (let [key, value] of formData2.entries()) {
            formData.append(`config2_${key}`, value);
        }

        // Add data from form3 with prefix "config3_"
        const formData3 = new FormData(form3);
        for (let [key, value] of formData3.entries()) {
            formData.append(`config3_${key}`, value);
        }

        try {
            btnGenerate.disabled = true;
            btnGenerate.textContent = "Memproses...";

            const response = await fetch("/api/generate2", {
                method: "POST",
                body: formData,
            });

            const data = await response.json();

            if (data.ok) {
                // Display Python logs in browser console if available
                if (data.result && Array.isArray(data.result)) {
                    data.result.forEach((config, index) => {
                        if (config.pythonLogs) {
                            console.log(
                                `%c=== CONFIG ${
                                    index + 1
                                } - PYTHON GREEDY LOGS ===`,
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

                // Save to localStorage and redirect
                localStorage.setItem(
                    "comparisonResult",
                    JSON.stringify(data.result)
                );
                window.location.href = "/penjadwalan_2";
            } else {
                alert("Error: " + data.error);
                btnGenerate.disabled = false;
                btnGenerate.textContent = "Bandingkan 3 Konfigurasi";
            }
        } catch (error) {
            console.error("Error:", error);
            alert("Gagal generate penjadwalan: " + error.message);
            btnGenerate.disabled = false;
            btnGenerate.textContent = "Bandingkan 3 Konfigurasi";
        }
    });
});
