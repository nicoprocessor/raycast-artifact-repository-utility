# Artifact Registry Explorer

[![Quality Checks](https://github.com/nicoprocessor/raycast-artifact-repository-utility/actions/workflows/quality-checks.yml/badge.svg)](https://github.com/nicoprocessor/raycast-artifact-repository-utility/actions/workflows/quality-checks.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Raycast Extension](https://img.shields.io/badge/Raycast-Extension-FF6363?logo=raycast&logoColor=white)
![Private Registry](https://img.shields.io/badge/Registry-Multi--Provider-6E56CF)

Raycast extension for working with private registries, with multi-provider support.

## Workflow

- **Manage Providers**: add one or more providers (Private Harbor, Docker Hub Beta).
- **Search Images**: search across all providers by default; filter by provider from the dropdown.
- **Search Projects**: provider-specific or aggregated project flow, with member view where available.
- **Favorite Projects**: quick access to saved favorites.
- **Favorite Repositories**: quick access to saved repositories, latest tags, and artifact inspection.

## Functional Notes

- If no provider is configured, commands show a quick onboarding flow (⌘N).
- In Search Images, severity does not show a green check when a scan has not been run yet.
- Available image actions: copy, open artifact/project, trigger scan, delete tag/artifact.
- Docker Hub support is in beta (some endpoints like scan/delete may be unavailable via API).
- Provider credentials are stored in macOS Keychain, not in plain LocalStorage.
- Search caching: Projects use a longer cache window; Images use a short cache window. Press `⌘R` in Search Images/Search Projects to force refresh.

## Quality Checks

- CI pipeline runs on push and pull requests.
- Pipeline executes lint, build, and automated tests.

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting changes.

## License

This project is released under the [MIT License](./LICENSE).
