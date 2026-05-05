const state = {
  index: 0,
  total: 0,
  headers: [],
  contact: null,
  duplicates: [],
  stats: {},
  canUndo: false,
  mergeTarget: null,
  saveTimer: null,
};

const importantFields = [
  "E-mail Address",
  "E-mail 2 Address",
  "E-mail 3 Address",
  "Mobile Phone",
  "Home Phone",
  "Business Phone",
  "Company",
  "Job Title",
  "Business City",
  "Business Country/Region",
  "Home City",
  "Home Country/Region",
  "Birthday",
  "Notes",
];

const editFields = [
  "First Name",
  "Middle Name",
  "Last Name",
  "Nickname",
  "E-mail Address",
  "E-mail 2 Address",
  "E-mail 3 Address",
  "Mobile Phone",
  "Home Phone",
  "Business Phone",
  "Company",
  "Job Title",
  "Business Street",
  "Business City",
  "Business Country/Region",
  "Home Street",
  "Home City",
  "Home Country/Region",
  "Notes",
];

const el = {
  positionLabel: document.querySelector("#positionLabel"),
  reviewedLabel: document.querySelector("#reviewedLabel"),
  progressBar: document.querySelector("#progressBar"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  searchResults: document.querySelector("#searchResults"),
  prevBtn: document.querySelector("#prevBtn"),
  nextBtn: document.querySelector("#nextBtn"),
  resumeBtn: document.querySelector("#resumeBtn"),
  jumpInput: document.querySelector("#jumpInput"),
  exportBtn: document.querySelector("#exportBtn"),
  exportMessage: document.querySelector("#exportMessage"),
  mergeDialog: document.querySelector("#mergeDialog"),
  mergeForm: document.querySelector("#mergeForm"),
  mergeTitle: document.querySelector("#mergeTitle"),
  mergeFields: document.querySelector("#mergeFields"),
  confirmMergeBtn: document.querySelector("#confirmMergeBtn"),
  rowMeta: document.querySelector("#rowMeta"),
  displayName: document.querySelector("#displayName"),
  companyLine: document.querySelector("#companyLine"),
  statusPill: document.querySelector("#statusPill"),
  currentUndoBtn: document.querySelector("#currentUndoBtn"),
  primaryFields: document.querySelector("#primaryFields"),
  reviewNote: document.querySelector("#reviewNote"),
  editFields: document.querySelector("#editFields"),
  saveEditsBtn: document.querySelector("#saveEditsBtn"),
  saveEditsStatus: document.querySelector("#saveEditsStatus"),
  duplicates: document.querySelector("#duplicates"),
  duplicateCount: document.querySelector("#duplicateCount"),
  statUnreviewed: document.querySelector("#statUnreviewed"),
  statKeep: document.querySelector("#statKeep"),
  statDelete: document.querySelector("#statDelete"),
  statMaybe: document.querySelector("#statMaybe"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error((await response.json()).error || response.statusText);
  return response.json();
}

function value(record, field) {
  return String(record[field] || "").trim();
}

function statusClass(status) {
  return ["keep", "delete", "maybe", "merged"].includes(status) ? status : "";
}

function updateStats(stats) {
  state.stats = stats;
  const reviewed = (stats.keep || 0) + (stats.delete || 0) + (stats.maybe || 0) + (stats.merged || 0);
  el.reviewedLabel.textContent = `${reviewed.toLocaleString()} reviewed`;
  el.progressBar.style.width = `${state.total ? (reviewed / state.total) * 100 : 0}%`;
  el.statUnreviewed.textContent = (stats.unreviewed || 0).toLocaleString();
  el.statKeep.textContent = (stats.keep || 0).toLocaleString();
  el.statDelete.textContent = (stats.delete || 0).toLocaleString();
  el.statMaybe.textContent = (stats.maybe || 0).toLocaleString();
}

function updateUndo(canUndo) {
  state.canUndo = Boolean(canUndo);
}

function renderPrimaryFields(record) {
  const blocks = importantFields
    .filter((field) => value(record, field))
    .map((field) => {
      const wide = field === "Notes" || value(record, field).length > 80 ? " wide" : "";
      return `<div class="info-block${wide}"><span>${field}</span><strong>${escapeHtml(value(record, field))}</strong></div>`;
    });
  el.primaryFields.innerHTML = blocks.length
    ? blocks.join("")
    : '<div class="info-block wide"><span>Empty</span><strong>No populated primary fields on this contact.</strong></div>';
}

function renderEditFields(record) {
  el.editFields.innerHTML = editFields
    .map((field) => {
      const tag = field === "Notes" ? "textarea" : "input";
      const classes = field === "Notes" ? "field-label notes" : "field-label";
      const currentValue = escapeHtml(value(record, field));
      if (tag === "textarea") {
        return `<label class="${classes}">${field}<textarea class="field-input edit-input" data-field="${field}" rows="4">${currentValue}</textarea></label>`;
      }
      return `<label class="${classes}">${field}<input class="field-input edit-input" data-field="${field}" value="${currentValue}" /></label>`;
    })
    .join("");

  document.querySelectorAll(".edit-input").forEach((input) => {
    input.addEventListener("input", () => scheduleSave());
  });
}

function renderDuplicates(duplicates) {
  el.duplicateCount.textContent = duplicates.length;
  if (!duplicates.length) {
    el.duplicates.innerHTML = '<p class="subtle">No obvious duplicates found for this record.</p>';
    return;
  }
  el.duplicates.innerHTML = duplicates
    .map(
      (item) => `
        <div class="duplicate-item ${statusClass(item.status)}" data-index="${item.index}">
          <button class="duplicate-open" data-index="${item.index}">
            <strong>${escapeHtml(item.displayName)}</strong>
            <div class="small-meta">Row ${item.rowNumber}</div>
            <div class="small-meta">${escapeHtml([item.company, item.emails[0], item.phones[0]].filter(Boolean).join(" · "))}</div>
          </button>
          <div class="duplicate-status-row">
            <span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span>
            <button class="record-action undo duplicate-undo" data-id="${item.id}" ${item.canUndo ? "" : "hidden"}>Undo</button>
          </div>
          <div class="reason-list">${item.reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}</div>
          <span class="pair-merge" data-id="${item.id}">Review merge into this duplicate</span>
          <span class="duplicate-keep" data-id="${item.id}" ${item.status === "keep" ? "hidden" : ""}>Keep this duplicate</span>
          <span class="duplicate-delete" data-id="${item.id}" ${item.status === "delete" ? "hidden" : ""}>Delete this duplicate</span>
          <span class="not-duplicate" data-id="${item.id}">Not a duplicate</span>
        </div>
      `,
    )
    .join("");

  document.querySelectorAll(".duplicate-open").forEach((button) => {
    button.addEventListener("click", () => loadContact(Number(button.dataset.index)));
  });
  document.querySelectorAll(".duplicate-undo").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      undoRecord(button.dataset.id);
    });
  });
  document.querySelectorAll(".duplicate-delete").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteDuplicate(button.dataset.id);
    });
  });
  document.querySelectorAll(".duplicate-keep").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      keepDuplicate(button.dataset.id);
    });
  });
  document.querySelectorAll(".not-duplicate").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      dismissDuplicate(button.dataset.id);
    });
  });
  document.querySelectorAll(".pair-merge").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openMergeDialog(button.dataset.id);
    });
  });
}

