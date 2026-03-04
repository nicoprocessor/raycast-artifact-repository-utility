# Raycast Artifact Repository Utility

Raycast extension for working with private registries, with multi-provider support.

## Workflow

- **Manage Providers**: add one or more providers (Private Harbor, Docker Hub Beta).
- **Search Images**: search across all providers by default; filter by provider from the dropdown.
- **Search Projects**: provider-specific or aggregated project flow, with member view where available.
- **Favorite Projects**: quick access to saved favorites.

## Functional Notes

- If no provider is configured, commands show a quick onboarding flow (⌘N).
- In Search Images, severity does not show a green check when a scan has not been run yet.
- Available image actions: copy, open artifact/project, trigger scan, delete tag/artifact.
- Docker Hub support is in beta (some endpoints like scan/delete may be unavailable via API).
