// Minimal iCal generator. Spec: RFC 5545.
//
// Each performance becomes one VEVENT with floating local time -- no
// timezone declaration -- which iCal-aware clients interpret as local
// time on whatever device imports the file. That's the right thing for
// festival attendance: the user is in Brighton, the calendar will be on
// a device in Brighton, the time is the time on the wall clock.
//
// generateICS({ performances }) -> string
// downloadICS(filename, performances)   -> triggers browser save

function _pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function _nowUtcStamp() {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}${_pad(d.getUTCMonth() + 1)}${_pad(d.getUTCDate())}T` +
    `${_pad(d.getUTCHours())}${_pad(d.getUTCMinutes())}${_pad(d.getUTCSeconds())}Z`
  );
}

function _floatingStamp(dateStr, timeStr) {
  // dateStr "2026-05-22", timeStr "19:30" -> "20260522T193000"
  const date = dateStr.replace(/-/g, "");
  const time = (timeStr || "00:00").replace(":", "") + "00";
  return `${date}T${time}`;
}

function _addMinutes(dateStr, timeStr, minutes) {
  // Returns a floating-time string `minutes` after the given local time.
  // We build a Date in UTC just to do the arithmetic, then read its UTC
  // fields back out (no timezone shifts).
  const [Y, M, D] = dateStr.split("-").map((n) => parseInt(n, 10));
  const [h, m] = (timeStr || "00:00").split(":").map((n) => parseInt(n, 10));
  const d = new Date(Date.UTC(Y, M - 1, D, h, m + minutes));
  return (
    `${d.getUTCFullYear()}${_pad(d.getUTCMonth() + 1)}${_pad(d.getUTCDate())}T` +
    `${_pad(d.getUTCHours())}${_pad(d.getUTCMinutes())}00`
  );
}

function _escape(text) {
  if (!text) return "";
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// Wrap long lines per RFC 5545 (75 octets, soft-wrapped with leading space).
function _fold(line) {
  if (line.length <= 75) return line;
  const out = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    out.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest) out.push(" " + rest);
  return out.join("\r\n");
}

// performances: array of { slug, title, date ("YYYY-MM-DD"), time
// ("HH:MM"), duration_minutes?, venue_name?, venue_address?, url?,
// booking_url?, summary? }
export function generateICS(performances) {
  const stamp = _nowUtcStamp();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bringe//Brighton Fringe browser//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const p of performances) {
    if (!p.date) continue;
    const start = _floatingStamp(p.date, p.time);
    const dur = p.duration_minutes && p.duration_minutes > 0 ? p.duration_minutes : 90;
    const end = _addMinutes(p.date, p.time || "00:00", dur);

    const location = [p.venue_name, p.venue_address]
      .filter((s) => s && s.trim())
      .join(", ");
    const descParts = [];
    if (p.summary) descParts.push(p.summary);
    if (p.url) descParts.push(`Brighton Fringe page: ${p.url}`);
    if (p.booking_url && p.booking_url !== p.url) {
      descParts.push(`Book tickets: ${p.booking_url}`);
    }
    const description = descParts.join("\n\n");

    const uid = `${p.slug}-${p.date}-${(p.time || "00:00").replace(":", "")}@bringe`;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${_escape(uid)}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${start}`);
    lines.push(`DTEND:${end}`);
    lines.push(_fold(`SUMMARY:${_escape(p.title || "")}`));
    if (location) lines.push(_fold(`LOCATION:${_escape(location)}`));
    if (description) lines.push(_fold(`DESCRIPTION:${_escape(description)}`));
    if (p.url) lines.push(_fold(`URL:${p.url}`));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // iCal requires CRLF line endings.
  return lines.join("\r\n") + "\r\n";
}

export function downloadICS(filename, performances) {
  const text = generateICS(performances);
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "bringe-picks.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
