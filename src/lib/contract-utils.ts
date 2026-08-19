import { getStandardContractTemplate } from "./contract-templates";

const EMPLOYMENT_LABELS: Record<string, string> = {
  minijob: "Minijob",
  teilzeit: "Teilzeit",
  vollzeit: "Vollzeit",
};

// Default-Wochenstunden und Default-Monatsgehalt je Beschäftigungsart.
// Diese Werte greifen, wenn pro Mitarbeiter nichts anderes hinterlegt ist,
// damit Platzhalter wie {{weekly_hours}} / {{monthly_salary}} nicht leer bleiben.
const DEFAULT_WEEKLY_HOURS: Record<string, string> = {
  minijob: "10",
  teilzeit: "20",
  vollzeit: "40",
};
const DEFAULT_MONTHLY_SALARY: Record<string, string> = {
  minijob: "556,00 €",
  teilzeit: "1.200,00 €",
  vollzeit: "2.400,00 €",
};

interface ContractData {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  employmentType: string;
  companyName: string;
  companyCeoName: string;
  companyAddress?: string;
  companyCity?: string;
  startDate?: string; // already formatted DE
  weeklyHours?: string;
  monthlySalary?: string;
}

/**
 * Viele Vorlagen verwenden im Firmenblock die generischen Platzhalter
 * {{address}} / {{city}} – diese würden sonst mit den Daten des Arbeitnehmers
 * gefüllt. Dieser Pre-Processor erkennt den Firmenblock (alles direkt nach
 * {{company_name}} bis zum nächsten alleinstehenden "und") und ersetzt das
 * erste Vorkommen von {{address}}/{{city}} dort mit firmenspezifischen
 * Platzhaltern.
 */
function disambiguateCompanyPlaceholders(template: string): string {
  if (!template) return template;
  const companyIdx = template.search(/\{\{\s*company_name\s*\}\}/i);
  if (companyIdx < 0) return template;
  // Ende des Firmenblocks: erstes alleinstehendes "und" auf eigener Zeile
  const after = template.slice(companyIdx);
  const undMatch = after.match(/\n\s*und\s*\n/i);
  const blockEnd = undMatch ? companyIdx + (undMatch.index ?? 0) : template.length;
  const before = template.slice(0, companyIdx);
  let block = template.slice(companyIdx, blockEnd);
  const rest = template.slice(blockEnd);
  block = block.replace(/\{\{\s*address\s*\}\}/i, "{{company_address}}");
  block = block.replace(/\{\{\s*city\s*\}\}/i, "{{company_city}}");
  return before + block + rest;
}

/**
 * Extract city from a full address string.
 * "Musterstraße 1, 12345 Berlin" → "Berlin"
 * Returns "" if no city can be parsed (so {{company_city}} renders empty
 * instead of duplicating the full address).
 */
function extractCityFromAddress(addr?: string | null): string {
  if (!addr) return "";
  const last = addr.split(",").pop()?.trim() ?? "";
  // Strip leading PLZ (German 5-digit), keep the rest as city
  return last.replace(/^\d{4,5}\s+/, "").trim();
}

/**
 * Resolve the city for company placeholders. If the admin stored a full
 * address in the city field (contains a comma or street number), extract
 * just the city part to avoid duplicating the address.
 */
function resolveCompanyCity(companyCity?: string | null, companyAddress?: string | null): string {
  const raw = (companyCity ?? "").trim();
  if (raw) {
    // Looks like a full address (has comma or starts with PLZ + street)?
    if (raw.includes(",") || /^\d{4,5}\s+\S+\s+\d/.test(raw)) {
      return extractCityFromAddress(raw);
    }
    return raw;
  }
  return extractCityFromAddress(companyAddress);
}

export function formatGermanDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  if (typeof d === "string") {
    const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
    const german = d.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
    if (german) {
      const year = german[3].length === 2 ? `20${german[3]}` : german[3];
      return `${german[1].padStart(2, "0")}.${german[2].padStart(2, "0")}.${year}`;
    }
  }
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function applyEmploymentStartDate(content: string, startDate?: string): string {
  if (!content || !startDate) return content;
  return content.replace(
    /(Arbeitsverhältnis\s+beginnt\s+(?:am|zum)\s+)\d{1,2}\.\d{1,2}\.\d{2,4}/gi,
    `$1${startDate}`
  );
}

/**
 * Resolve all placeholder spellings in a stored contract (both `{{key}}` and
 * `((key))` styles, with common typos). Safe to run repeatedly on already-
 * rendered contracts — placeholders that no longer exist are simply skipped.
 */
