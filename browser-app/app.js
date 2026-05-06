const STORAGE_PREFIX = "contacts-cleanup-browser:";

const state = {
  fileName: "",
  fileKey: "",
  headers: [],
  contacts: [],
  decisions: { _history: [], _notDuplicates: [] },
  index: 0,
  duplicates: [],
  saveTimer: null,
};

const importantFields = [
  "E-mail Address", "E-mail 2 Address", "E-mail 3 Address", "Mobile Phone", "Home Phone",
  "Business Phone", "Company", "Job Title", "Business City", "Business Country/Region",
  "Home City", "Home Country/Region", "Birthday", "Notes",
];

const editFields = [
  "First Name", "Middle Name", "Last Name", "Nickname", "E-mail Address", "E-mail 2 Address",
  "E-mail 3 Address", "Mobile Phone", "Home Phone", "Business Phone", "Company", "Job Title",
  "Business Street", "Business City", "Business Country/Region", "Home Street", "Home City",
  "Home Country/Region", "Notes",
];

const el = {
  csvInput: document.querySelector("#csvInput"),
  exportBtn: document.querySelector("#exportBtn"),
  message: document.querySelector("#message"),
  positionLabel: document.querySelector("#positionLabel"),
  reviewedLabel: document.querySelector("#reviewedLabel"),
  progressBar: document.querySelector("#progressBar"),
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  searchResults: document.querySelector("#searchResults"),
  prevBtn: document.querySelector("#prevBtn"),
  nextBtn: document.querySelector("#nextBtn"),
  resumeBtn: document.querySelector("#resumeBtn"),
  jumpInput: document.querySelector("#jumpInput"),
  deleteDupesBtn: document.querySelector("#deleteDupesBtn"),
  rowMeta: document.querySelector("#rowMeta"),
  displayName: document.querySelector("#displayName"),
  companyLine: document.querySelector("#companyLine"),
  statusPill: document.querySelector("#statusPill"),
  currentUndoBtn: document.querySelector("#currentUndoBtn"),
  primaryFields: document.querySelector("#primaryFields"),
  reviewNote: document.querySelector("#reviewNote"),
  applyNoteBtn: document.querySelector("#applyNoteBtn"),
  applyNoteStatus: document.querySelector("#applyNoteStatus"),
  editFields: document.querySelector("#editFields"),
  saveEditsBtn: document.querySelector("#saveEditsBtn"),
  saveEditsStatus: document.querySelector("#saveEditsStatus"),
  duplicates: document.querySelector("#duplicates"),
  duplicateCount: document.querySelector("#duplicateCount"),
  statUnreviewed: document.querySelector("#statUnreviewed"),
  statKeep: document.querySelector("#statKeep"),
  statDelete: document.querySelector("#statDelete"),
  statMaybe: document.querySelector("#statMaybe"),
  mergeDialog: document.querySelector("#mergeDialog"),
  mergeForm: document.querySelector("#mergeForm"),
  mergeTitle: document.querySelector("#mergeTitle"),
  mergeFields: document.querySelector("#mergeFields"),
  confirmMergeBtn: document.querySelector("#confirmMergeBtn"),
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@.+]+/g, " ")
    .trim();
}

function fullName(record) {
  return [record["First Name"], record["Middle Name"], record["Last Name"]].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
}

function emailValues(record) {
  return ["E-mail Address", "E-mail 2 Address", "E-mail 3 Address"].map((key) => normalize(record[key])).filter(Boolean);
}

function phoneValues(record) {
  return ["Home Phone", "Home Phone 2", "Business Phone", "Business Phone 2", "Mobile Phone", "Car Phone", "Other Phone", "Primary Phone", "Company Main Phone", "Assistant's Phone"]
    .map((key) => String(record[key] || "").replace(/\D/g, ""))
    .filter((value) => value.length >= 6);
}

function displayName(record) {
  return fullName(record) || record.Nickname || record.Company || emailValues(record)[0] || phoneValues(record)[0] || "Unnamed contact";
}

