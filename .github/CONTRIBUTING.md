# Contributing

This guide covers development, testing, and pull requests for Codex Usage Status.

## Discuss a change

Open a GitHub issue to discuss the proposed change before submitting a pull request. Check existing issues and pull requests for related work first.

- Bug reports should use the **Bug Report** issue template.
- Feature proposals should use the **Feature Request** issue template.

## Branching

All feature branches are created from `main`. Branch names follow the convention `<type>/<short-description>`, where:

- `type` is one of: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `perf`.
- `short-description` uses lowercase words separated by hyphens.

Examples:

```
feat/usage-tooltip
fix/stale-allowance
docs/contributing-guide
```

## Commit conventions

All commits follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. The format is:

```
<type>(<scope>)!: <subject>
```

The scope and breaking-change marker `!` are optional. The permitted types are: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `perf`, `revert`.

Write the subject in the imperative mood, such as "add" rather than "added", without a final full stop. The subject after `: ` must contain 1 to 72 characters.

To mark a breaking change, append `!` after the type or scope and include a `BREAKING CHANGE:` footer in the body.

Examples:

```
feat(usage): show allowance reset times
fix: keep previous values after a failed refresh
docs: update contributing guide
feat(settings)!: rename the refresh interval setting
```

The [commit validation workflow](workflows/commit-validation.yml) runs on pull requests targeting `main`. It checks commit subjects for the permitted type, optional scope and `!`, and subject length. It skips subjects beginning with `Merge `. Invalid messages fail the workflow check; the workflow does not reject pushes.

## Pull requests

Target `main`, link the issue, and use the [pull request template](pull_request_template.md). Describe what changed, why, and how you tested it. Include the optional approach section when it helps explain the change. Request a review from the designated [CODEOWNERS](CODEOWNERS).

Run `npm test` and `npm run check:vscode-api` before submitting code changes. For interface changes, also run `npm run check:icons` and `npm run test:compat`. Describe any further visual checks. Update the README when commands, settings, or user-visible behaviour change. GitHub Actions checks API compatibility, runs the unit tests, and validates the generated icon assets. It then builds and tests the VSIX on the declared minimum and stable VS Code releases. A separate workflow validates commit messages.

Pull requests are squash-merged into `main`. The squashed commit message must follow the Conventional Commits format described above, summarising the overall change concisely.

## Code style

Use British English for documentation, interface text, comments, and test descriptions. Preserve required API names, identifiers, external titles, and verbatim licence text.

This repository uses [.editorconfig](../.editorconfig) to define formatting rules. Please ensure your editor respects these settings. The baseline rules are:

- 2-space indentation
- UTF-8 encoding
- LF line endings
- Insert final newline
- Trim trailing whitespace

