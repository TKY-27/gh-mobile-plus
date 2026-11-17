# Contributing to GH Mobile+

Thanks for your interest! Bug reports, ideas and pull requests are welcome.

## Before you start

- Read [docs/SPEC.md](docs/SPEC.md). It defines what v1 is and what is out of scope.
- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Follow the Code Quality Rules in [AGENTS.md](AGENTS.md). They apply to humans too.

## Development setup

See "Development" in [README.md](README.md). You need your own GitHub OAuth App for local sign-in.

## Pull requests

- Keep each PR focused on one change.
- Run `pnpm ci:all` locally. CI must be green.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages and PR titles.
- Add or update tests for any behavior change. Never weaken an existing test to make it pass.
- Update `docs/SPEC.md`, its Changelog and an ADR when you change a decision.
- Add user-facing changes to the `Unreleased` section of `CHANGELOG.md`.
- Add new strings to both the `en` and `ja` catalogs.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
