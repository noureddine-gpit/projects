(function () {
  "use strict";

  const core = window.MetadataCore;
  const state = {
    files: [],
    tags: [],
    nextId: 1,
    working: false,
  };

  const elements = {
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("fileInput"),
    fileList: document.getElementById("fileList"),
    fileCounter: document.getElementById("fileCounter"),
    fileTemplate: document.getElementById("fileItemTemplate"),
    keywordInput: document.getElementById("keywordInput"),
    tagEditor: document.getElementById("tagEditor"),
    tagList: document.getElementById("tagList"),
    tagCount: document.getElementById("tagCount"),
    pasteButton: document.getElementById("pasteButton"),
    clearTagsButton: document.getElementById("clearTagsButton"),
    mergeExisting: document.getElementById("mergeExisting"),
    titleInput: document.getElementById("titleInput"),
    descriptionInput: document.getElementById("descriptionInput"),
    creatorInput: document.getElementById("creatorInput"),
    copyrightInput: document.getElementById("copyrightInput"),
    processButton: document.getElementById("processButton"),
    toastRegion: document.getElementById("toastRegion"),
    indicators: Array.from(document.querySelectorAll("[data-step-indicator]")),
  };

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function notify(message, type) {
    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " is-error" : ""}`;
    toast.textContent = message;
    elements.toastRegion.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3600);
  }

  function isSupported(file) {
    return /\.(jpe?g|png)$/i.test(file.name) || ["image/jpeg", "image/png"].includes(file.type);
  }

  function setProgress(step) {
    for (const indicator of elements.indicators) {
      const ownStep = Number(indicator.dataset.stepIndicator);
      indicator.classList.toggle("is-active", ownStep === step);
      indicator.classList.toggle("is-complete", ownStep < step);
    }
  }

  function updateControls() {
    elements.fileCounter.textContent = `${state.files.length} صور`;
    elements.tagCount.textContent = String(state.tags.length);
    elements.processButton.disabled = state.working || state.files.length === 0 || state.tags.length === 0;

    if (state.files.some((entry) => entry.outputUrl)) setProgress(3);
    else if (state.tags.length > 0) setProgress(2);
    else setProgress(1);
  }

  function renderTags() {
    elements.tagList.replaceChildren();
    state.tags.forEach((tag, index) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";

      const label = document.createElement("span");
      label.textContent = tag;
      chip.appendChild(label);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.setAttribute("aria-label", `حذف ${tag}`);
      removeButton.textContent = "×";
      removeButton.addEventListener("click", () => {
        state.tags.splice(index, 1);
        renderTags();
      });
      chip.appendChild(removeButton);
      elements.tagList.appendChild(chip);
    });
    updateControls();
  }

  function addTags(values) {
    state.tags = core.normalizeKeywords(state.tags.concat(values));
    renderTags();
  }

  function commitKeywordInput() {
    const value = elements.keywordInput.value.trim();
    if (!value) return;
    addTags(value.split(/[,;\n]+/));
    elements.keywordInput.value = "";
  }

  function removeFile(id) {
    const index = state.files.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const entry = state.files[index];
    URL.revokeObjectURL(entry.previewUrl);
    if (entry.outputUrl) URL.revokeObjectURL(entry.outputUrl);
    entry.element.remove();
    state.files.splice(index, 1);
    updateControls();
  }

  function createFileRow(entry) {
    const fragment = elements.fileTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".file-item");
    const image = row.querySelector(".thumbnail");
    const type = row.querySelector(".file-type");
    const name = row.querySelector(".file-name");
    const meta = row.querySelector(".file-meta");
    const existingTags = row.querySelector(".existing-tags");
    const removeButton = row.querySelector(".remove-file");

    image.src = entry.previewUrl;
    image.alt = `معاينة ${entry.file.name}`;
    type.textContent = /png$/i.test(entry.file.name) ? "PNG" : "JPG";
    name.textContent = entry.file.name;
    meta.textContent = `${formatBytes(entry.file.size)} · كنقرا metadata…`;
    existingTags.textContent = "";
    removeButton.addEventListener("click", () => removeFile(entry.id));
    entry.element = row;
    entry.metaElement = meta;
    entry.existingElement = existingTags;
    entry.downloadElement = row.querySelector(".download-file");
    elements.fileList.appendChild(fragment);
  }

  async function inspectEntry(entry) {
    try {
      const bytes = new Uint8Array(await entry.file.arrayBuffer());
      const inspection = core.inspect(bytes);
      entry.existing = inspection.metadata;
      entry.metaElement.textContent = `${formatBytes(entry.file.size)} · ${inspection.type.toUpperCase()}`;
      const count = inspection.metadata.keywords.length;
      entry.existingElement.textContent = count ? `${count} keywords موجودة` : "ما فيها حتى keyword دابا";
    } catch (error) {
      entry.error = error.message;
      entry.metaElement.textContent = "تعذر قراءة الصورة";
      entry.existingElement.textContent = error.message;
      entry.existingElement.style.color = "#b84e43";
    }
    updateControls();
  }

  async function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    let rejected = 0;
    for (const file of incoming) {
      if (!isSupported(file) || file.size > 25 * 1024 * 1024) {
        rejected += 1;
        continue;
      }
      const duplicate = state.files.some(
        (entry) =>
          entry.file.name === file.name &&
          entry.file.size === file.size &&
          entry.file.lastModified === file.lastModified,
      );
      if (duplicate) continue;

      const entry = {
        id: state.nextId,
        file,
        previewUrl: URL.createObjectURL(file),
        outputUrl: "",
        existing: null,
      };
      state.nextId += 1;
      state.files.push(entry);
      createFileRow(entry);
      inspectEntry(entry);
    }

    elements.fileInput.value = "";
    updateControls();
    if (rejected) notify("شي ملفات ما تقبلوش: استعمل JPG أو PNG أقل من 25 MB.", "error");
  }

  function metadataRequest() {
    return {
      keywords: state.tags,
      mergeExisting: elements.mergeExisting.checked,
      title: elements.titleInput.value.trim(),
      description: elements.descriptionInput.value.trim(),
      creator: elements.creatorInput.value.trim(),
      copyright: elements.copyrightInput.value.trim(),
    };
  }

  async function processEntry(entry, request) {
    if (entry.error) return false;
    const bytes = new Uint8Array(await entry.file.arrayBuffer());
    const result = core.write(bytes, request);
    const mime = result.type === "png" ? "image/png" : "image/jpeg";
    const blob = new Blob([result.bytes], { type: mime });

    if (entry.outputUrl) URL.revokeObjectURL(entry.outputUrl);
    entry.outputUrl = URL.createObjectURL(blob);
    entry.downloadElement.href = entry.outputUrl;
    entry.downloadElement.download = core.taggedFileName(entry.file.name);
    entry.downloadElement.hidden = false;
    entry.element.querySelector(".remove-file").hidden = true;
    entry.metaElement.textContent = `${formatBytes(blob.size)} · جاهزة`;
    entry.existingElement.textContent = `${result.metadata.keywords.length} keywords تكتبو بنجاح`;
    return true;
  }

  async function processAll() {
    commitKeywordInput();
    if (!state.files.length || !state.tags.length || state.working) return;

    state.working = true;
    updateControls();
    elements.processButton.classList.add("is-working");
    elements.processButton.querySelector("span").textContent = "جاري كتابة metadata…";

    let successes = 0;
    const request = metadataRequest();
    for (const entry of state.files) {
      try {
        if (await processEntry(entry, request)) successes += 1;
      } catch (error) {
        entry.metaElement.textContent = "وقع مشكل فالمعالجة";
        entry.existingElement.textContent = error.message;
        entry.existingElement.style.color = "#b84e43";
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    state.working = false;
    elements.processButton.classList.remove("is-working");
    elements.processButton.querySelector("span").textContent = "عاود كتب metadata";
    updateControls();
    if (successes) notify(`${successes} صور واجدين — اضغط تحميل حد كل صورة.`);
    else notify("ما قدرناش نعالجو الصور. راجع نوع الملفات.", "error");
  }

  elements.dropzone.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", (event) => addFiles(event.target.files));

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.remove("is-dragging");
    });
  });
  elements.dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

  elements.tagEditor.addEventListener("click", () => elements.keywordInput.focus());
  elements.keywordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "," || event.key === ";") {
      event.preventDefault();
      commitKeywordInput();
    } else if (event.key === "Backspace" && !elements.keywordInput.value && state.tags.length) {
      state.tags.pop();
      renderTags();
    }
  });
  elements.keywordInput.addEventListener("input", () => {
    if (/[,;\n]/.test(elements.keywordInput.value)) commitKeywordInput();
  });
  elements.keywordInput.addEventListener("blur", commitKeywordInput);

  elements.pasteButton.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return notify("الحافظة خاوية.", "error");
      addTags(text.split(/[,;\n]+/));
    } catch (_) {
      elements.keywordInput.focus();
      notify("دير Ctrl+V فخانة الكلمات باش تلصق اللائحة.");
    }
  });

  elements.clearTagsButton.addEventListener("click", () => {
    state.tags = [];
    elements.keywordInput.value = "";
    renderTags();
  });

  elements.processButton.addEventListener("click", processAll);
  window.addEventListener("beforeunload", () => {
    state.files.forEach((entry) => {
      URL.revokeObjectURL(entry.previewUrl);
      if (entry.outputUrl) URL.revokeObjectURL(entry.outputUrl);
    });
  });

  updateControls();
})();
