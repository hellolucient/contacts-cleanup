const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 4173);
const APP_DIR = __dirname;
const CSV_PATH = process.env.CONTACTS_CSV || path.join(APP_DIR, "contacts.csv");
const PUBLIC_DIR = path.join(APP_DIR, "public");
const DATA_DIR = path.join(APP_DIR, "data");
const EXPORT_DIR = path.join(APP_DIR, "exports");
const DECISIONS_PATH = path.join(DATA_DIR, "review-decisions.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(EXPORT_DIR, { recursive: true });

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

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusColor(status) {
  return {
    keep: "#d9efec",
    delete: "#f5d9db",
    maybe: "#f5e4ca",
    merged: "#dde7f8",
    unreviewed: "#ffffff",
  }[status || "unreviewed"] || "#ffffff";
}

function readContacts() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Contacts CSV not found: ${CSV_PATH}`);
    console.error("Set CONTACTS_CSV=/absolute/path/to/contacts.csv or place contacts.csv in this folder.");
    process.exit(1);
  }
  const text = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(text).filter((row) => row.some((value) => value.trim()));
  const headers = rows[0].map((header) => header.trim());
  const contacts = rows.slice(1).map((row, index) => {
    const record = {};
    headers.forEach((header, i) => {
      record[header] = row[i] || "";
    });
    return {
      id: `c${index + 1}`,
      rowNumber: index + 2,
      record,
      search: buildSearch(record),
      tokens: buildTokens(record),
    };
  });
  return { headers, contacts };
}

function loadDecisions() {
  try {
    const loaded = JSON.parse(fs.readFileSync(DECISIONS_PATH, "utf8"));
    if (!Array.isArray(loaded._history)) loaded._history = [];
    if (!Array.isArray(loaded._notDuplicates)) loaded._notDuplicates = [];
    return loaded;
  } catch {
    return { _history: [], _notDuplicates: [] };
  }
}

function saveDecisions(decisions) {
  fs.writeFileSync(DECISIONS_PATH, JSON.stringify(decisions, null, 2));
}

function publicDecisions() {
  return Object.fromEntries(Object.entries(decisions).filter(([key]) => !key.startsWith("_")));
}

function getDecision(id) {
  return decisions[id] || null;
}

function pairKey(a, b) {
  return [a, b].sort().join("::");
}

function isDismissedDuplicate(a, b) {
  return (decisions._notDuplicates || []).includes(pairKey(a, b));
}

function rememberChange(label, focusIndex, changes) {
  decisions._history = decisions._history || [];
  decisions._history.push({
    label,
    focusIndex,
    changes,
    createdAt: new Date().toISOString(),
  });
  decisions._history = decisions._history.slice(-50);
}

function canUndoRecord(id) {
  const decision = getDecision(id);
  return Boolean(
    (decisions._history || []).some((entry) => entry.changes.some((change) => change.id === id)) ||
      (decision && (decision.status || "unreviewed") !== "unreviewed"),
  );
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@.+]+/g, " ")
    .trim();
}

function emailValues(record) {
  return ["E-mail Address", "E-mail 2 Address", "E-mail 3 Address"]
    .map((key) => normalize(record[key]))
    .filter(Boolean);
}

function phoneValues(record) {
  return [
    "Home Phone",
    "Home Phone 2",
    "Business Phone",
    "Business Phone 2",
    "Mobile Phone",
    "Car Phone",
    "Other Phone",
    "Primary Phone",
    "Company Main Phone",
    "Assistant's Phone",
  ]
    .map((key) => String(record[key] || "").replace(/\D/g, ""))
    .filter((value) => value.length >= 6);
}

function fullName(record) {
  return [record["First Name"], record["Middle Name"], record["Last Name"]]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
}

function displayName(record) {
  return fullName(record) || record.Nickname || record.Company || emailValues(record)[0] || phoneValues(record)[0] || "Unnamed contact";
}

function buildTokens(record) {
  const name = normalize(fullName(record));
  const reversedName = normalize([record["Last Name"], record["First Name"]].filter(Boolean).join(" "));
  return {
    name,
    reversedName,
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

function scoreDuplicate(a, b) {
  let score = 0;
  const reasons = [];

  const emailOverlap = a.tokens.emails.filter((email) => b.tokens.emails.includes(email));
  if (emailOverlap.length) {
    score += 80;
    reasons.push("same email");
  }

  const phoneOverlap = a.tokens.phones.filter((phone) => b.tokens.phones.includes(phone));
  if (phoneOverlap.length) {
    score += 50;
    reasons.push("same phone");
  }

  if (a.tokens.name && (a.tokens.name === b.tokens.name || a.tokens.name === b.tokens.reversedName)) {
    score += 45;
    reasons.push("same name");
  } else if (a.tokens.first && a.tokens.last && a.tokens.first === b.tokens.first && a.tokens.last === b.tokens.last) {
    score += 40;
    reasons.push("same first and last");
  } else if (a.tokens.last && a.tokens.last === b.tokens.last && (a.tokens.first === b.tokens.first || !a.tokens.first || !b.tokens.first)) {
    score += 20;
    reasons.push("similar name");
  }

  if (a.tokens.company && a.tokens.company === b.tokens.company) {
    score += 12;
    reasons.push("same company");
  }

  if (!emailOverlap.length && !phoneOverlap.length && score < 45) return null;
  return { score, reasons };
}

const state = readContacts();
let decisions = loadDecisions();

function contactSummary(contact) {
  const decision = getDecision(contact.id) || {};
  const record = { ...contact.record, ...(decision.edits || {}) };
  return {
    id: contact.id,
    rowNumber: contact.rowNumber,
    displayName: displayName(record),
    company: record.Company || "",
    emails: emailValues(record),
    phones: phoneValues(record),
    status: decision.status || "unreviewed",
    reviewNote: decision.reviewNote || "",
    canUndo: canUndoRecord(contact.id),
  };
}

function contactDetails(index) {
  const contact = state.contacts[index];
  if (!contact) return null;

  const decision = getDecision(contact.id) || {};
  const record = { ...contact.record, ...(decision.edits || {}) };
  const current = { ...contact, record, displayName: displayName(record) };
  const duplicates = [];

  for (let candidateIndex = 0; candidateIndex < state.contacts.length; candidateIndex += 1) {
    const candidate = state.contacts[candidateIndex];
    if (candidate.id === contact.id) continue;
    if (isDismissedDuplicate(contact.id, candidate.id)) continue;
    const match = scoreDuplicate(current, candidate);
    if (match) {
      duplicates.push({
        ...contactSummary(candidate),
        index: candidateIndex,
        record: { ...candidate.record, ...((getDecision(candidate.id) || {}).edits || {}) },
        score: match.score,
        reasons: match.reasons,
      });
    }
  }

  duplicates.sort((a, b) => b.score - a.score || a.rowNumber - b.rowNumber);

  return {
    index,
    total: state.contacts.length,
    headers: state.headers,
    contact: {
      id: current.id,
      rowNumber: current.rowNumber,
      displayName: current.displayName,
      record,
      original: contact.record,
      decision: {
        status: decision.status || "unreviewed",
        reviewNote: decision.reviewNote || "",
        edits: decision.edits || {},
        updatedAt: decision.updatedAt || "",
      },
      canUndo: canUndoRecord(current.id),
    },
    duplicates: duplicates.slice(0, 12),
  };
}

function stats() {
  const counts = { unreviewed: 0, keep: 0, delete: 0, maybe: 0, merged: 0 };
  for (const contact of state.contacts) {
    const status = getDecision(contact.id)?.status || "unreviewed";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function sendJson(res, payload, status = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

function exportReview() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reviewedHeaders = [
    "Review Status",
    "Review Color",
    "Review Note",
    "Source Row",
    "Contact ID",
    ...state.headers,
  ];
  const deletionRows = [];
  const allRows = [reviewedHeaders];

  for (const contact of state.contacts) {
    const decision = getDecision(contact.id) || {};
    const record = { ...contact.record, ...(decision.edits || {}) };
    const status = decision.status || "unreviewed";
    const row = [
      status,
      statusColor(status),
      decision.reviewNote || "",
      contact.rowNumber,
      contact.id,
      ...state.headers.map((header) => record[header] || ""),
    ];
    allRows.push(row);
    if (status === "delete") deletionRows.push(row);
  }

  const reviewedPath = path.join(EXPORT_DIR, `contacts-reviewed-${timestamp}.csv`);
  const deletePath = path.join(EXPORT_DIR, `contacts-marked-for-deletion-${timestamp}.csv`);
  const htmlPath = path.join(EXPORT_DIR, `contacts-reviewed-colour-coded-${timestamp}.html`);
  fs.writeFileSync(reviewedPath, allRows.map((row) => row.map(csvEscape).join(",")).join("\n"));
  fs.writeFileSync(deletePath, [reviewedHeaders, ...deletionRows].map((row) => row.map(csvEscape).join(",")).join("\n"));
  fs.writeFileSync(htmlPath, buildColorCodedHtml(reviewedHeaders, allRows.slice(1)));

  return { reviewedPath, deletePath, htmlPath, deleteCount: deletionRows.length };
}

function buildColorCodedHtml(headers, rows) {
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const rowsHtml = rows
    .map((row) => {
      const status = row[0] || "unreviewed";
      const color = row[1] || statusColor(status);
      const cells = row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("");
      return `<tr style="background:${escapeHtml(color)}">${cells}</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Contacts Reviewed - Colour Coded</title>
  <style>
    body { margin: 24px; color: #1f2a2e; font-family: Arial, sans-serif; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #c9c3b7; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #ebe7dc; position: sticky; top: 0; }
    td { white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Contacts Reviewed - Colour Coded</h1>
  <table>
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
}

function staticFile(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
  }[ext] || "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/meta") {
      sendJson(res, {
        csvPath: CSV_PATH,
        total: state.contacts.length,
        headers: state.headers,
        stats: stats(),
        canUndo: (decisions._history || []).length > 0,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/contact") {
      const index = Math.max(0, Math.min(state.contacts.length - 1, Number(url.searchParams.get("index") || 0)));
      sendJson(res, contactDetails(index));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/search") {
      const query = normalize(url.searchParams.get("q") || "");
      const status = url.searchParams.get("status") || "";
      const results = state.contacts
        .map((contact, index) => ({ contact, index }))
        .filter(({ contact }) => {
          const currentStatus = decisions[contact.id]?.status || "unreviewed";
          return (!status || status === currentStatus) && (!query || contact.search.includes(query));
        })
        .slice(0, 100)
        .map(({ contact, index }) => ({ index, ...contactSummary(contact) }));
      sendJson(res, { results });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/next-unreviewed") {
      const from = Math.max(-1, Number(url.searchParams.get("from") || -1));
      let index = -1;
      for (let i = from + 1; i < state.contacts.length; i += 1) {
        if ((getDecision(state.contacts[i].id)?.status || "unreviewed") === "unreviewed") {
          index = i;
          break;
        }
      }
      sendJson(res, { index });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/decision") {
      const body = await readBody(req);
      const contact = state.contacts.find((item) => item.id === body.id);
      if (!contact) {
        sendJson(res, { error: "Contact not found" }, 404);
        return;
      }

      const cleanEdits = {};
      for (const [key, value] of Object.entries(body.edits || {})) {
        if (state.headers.includes(key) && value !== contact.record[key]) cleanEdits[key] = String(value || "");
      }

      const before = getDecision(body.id);
      const after = {
        status: body.status || decisions[body.id]?.status || "unreviewed",
        reviewNote: String(body.reviewNote || ""),
        edits: cleanEdits,
        updatedAt: new Date().toISOString(),
      };
      decisions[body.id] = after;
      rememberChange("Status change", state.contacts.findIndex((item) => item.id === body.id), [
        { id: body.id, before, after },
      ]);
      saveDecisions(decisions);
      sendJson(res, { ok: true, stats: stats(), canUndo: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/delete-pair") {
      const body = await readBody(req);
      const current = state.contacts.find((item) => item.id === body.currentId);
      const duplicate = state.contacts.find((item) => item.id === body.duplicateId);
      if (!current || !duplicate) {
        sendJson(res, { error: "Contact not found" }, 404);
        return;
      }

      const currentDecision = getDecision(current.id) || {};
      const duplicateDecision = getDecision(duplicate.id) || {};
      const beforeCurrent = getDecision(current.id);
      const beforeDuplicate = getDecision(duplicate.id);
      const now = new Date().toISOString();

      const afterCurrent = {
        ...currentDecision,
        status: "delete",
        reviewNote: body.currentNote || currentDecision.reviewNote || "",
        edits: body.currentEdits || currentDecision.edits || {},
        updatedAt: now,
      };

      const afterDuplicate = {
        ...duplicateDecision,
        status: "delete",
        reviewNote:
          duplicateDecision.reviewNote ||
          `Marked for deletion as duplicate of ${current.id} / source row ${current.rowNumber}.`,
        edits: duplicateDecision.edits || {},
        updatedAt: now,
      };
      decisions[current.id] = afterCurrent;
      decisions[duplicate.id] = afterDuplicate;
      rememberChange("Delete duplicate pair", state.contacts.findIndex((item) => item.id === current.id), [
        { id: current.id, before: beforeCurrent, after: afterCurrent },
        { id: duplicate.id, before: beforeDuplicate, after: afterDuplicate },
      ]);

      saveDecisions(decisions);
      sendJson(res, { ok: true, stats: stats(), canUndo: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/merge-records") {
      const body = await readBody(req);
      const source = state.contacts.find((item) => item.id === body.sourceId);
      const target = state.contacts.find((item) => item.id === body.targetId);
      if (!source || !target) {
        sendJson(res, { error: "Contact not found" }, 404);
        return;
      }

      const sourceDecision = getDecision(source.id) || {};
      const targetDecision = getDecision(target.id) || {};
      const beforeSource = getDecision(source.id);
      const beforeTarget = getDecision(target.id);
      const now = new Date().toISOString();
      const mergedEdits = {};
      for (const [key, value] of Object.entries(body.targetEdits || {})) {
        if (state.headers.includes(key) && value !== target.record[key]) mergedEdits[key] = String(value || "");
      }

      const afterSource = {
        ...sourceDecision,
        status: "merged",
        reviewNote:
          body.sourceNote ||
          sourceDecision.reviewNote ||
          `Merged into ${target.id} / source row ${target.rowNumber}.`,
        edits: sourceDecision.edits || {},
        updatedAt: now,
      };
      const afterTarget = {
        ...targetDecision,
        status: "keep",
        reviewNote:
          targetDecision.reviewNote ||
          `Received merged fields from ${source.id} / source row ${source.rowNumber}.`,
        edits: { ...(targetDecision.edits || {}), ...mergedEdits },
        updatedAt: now,
      };

      decisions[source.id] = afterSource;
      decisions[target.id] = afterTarget;
      rememberChange("Merge contacts", state.contacts.findIndex((item) => item.id === source.id), [
        { id: source.id, before: beforeSource, after: afterSource },
        { id: target.id, before: beforeTarget, after: afterTarget },
      ]);

      saveDecisions(decisions);
      sendJson(res, { ok: true, stats: stats(), canUndo: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/undo") {
      const history = decisions._history || [];
      const last = history.pop();
      if (!last) {
        sendJson(res, { ok: false, stats: stats(), canUndo: false });
        return;
      }

      for (const change of last.changes) {
        if (change.before) {
          decisions[change.id] = change.before;
        } else {
          delete decisions[change.id];
        }
      }
      decisions._history = history;
      saveDecisions(decisions);
      sendJson(res, {
        ok: true,
        undone: last.label,
        focusIndex: last.focusIndex || 0,
        stats: stats(),
        canUndo: history.length > 0,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/undo-record") {
      const body = await readBody(req);
      const history = decisions._history || [];
      let undone = null;

      for (let i = history.length - 1; i >= 0; i -= 1) {
        const changeIndex = history[i].changes.findIndex((change) => change.id === body.id);
        if (changeIndex === -1) continue;

        const [change] = history[i].changes.splice(changeIndex, 1);
        if (change.before) {
          decisions[change.id] = change.before;
        } else {
          delete decisions[change.id];
        }
        undone = history[i].label;
        if (!history[i].changes.length) history.splice(i, 1);
        break;
      }

      if (!undone && getDecision(body.id)) {
        delete decisions[body.id];
        undone = "Reset record status";
      }

      decisions._history = history;
      saveDecisions(decisions);
      sendJson(res, {
        ok: Boolean(undone),
        undone,
        stats: stats(),
        canUndo: Boolean(undone) && canUndoRecord(body.id),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/not-duplicate") {
      const body = await readBody(req);
      const current = state.contacts.find((item) => item.id === body.currentId);
      const duplicate = state.contacts.find((item) => item.id === body.duplicateId);
      if (!current || !duplicate) {
        sendJson(res, { error: "Contact not found" }, 404);
        return;
      }

      decisions._notDuplicates = decisions._notDuplicates || [];
      const key = pairKey(current.id, duplicate.id);
      if (!decisions._notDuplicates.includes(key)) decisions._notDuplicates.push(key);
      saveDecisions(decisions);
      sendJson(res, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/export") {
      const output = exportReview();
      sendJson(res, { ok: true, ...output });
      return;
    }

    staticFile(res, url.pathname);
  } catch (error) {
    sendJson(res, { error: error.message }, 500);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Contacts review app running at http://localhost:${PORT}`);
  console.log(`Reading contacts from: ${CSV_PATH}`);
  console.log(`Review decisions: ${DECISIONS_PATH}`);
});
