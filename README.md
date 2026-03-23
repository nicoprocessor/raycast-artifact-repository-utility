# Artifact Registry Explorer

[![Quality Checks](https://github.com/nicoprocessor/raycast-artifact-repository-utility/actions/workflows/quality-checks.yml/badge.svg)](https://github.com/nicoprocessor/raycast-artifact-repository-utility/actions/workflows/quality-checks.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Raycast Extension](https://img.shields.io/badge/Raycast-Extension-FF6363?logo=raycast&logoColor=white)

Raycast extension for working container artifact registries, with multi-provider support.

## Workflow

- **Manage Providers**: add one or more providers (Project Harbor, Docker Hub).
- **Search Images**: search across all providers by default; filter by provider from the dropdown.
- **Search Projects**: provider-specific or aggregated project flow, with member view where available.
- **Favorite Projects**: quick access to saved favorites.
- **Favorite Repositories**: quick access to saved repositories, latest tags, and artifact inspection.

## Quality Checks

- CI pipeline runs on push and pull requests.
- Pipeline executes formatting checks, lint, build, and automated tests.

## Pre-commit (Staged Files Only)

This repository uses `simple-git-hooks` with `lint-staged`.

- On every commit, only staged files are processed.
- JavaScript/TypeScript files in `src/` are auto-fixed with ESLint and formatted with Prettier.
- JSON/Markdown/YAML/CSS/HTML staged files are formatted with Prettier.
- Fixes are applied and re-staged automatically before the commit is finalized.

To ensure hooks are installed after cloning:

```bash
pnpm install
```

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting changes.

## License

This project is released under the [MIT License](./LICENSE).