export function resolveContractPlaceholders(
  content: string,
  data: {
    firstName?: string;
    lastName?: string;
    address?: string;
    city?: string;
    employmentType?: string;
    companyName?: string;
    companyCeoName?: string;
    companyAddress?: string;
    companyCity?: string;
    startDate?: string;
    weeklyHours?: string;
    monthlySalary?: string;
  }
): string {
  if (!content) return content;
  const employmentLabel =
    data.employmentType === "minijob" ? "Minijob"
    : data.employmentType === "teilzeit" ? "Teilzeit"
    : data.employmentType === "vollzeit" ? "Vollzeit"
    : data.employmentType ?? "";

  const weeklyHours = data.weeklyHours || DEFAULT_WEEKLY_HOURS[data.employmentType ?? ""] || "";
  const monthlySalary = data.monthlySalary || DEFAULT_MONTHLY_SALARY[data.employmentType ?? ""] || "";

  const today = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const map: Record<string, string> = {
    first_name: data.firstName ?? "",
    firstname: data.firstName ?? "",
    last_name: data.lastName ?? "",
    lastname: data.lastName ?? "",
    address: data.address ?? "",
    adresse: data.address ?? "",
    city: data.city ?? "",
    stadt: data.city ?? "",
    employment_type: employmentLabel,
    beschaeftigungsart: employmentLabel,
    weekly_hours: weeklyHours,
    working_hours: weeklyHours,
    wochenstunden: weeklyHours,
    hours_per_week: weeklyHours,
    monthly_salary: monthlySalary,
    salary: monthlySalary,
    gehalt: monthlySalary,
    monatsgehalt: monthlySalary,
    company_name: data.companyName ?? "",
    companyname: data.companyName ?? "",
    firmenname: data.companyName ?? "",
    company_ceo_name: data.companyCeoName ?? "",
    companyceoname: data.companyCeoName ?? "",
    geschaeftsfuehrer: data.companyCeoName ?? "",
    company_address: data.companyAddress ?? "",
    companyaddress: data.companyAddress ?? "",
    companyadress: data.companyAddress ?? "",
    company_adress: data.companyAddress ?? "",
    firmenadresse: data.companyAddress ?? "",
    company_city: resolveCompanyCity(data.companyCity, data.companyAddress),
    companycity: resolveCompanyCity(data.companyCity, data.companyAddress),
    firmenstadt: resolveCompanyCity(data.companyCity, data.companyAddress),
    start_date: data.startDate || today,
    startdate: data.startDate || today,
    startdatum: data.startDate || today,
    employment_start_date: data.startDate || today,
    date: today,
    datum: today,
  };

  const norm = (k: string) => k.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const replacer = (_m: string, key: string) => {
    const v = map[norm(key)];
    return v !== undefined ? v : _m;
  };
  let out = disambiguateCompanyPlaceholders(content).replace(/\{\{\s*([a-zA-Z0-9_ -]+?)\s*\}\}/g, replacer);
  out = out.replace(/\(\(\s*([a-zA-Z0-9_ -]+?)\s*\)\)/g, replacer);
  if (data.startDate) out = applyEmploymentStartDate(out, data.startDate);
  return out;
}

export function replacePlaceholders(template: string, data: ContractData): string {
  const today = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const startDate = data.startDate || today;
  const weeklyHours = data.weeklyHours || DEFAULT_WEEKLY_HOURS[data.employmentType] || "";
  const monthlySalary = data.monthlySalary || DEFAULT_MONTHLY_SALARY[data.employmentType] || "";
  const companyCity = resolveCompanyCity(data.companyCity, data.companyAddress);
  const resolved = disambiguateCompanyPlaceholders(template)
    .replace(/\{\{first_name\}\}/g, data.firstName)
    .replace(/\{\{last_name\}\}/g, data.lastName)
    .replace(/\{\{address\}\}/g, data.address)
    .replace(/\{\{city\}\}/g, data.city)
    .replace(/\{\{employment_type\}\}/g, EMPLOYMENT_LABELS[data.employmentType] ?? data.employmentType)
    .replace(/\{\{weekly_hours\}\}/g, weeklyHours)
    .replace(/\{\{working_hours\}\}/g, weeklyHours)
    .replace(/\{\{monthly_salary\}\}/g, monthlySalary)
    .replace(/\{\{salary\}\}/g, monthlySalary)
    .replace(/\{\{company_name\}\}/g, data.companyName)
    .replace(/\{\{company_ceo_name\}\}/g, data.companyCeoName)
    .replace(/\{\{company_address\}\}/g, data.companyAddress ?? "")
    .replace(/\{\{company_city\}\}/g, companyCity)
    .replace(/\{\{start_date\}\}/g, startDate)
    .replace(/\{\{employment_start_date\}\}/g, startDate)
    .replace(/\{\{date\}\}/g, today);
  return applyEmploymentStartDate(resolved, data.startDate);
}

export function generateFallbackContract(data: ContractData): string {
  // Notfall-Vertrag, wenn für den Mandanten keine aktive Vorlage existiert.
  // Verwendet exakt denselben Wortlaut wie die Standardvorlage, damit ein
  // Mitarbeiter nie einen abweichenden Vertrag zu sehen bekommt.
  return replacePlaceholders(getStandardContractTemplate(data.employmentType), data);
}
