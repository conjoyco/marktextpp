# MarkText++ — handoff for a fresh local Claude Code thread

**Read this first.** You are a new Claude Code session running locally in
`C:\dev\marktextpp` with filesystem access and git push/pull to
`conjoyco/marktextpp`. A previous (remote, sandboxed) thread set this up
but couldn't reach the user's machine — that's why you exist. Your near-term
job is to get this app to **build and run as a portable win64 executable**,
then (only if the user wants) add features.

## What this is

MarkText++ is the user's fork of the maintained MarkText fork
**peterjthomson/marktext** (v1.3.0) — an Electron + electron-vite +
Vue markdown editor with inline WYSIWYG live preview. Chosen over the
original `marktext/marktext` because that one is dead since 2022 and won't
build on a modern toolchain; this fork is on Electron 39 / electron-builder 26.

The user's original ask: a markdown editor that (a) opens with syntax
coloring like Sublime, (b) toggles to an editable rendered view with one
keypress (Word-doc feel), (c) eventually a side-by-side mode. MarkText
already does the inline-WYSIWYG part; the fork is the base we improve.

## Repo + remotes (already configured)

- Working copy: `C:\dev\marktextpp` (repo root, `.git` here).
- `origin`   → https://github.com/conjoyco/marktextpp.git  (the user's, owned by conjoyco org)
- `upstream` → https://github.com/peterjthomson/marktext.git  (pull future updates from here)
- Branch: `master`.
- Note: folder is `marktextpp` but the app's internal name is still
  `marktext` (package.json `"name"`, and build artifacts like
  `marktext-win-x64-1.3.0.zip`). Cosmetic — rename later if the user cares.

## Toolchain / environment (user's Windows box)

- Windows 10.0.26200, VS 2022 **Community** 17.14 installed (they also do
  Unity IL2CPP builds, so the C++ toolchain is real).