function renderContact(payload) {
  state.index = payload.index;
  state.total = payload.total;
  state.headers = payload.headers;
  state.contact = payload.contact;
  state.duplicates = payload.duplicates;

  const { contact } = payload;
  const status = contact.decision.status || "unreviewed";
  el.positionLabel.textContent = `${state.index + 1} of ${state.total.toLocaleString()}`;
  el.jumpInput.value = state.index + 1;
  el.jumpInput.max = state.total;
  el.rowMeta.textContent = `Source row ${contact.rowNumber} · ${contact.id}`;
  el.displayName.textContent = contact.displayName;
  el.companyLine.textContent = [value(contact.record, "Company"), value(contact.record, "Job Title")].filter(Boolean).join(" · ");
  el.statusPill.textContent = status;
  el.statusPill.className = `status-pill ${statusClass(status)}`;
  el.currentUndoBtn.hidden = !contact.canUndo;
  document.querySelector(".contact-card").className = `contact-card ${statusClass(status)}`;
  el.reviewNote.value = contact.decision.reviewNote || "";

  document.querySelectorAll('.topbar .status-btn[data-status]').forEach((button) => {
    button.classList.toggle("active", button.dataset.status === status);
  });
  const mergeButton = document.querySelector('.topbar .status-btn[data-status="merged"]');
  if (mergeButton) {
    mergeButton.disabled = !payload.duplicates.length;
    mergeButton.title = payload.duplicates.length
      ? "Choose a duplicate card below to review a merge"
      : "Merged is only available when possible duplicates are shown";
  }

  renderPrimaryFields(contact.record);
  renderEditFields(contact.record);
  renderDuplicates(payload.duplicates);
}

