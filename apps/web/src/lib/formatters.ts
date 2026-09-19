/**
 * Truepost Practice OS — Human-Readable Formatters
 *
 * Rules:
 * 1. Dates: MM/DD/YYYY (month-day format)
 * 2. Times: 12-hour format with AM/PM (NEVER military / 24-hour time)
 * 3. Messages & Audit Events: Pure legible English (NEVER raw JSON output)
 */

/**
 * Formats date strictly as MM/DD/YYYY
 * Example: 09/19/2026
 */
export function formatDate(input: string | number | Date | null | undefined): string {
  if (!input) return "—";
  const d = new Date(input);
  if (isNaN(d.getTime())) return String(input);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Formats time strictly in 12-hour format with AM/PM (NO military time)
 * Example: 09:24 AM
 */
export function formatTime(input: string | number | Date | null | undefined): string {
  if (!input) return "—";
  const d = new Date(input);
  if (isNaN(d.getTime())) return String(input);
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hh = String(hours).padStart(2, "0");
  return `${hh}:${minutes} ${ampm}`;
}

/**
 * Formats datetime strictly as MM/DD/YYYY hh:mm AM/PM (12-hour, NO military time)
 * Example: 09/19/2026 09:24 AM
 */
export function formatDateTime(input: string | number | Date | null | undefined): string {
  if (!input) return "—";
  const d = new Date(input);
  if (isNaN(d.getTime())) return String(input);
  const dateStr = formatDate(d);
  const timeStr = formatTime(d);
  return `${dateStr} ${timeStr}`;
}

/**
 * Formats any raw message, database JSON, or error into clean, polished human-readable text.
 * Completely eliminates raw JSON braces, quotes, and brackets.
 */
export function formatLegibleMessage(msg: any): string {
  if (!msg) return "";
  if (typeof msg === "string") {
    const trimmed = msg.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed);
        return formatLegibleMessage(parsed);
      } catch {
        // Not valid JSON
      }
    }
    return trimmed;
  }

  if (typeof msg === "object" && msg !== null) {
    if (Array.isArray(msg)) {
      return msg.map(formatLegibleMessage).join(", ");
    }
    
    // Check known audit / event schemas for custom clean presentation
    const parts: string[] = [];
    if (msg.status) parts.push(`Status: ${msg.status}`);
    if (msg.betaDays) parts.push(`Duration: ${msg.betaDays} days`);
    if (msg.invitationId) parts.push(`Invite Reference: ${String(msg.invitationId).slice(0, 8)}`);
    if (msg.startsAt) parts.push(`Valid From: ${formatDate(msg.startsAt)}`);
    if (msg.expiresAt) parts.push(`Expires: ${formatDate(msg.expiresAt)}`);
    if (msg.invitationExpiresAt) parts.push(`Redemption Deadline: ${formatDate(msg.invitationExpiresAt)}`);
    
    if (parts.length > 0) return parts.join(" · ");

    // Generic key-value formatting without JSON braces
    const lines = Object.entries(msg)
      .filter(([_, v]) => v !== null && v !== undefined && v !== "")
      .map(([key, val]) => {
        const cleanKey = key
          .replace(/_/g, " ")
          .replace(/([A-Z])/g, " $1")
          .trim();
        const capitalized = cleanKey.charAt(0).toUpperCase() + cleanKey.slice(1);
        const cleanVal = typeof val === "object" ? formatLegibleMessage(val) : String(val);
        return `${capitalized}: ${cleanVal}`;
      });

    return lines.join(" · ") || "Verified";
  }

  return String(msg);
}
