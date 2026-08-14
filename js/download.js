/**
 * Excel export download helper.
 *
 * The app runs inside a cross-origin Genesys Cloud iframe where downloads,
 * showSaveFilePicker and partitioned storage are all blocked or unavailable.
 *
 * The workbook is handed over through `window.opener`: the exporting page
 * stashes it on `window._xlsxDownload[key]` and this page is opened with only
 * the short random `key` in its URL hash. Both windows are same-origin, so the
 * property read is direct.
 *
 * The payload deliberately does NOT travel in the URL: browsers cap URL length
 * (Chrome around 2 MB), and a workbook over that limit was silently truncated
 * into a corrupt file. Going through the opener removes any size ceiling.
 *
 * Lives in its own file rather than a <script> block so the
 * Content-Security-Policy can forbid inline script outright.
 */
(function () {
  var msgEl = document.getElementById("msg");
  var subEl = document.getElementById("sub");
  var btnEl = document.getElementById("dlBtn");

  try {
    var key = location.hash.substring(1);
    if (!key) { msgEl.textContent = "No export data found."; return; }

    var store = window.opener && window.opener._xlsxDownload;
    var payload = store && store[key];
    if (!payload) {
      msgEl.textContent = "Export data not found or expired. Please try the export again.";
      return;
    }

    var fileName = payload.filename;
    var b64 = payload.b64;

    // Release the opener's copy as soon as it has been read — a workbook can be
    // tens of megabytes and there is no reason to keep it alive in the app tab.
    try { delete window.opener._xlsxDownload[key]; } catch (e) { /* ignore */ }

    // Clear the hash so the key does not linger in history.
    history.replaceState(null, "", location.pathname);

    // Decode base64
    var raw = atob(b64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    var mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    var blob = new Blob([bytes], { type: mime });

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
