# VS Code compatibility

## Supported minimum

The audit on 11 October 2026 found VS Code 1.66.0 to be the lowest compatible stable release for the current extension code. The disposable tests ran on Linux with a fake Codex server.

| VS Code release | Bundled Node.js | Result |
| --- | --- | --- |
| 1.65.2 | 14.16.0 | Activation fails with `Cannot find module 'node:path'`. `Object.hasOwn` is also unavailable. |
| 1.66.0 | 16.13.0 | The full suite passes. |

Windows and macOS builds were not tested in this audit. The project declares `engines.vscode` as `^1.66.0` and pins `@types/vscode` to `1.66.0`.

The runtime sets the lower limit. The extension uses `require('node:path')` and other imports with the `node:` prefix. Node.js added support for this prefix in `require` in versions 14.18.0 and 16.0.0. See the [built-in module documentation](https://nodejs.org/api/modules.html#built-in-modules). The client also uses `Object.hasOwn`, introduced in [Node.js 16.9.0](https://nodejs.org/en/blog/release/v16.9.0).

VS Code 1.66 upgraded from Electron 13 to Electron 17 and bundled Node.js 16.13.0. See the [1.66 release notes](https://code.visualstudio.com/updates/v1_66#_electron-17-update). The [1.65.2 build configuration](https://github.com/microsoft/vscode/blob/1.65.2/.yarnrc) still targets Electron 13.5.2. Build configurations for releases 1.57 through 1.65 also use Electron 12 or 13.

An isolated JavaScript type check passed against the stable API definitions from both the [1.65.0 source tag](https://github.com/microsoft/vscode/blob/1.65.0/src/vscode-dts/vscode.d.ts) and the [1.66.0 source tag](https://github.com/microsoft/vscode/blob/1.66.0/src/vscode-dts/vscode.d.ts). The temporary source copies used these definitions without loading the project's then-pinned 1.85.0 definitions. The runtime test identifies the limitation that an API check alone misses.

## Run the checks

Use Node.js 20 or later and Python 3, available as `python3`. Install the development dependencies and check the minimum VS Code API:

```sh
npm ci
npm run check:vscode-api
```

Run the packaged extension tests on Linux or macOS:

```sh
npm run test:compat
```

By default, this tests the minimum release from `engines.vscode` and the current stable release. Headless Linux needs Xvfb and the Electron display libraries. CI installs them on disposable runners. With those dependencies available locally, run:

```sh
xvfb-run -a npm run test:compat
```

The fake executable launcher supports Linux and macOS. Windows users can use CI or WSL with the Linux display dependencies.

To test one release, use `--version minimum`, `--version stable`, or an exact stable release:

```sh
npm run test:compat -- --version minimum
npm run test:compat -- --version stable
npm run test:compat -- --version 1.66.0
```

The runner normalises a leading `v` and build metadata to the numeric release. It rejects prereleases and Insiders identifiers, including in probe mode.

To investigate a release below the declared minimum, add `--probe`:

```sh
npm run test:compat -- --version 1.65.2 --probe
```

This overrides the engine requirement in the temporary VSIX only. The 1.65.2 probe reproduces the audit's expected activation failure. A passing probe covers the tested behaviour on that release. Review API definitions, runtime requirements, and test results before changing the supported minimum and documented prerequisites.

## API and runtime checks

The API check requires both the manifest's `@types/vscode` pin and the installed version to match the minimum from `engines.vscode`. It checks `src/` and the helper extension through `tsconfig.compatibility.json` and writes no compiled files. Development runners use newer Node.js APIs and stay outside this project.

The project pins `@types/node` to `16.11.7`, a conservative baseline for the Node.js 16.13 extension host. Compiler regression tests require the check to reject newer VS Code APIs and the unavailable Node.js APIs `fetch`, global `BroadcastChannel`, and `AbortSignal.timeout`.

Historical Node.js declarations conflict with modern TypeScript's typed-array declarations, so `skipLibCheck` skips checks inside dependency declaration files. Calls in the checked JavaScript still use the pinned definitions.

## Test coverage and CI

The integration suite installs the VSIX and checks activation, allowance colours, icon font loading and CSS registration, tooltip text and the dashboard URL, refresh, stale values, recovery, settings changes, executable replacement, and client shutdown. The replacement launcher reports its identity and supplies a distinct allowance response. The tests require its own handshake and usage request, and wait for the previous clients to stop.

Playwright 1.60.0 connects to the downloaded VS Code application's local debugging endpoint without downloading a separate browser. Its [`noDefaults`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) option leaves Electron's download and browser settings unchanged. The worker checks the rendered dashboard anchor and applies settings through VS Code's configuration API.

The [compatibility workflow](../.github/workflows/compatibility.yml) runs on pull requests, pushes to `main`, manual dispatch, and every Monday. It runs the API check, unit tests, and `check:icons` before testing the minimum and stable VS Code releases. The minimum comes from the manifest, and CI uses no probe override.

The icon check uses the FontTools version pinned in `requirements-dev.txt`. It regenerates the font and icon declarations in a temporary directory and compares them with the committed files. This verifies font data and character mapping alongside the integration suite's font loading and CSS checks. See the [icon development instructions](../README.md#development) for the Python requirements and commands.

## Isolation and cleanup

Each release gets a temporary directory for its downloaded VS Code archive, extracted executable, VSIX, workspace, helper extension, and fake Codex responses. Temporary files, runtime sockets, and OS caches also go there. The tests use a fake Codex server and do not use your installed editor, settings, extensions, or Codex account. No `.vscode-test` cache remains in the repository.

The runner sets `VSCODE_PORTABLE` to a directory inside the temporary test root. This contains VS Code's startup configuration in `argv.json`, user settings, storage, and extensions. VS Code 1.66 otherwise reads or creates `argv.json` under the user's home directory, even with `--user-data-dir`. See the [startup configuration source](https://github.com/microsoft/vscode/blob/1.66.0/src/main.js#L216-L286). The runner invokes the CLI from the downloaded executable directly, so the CLI and application use the same portable directory without the test library adding separate profile arguments. Their explicit user-data and extension arguments also point inside this directory.

Credential isolation uses `--disable-keytar`, which selects the [in-memory credential provider in VS Code 1.66](https://github.com/microsoft/vscode/blob/1.66.0/src/vs/platform/credentials/electron-main/credentialsMainService.ts#L24-L41). Newer releases accept this option as the [alias for `--use-inmemory-secretstorage`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/environment/node/argv.ts). The runner rejects an unrecognised option before launching the application.

The helper reads an unused key in its own secret storage to initialise the backend, then reports the VS Code version, Node.js version, `Object.hasOwn` availability, portable directory, and global storage path. The worker checks the paths and the portable `argv.json`, and requires the application logs to confirm an in-memory credential provider. These checks run before the allowance assertions, including on probes of older releases.

The supervisor removes inherited VS Code launcher variables and owns the worker and application process groups from spawn. It stops both processes and waits for them to close before removing the test directory, including after cancellation or a timeout. Regression tests cover a worker that blocks during startup and needs forced termination.

Failed runs include a bounded tail of the application's stderr for startup failures and timeouts. The worker reports extension host activation errors when logs are available.