- Node: global is **v24.16.0**, but this project is **pinned to Node 22.21.1**
  (fork's dev docs: "same version as the current Electron release"). They
  installed **nvm-windows** (`C:\nvm4w\nodejs\...`) — use `nvm use 22.21.1`
  in an **admin** cmd before building. Do NOT build on Node 24.
- Python 3.14.3 is what node-gyp picks up. It got far enough (found VS, ran
  MSBuild) so it's not the current blocker, but flag it if a *different*
  native module later fails inside gyp/python rather than at MSBuild.
- Package manager: **npm** (not yarn).

## BLOCKER HISTORY (RESOLVED 2026-07-04) — read so you don't re-chase it

The app now **builds and runs**. `dist\win-unpacked\marktext.exe` launches
clean, and `dist\marktext-win-x64-1.3.0.zip` is the portable deliverable.
Getting there took untangling two *separate* problems that both look like
"native build fails on Windows":

### 1. Spectre libs / wrong toolset (the MSB8040 error) — FIXED

`npm install` failed building `native-keymap` with:
```
error MSB8040: Spectre-mitigated libraries are required for this project.
```
The spectre component WAS eventually installed — but only for the **"(Latest)"
MSVC toolset 14.44.35207**. The catch: this machine's default `v143` platform
toolset resolves to **14.38.33130** (see
`VC\Auxiliary\Build\Microsoft.VCToolsVersion.v143.default.txt` = 14.38, while
`Microsoft.VCToolsVersion.default.txt` = 14.44). So node-gyp built against
14.38, which had no spectre libs → MSB8040, *even though 14.44 had them*.

Fix (already committed to the repo): force native builds onto 14.44 via the
`VCToolsVersion` env var. `Directory.Build.props` does NOT work here —
node-gyp's generated `.vcxproj` imports `Microsoft.Cpp.props` directly and
never imports `Microsoft.Common.props`, so `Directory.Build.props` is never
read. The env var is the only reliable lever. It's baked into **package.json
scripts** with `cross-env` (already a devDep):
- `rebuild-native` and `build:win` are prefixed
  `cross-env VCToolsVersion=14.44.35207 ...`.

Caveat: a *fresh* `npm install` has no script hook, so it still needs the env
var. Run installs as:
```
set VCToolsVersion=14.44.35207   &&  npm install     (cmd)
$env:VCToolsVersion="14.44.35207"; npm install       (pwsh)
```
Alternative permanent fixes if you dislike the env var: (a) tick the VS
installer box for **14.38 (17.8, "Out of Support")** spectre libs too, or
(b) edit `Microsoft.VCToolsVersion.v143.default.txt` → 14.44. Both are
machine-wide and the user does Unity IL2CPP builds, so they were avoided in
favor of the repo-scoped script env var.

### 2. winCodeSign symlink privilege (blocks the .zip/.exe TARGETS) — WORKAROUND

`npm run build:win` gets all the way to packaging, produces `win-unpacked\`
(the real, runnable app), then FAILS extracting the `winCodeSign` cache:
```
Cannot create symbolic link : A required privilege is not held by the client.
  ...winCodeSign\...\darwin\10.12\lib\libcrypto.dylib
```
electron-builder always extracts winCodeSign for win targets; that archive
contains macOS dylib **symlinks**, and creating symlinks on Windows needs
`SeCreateSymbolicLinkPrivilege`. A non-elevated shell doesn't have it → both
`zip` and `nsis` targets fail. **This is why the original handoff said build
from an admin cmd.** Fixes:
- Run `npm run build:win` from an **elevated (Run as administrator)** terminal, OR
- Enable **Windows Settings → System → For developers → Developer Mode** once
  (grants the symlink privilege to the normal user; no elevation needed after).

The current `dist\marktext-win-x64-1.3.0.zip` was produced by zipping
`win-unpacked\` directly (`Compress-Archive`) to sidestep winCodeSign — it's
functionally identical to electron-builder's zip target (minus a `.blockmap`).
Once you build elevated / with Developer Mode on, the official targets produce
the zip + nsis setup.exe normally.

## Build / run recipe (once install is clean)

```
nvm use 22.21.1
set VCToolsVersion=14.44.35207   # cmd; pwsh: $env:VCToolsVersion="14.44.35207"
npm install            # needs the env var above; ends with "added NNN packages"
npm run dev            # launches the app live — fastest way to eyeball it
npm run build:win      # RUN ELEVATED (admin) or with Developer Mode on — see winCodeSign note.
                       # Downloads Electron 39 (~100MB) first run. rebuild-native/build:win
                       # already carry VCToolsVersion via cross-env, so no env var needed for these.
```

Portable (no-install) output lands in `C:\dev\marktextpp\dist\`:
- `marktext-win-x64-1.3.0.zip`  ← unzip anywhere, run `marktext.exe`. This is
  the "no install version" the user wants.
- `marktext-win-x64-1.3.0-setup.exe`  ← nsis installer, ignore.

Build config lives in `electron-builder.yml` (`win:` targets = nsis + zip).

## Feature roadmap (DEFERRED — do not start unasked)

The user said "later, if it bothers me." In rough order:
1. ~~3-way toggle: **raw | side-by-side | pretty**.~~ **DONE 2026-07-16** —
   View → Side-by-Side Mode (`Ctrl+\` / `Cmd+\`, also in the command palette).
   Mutually exclusive with Source Code Mode; raw stays `Ctrl+E`.
2. ~~Draggable vertical separator on the split view (resize either pane).~~
   **DONE 2026-07-16** — ratio clamped 20–80%, persisted in localStorage.
3. ~~True bidirectional live sync (edit either pane, other updates).~~
   **DONE 2026-07-16** — CodeMirror→Muya debounced 300ms (renders without
   stealing focus), Muya→CodeMirror mirrored 200ms via the store watcher,
   hover-driven proportional scroll sync. See
   `src/renderer/src/components/editorWithTabs/splitSource.vue`.
4. Typora-grade polish passes.
5. Rename internal `marktext` → `marktextpp` (package name, product name, ids).

Confirm scope with the user before building any of these. Get it building and
running first.

## Ground rules for this thread

- Commit to `conjoyco/marktextpp`, push to `origin master` (or a feature
  branch). This is a NEW repo, unrelated to the user's StressBuddy game repo —
  nothing here goes into stressbuddy.
- Every commit should leave the app buildable.
- Terse communication; the user reads diffs directly. Diagnose from real logs,
  not hypotheses.
- The user is on Windows; use cmd/PowerShell-appropriate commands, backslash
  paths.

## How the user starts you

Open a terminal in `C:\dev\marktextpp`, run `claude`, and paste:
"Read MARKTEXTPP-HANDOFF.md and pick up from the current blocker."
