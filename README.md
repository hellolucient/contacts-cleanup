# Contacts Cleanup

Contacts Cleanup is a local-first app for reviewing an old Outlook contacts CSV without editing the original file. It is designed for privacy-sensitive contact cleanup: source data, review decisions, and exports stay on the user's machine.

The repo now has two app tracks:

- `local-node/`: the current working developer/local version. This runs a tiny local server on `localhost`, reads a CSV path from your machine, saves review decisions to local files, and writes exports to `local-node/exports/`.
- `browser-app/`: a static no-upload browser version. The user chooses a CSV in the browser, the app processes it in that browser session, and exports download back to the same computer. There is no backend.

## Privacy

- Contacts are read from a local CSV on your machine.
- There are no analytics, third-party scripts, accounts, or cloud uploads.
- Review decisions and exports are saved locally and ignored by Git.
- Do not commit real contact CSVs, `data/`, or `exports/`.
- The browser-only app can keep working after the page has loaded, even if the user disconnects from the internet.

## Browser-Only App

Open the static app:

```text
browser-app/index.html
```

Then choose an Outlook CSV with the file picker. The CSV is parsed in the browser. Review decisions are stored in that browser's local storage using a fingerprint of the selected file name, size, and modified date.

Use this track when you want the most privacy-friendly option for non-technical users: a website can serve the app files, but contact data is not uploaded to that website.

## Local Node App

From `local-node/`, use an environment variable:

```sh
cd local-node
CONTACTS_CSV="/absolute/path/to/contacts.csv" npm start
```

Or place a local file named `contacts.csv` in `local-node/`:

```sh
npm start
```

Then open:

```text
http://localhost:4173
```

## Repo Safety

Before committing, check that Git is only seeing app files. Real contact data should stay in ignored paths such as `data/`, `exports/`, local CSV files, or browser downloads.

## Review Workflow

- Use the top-bar buttons to mark the current record as `Keep`, `Maybe`, `Delete`, or `Merged`.
- After a decision, the app auto-advances to the next unreviewed record.
- The previous/next arrows move one record at a time for manual inspection.
- `Resume` jumps to the first unreviewed record.
- Reviewed cards change color by status.
- `Undo` appears on reviewed records when the status or edits can be reset.
- Review notes are saved and included in exports.
- Field edits are saved separately from the original CSV and applied to exports.

## Duplicate Tools

When possible duplicates are detected, the duplicate panel can:

- Review a merge into a duplicate
- Keep a duplicate as its own record
- Delete a duplicate
- Mark a suggestion as not a duplicate
- Apply the current review note to visible duplicates
- Delete the current record plus visible duplicates with `Delete + Dupes`

The merge tool lets you build a final editable record from the current record and duplicate source values.

## Exports

The export button creates timestamped files. In `local-node/`, they are written to `local-node/exports/`. In `browser-app/`, they download through the browser:

- `contacts-clean-...csv`: final cleaned Outlook-style CSV. It uses the original CSV columns, applies field edits, and excludes records marked `delete` or `merged`.
- `contacts-reviewed-colour-coded-...html`: color-coded audit view for reviewing statuses.
- `contacts-reviewed-...csv`: full review ledger with review status, review color, review note, source row, contact ID, and contact fields.
- `contacts-marked-for-deletion-...csv`: records marked for deletion.

## Features

- Review contacts one card at a time
- Mark records as keep, maybe, delete, or merged
- Auto-advance to the next unreviewed record after decisions
- Browse manually by record number
- Detect, dismiss, merge, keep, or delete possible duplicates
- Apply notes to possible duplicates
- Save field edits separately from the original CSV
- Export a clean CSV, reviewed CSV, deletion-only CSV, and color-coded HTML
