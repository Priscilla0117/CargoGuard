# Historical CargoGuard 2.0.0 packaging notes

**For the current submission, start with [README.md](README.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), not the archived instructions below.** Current `main` includes CargoGuard 3.2.1 from the merged `cargoguard-v3-deploy` source. The dated cloud release still has its own commit/branch record in [CLOUD_RELEASE.md](docs/CLOUD_RELEASE.md); a source merge does not itself redeploy the app.

The sections below and `SOURCE_MANIFEST.json` describe the **older v2 ZIP only**. They are retained as history, not current deployment instructions, a current source manifest or current verification results. Do not overwrite current `main` with that archive. In particular, **do not restore `.openai/hosting.json`, run the old `db:local`/Worker commands, or follow the old Site publishing process for the independent Render/Turso app.** The current local QA database uses `CARGO_LOCAL_DB` and `npm run db:migrate`, as documented in README.md.

Keep `package.json`, README.md and application folders at the repository root. Publish reviewed source, not only a ZIP, and keep real environment files, credentials, local databases, private QA state, generated outputs and answer keys out of Git. The tracked `.env.example` may contain placeholders only. Preserve licenses and required AI-assistance attribution. Verify repository and demo access separately while signed out; this guide does not establish public access or submission completion.

## Archive identification — v2 only

The old ZIP's application source matches release commit `95e54c28f80a14bb1c158983be05566b51b9f9aa`. Its packaging added this guide, a standalone evaluation script, the technical release report and a file-integrity manifest. None of that identifies the current 3.2.1 source or a new runtime deployment.

## Archived v2 upload procedure — do not apply to current main

1. Extract the ZIP with **Extract All**. Open its `cargoguard` folder.
2. Upload the **contents of that folder** to your GitHub repository root. `package.json`, `README.md`, `app`, `lib` and the other project folders must be at the repository root, not inside another `cargoguard` directory.
3. The historical v2 package included `.gitignore`, `.env.example`, `.npmrc` and `.openai/hosting.json`. The Site configuration belongs only to that archive: do not copy it into the current independent deployment.
4. Do not upload dependencies, generated build files or your local database after testing. The included `.gitignore` excludes them. Never include a real `.env` file, credentials or ground-truth answer keys.

GitHub's browser uploader accepts up to 100 files per upload. This package contains more than 100 files, so use Git/GitHub Desktop, or upload in smaller batches while preserving folder paths. [Official GitHub upload instructions](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository).

Uploading only a ZIP stores an archive; it does not expose a normal source repository for judges. GitHub Pages alone cannot run either server-backed version. **The archived v2 runtime used Worker/D1/R2; the current runtime uses Next.js/Node on Render with Turso.** Uploading source does not change an app's audience.

## Archived v2 local commands — not the current startup path

Use Node.js 22.13 or newer (the release was checked using Node 24), npm, and a terminal opened in the extracted `cargoguard` folder. No API key or original organiser directory is needed for the app, regression tests or build.

```powershell
npm run install:ci
npm run db:local
npm run dev
```

Open the local URL printed by the server, normally `http://localhost:5173`. Click **Run inbox**. The included `data/bundle.json` contains all 520 organiser input emails and the 250 original document byte sequences, not the ground-truth answer key. OCR assets are staged automatically from installed packages when starting or building.

## Archived v2 self-contained checks

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

## Archived v2 organiser scoring

The original README's `npm run evaluate`, `npm run quality`, `scripts/check-bundle.mjs`, ablation and Python scoring instructions require the original organiser directories beside `cargoguard`. Those independent organiser files are intentionally not bundled here. Use the self-contained commands above when working from only this ZIP. Ground truth remains offline; do not publish it as application input.

## Archived v2 contents and integrity

The old archive included application source, package lockfile, database migrations, runtime input data, tests, example documents, attribution notices, build configuration and documentation. Its `.openai/hosting.json` contained a Site identifier and logical database/storage bindings, not deployment authorization. It is not required for the current Render/Turso source.

Excluded: `.git` history, `node_modules`, build outputs, runtime databases, uploaded user files, logs, per-case evaluation outputs, organiser answer keys, unrelated PDFs/Docker bundles, and credentials. No broad new license is assigned to organiser data or third-party assets; existing attribution notices are retained.

`SOURCE_MANIFEST.json` records the SHA-256 of every file in that historical package except the manifest itself. It does **not** verify the current `main` tree. The old ZIP's separate checksum and packaging verification report belonged beside that ZIP, not to the current release evidence.

See `docs/TECHNICAL_RELEASE.md` for prior release testing and limitations. Passing tests supports this release; it cannot guarantee zero future bugs, real-world accuracy or a competition result.