async function loadContact(index) {
  const payload = await api(`/api/contact?index=${index}`);
  renderContact(payload);
}

async function loadNextUnreviewed(fromIndex = state.index) {
  const payload = await api(`/api/next-unreviewed?from=${fromIndex}`);
  if (payload.index >= 0) {
    await loadContact(payload.index);
  } else {
    await loadContact(Math.min(state.total - 1, fromIndex + 1));
  }
}

function gatherEdits() {
  const edits = {};
  document.querySelectorAll(".edit-input").forEach((input) => {
    edits[input.dataset.field] = input.value;
  });
  return edits;
}

async function saveDecision(status = null, options = {}) {
  if (!state.contact) return;
  const nextStatus = status || state.contact.decision.status || "unreviewed";
  const currentIndex = state.index;
  const payload = {
    id: state.contact.id,
    status: nextStatus,
    reviewNote: el.reviewNote.value,
    edits: gatherEdits(),
  };
  const result = await api("/api/decision", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.contact.decision.status = nextStatus;
  state.contact.decision.reviewNote = payload.reviewNote;
  updateStats(result.stats);
  updateUndo(result.canUndo);
  if (options.silent) return;
  if (options.advance) {
    await loadNextUnreviewed(currentIndex);
    return;
  }
  const fresh = await api(`/api/contact?index=${currentIndex}`);
  renderContact(fresh);
}

async function saveCurrentEdits() {
  if (!state.contact) return;
  window.clearTimeout(state.saveTimer);
  el.saveEditsBtn.disabled = true;
  el.saveEditsStatus.textContent = "Saving...";
  try {
    await saveDecision(null);
    el.saveEditsStatus.textContent = "Saved";
  } finally {
    el.saveEditsBtn.disabled = false;
    window.setTimeout(() => {
      el.saveEditsStatus.textContent = "";
    }, 1400);
  }
}

async function deleteCurrentAndDuplicate(duplicateId) {
  if (!state.contact) return;
  const currentIndex = state.index;
  const result = await api("/api/delete-pair", {
    method: "POST",
    body: JSON.stringify({
      currentId: state.contact.id,
      duplicateId,
      currentNote: el.reviewNote.value,
      currentEdits: gatherEdits(),
    }),
  });
  updateStats(result.stats);
  updateUndo(result.canUndo);
  await loadNextUnreviewed(currentIndex);
}

function openMergeDialog(targetId) {
  const target = state.duplicates.find((item) => item.id === targetId);
  if (!state.contact || !target) return;
  state.mergeTarget = target;
  el.mergeTitle.textContent = `Build final record for ${state.contact.displayName}`;

  const sourceRecord = { ...state.contact.record, ...gatherEdits() };
  const sources = state.duplicates.map((item, index) => ({
      id: item.id,
      label: `Duplicate ${index + 1}`,
      subtitle: `Row ${item.rowNumber}`,
      record: item.record,
    }));
  const targetRecord = sourceRecord;
  const fields = Array.from(
    new Set([
      ...editFields,
      ...importantFields,
      "Business Phone 2",
      "Business Fax",
      "Business Postal Code",
    ]),
  );
  const rows = fields
    .filter((field) => sources.some((source) => value(source.record, field)) || value(targetRecord, field))
    .map((field) => {
      const finalValue = value(targetRecord, field) || value(sourceRecord, field);
      const sourceCells = sources
        .map((source) => {
          const sourceValue = value(source.record, field);
          return `
            <button
              type="button"
              class="merge-source"
              draggable="${sourceValue ? "true" : "false"}"
              data-value="${escapeHtml(sourceValue)}"
              title="Click or drag this value into any final field"
            >
              <strong>${escapeHtml(source.label)}</strong>
              <small>${escapeHtml(source.subtitle)}</small>
              <span>${escapeHtml(sourceValue || "Blank")}</span>
            </button>
          `;
        })
        .join("");
      return `
        <div class="merge-row" data-field="${escapeHtml(field)}">
          <div class="merge-row-name">${escapeHtml(field)}</div>
          <label class="merge-final">
            <textarea class="merge-final-input" data-field="${escapeHtml(field)}" rows="${field === "Notes" || field.includes("Street") ? "3" : "2"}">${escapeHtml(finalValue)}</textarea>
          </label>
          <div class="merge-sources">${sourceCells}</div>
        </div>
      `;
    });

  el.mergeFields.innerHTML = rows.length
    ? rows.join("")
    : '<p class="subtle">Neither record has populated editable fields.</p>';
  wireMergeValueTransfers();
  el.mergeDialog.showModal();
}

async function confirmMerge() {
  if (!state.contact || !state.mergeTarget) return;
  const targetEdits = {};

  document.querySelectorAll(".merge-final-input").forEach((input) => {
    targetEdits[input.dataset.field] = input.value;
  });

  const currentIndex = state.index;
  const result = await api("/api/merge-records", {
    method: "POST",
    body: JSON.stringify({
      sourceId: state.mergeTarget.id,
      targetId: state.contact.id,
      targetEdits,
      sourceNote: `Merged into ${state.contact.id}.`,
    }),
  });
  updateStats(result.stats);
  updateUndo(result.canUndo);
  el.mergeDialog.close();
  await loadNextUnreviewed(currentIndex);
}

function wireMergeValueTransfers() {
  document.querySelectorAll(".merge-source").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest(".merge-row");
      const input = row?.querySelector(".merge-final-input");
      if (input && button.dataset.value) input.value = button.dataset.value;
    });
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", button.dataset.value || "");
    });
  });

  document.querySelectorAll(".merge-final-input").forEach((input) => {
    input.addEventListener("dragover", (event) => {
      event.preventDefault();
      input.classList.add("drop-ready");
    });
    input.addEventListener("dragleave", () => input.classList.remove("drop-ready"));
    input.addEventListener("drop", (event) => {
      event.preventDefault();
      input.classList.remove("drop-ready");
      const droppedValue = event.dataTransfer.getData("text/plain");
      if (droppedValue) input.value = droppedValue;
    });
  });
}

