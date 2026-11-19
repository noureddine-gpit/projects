(function () {
  "use strict";

  /* ── DOM refs ────────────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);

  const els = {
    statusDot:      $("statusDot"),
    statusText:     $("statusText"),
    statusPill:     $("statusPill"),
    completedCount: $("completedCount"),
    queueCount:     $("queueCount"),
    qualityDisplay: $("qualityDisplay"),
    depsDisplay:    $("depsDisplay"),
    depsIcon:       document.querySelector(".stat-icon--deps"),
    sheetUrl:       $("sheetUrl"),
    folder:         $("folder"),
    batchSize:      $("batchSize"),
    quality:        $("quality"),
    browseBtn:      $("browseBtn"),
    rightsCheck:    $("rightsCheck"),
    startBtn:       $("startBtn"),
    pauseBtn:       $("pauseBtn"),
    openFolderBtn:  $("openFolderBtn"),
    progressSection:$("progressSection"),
    progressLabel:  $("progressLabel"),
    progressPercent:$("progressPercent"),
    progressFill:   $("progressFill"),
    currentVideo:   $("currentVideo"),
    logBody:        $("logBody"),
    clearLogBtn:    $("clearLogBtn"),
  };

  /* ── State ───────────────────────────────────────────────────────── */
  let currentStatus = "idle";
  let logStarted = false;

  /* ── Helpers ─────────────────────────────────────────────────────── */
  async function api(method, path, body) {
    const opts = { method, headers: {} };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    return res.json();
  }

  const STATUS_LABELS = {
    idle:        "Ready",
    loading:     "Loading Sheet…",
    downloading: "Downloading…",
    pausing:     "Pausing…",
    paused:      "Paused",
    complete:    "Complete",
    error:       "Error",
  };

  /* ── UI updates ──────────────────────────────────────────────────── */
  function applyStatus(data) {
    currentStatus = data.status;

    // Status pill
    els.statusDot.className = "status-dot is-" + data.status;
    els.statusText.textContent = STATUS_LABELS[data.status] || data.status;

    // Stats
    els.completedCount.textContent = String(data.completedCount);

    if (data.total > 0 && data.position > 0) {
      els.queueCount.textContent = String(data.total - data.position);
    }

    // Quality display (read from select)
    els.qualityDisplay.textContent = els.quality.value + "p";

    // Dependencies
    if (data.deps) {
      const allOk = Object.values(data.deps).every(Boolean);
      els.depsDisplay.textContent = allOk ? "OK" : "Missing";
      els.depsIcon.classList.toggle("is-bad", !allOk);
    }

    // Progress
    const isActive = ["loading", "downloading", "pausing"].includes(data.status);
    els.progressSection.classList.toggle("is-visible", isActive || data.progress > 0);

    if (data.total > 0) {
      els.progressLabel.textContent = `Video ${data.position}/${data.total}`;
    } else {
      els.progressLabel.textContent = data.status === "loading" ? "Loading…" : "";
    }

    const pct = Math.min(100, Math.max(0, data.progress));
    els.progressPercent.textContent = pct.toFixed(1) + "%";
    els.progressFill.style.width = pct + "%";
    els.currentVideo.textContent = data.currentVideo || "";

    // Buttons
    const isRunning = ["loading", "downloading", "pausing"].includes(data.status);
    els.startBtn.disabled = isRunning || !els.rightsCheck.checked;
    els.pauseBtn.disabled = !isRunning || data.status === "pausing";

    // Disable config while running
    const configLocked = isRunning;
    els.sheetUrl.disabled = configLocked;
    els.folder.disabled = configLocked;
    els.batchSize.disabled = configLocked;
    els.quality.disabled = configLocked;
    els.browseBtn.disabled = configLocked;
    els.rightsCheck.disabled = configLocked;
  }

  function appendLog(time, message) {
    // Remove welcome text on first real log
    if (!logStarted) {
      logStarted = true;
      const welcome = els.logBody.querySelector(".log-welcome");
      if (welcome) welcome.remove();
    }

    const line = document.createElement("p");
    line.className = "log-line";

    // Classify
    if (message.startsWith("✓") || message.startsWith("Saved")) {
      line.classList.add("is-success");
    } else if (message.startsWith("ERROR") || message.startsWith("✗")) {
      line.classList.add("is-error");
    } else if (message.startsWith("━━") || message.startsWith("Found")) {
      line.classList.add("is-info");
    }

    const timeSpan = document.createElement("span");
    timeSpan.className = "log-time";
    timeSpan.textContent = time;
    line.appendChild(timeSpan);
    line.appendChild(document.createTextNode(message));

    els.logBody.appendChild(line);
    els.logBody.scrollTop = els.logBody.scrollHeight;

    // Keep max 500 lines
    while (els.logBody.children.length > 500) {
      els.logBody.removeChild(els.logBody.firstChild);
    }
  }

  /* ── SSE connection ──────────────────────────────────────────────── */
  function connectSSE() {
    const source = new EventSource("/api/events");

    source.addEventListener("status", (e) => {
      try { applyStatus(JSON.parse(e.data)); } catch {}
    });

    source.addEventListener("log", (e) => {
      try {
        const d = JSON.parse(e.data);
        appendLog(d.time, d.message);
      } catch {}
    });

    source.onerror = () => {
      source.close();
      els.statusDot.className = "status-dot is-error";
      els.statusText.textContent = "Disconnected";
      // Reconnect after 3s
      setTimeout(connectSSE, 3000);
    };

    source.onopen = () => {
      // Fetch current status on connect
      api("GET", "/api/status").then(applyStatus).catch(() => {});
    };
  }

  /* ── Event listeners ─────────────────────────────────────────────── */

  // Start
  els.startBtn.addEventListener("click", async () => {
    const data = {
      sheetUrl:  els.sheetUrl.value.trim(),
      folder:    els.folder.value.trim(),
      batchSize: parseInt(els.batchSize.value, 10) || 10,
      quality:   parseInt(els.quality.value, 10) || 1080,
    };
    if (!data.sheetUrl) {
      alert("Please enter a Google Sheet URL.");
      els.sheetUrl.focus();
      return;
    }
    if (!data.folder) {
      alert("Please enter a download folder.");
      els.folder.focus();
      return;
    }
    els.startBtn.disabled = true;
    const res = await api("POST", "/api/start", data);
    if (!res.ok) {
      alert(res.error || "Could not start.");
      els.startBtn.disabled = false;
    }
  });

  // Pause
  els.pauseBtn.addEventListener("click", async () => {
    els.pauseBtn.disabled = true;
    await api("POST", "/api/pause");
  });

  // Browse folder
  els.browseBtn.addEventListener("click", async () => {
    const res = await api("POST", "/api/browse");
    if (res.ok && res.path) {
      els.folder.value = res.path;
    }
  });

  // Open folder
  els.openFolderBtn.addEventListener("click", () => {
    api("POST", "/api/open-folder", { folder: els.folder.value.trim() });
  });

  // Clear log
  els.clearLogBtn.addEventListener("click", () => {
    els.logBody.innerHTML = '<p class="log-welcome">Log cleared.</p>';
    logStarted = false;
  });

  // Rights checkbox → enable start
  els.rightsCheck.addEventListener("change", () => {
    const isRunning = ["loading", "downloading", "pausing"].includes(currentStatus);
    els.startBtn.disabled = isRunning || !els.rightsCheck.checked;
  });

  // Quality selector → update display
  els.quality.addEventListener("change", () => {
    els.qualityDisplay.textContent = els.quality.value + "p";
  });

  /* ── Init ────────────────────────────────────────────────────────── */
  async function init() {
    // Load defaults
    try {
      const defaults = await api("GET", "/api/defaults");
      els.sheetUrl.value = defaults.sheetUrl || "";
      els.folder.value = defaults.folder || "";
    } catch {}

    // Load current status
    try {
      const status = await api("GET", "/api/status");
      applyStatus(status);
    } catch {}

    // Connect SSE
    connectSSE();
  }

  init();
})();
