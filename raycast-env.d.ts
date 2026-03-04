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
  export type SearchImages = ExtensionPreferences & {}
  /** Preferences accessible in the `search-projects` command */
  export type SearchProjects = ExtensionPreferences & {}
  /** Preferences accessible in the `favorite-projects` command */
  export type FavoriteProjects = ExtensionPreferences & {}
  /** Preferences accessible in the `favorite-repositories` command */
  export type FavoriteRepositories = ExtensionPreferences & {}
  /** Preferences accessible in the `manage-providers` command */
  export type ManageProviders = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `search-images` command */
  export type SearchImages = {}
  /** Arguments passed to the `search-projects` command */
  export type SearchProjects = {}
  /** Arguments passed to the `favorite-projects` command */
  export type FavoriteProjects = {}
  /** Arguments passed to the `favorite-repositories` command */
  export type FavoriteRepositories = {}
  /** Arguments passed to the `manage-providers` command */
  export type ManageProviders = {}
}

