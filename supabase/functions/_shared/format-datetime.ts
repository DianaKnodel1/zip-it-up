// Zeitformatierung für E-Mails — unabhängig davon, ob das Runtime vollständige
// Zeitzonendaten (ICU) mitbringt. Manche selbstgehosteten Edge-Runtimes ignorieren
// `timeZone` still und liefern UTC → Termine erschienen 1–2 Stunden zu früh.

export const APP_TZ = "Europe/Berlin";

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** Letzter Sonntag im Monat (UTC), 01:00 UTC = EU-Umstellungszeitpunkt. */
function lastSundayUtc(year: number, monthIndex: number): number {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0, 1, 0, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}

/** Offset für Europe/Berlin in Minuten (60 = MEZ, 120 = MESZ). */
export function berlinOffsetMinutes(date: Date): number {
  const y = date.getUTCFullYear();
  const t = date.getTime();
  return t >= lastSundayUtc(y, 2) && t < lastSundayUtc(y, 9) ? 120 : 60;
}

/** Datum/Zeit-Teile in Berliner Ortszeit, ohne auf ICU angewiesen zu sein. */
function berlinParts(date: Date) {
  const shifted = new Date(date.getTime() + berlinOffsetMinutes(date) * 60_000);
  return {
    weekday: WEEKDAYS[shifted.getUTCDay()],
    day: shifted.getUTCDate(),
    month: MONTHS[shifted.getUTCMonth()],
    year: shifted.getUTCFullYear(),
    hour: String(shifted.getUTCHours()).padStart(2, "0"),
    minute: String(shifted.getUTCMinutes()).padStart(2, "0"),
  };
}

/** z.B. "Dienstag, 28. Juli 2026" (withYear=false → ohne Jahr). */
export function formatAppointmentDate(date: Date, withYear = true): string {
  const p = berlinParts(date);
  return `${p.weekday}, ${p.day}. ${p.month}${withYear ? ` ${p.year}` : ""}`;
}

/** z.B. "01:00" */
export function formatAppointmentTime(date: Date): string {
  const p = berlinParts(date);
  return `${p.hour}:${p.minute}`;
}

/** Lokale Zeit als ICS-Wert (ohne Z), für DTSTART;TZID=Europe/Berlin. */
export function icsLocalBerlin(date: Date): string {
  const shifted = new Date(date.getTime() + berlinOffsetMinutes(date) * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}${p(shifted.getUTCMonth() + 1)}${p(shifted.getUTCDate())}T${p(shifted.getUTCHours())}${p(shifted.getUTCMinutes())}${p(shifted.getUTCSeconds())}`;
}
