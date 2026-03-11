import { getPreferenceValues } from "@raycast/api";

export type DateFormatPreference = "iso" | "us" | "it" | "ymd";

type ExtensionPreferences = {
  dateFormat?: DateFormatPreference;
  latestTagCacheTtlSeconds?: string;
};

function clampCacheTtlSeconds(value: number): number {
  if (!Number.isFinite(value)) return 60;
  const allowed = [60, 300, 600];
  const normalized = Math.floor(value);
  return allowed.includes(normalized) ? normalized : 60;
}

export function getUserSettings(): { dateFormat: DateFormatPreference; latestTagCacheTtlMs: number } {
  const preferences = getPreferenceValues<ExtensionPreferences>();
  const dateFormat = preferences.dateFormat ?? "it";
  const ttlSeconds = clampCacheTtlSeconds(Number(preferences.latestTagCacheTtlSeconds ?? "60"));
  return {
    dateFormat,
    latestTagCacheTtlMs: ttlSeconds * 1000,
  };
}

function formatDateInternal(value: string | undefined, dateFormat: DateFormatPreference, withTime: boolean): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  if (dateFormat === "iso") {
    return date.toISOString();
  }

  const locale = dateFormat === "us" ? "en-US" : "it-IT";
  if (dateFormat === "ymd") {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    if (!withTime) return `${year}/${month}/${day}`;

    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
  }
  const options: Intl.DateTimeFormatOptions = withTime
    ? {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }
    : {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      };

  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatDate(value: string | undefined, dateFormat: DateFormatPreference): string {
  return formatDateInternal(value, dateFormat, false);
}

export function formatDateTime(value: string | undefined, dateFormat: DateFormatPreference): string {
  return formatDateInternal(value, dateFormat, true);
}
