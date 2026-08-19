# Vier Anzeige-Fehler beheben (Mail-Historie, Mitarbeiterliste, Perso, Zusage)

## Was ich im Code nachgewiesen habe

1. **Terminbestätigung bleibt auf „noch kein Ergebnis"**
   Der Versand legt zuerst eine Reservierungs-Zeile mit Status „pending" an, verschickt die Mail,
   schreibt dann das Reminder-Protokoll auf „gesendet" und erst danach den Endstatus „sent".
   Bricht der Aufruf zwischen diesen Schritten ab (bekanntes Gateway-Timeout), bleibt „pending" stehen.
   Die Oberfläche paart beide Protokolle und verwirft dabei genau den Eintrag mit dem echten
   Ergebnis — die Mail ist raus, sieht aber offen aus.

2. **Fehlende E-Mail-Adressen in der Mitarbeiterliste**
   Die Liste liest `profiles.email` — diese Spalte existiert in der Tabelle nicht.
   Sichtbar wird nur die Adresse aus einer verknüpften Bewerbung; ohne Bewerbung bleibt „—".
   Die echte Adresse liegt ausschließlich im Login-Konto.

3. **„Perso" bleibt grau, obwohl der Ausweis hochgeladen ist**
   Die Liste prüft `profiles.id_front_url` / `id_back_url` — auch diese Felder gibt es dort nicht.
   Die Ausweis-Dokumente liegen in der KYC-Tabelle, die im Admin bereits geladen, aber hier
   nicht genutzt wird.

4. **Katja Dönges: „Zusage-Mail wurde nie ausgelöst"**
   Die Bewerbungsliste lädt nur die 5.000 neuesten Mail-Zeilen ohne Zeitfenster. Bei aktuellem
   Volumen fallen ältere Versände aus diesem Fenster — die Zusage-Mail existiert, ist für die
   Oberfläche aber unsichtbar. Zusätzlich zählt bisher nur der Status „sent" aus dem
   Versand-Protokoll als Nachweis.

## Umsetzung

- **Mail-Historie ehrlich machen** (`src/lib/mail-chain.ts`)
  Passt zu einer „pending"-Zeile ein Reminder-Eintrag mit Ergebnis „gesendet", wird der Schritt
  als gesendet dargestellt. Bleibt eine Reservierung älter als 30 Minuten ganz ohne Ergebnis,
  wird sie als „hängen geblieben" ausgewiesen statt als „noch kein Ergebnis".

- **Vollständige Mail-Historie laden** (`src/routes/admin.bewerbungen.tsx`)
  Statt „die neuesten 5.000 Zeilen" ein sauberes Zeitfenster (letzte 90 Tage, vollständig
  paginiert). Als Nachweis einer erteilten Zusage zählen künftig auch Einträge, die nur im
  Reminder-Protokoll als versendet stehen.

- **E-Mail-Spalte reparieren** (neu: `src/lib/user-emails.functions.ts`, dazu
  `src/contexts/AdminDataContext.tsx`, `src/routes/admin.mitarbeiter.tsx`)
  Eine neue Admin-Serverfunktion liefert die Adressen der Login-Konten; die Mitarbeiterliste
  nutzt sie als Quelle, die Bewerbungsadresse bleibt Rückfall.

- **Perso-Schritt reparieren** (`src/routes/admin.mitarbeiter.tsx`)
  Der Schritt wird aus den bereits geladenen KYC-Daten abgeleitet (Vorder-/Rückseite bzw.
  geprüfter Status) statt aus nicht existierenden Profilfeldern.

## Nicht Teil dieses Schritts

Die gewünschte Bewerber-Übersicht (`portal.<domain>/bewerbung`, Zugang über die Bewerbungs-E-Mail)
ist ein eigenes Feature — das plane ich separat, sobald diese Fehler behoben sind.

## Technische Details

- Keine Datenbank-Änderung, keine Migration, kein Edge-Function-Deploy nötig: alle vier Punkte
  sind Anzeige- bzw. Abfragefehler im Portal-Frontend plus eine neue Serverfunktion.
- Deploy danach ausschließlich auf dem Portal-Server (`scripts/deploy.sh`).