Python files use 4 spaces as per the [PEP 8](https://peps.python.org/pep-0008/#indentation) official style guide.

Markdown files are exempt from trailing whitespace trimming, as trailing spaces can be semantically meaningful in Markdown.

## Local development

### Prerequisites

- VS Code 1.66.0 or later to run the extension.
- Node.js 20 or later and npm to run the development scripts.
- Python 3, available as `python3`, to build a VSIX. Icon checks require Python 3.11 or later.

Clone your fork and create a branch from `main` using the naming convention above. Run `npm ci` from the repository root to install development dependencies, then run the commands below.

### Run the extension

1. Open the repository in VS Code.
2. Select **Run Codex Usage Status** in Run and Debug, then press **F5**.
3. Check the status bar in the Extension Development Host window.

For live usage checks, you need a Codex executable and a ChatGPT account signed in to Codex with allowance data available. See the [README prerequisites](../README.md#prerequisites) and [settings](../README.md#settings) for executable discovery and configuration.

After changing source files, restart the debugging session to load the changes. Check the status bar text, tooltip, and **Codex Usage: Refresh** command when changing usage display behaviour. Check that settings changes take effect when changing configuration handling.

### Run tests

```sh
npm test
```

The tests use Node.js's built-in test runner. Client tests launch a local fake server, so the test suite does not need Codex, a signed-in account, or VS Code.

To run one test file:

```sh
node --test test/client.test.js
```

Add regression coverage for changes to client behaviour or allowance parsing in the corresponding file under `test/`.

Check the JavaScript against the declared minimum VS Code API:

```sh
npm run check:vscode-api
```

When changing `engines.vscode`, pin `@types/vscode` to the same minimum release, update the lockfile, and update the documented prerequisites.

Keep `@types/node` compatible with the Node.js version bundled by the minimum VS Code release. See the [API and runtime checks](../docs/vscode-compatibility.md#api-and-runtime-checks) for the baseline and compiler regression coverage.

Run the packaged extension against the minimum and stable VS Code releases on Linux or macOS:

```sh
npm run test:compat
```

The tests use disposable editor profiles and a fake Codex server. See the [compatibility guide](../docs/vscode-compatibility.md#run-the-checks) for display requirements, single-release tests, probes of older releases, and Windows options.

For icon changes, activate a virtual environment with Python 3.11 or later, then run:

```sh
python3 -m pip install -r requirements-dev.txt
npm run check:icons
```

This check regenerates the font and icon declarations in a temporary directory, compares them with the committed files, and tests the supported SVG input format. To update the committed assets, run `python scripts/generate_gauges.py`. See the [README](../README.md#development) for the SVG requirements. The JavaScript tests and normal packaging do not require FontTools.

### Build and check a VSIX

```sh
npm run package
```

The command writes `dist/codex-usage-status-<version>.vsix`, with the version from `package.json`. Git ignores `dist/`.

To check the package in a disposable VS Code profile, run `npm run test:compat`. The command builds its own temporary VSIX, installs it in an isolated extensions directory, and checks the rendered status bar and tooltips. Record any further manual checks in the pull request.

### Repository layout

- `src/extension.js` handles VS Code activation, commands, settings, and the status bar.
- `src/client.js` manages the local app-server process and protocol requests.
- `src/usage.js` converts allowance data into display windows.
- `src/credits.js` normalises reset-credit snapshots and formats account reset totals and expiries.
- `src/time.js` formats reset descriptions and update ages.
- `test/client.test.js`, `test/usage.test.js` and `test/time.test.js` cover the client, allowance parsing and time formatting.
- `test/credits.test.js` covers reset-credit availability, expiry and incomplete account data.
- `test/icons.test.js` checks icon registration. `test/test_icons.py` checks generated assets and the SVG input format with FontTools.
- `test/compatibility.test.js` checks API and runtime definitions, release arguments, package engine overrides, startup diagnostics, and cleanup when a worker blocks during launch.
- `test/integration-files.test.js` checks atomic JSON publication during concurrent reads and cleanup after a failed publication.
- `integration/vscode.js` tests the packaged extension in downloaded VS Code instances. `integration/fake-codex.js` supplies local test responses.
- `integration/configuration-helper/` contains the helper extension and the shared atomic JSON writer. The runner copies the helper into each temporary profile.
- `scripts/vscode-compatibility.js` selects releases and starts disposable test runs.
- `scripts/compatibility-processes.js` owns the worker and VS Code processes, handles application commands, and waits for shutdown before removing test directories.
- `scripts/check-vscode-api.js` checks the pinned API version and runs the JavaScript type check.
- `scripts/package.py` builds the VSIX from an explicit file list. Update that list if you add files the extension needs at runtime.
- `package.json` declares commands, settings, extension metadata, and development scripts.

## Security reporting

Security vulnerabilities must not be reported via public GitHub issues. Please follow the process described in [SECURITY.md](SECURITY.md) for responsible disclosure.

## Code of conduct

All participants in this project are expected to abide by the [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## Licence

Contributions to this project are submitted under the GNU General Public License v3.0. By submitting a pull request, you agree to these licence terms.

See the [LICENCE](../LICENCE) file for the full text.
