/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `search-images` command */
  export type SearchImages = ExtensionPreferences & {
  /** Provider - Registry provider to query */
  "provider": "harbor",
  /** Harbor Base URL - Base URL, e.g. https://registry.invisiblefarm.it */
  "harborBaseUrl": string,
  /** Harbor Username - Harbor username (or robot account name) */
  "harborUsername": string,
  /** Harbor Password / Token - Harbor password or robot token */
  "harborPassword": string,
  /** Default Project (Optional) - Limit search to one project; leave empty to search all */
  "harborProject"?: string
}
}

declare namespace Arguments {
  /** Arguments passed to the `search-images` command */
  export type SearchImages = {}
}

