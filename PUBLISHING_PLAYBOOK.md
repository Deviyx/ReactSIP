# ReactSIP Publishing Playbook

This file is the canonical release process for this repository.
Use this whenever context is lost or a new session starts.

## Release rules

1. Keep `productName` as `ReactSIP`.
2. Always bump `package.json` + `package-lock.json` version before publishing.
3. Tag format for stable releases:
   - `vX.Y.Z-stable`
4. Keep artifact naming consistent with `electron-builder.json`:
   - `ReactSIP-Setup-${version}-stable.exe`
   - `ReactSIP-Portable-${version}-stable.exe`
5. Do not create random extra tags.
   - If user asks to reuse a tag, delete and recreate the same tag.

## Pre-release checklist

- [ ] `npm run build` succeeds locally.
- [ ] New icon is configured:
  - Window icon in `public/electron.js`
  - Windows icon in `electron-builder.json`
- [ ] `native/sip-agent/bin/sip-agent.exe` exists (for packaging).
- [ ] Working tree does not include build outputs (`release/`, `renderer-dist/`, etc.).

## Standard release flow

```powershell
# 1) Bump version (example: 1.1.1)
npm version 1.1.1 --no-git-tag-version

# 2) Validate build
npm run build

# 3) Commit
git add .
git commit -m "release: v1.1.1 stable"
git push origin main

# 4) Create and push tag
git tag v1.1.1-stable
git push origin v1.1.1-stable
```

## Reuse same tag (when requested)

```powershell
git tag -d <tag>
git push origin :refs/tags/<tag>
git tag <tag>
git push origin <tag>
```

## If GitHub Actions does not start on tag push

1. Confirm workflow trigger contains:
   - `on.push.tags: - 'v*'`
2. Check workflow state is `active`.
3. Re-push the same tag.
4. If still not triggered, recreate as lightweight tag and push again:

```powershell
git tag -d <tag>
git push origin :refs/tags/<tag>
git tag <tag> <commit_sha>
git push origin refs/tags/<tag>
```

## Post-release verification

- [ ] GitHub Action finished successfully.
- [ ] Release has expected assets (`.exe`, `.blockmap`, `latest*.yml`).
- [ ] Updater download URL matches uploaded setup filename.

