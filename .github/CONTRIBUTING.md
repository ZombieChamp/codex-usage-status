# Contributing

Thank you for considering a contribution to this project. This document describes the conventions and workflows we follow. The README's Contributing section provides a brief overview; this file is the detailed reference.

## Issue-First Process

Before submitting a pull request, please open a GitHub issue to discuss the proposed change. This gives maintainers and other contributors the opportunity to provide early feedback, align on direction, and avoid duplicated effort.

- Bug reports should use the **Bug Report** issue template.
- Feature proposals should use the **Feature Request** issue template.

Opening an issue first ensures that time spent writing code is not wasted on changes that may not be accepted or that overlap with ongoing work.

## Branching Strategy

All feature branches are created from `main`. Branch names follow the convention `<type>/<short-description>`, where:

- `type` is one of: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `perf`.
- `short-description` uses lowercase words separated by hyphens.

Examples:

```
feat/sso-login
fix/null-pointer
docs/contributing-guide
```

## Commit Conventions

All commits follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. The format is:

```
<type>(<scope>): <subject>
```

The scope is optional. The permitted types are: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `perf`, `revert`.

The subject line must be written in imperative mood (e.g., "add" not "added"), must be under 72 characters, and must not end with a full stop.

To mark a breaking change, append `!` after the type or scope (e.g., `feat(api)!: remove v1 endpoints`) and include a `BREAKING CHANGE:` footer in the body.

Examples:

```
feat(auth): add SSO login support
fix: resolve null pointer in user lookup
docs: update contributing guide formatting
feat(api)!: remove v1 endpoints
```

A commit validation workflow enforces this format on push. If your commit messages do not conform, the workflow will fail and the push will be rejected.

## Pull Request Process

When opening a pull request, use the [pull request template](pull_request_template.md) and fill in all sections. Request a review from the designated [CODEOWNERS](CODEOWNERS).

Pull requests are squash-merged into `main`. The squashed commit message must follow the Conventional Commits format described above, summarising the overall change concisely.

## Code Style

Use British English for documentation, interface text, comments, and test descriptions. Preserve required API names, identifiers, external titles, and verbatim licence text.

This repository uses [.editorconfig](../.editorconfig) to define formatting rules. Please ensure your editor respects these settings. The baseline rules are:

- 2-space indentation, except Python files, which use 4 spaces
- UTF-8 encoding
- LF line endings
- Insert final newline
- Trim trailing whitespace

Markdown files are exempt from trailing whitespace trimming, as trailing spaces can be semantically meaningful in Markdown.

## Local Development

> *This section is a placeholder. Template adopters should replace it with project-specific setup instructions, including dependencies, build commands, and how to run the test suite.*

## Security Reporting

Security vulnerabilities must not be reported via public GitHub issues. Please follow the process described in [SECURITY.md](SECURITY.md) for responsible disclosure.

## Code of Conduct

All participants in this project are expected to abide by the [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## Licence

Contributions to this project are submitted under the GNU General Public License v3.0. By submitting a pull request, you agree to these licence terms.

See the [LICENCE](../LICENCE) file for the full text.
