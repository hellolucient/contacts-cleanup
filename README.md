# Contacts Cleanup

Contacts Cleanup is a local-only app for reviewing an old Outlook contacts CSV without editing the original file.

## Privacy

- Contacts are read from a local CSV on your machine.
- The app runs on `localhost`.
- There are no analytics, third-party scripts, accounts, or cloud uploads.
- Review decisions and exports are saved locally and ignored by Git.
- Do not commit real contact CSVs, `data/`, or `exports/`.

## Run

Use an environment variable:

```sh
CONTACTS_CSV="/absolute/path/to/contacts.csv" npm start
```

Or place a local file named `contacts.csv` in this folder:

```sh
npm start
```

Then open:

```text
http://localhost:4173
```

## Features

- Review contacts one card at a time
- Mark records as keep, maybe, delete, or merged
- Auto-advance to the next unreviewed record after decisions
- Browse manually by record number
- Detect, dismiss, merge, keep, or delete possible duplicates
- Save field edits separately from the original CSV
- Export reviewed CSV, deletion-only CSV, and color-coded HTML