function buildTokens(record) {
  return {
    name: normalize(fullName(record)),
    reversedName: normalize([record["Last Name"], record["First Name"]].filter(Boolean).join(" ")),
    first: normalize(record["First Name"]),
    last: normalize(record["Last Name"]),
    company: normalize(record.Company),
    emails: emailValues(record),
    phones: phoneValues(record),
  };
}

function buildSearch(record) {
  return Object.values(record).map(normalize).filter(Boolean).join(" ");
}

function pairKey(a, b) {
  return [a, b].sort().join("::");
}

function getDecision(id) {
  return state.decisions[id] || null;
}

function statusClass(status) {
  return ["keep", "delete", "maybe", "merged"].includes(status) ? status : "";
}

function statusColor(status) {
  return { keep: "#d9efec", delete: "#f5d9db", maybe: "#f5e4ca", merged: "#dde7f8", unreviewed: "#ffffff" }[status || "unreviewed"] || "#ffffff";
}

function currentRecord(contact) {
  const decision = getDecision(contact.id) || {};
  return { ...contact.record, ...(decision.edits || {}) };
}

function canUndoRecord(id) {
  const decision = getDecision(id);
  return Boolean((state.decisions._history || []).some((entry) => entry.changes.some((change) => change.id === id)) || (decision && (decision.status || "unreviewed") !== "unreviewed"));
}

function rememberChange(label, focusIndex, changes) {
  state.decisions._history = state.decisions._history || [];
  state.decisions._history.push({ label, focusIndex, changes, createdAt: new Date().toISOString() });
  state.decisions._history = state.decisions._history.slice(-50);
}

function storageKey() {
  return `${STORAGE_PREFIX}${state.fileKey || state.fileName}`;
}

function saveLocalState() {
  if (!state.fileName) return;
  localStorage.setItem(storageKey(), JSON.stringify(state.decisions));
}