async function undoLastChange() {
  const result = await api("/api/undo", { method: "POST", body: "{}" });
  updateStats(result.stats);
  updateUndo(result.canUndo);
  await loadContact(result.focusIndex || 0);
}

async function undoRecord(id) {
  const result = await api("/api/undo-record", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
  updateStats(result.stats);
  await loadContact(state.index);
}

async function deleteDuplicate(id) {
  const duplicate = state.duplicates.find((item) => item.id === id);
  if (!duplicate) return;
  const result = await api("/api/decision", {
    method: "POST",
    body: JSON.stringify({
      id,
      status: "delete",
      reviewNote: duplicate.reviewNote || "",
      edits: duplicate.record || {},
    }),
  });
  updateStats(result.stats);
  updateUndo(result.canUndo);
  await loadContact(state.index);
}

async function keepDuplicate(id) {
  const duplicate = state.duplicates.find((item) => item.id === id);
  if (!duplicate || !state.contact) return;
  const result = await api("/api/decision", {
    method: "POST",
    body: JSON.stringify({
      id,
      status: "keep",
      reviewNote: duplicate.reviewNote || "Kept as related contact; not a duplicate.",
      edits: duplicate.record || {},
    }),
  });
  updateStats(result.stats);
  updateUndo(result.canUndo);
  await dismissDuplicate(id);
}

async function dismissDuplicate(duplicateId) {
  if (!state.contact) return;
  await api("/api/not-duplicate", {
    method: "POST",
    body: JSON.stringify({
      currentId: state.contact.id,
      duplicateId,
    }),
  });
  await loadContact(state.index);
}

function scheduleSave() {
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => saveDecision(null, { silent: true }), 700);
}

