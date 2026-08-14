/**
 * Excel export download helper.
 *
 * The app runs inside a cross-origin Genesys Cloud iframe where downloads,
 * showSaveFilePicker, postMessage and localStorage are all blocked or
 * partitioned. The export page therefore hands the workbook over in this page's
 * URL hash (`#<encoded filename>|<base64>`): a fragment never leaves the
 * browser and is not sent to the server.
 *
 * Lives in its own file rather than a <script> block so the
 * Content-Security-Policy can forbid inline script outright.
 */
(function () {
  var msgEl = document.getElementById("msg");
  var subEl = document.getElementById("sub");
  var btnEl = document.getElementById("dlBtn");

  try {
    var hash = location.hash.substring(1);
    var sep = hash.indexOf("|");
    if (!hash || sep < 0) { msgEl.textContent = "No export data found."; return; }

    var fileName = decodeURIComponent(hash.substring(0, sep));
    var b64 = hash.substring(sep + 1);

    // Decode base64
    var raw = atob(b64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    var mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    var blob = new Blob([bytes], { type: mime });

    // Clear hash for privacy
    history.replaceState(null, "", location.pathname);

    msgEl.textContent = "Click the button to save your file:";
    btnEl.textContent = "⬇ Save " + fileName;
    btnEl.classList.remove("is-hidden");
    subEl.textContent = "You can close this tab after downloading.";

    btnEl.addEventListener("click", async function () {
      try {
        // Primary: File System Access API (native Save As dialog)
        if (window.showSaveFilePicker) {
          var handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{
              description: "Excel Workbook",
              accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
            }],
          });
          var writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          msgEl.textContent = "✅ Saved: " + fileName;
          btnEl.classList.add("is-hidden");
          var countdown = 3;
          subEl.textContent = "Closing in " + countdown + "s…";
          var timer = setInterval(function () {
            countdown--;
            if (countdown <= 0) { clearInterval(timer); window.close(); }
            else { subEl.textContent = "Closing in " + countdown + "s…"; }
          }, 1000);
          return;
        }
      } catch (e) {
        if (e.name === "AbortError") { return; } // user cancelled
        console.warn("showSaveFilePicker failed, trying fallback:", e);
      }

      // Fallback: blob URL <a> click
      try {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        msgEl.textContent = "Download started: " + fileName;
      } catch (e2) {
        msgEl.textContent = "Download failed: " + e2.message;
      }
    });

  } catch (err) {
    msgEl.textContent = "Error: " + err.message;
    console.error("Download helper error:", err);
  }
})();