function loadLocalState(fileKey) {
  try {
    const loaded = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${fileKey}`) || "{}");
    if (!Array.isArray(loaded._history)) loaded._history = [];
    if (!Array.isArray(loaded._notDuplicates)) loaded._notDuplicates = [];
    state.decisions = loaded;
  } catch {
    state.decisions = { _history: [], _notDuplicates: [] };
  }
}

function scoreDuplicate(a, b) {
  let score = 0;
  const reasons = [];
  const emailOverlap = a.tokens.emails.filter((email) => b.tokens.emails.includes(email));
  if (emailOverlap.length) { score += 80; reasons.push("same email"); }
  const phoneOverlap = a.tokens.phones.filter((phone) => b.tokens.phones.includes(phone));
  if (phoneOverlap.length) { score += 50; reasons.push("same phone"); }
  if (a.tokens.name && (a.tokens.name === b.tokens.name || a.tokens.name === b.tokens.reversedName)) {
    score += 45; reasons.push("same name");
  } else if (a.tokens.first && a.tokens.last && a.tokens.first === b.tokens.first && a.tokens.last === b.tokens.last) {
    score += 40; reasons.push("same first and last");
  } else if (a.tokens.last && a.tokens.last === b.tokens.last && (a.tokens.first === b.tokens.first || !a.tokens.first || !b.tokens.first)) {
    score += 20; reasons.push("similar name");
  }
  if (a.tokens.company && a.tokens.company === b.tokens.company) { score += 12; reasons.push("same company"); }
  if (!emailOverlap.length && !phoneOverlap.length && score < 45) return null;
  return { score, reasons };
}

function contactSummary(contact, index = null) {
  const record = currentRecord(contact);
  const decision = getDecision(contact.id) || {};
  return {
    index,
    id: contact.id,
    rowNumber: contact.rowNumber,
    displayName: displayName(record),
    company: record.Company || "",
    emails: emailValues(record),
    phones: phoneValues(record),
    status: decision.status || "unreviewed",
    reviewNote: decision.reviewNote || "",
    record,
    canUndo: canUndoRecord(contact.id),
  };
}

function findDuplicates(contact) {
  const record = currentRecord(contact);
  const current = { ...contact, record, tokens: buildTokens(record) };
  const duplicates = [];
  for (let index = 0; index < state.contacts.length; index += 1) {
    const candidate = state.contacts[index];
    if (candidate.id === contact.id) continue;
    if ((state.decisions._notDuplicates || []).includes(pairKey(contact.id, candidate.id))) continue;
    const match = scoreDuplicate(current, candidate);
    if (match) duplicates.push({ ...contactSummary(candidate, index), score: match.score, reasons: match.reasons });
  }
  return duplicates.sort((a, b) => b.score - a.score || a.rowNumber - b.rowNumber).slice(0, 12);
}

function stats() {
  const counts = { unreviewed: 0, keep: 0, delete: 0, maybe: 0, merged: 0 };
  for (const contact of state.contacts) {
    const status = getDecision(contact.id)?.status || "unreviewed";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function updateStats() {
  const counts = stats();
  const reviewed = counts.keep + counts.delete + counts.maybe + counts.merged;
  el.reviewedLabel.textContent = `${reviewed.toLocaleString()} reviewed`;
  el.progressBar.style.width = `${state.contacts.length ? (reviewed / state.contacts.length) * 100 : 0}%`;
  el.statUnreviewed.textContent = counts.unreviewed.toLocaleString();
  el.statKeep.textContent = counts.keep.toLocaleString();
  el.statDelete.textContent = counts.delete.toLocaleString();
  el.statMaybe.textContent = counts.maybe.toLocaleString();
}

function setControlsEnabled(enabled) {
  [el.exportBtn, el.searchInput, el.statusFilter, el.prevBtn, el.nextBtn, el.resumeBtn, el.jumpInput, el.reviewNote, el.saveEditsBtn].forEach((node) => { node.disabled = !enabled; });
  document.querySelectorAll(".topbar .status-btn[data-status]").forEach((button) => { button.disabled = !enabled; });
}

function value(record, field) {
  return String(record[field] || "").trim();
}

function renderPrimaryFields(record) {
  const blocks = importantFields.filter((field) => value(record, field)).map((field) => {
    const wide = field === "Notes" || value(record, field).length > 80 ? " wide" : "";
    return `<div class="info-block${wide}"><span>${escapeHtml(field)}</span><strong>${escapeHtml(value(record, field))}</strong></div>`;
  });
  el.primaryFields.innerHTML = blocks.length ? blocks.join("") : '<div class="info-block wide"><span>Empty</span><strong>No populated primary fields on this contact.</strong></div>';
}

function renderEditFields(record) {
  el.editFields.innerHTML = editFields.map((field) => {
    const classes = field === "Notes" ? "field-label notes" : "field-label";
    const currentValue = escapeHtml(value(record, field));
    if (field === "Notes") return `<label class="${classes}">${field}<textarea class="field-input edit-input" data-field="${field}" rows="4">${currentValue}</textarea></label>`;
    return `<label class="${classes}">${field}<input class="field-input edit-input" data-field="${field}" value="${currentValue}" /></label>`;
  }).join("");
  document.querySelectorAll(".edit-input").forEach((input) => input.addEventListener("input", scheduleSave));
}

function renderDuplicates(duplicates) {
  el.duplicateCount.textContent = duplicates.length;
  if (!duplicates.length) {
    el.duplicates.innerHTML = '<p class="subtle">No obvious duplicates found for this record.</p>';
    return;
  }
  el.duplicates.innerHTML = duplicates.map((item) => `
    <div class="duplicate-item ${statusClass(item.status)}">
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
    </div>`).join("");
  document.querySelectorAll(".duplicate-open").forEach((button) => button.addEventListener("click", () => loadContact(Number(button.dataset.index))));
  document.querySelectorAll(".duplicate-undo").forEach((button) => button.addEventListener("click", () => undoRecord(button.dataset.id)));
  document.querySelectorAll(".duplicate-delete").forEach((button) => button.addEventListener("click", () => setDuplicateStatus(button.dataset.id, "delete")));
  document.querySelectorAll(".duplicate-keep").forEach((button) => button.addEventListener("click", () => keepDuplicate(button.dataset.id)));
  document.querySelectorAll(".not-duplicate").forEach((button) => button.addEventListener("click", () => dismissDuplicate(button.dataset.id)));
  document.querySelectorAll(".pair-merge").forEach((button) => button.addEventListener("click", () => openMergeDialog(button.dataset.id)));
}

function renderContact() {
  if (!state.contacts.length) return;
  const contact = state.contacts[state.index];
  const record = currentRecord(contact);
  const decision = getDecision(contact.id) || {};
  const status = decision.status || "unreviewed";
  state.duplicates = findDuplicates(contact);
  el.positionLabel.textContent = `${state.index + 1} of ${state.contacts.length.toLocaleString()}`;
  el.jumpInput.value = state.index + 1;
  el.jumpInput.max = state.contacts.length;
  el.rowMeta.textContent = `Source row ${contact.rowNumber} · ${contact.id}`;
  el.displayName.textContent = displayName(record);
  el.companyLine.textContent = [value(record, "Company"), value(record, "Job Title")].filter(Boolean).join(" · ");
  el.statusPill.textContent = status;
  el.statusPill.className = `status-pill ${statusClass(status)}`;
  el.currentUndoBtn.hidden = !canUndoRecord(contact.id);
  el.applyNoteBtn.hidden = !state.duplicates.length;
  el.deleteDupesBtn.hidden = !state.duplicates.length;
  document.querySelector(".contact-card").className = `contact-card ${statusClass(status)}`;
  el.reviewNote.value = decision.reviewNote || "";
  document.querySelectorAll(".topbar .status-btn[data-status]").forEach((button) => button.classList.toggle("active", button.dataset.status === status));
  document.querySelector('.topbar .status-btn[data-status="merged"]').disabled = !state.duplicates.length;
  renderPrimaryFields(record);
  renderEditFields(record);
  renderDuplicates(state.duplicates);
  updateStats();
}

function loadContact(index) {
  state.index = Math.max(0, Math.min(state.contacts.length - 1, index));
  renderContact();
}

function loadNextUnreviewed(fromIndex = state.index) {
  for (let index = fromIndex + 1; index < state.contacts.length; index += 1) {
    if ((getDecision(state.contacts[index].id)?.status || "unreviewed") === "unreviewed") return loadContact(index);
  }
  loadContact(Math.min(state.contacts.length - 1, fromIndex + 1));
}

function gatherEdits() {
  const edits = {};
  document.querySelectorAll(".edit-input").forEach((input) => { edits[input.dataset.field] = input.value; });
  return edits;
}

function saveDecision(status = null, options = {}) {
  if (!state.contacts.length) return;
  const contact = state.contacts[state.index];
  const before = getDecision(contact.id);
  const after = {
    status: status || before?.status || "unreviewed",
    reviewNote: el.reviewNote.value,
    edits: Object.fromEntries(Object.entries(gatherEdits()).filter(([key, value]) => value !== contact.record[key])),
    updatedAt: new Date().toISOString(),
  };
  state.decisions[contact.id] = after;
  rememberChange("Status change", state.index, [{ id: contact.id, before, after }]);
  saveLocalState();
  if (options.silent) return;
  if (options.advance) loadNextUnreviewed(state.index);
  else renderContact();
}

function saveCurrentEdits() {
  window.clearTimeout(state.saveTimer);
  el.saveEditsStatus.textContent = "Saving...";
  saveDecision(null);
  el.saveEditsStatus.textContent = "Saved";
  window.setTimeout(() => { el.saveEditsStatus.textContent = ""; }, 1400);
}

function setDecisionForContact(contact, status, note = null, edits = null) {
  const before = getDecision(contact.id);
  const after = {
    ...(before || {}),
    status,
    reviewNote: note ?? before?.reviewNote ?? "",
    edits: edits ?? before?.edits ?? {},
    updatedAt: new Date().toISOString(),
  };
  state.decisions[contact.id] = after;
  return { id: contact.id, before, after };
}

function deleteCurrentAndVisibleDuplicates() {
  const changes = [setDecisionForContact(state.contacts[state.index], "delete", el.reviewNote.value, gatherEdits())];
  for (const duplicate of state.duplicates) changes.push(setDecisionForContact(state.contacts[duplicate.index], "delete", getDecision(duplicate.id)?.reviewNote || `Marked for deletion with ${state.contacts[state.index].id}.`));
  rememberChange("Delete current and duplicates", state.index, changes);
  saveLocalState();
  loadNextUnreviewed(state.index);
}

function setDuplicateStatus(id, status) {
  const duplicate = state.duplicates.find((item) => item.id === id);
  if (!duplicate) return;
  const changes = [setDecisionForContact(state.contacts[duplicate.index], status, duplicate.reviewNote || "", duplicate.record)];
  rememberChange(`${status} duplicate`, state.index, changes);
  saveLocalState();
  renderContact();
}

function keepDuplicate(id) {
  const duplicate = state.duplicates.find((item) => item.id === id);
  if (!duplicate) return;
  const changes = [setDecisionForContact(state.contacts[duplicate.index], "keep", duplicate.reviewNote || "Kept as related contact; not a duplicate.", duplicate.record)];
  state.decisions._notDuplicates.push(pairKey(state.contacts[state.index].id, id));
  rememberChange("Keep duplicate", state.index, changes);
  saveLocalState();
  renderContact();
}

function dismissDuplicate(id) {
  const key = pairKey(state.contacts[state.index].id, id);
  if (!state.decisions._notDuplicates.includes(key)) state.decisions._notDuplicates.push(key);
  saveLocalState();
  renderContact();
}

function applyNoteToDuplicates() {
  const note = el.reviewNote.value.trim();
  if (!note) {
    el.applyNoteStatus.textContent = "Add a note first";
    window.setTimeout(() => { el.applyNoteStatus.textContent = ""; }, 1600);
    return;
  }
  saveDecision(null, { silent: true });
  const changes = state.duplicates.map((duplicate) => setDecisionForContact(state.contacts[duplicate.index], getDecision(duplicate.id)?.status || "unreviewed", note));
  rememberChange("Apply note to duplicates", state.index, changes);
  saveLocalState();
  el.applyNoteStatus.textContent = `Applied to ${changes.length}`;
  renderContact();
  window.setTimeout(() => { el.applyNoteStatus.textContent = ""; }, 1600);
}

function undoRecord(id) {
  const history = state.decisions._history || [];
  let undone = false;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const changeIndex = history[i].changes.findIndex((change) => change.id === id);
    if (changeIndex === -1) continue;
    const [change] = history[i].changes.splice(changeIndex, 1);
    if (change.before) state.decisions[change.id] = change.before;
    else delete state.decisions[change.id];
    if (!history[i].changes.length) history.splice(i, 1);
    undone = true;
    break;
  }
  if (!undone && getDecision(id)) delete state.decisions[id];
  saveLocalState();
  renderContact();
}

function openMergeDialog(targetId) {
  const target = state.duplicates.find((item) => item.id === targetId);
  if (!target) return;
  state.mergeTarget = target;
  el.mergeTitle.textContent = `Build final record for ${displayName(currentRecord(state.contacts[state.index]))}`;
  const sourceRecord = { ...currentRecord(state.contacts[state.index]), ...gatherEdits() };
  const sources = state.duplicates.map((item, index) => ({ ...item, label: `Duplicate ${index + 1}` }));
  const fields = Array.from(new Set([...editFields, ...importantFields, "Business Phone 2", "Business Fax", "Business Postal Code"]));
  el.mergeFields.innerHTML = fields.filter((field) => sources.some((source) => value(source.record, field)) || value(sourceRecord, field)).map((field) => {
    const sourceCells = sources.map((source) => {
      const sourceValue = value(source.record, field);
      return `<button type="button" class="merge-source" draggable="${sourceValue ? "true" : "false"}" data-value="${escapeHtml(sourceValue)}"><strong>${escapeHtml(source.label)}</strong><small>Row ${source.rowNumber}</small><span>${escapeHtml(sourceValue || "Blank")}</span></button>`;
    }).join("");
    return `<div class="merge-row" data-field="${escapeHtml(field)}"><div class="merge-row-name">${escapeHtml(field)}</div><label class="merge-final"><textarea class="merge-final-input" data-field="${escapeHtml(field)}" rows="${field === "Notes" || field.includes("Street") ? "3" : "2"}">${escapeHtml(value(sourceRecord, field))}</textarea></label><div class="merge-sources">${sourceCells}</div></div>`;
  }).join("");
  wireMergeValueTransfers();
  el.mergeDialog.showModal();
}

function confirmMerge() {
  const targetEdits = {};
  document.querySelectorAll(".merge-final-input").forEach((input) => { targetEdits[input.dataset.field] = input.value; });
  const current = state.contacts[state.index];
  const source = state.contacts[state.mergeTarget.index];
  const changes = [
    setDecisionForContact(source, "merged", `Merged into ${current.id}.`),
    setDecisionForContact(current, "keep", getDecision(current.id)?.reviewNote || `Received merged fields from ${source.id}.`, Object.fromEntries(Object.entries(targetEdits).filter(([key, value]) => value !== current.record[key]))),
  ];
  rememberChange("Merge contacts", state.index, changes);
  saveLocalState();
  el.mergeDialog.close();
  loadNextUnreviewed(state.index);
}

function wireMergeValueTransfers() {
  document.querySelectorAll(".merge-source").forEach((button) => {
    button.addEventListener("click", () => {
      const input = button.closest(".merge-row")?.querySelector(".merge-final-input");
      if (input && button.dataset.value) input.value = button.dataset.value;
    });
    button.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", button.dataset.value || ""));
  });
  document.querySelectorAll(".merge-final-input").forEach((input) => {
    input.addEventListener("dragover", (event) => { event.preventDefault(); input.classList.add("drop-ready"); });
    input.addEventListener("dragleave", () => input.classList.remove("drop-ready"));
    input.addEventListener("drop", (event) => {
      event.preventDefault();
      input.classList.remove("drop-ready");
      const droppedValue = event.dataTransfer.getData("text/plain");
      if (droppedValue) input.value = droppedValue;
    });
  });
}

function scheduleSave() {
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => saveDecision(null, { silent: true }), 700);
}

function search() {
  const query = normalize(el.searchInput.value);
  const status = el.statusFilter.value;
  const results = state.contacts.map((contact, index) => ({ contact, index })).filter(({ contact }) => {
    const currentStatus = getDecision(contact.id)?.status || "unreviewed";
    return (!status || status === currentStatus) && (!query || contact.search.includes(query));
  }).slice(0, 100);
  el.searchResults.innerHTML = results.map(({ contact, index }) => {
    const item = contactSummary(contact, index);
    return `<button class="result-item" data-index="${index}"><strong>${escapeHtml(item.displayName)}</strong><div class="small-meta">Row ${item.rowNumber} · ${escapeHtml(item.status)}</div><div class="small-meta">${escapeHtml([item.company, item.emails[0], item.phones[0]].filter(Boolean).join(" · "))}</div></button>`;
  }).join("");
  document.querySelectorAll(".result-item").forEach((button) => button.addEventListener("click", () => loadContact(Number(button.dataset.index))));
}

function exportReview() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reviewedHeaders = ["Review Status", "Review Color", "Review Note", "Source Row", "Contact ID", ...state.headers];
  const allRows = [reviewedHeaders];
  const deletionRows = [];
  const cleanRows = [state.headers];
  for (const contact of state.contacts) {
    const decision = getDecision(contact.id) || {};
    const record = currentRecord(contact);
    const status = decision.status || "unreviewed";
    const row = [status, statusColor(status), decision.reviewNote || "", contact.rowNumber, contact.id, ...state.headers.map((header) => record[header] || "")];
    allRows.push(row);
    if (status === "delete") deletionRows.push(row);
    if (status !== "delete" && status !== "merged") cleanRows.push(state.headers.map((header) => record[header] || ""));
  }
  downloadCsv(`contacts-clean-${timestamp}.csv`, cleanRows);
  downloadCsv(`contacts-reviewed-${timestamp}.csv`, allRows);
  downloadCsv(`contacts-marked-for-deletion-${timestamp}.csv`, [reviewedHeaders, ...deletionRows]);
  downloadText(`contacts-reviewed-colour-coded-${timestamp}.html`, buildColorCodedHtml(reviewedHeaders, allRows.slice(1)), "text/html");
  el.message.textContent = `Exported ${cleanRows.length - 1} clean contacts and ${deletionRows.length} deletion records.`;
}

function downloadCsv(fileName, rows) {
  downloadText(fileName, rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv");
}

function downloadText(fileName, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function buildColorCodedHtml(headers, rows) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Contacts Reviewed</title><style>body{margin:24px;color:#1f2a2e;font-family:Arial,sans-serif}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #c9c3b7;padding:6px 8px;text-align:left;vertical-align:top}th{background:#ebe7dc;position:sticky;top:0}td{white-space:pre-wrap}</style></head><body><h1>Contacts Reviewed</h1><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr style="background:${escapeHtml(row[1] || statusColor(row[0]))}">${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("\n")}</tbody></table></body></html>`;
}

function loadCsvFile(file) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const rows = parseCsv(String(reader.result || "")).filter((row) => row.some((value) => String(value).trim()));
    state.fileName = file.name;
    state.fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    state.headers = rows[0].map((header) => header.trim());
    state.contacts = rows.slice(1).map((row, index) => {
      const record = {};
      state.headers.forEach((header, cellIndex) => { record[header] = row[cellIndex] || ""; });
      return { id: `c${index + 1}`, rowNumber: index + 2, record, tokens: buildTokens(record), search: buildSearch(record) };
    });
    loadLocalState(state.fileKey);
    setControlsEnabled(true);
    el.message.textContent = `Loaded ${state.contacts.length.toLocaleString()} contacts from ${file.name}. Review data is stored locally in this browser.`;
    loadNextUnreviewed(-1);
    search();
  });
  reader.readAsText(file);
}