async function search() {
  const query = encodeURIComponent(el.searchInput.value);
  const status = encodeURIComponent(el.statusFilter.value);
  const payload = await api(`/api/search?q=${query}&status=${status}`);
  el.searchResults.innerHTML = payload.results
    .map(
      (item) => `
        <button class="result-item" data-index="${item.index}">
          <strong>${escapeHtml(item.displayName)}</strong>
          <div class="small-meta">Row ${item.rowNumber} · ${escapeHtml(item.status)}</div>
          <div class="small-meta">${escapeHtml([item.company, item.emails[0], item.phones[0]].filter(Boolean).join(" · "))}</div>
        </button>
      `,
    )
    .join("");
  document.querySelectorAll(".result-item").forEach((button) => {
    button.addEventListener("click", () => loadContact(Number(button.dataset.index)));
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

el.prevBtn.addEventListener("click", () => loadContact(Math.max(0, state.index - 1)));
el.nextBtn.addEventListener("click", () => loadContact(Math.min(state.total - 1, state.index + 1)));
el.resumeBtn.addEventListener("click", () => loadNextUnreviewed(-1));
el.jumpInput.addEventListener("change", () => loadContact(Math.max(0, Math.min(state.total - 1, Number(el.jumpInput.value) - 1))));
el.reviewNote.addEventListener("input", scheduleSave);
el.saveEditsBtn.addEventListener("click", (event) => {
  event.preventDefault();
  saveCurrentEdits();
});
el.searchForm.addEventListener("input", search);
el.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  search();
});

document.querySelectorAll('.topbar .status-btn[data-status]').forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.status === "merged") {
      const firstDuplicate = state.duplicates[0];
      if (firstDuplicate) openMergeDialog(firstDuplicate.id);
      return;
    }
    saveDecision(button.dataset.status, { advance: true });
  });
});

el.currentUndoBtn.addEventListener("click", () => undoRecord(state.contact.id));

el.mergeForm.addEventListener("submit", (event) => {
  if (event.submitter === el.confirmMergeBtn) {
    event.preventDefault();
    confirmMerge();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea, select")) return;
  if (event.key === "ArrowLeft") loadContact(Math.max(0, state.index - 1));
  if (event.key === "ArrowRight") loadContact(Math.min(state.total - 1, state.index + 1));
  if (event.key.toLowerCase() === "k") saveDecision("keep", { advance: true });
  if (event.key.toLowerCase() === "d") saveDecision("delete", { advance: true });
  if (event.key.toLowerCase() === "m") saveDecision("maybe", { advance: true });
});

el.exportBtn.addEventListener("click", async () => {
  el.exportBtn.disabled = true;
  try {
    const output = await api("/api/export", { method: "POST", body: "{}" });
    el.exportMessage.hidden = false;
    el.exportMessage.textContent = `Exported reviewed CSV, deletion list, and colour-coded HTML. Delete-marked contacts: ${output.deleteCount}. Files: ${output.reviewedPath}, ${output.deletePath}, and ${output.htmlPath}`;
  } finally {
    el.exportBtn.disabled = false;
  }
});

async function init() {
  const meta = await api("/api/meta");
  state.total = meta.total;
  updateStats(meta.stats);
  updateUndo(meta.canUndo);
  await loadNextUnreviewed(-1);
  await search();
}

init().catch((error) => {
  document.body.innerHTML = `<pre>${escapeHtml(error.stack || error.message)}</pre>`;
});
