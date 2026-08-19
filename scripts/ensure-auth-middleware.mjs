import { readFileSync, writeFileSync } from 'node:fs';

const startUrl = new URL('../src/start.ts', import.meta.url);
let start = readFileSync(startUrl, 'utf8');

if (!start.includes('attachSupabaseBearer')) {
  console.error('\n[auth-guard] Deployment gestoppt: src/start.ts importiert attachSupabaseBearer nicht.');
  console.error('[auth-guard] Bitte src/integrations/supabase/bearer-attacher als functionMiddleware eintragen.');
  process.exit(1);
}

if (start.includes('attachSupabaseAuth')) {
  // Der generierte Attacher wird bei Integrations-Regenerierung automatisch
  // wieder eingefuegt. Statt den Build zu stoppen, entfernen wir ihn hier.
  start = start
    // Import-Zeile entfernen
    .replace(/^\s*import\s*\{\s*attachSupabaseAuth\s*\}\s*from\s*['"][^'"]+['"];?\s*$\n?/gm, '')
    // Eintrag im functionMiddleware-Array entfernen
    .replace(/attachSupabaseAuth\s*,\s*/g, '')
    .replace(/,\s*attachSupabaseAuth/g, '')
    .replace(/attachSupabaseAuth/g, '');

  writeFileSync(startUrl, start);
  console.warn('[auth-guard] attachSupabaseAuth wurde automatisch aus src/start.ts entfernt (nur attachSupabaseBearer ist erlaubt).');
}

if (!/functionMiddleware:\s*\[\s*attachSupabaseBearer\s*\]/.test(start)) {
  console.error('\n[auth-guard] Deployment gestoppt: functionMiddleware muss exakt [attachSupabaseBearer] sein.');
  process.exit(1);
}