el.csvInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (file) loadCsvFile(file);
});
el.prevBtn.addEventListener("click", () => loadContact(state.index - 1));
el.nextBtn.addEventListener("click", () => loadContact(state.index + 1));
el.resumeBtn.addEventListener("click", () => loadNextUnreviewed(-1));
el.jumpInput.addEventListener("change", () => loadContact(Number(el.jumpInput.value) - 1));
el.reviewNote.addEventListener("input", scheduleSave);
el.applyNoteBtn.addEventListener("click", applyNoteToDuplicates);
el.saveEditsBtn.addEventListener("click", saveCurrentEdits);
el.searchInput.addEventListener("input", search);
el.statusFilter.addEventListener("change", search);
document.querySelectorAll(".topbar .status-btn[data-status]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.status === "merged") {
      const firstDuplicate = state.duplicates[0];
      if (firstDuplicate) openMergeDialog(firstDuplicate.id);
      return;
    }
    saveDecision(button.dataset.status, { advance: true });
  });
});
el.deleteDupesBtn.addEventListener("click", deleteCurrentAndVisibleDuplicates);
el.currentUndoBtn.addEventListener("click", () => undoRecord(state.contacts[state.index].id));
el.mergeForm.addEventListener("submit", (event) => {
  if (event.submitter === el.confirmMergeBtn) {
    event.preventDefault();
    confirmMerge();
  }
});
el.exportBtn.addEventListener("click", exportReview);
document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea, select")) return;
  if (!state.contacts.length) return;
  if (event.key === "ArrowLeft") loadContact(state.index - 1);
  if (event.key === "ArrowRight") loadContact(state.index + 1);
  if (event.key.toLowerCase() === "k") saveDecision("keep", { advance: true });
  if (event.key.toLowerCase() === "d") saveDecision("delete", { advance: true });
  if (event.key.toLowerCase() === "m") saveDecision("maybe", { advance: true });
});

setControlsEnabled(false);
