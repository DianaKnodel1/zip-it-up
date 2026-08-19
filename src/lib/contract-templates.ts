/**
 * Kanonische Standard-Vertragsvorlage (Home-Office / auftragsbezogen).
 *
 * Einzige Quelle für den Vertragstext: die Admin-Oberfläche
 * (Vertrags-Templates) und der Notfall-Fallback in `contract-utils.ts`
 * verwenden denselben Wortlaut. Unterschiede zwischen den drei
 * Beschäftigungsarten beschränken sich auf § 3 (Minijob-Grenze) und
 * § 4 (Arbeitszeit-Formulierung).
 */

export const EMPLOYMENT_TYPES = ["minijob", "teilzeit", "vollzeit"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

const WORKING_TIME_LINE: Record<string, string> = {
  minijob:
    "Die regelmäßige wöchentliche Arbeitszeit beträgt bis zu {{weekly_hours}} Wochenstunden auf Nebenjobbasis.",
  teilzeit:
    "Die regelmäßige wöchentliche Arbeitszeit beträgt bis zu {{weekly_hours}} Wochenstunden in Teilzeit.",
  vollzeit:
    "Die regelmäßige wöchentliche Arbeitszeit beträgt {{weekly_hours}} Wochenstunden in Vollzeit.",
};

const MINIJOB_LIMIT_LINE =
  "Sollte das Guthaben zum Auszahlungstag die derzeit gültige Minijob-Grenze überschreiten, so wird das überschüssige Guthaben in den nächsten Monat übertragen.";

function buildTemplate(employmentType: string): string {
  const workingTime = WORKING_TIME_LINE[employmentType] ?? WORKING_TIME_LINE.minijob;
  const limitLine = employmentType === "minijob" ? `\n${MINIJOB_LIMIT_LINE}` : "";

  return `Arbeitsvertrag
(für Angestellte und Mitarbeiter)

Der Vertrag wird geschlossen zwischen:

{{company_name}}
{{company_address}}

(Vertreten durch {{company_ceo_name}})

- nachfolgend "Arbeitgeber" genannt -

und

{{first_name}} {{last_name}}
{{address}}

- nachfolgend "Arbeitnehmer auf Home-Office Basis" genannt -

und beinhaltet die nachfolgenden Vereinbarungen:

§ 1
Beginn des Arbeitsverhältnisses
Dieses Arbeitsverhältnis beginnt am {{start_date}} und nach beidseitiger Unterfertigung erhält dieser Vertrag seine Rechtswirksamkeit.

§ 2
Probezeit
Das Arbeitsverhältnis wird auf unbestimmte Zeit geschlossen. Die ersten 3 Monate gelten als Probezeit. Während der Probezeit kann das Arbeitsverhältnis beiderseits mit einer Frist von zwei Wochen gekündigt werden. Der Arbeitnehmer wird als

Mobile-App-Prüfer/in via Home-Office (m/w/d)

eingestellt und vor allem mit folgenden Arbeiten beschäftigt:

- an mobilen App-Prüfungen
- aller Vorgänge
- unserer Qualitätsstandards

§ 3
Arbeitsvergütung
Die Vergütung erfolgt ausschließlich nach abgeschlossenem Auftrag.
Ein Anspruch auf Zahlung besteht erst, wenn der Auftrag vollständig bearbeitet, ordnungsgemäß dokumentiert sowie geprüft und ausgewertet wurde.
Der Arbeitnehmer erhält einen Lohn von bis zu {{monthly_salary}} netto.
Der genaue Auszahlungsbetrag ergibt sich aus dem aus den Gutschriften für erfolgreich abgeschlossene Aufträge summierten Guthaben.
Soweit eine zusätzliche Zahlung vom Arbeitgeber gewährt wird, handelt es sich um eine freiwillige Leistung. Auch die wiederholte vorbehaltslose Zahlung begründet keinen Rechtsanspruch auf Leistungsgewährung für die Zukunft.
Ein Anspruch auf Zuwendungen besteht nicht für Zeiten, in denen das Arbeitsverhältnis ruht und kein Anspruch auf Arbeitsentgelt besteht.
Die erstmalige Gehaltsauszahlung erfolgt am Ende des Folgemonats, nachdem der Arbeitsvertrag in Rechtskraft getreten ist und beinhaltet sowohl den Lohn für den ersten Monat als auch für den Folgemonat.${limitLine}

§ 4
Arbeitszeit
${workingTime}
Die tatsächliche Arbeitszeit bestimmt sich nach Art, Umfang und terminlicher Festlegung der jeweils übertragenen Aufträge. Der Arbeitnehmer ist grundsätzlich berechtigt, seine Arbeitszeit im Rahmen der für den jeweiligen Auftrag vorgegebenen Ausführungsfrist eigenverantwortlich zu gestalten.
Bei bestimmten Aufträgen ist die persönliche Anwesenheit des Teamleiters erforderlich.
In diesen Fällen ist der Arbeitnehmer verpflichtet, die Tätigkeit zum vorgegebenen Termin aufzunehmen. Aus der jeweiligen Auftragsbeschreibung ergibt sich, ob und in welchem Umfang eine zeitlich flexible Erledigung zulässig ist.
Überstunden im arbeitsrechtlichen Sinne fallen nicht an; etwaige zeitliche Mehranforderungen ergeben sich ausschließlich aus den Besonderheiten des einzelnen Auftrags.

§ 5
Urlaub
Der Arbeitnehmer hat Anspruch auf den gesetzlichen Mindesturlaub gemäß den gesetzlichen Bestimmungen.
Eine gesonderte Urlaubsmeldung gegenüber dem Arbeitgeber ist nicht erforderlich, da die Arbeitsleistung ausschließlich auftragsbezogen erfolgt.
Urlaubstage wirken sich nicht auf die Vergütung aus, da keine feste Monatsvergütung geschuldet wird.

§ 6
Krankheit
Ist der Arbeitnehmer infolge unverschuldeter Krankheit arbeitsunfähig, so besteht Anspruch auf Fortzahlung der Arbeitsvergütung bis zur Dauer von sechs Wochen nach den gesetzlichen Bestimmungen. Die Arbeitsverhinderung ist dem Arbeitgeber unverzüglich mitzuteilen.
Dauert die Arbeitsunfähigkeit länger als drei Kalendertage, hat der Arbeitnehmer eine ärztliche Bescheinigung über das Bestehen sowie deren voraussichtliche Dauer spätestens an dem auf den dritten Kalendertag folgenden Arbeitstag vorzulegen. Diese Nachweispflicht gilt auch nach Ablauf der sechs Wochen. Der Arbeitgeber ist berechtigt, die Vorlage der Arbeitsunfähigkeitsbescheinigung früher zu verlangen.

§ 7
Verschwiegenheitspflicht
Der Arbeitnehmer verpflichtet sich, während der Dauer des Arbeitsverhältnisses und auch nach dem Ausscheiden, über alle Betriebs- und Geschäftsgeheimnisse Stillschweigen zu bewahren.

§ 8
Kündigung
Nach Ablauf der Probezeit beträgt die Kündigungsfrist vier Wochen zum Fünfzehnten oder Ende eines Kalendermonats. Jede gesetzliche Verlängerung der Kündigungsfrist zugunsten des Arbeitnehmers gilt in gleicher Weise auch zugunsten des Arbeitgebers. Die Kündigung bedarf der Schriftform.
Vor Antritt des Arbeitsverhältnisses ist die Kündigung ausgeschlossen. Der Arbeitgeber ist berechtigt, den Arbeitnehmer bis zur Beendigung des Arbeitsverhältnisses freizustellen. Die Freistellung erfolgt unter Anrechnung der dem Arbeitnehmer eventuell noch zustehenden Urlaubsansprüche sowie eventueller Guthaben auf dem Arbeitszeitkonto.
In der Zeit der Freistellung hat sich der Arbeitnehmer einen durch Verwendung seiner Arbeitskraft erzielten Verdienst auf den Vergütungsanspruch gegenüber dem Arbeitgeber anrechnen zu lassen. Das Arbeitsverhältnis endet spätestens mit Ablauf des Monats, in dem der Arbeitnehmer das für ihn gesetzlich festgelegte Renteneintrittsalter vollendet hat.

§ 9
Folgen der Kündigung
Mit Wirksamwerden der Kündigung wird der Zugang des Arbeitnehmers zum Mitarbeiterportal und allen internen Systemen des Arbeitgebers unverzüglich gesperrt.
Sämtliche personenbezogenen Daten des Arbeitnehmers werden gemäß den Vorgaben der Datenschutz-Grundverordnung (DSGVO) unverzüglich gelöscht, soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen.
Bereits erstellte, aber noch nicht abgerechnete Aufträge werden bis zum Abschluss regulär vergütet, sofern die Arbeiten ordnungsgemäß erbracht wurden.
Alle materiellen Arbeitsmittel, Zugänge und Unterlagen, die dem Arbeitnehmer vom Arbeitgeber überlassen wurden, sind unverzüglich zurückzugeben.
Etwaige bestehende Ansprüche auf Vergütung aus abgeschlossenen Aufträgen verfallen nicht und werden gemäß den vertraglichen Vereinbarungen abgerechnet.

§ 10
Verfall-/Ausschlussfristen
Die Vertragsparteien müssen Ansprüche aus dem Arbeitsverhältnis innerhalb von drei Monaten nach ihrer Fälligkeit schriftlich geltend machen und im Falle der Ablehnung durch die Gegenseite innerhalb von weiteren drei Monaten einklagen. Andernfalls erlöschen sie. Für Ansprüche aus unerlaubter Handlung verbleibt es bei der gesetzlichen Regelung.

§ 11
Vertragsänderungen und Nebenabreden
Änderungen, Ergänzungen und Nebenabreden bedürfen der Schriftform; dies gilt auch für die Aufhebung der Schriftform selbst. Sollten einzelne Bestimmungen dieses Vertrages unwirksam sein oder werden, wird hierdurch die Wirksamkeit des Vertrages im Übrigen nicht berührt. Der Arbeitnehmer verpflichtet sich, dem Arbeitgeber unverzüglich über Veränderungen der persönlichen Verhältnisse wie Familienstand, Kinderzahl, Adresse, Mitteilung zu machen.

{{company_city}}, den {{date}}

{{company_ceo_name}}

{{city}}, {{first_name}} {{last_name}}`;
}

/** Standardvorlage mit Platzhaltern für die angegebene Beschäftigungsart. */
export function getStandardContractTemplate(employmentType: string): string {
  return buildTemplate(employmentType);
}

/** Titel-Vorschlag für automatisch angelegte Vorlagen. */
export function standardContractTitle(employmentType: string): string {
  const label =
    employmentType === "minijob" ? "Minijob"
    : employmentType === "teilzeit" ? "Teilzeit"
    : employmentType === "vollzeit" ? "Vollzeit"
    : employmentType;
  return `Arbeitsvertrag ${label} (Standard)`;
}