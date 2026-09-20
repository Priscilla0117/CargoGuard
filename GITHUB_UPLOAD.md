# CargoGuard 2.0.0 — GitHub source package

Start here when using the ZIP. The application source matches release commit `95e54c28f80a14bb1c158983be05566b51b9f9aa`. Packaging adds this guide, a standalone evaluation script, the technical release report and a file-integrity manifest; it does not change the deployed application logic.

## Upload the project, not just the ZIP

1. Extract the ZIP with **Extract All**. Open its `cargoguard` folder.
2. Upload the **contents of that folder** to your GitHub repository root. `package.json`, `README.md`, `app`, `lib` and the other project folders must be at the repository root, not inside another `cargoguard` directory.
3. Include dotfiles and hidden folders: `.gitignore`, `.env.example`, `.npmrc` and `.openai/hosting.json`. Enable **Hidden items** in Windows File Explorer if necessary.
4. Do not upload dependencies, generated build files or your local database after testing. The included `.gitignore` excludes them. Never include a real `.env` file, credentials or ground-truth answer keys.

GitHub's browser uploader accepts up to 100 files per upload. This package contains more than 100 files, so use Git/GitHub Desktop, or upload in smaller batches while preserving folder paths. [Official GitHub upload instructions](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository).

Uploading only the ZIP stores an archive; it does not expose a normal source repository for judges. GitHub Pages alone also cannot run this server-backed app: it needs a Worker, D1 and R2. Uploading source does not change the existing private app's audience.

## Run from a clean extracted folder

Use Node.js 22.13 or newer (the release was checked using Node 24), npm, and a terminal opened in the extracted `cargoguard` folder. No API key or original organiser directory is needed for the app, regression tests or build.

```powershell
npm run install:ci
npm run db:local
npm run dev
```

Open the local URL printed by the server, normally `http://localhost:5173`. Click **Run inbox**. The included `data/bundle.json` contains all 520 organiser input emails and the 250 original document byte sequences, not the ground-truth answer key. OCR assets are staged automatically from installed packages when starting or building.

## Self-contained checks

Stop the server before building on Windows to avoid locked build files.

```powershell
npm test
npm run typecheck
npm run lint
node --import tsx scripts/evaluate-embedded.ts
npm run build
```

The standalone evaluator creates `work/evaluation/submission.json` and `results.json` from the embedded original inputs. It does **not** score against ground truth or claim independent accuracy. Some supplied PDFs are deliberately damaged; parser warnings and review outcomes for them are expected.

For built-Worker integration tests, start this in one terminal after building:

```powershell
npm run start -- --port 5174
```

In a second terminal in the same project folder, after running the standalone evaluator:

```powershell
npm run test:api -- http://127.0.0.1:5174
npm run test:hardening -- http://127.0.0.1:5174
```

These tests create isolated synthetic workspaces. The baseline check compares hosted results with locally computed outputs; it is a runtime consistency check, not independent ground-truth scoring.

## Optional organiser scoring

The original README's `npm run evaluate`, `npm run quality`, `scripts/check-bundle.mjs`, ablation and Python scoring instructions require the original organiser directories beside `cargoguard`. Those independent organiser files are intentionally not bundled here. Use the self-contained commands above when working from only this ZIP. Ground truth remains offline; do not publish it as application input.

## Contents and integrity

Included: application source, package lockfile, database migrations, all runtime input data, tests, example documents, attribution notices, build configuration and documentation. `.openai/hosting.json` contains a non-secret Site identifier and logical database/storage bindings, not deployment authorization.

Excluded: `.git` history, `node_modules`, build outputs, runtime databases, uploaded user files, logs, per-case evaluation outputs, organiser answer keys, unrelated PDFs/Docker bundles, and credentials. No broad new license is assigned to organiser data or third-party assets; existing attribution notices are retained.

`SOURCE_MANIFEST.json` records the SHA-256 of every packaged file except the manifest itself. It describes the delivered snapshot and will naturally differ after you edit files. The ZIP's separate checksum and packaging verification report are beside the ZIP, not part of the source repository.

See `docs/TECHNICAL_RELEASE.md` for prior release testing and limitations. Passing tests supports this release; it cannot guarantee zero future bugs, real-world accuracy or a competition result.
