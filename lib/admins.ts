// Friendly display names for the admin accounts. The activity log stores the
// exact email (precise + stable); this maps it to a name at render time only.
// Client-safe: a pure map, no server imports, so client components can use it.
export const ADMIN_NAMES: Record<string, string> = {
  "gimansabandara2001@gmail.com": "Shashmitha",
  "dhanikaanupama2000@gmail.com": "Dhanika",
  "buddhikagaveen2021@gmail.com": "Gaveen",
};

/** Admin email → display name; anything else (client names, "operator") is
 *  returned unchanged. */
export function displayName(actor: string): string {
  return ADMIN_NAMES[(actor || "").toLowerCase()] ?? actor;
}
