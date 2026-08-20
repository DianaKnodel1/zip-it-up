import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface WhatsAppSupport {
  enabled: boolean;
  /** Fertiger Link (wa.me/… oder eine hinterlegte vollständige URL) */
  href: string | null;
}

const EMPTY: WhatsAppSupport = { enabled: false, href: null };

let cache: WhatsAppSupport | null = null;
let inflight: Promise<WhatsAppSupport> | null = null;

/** Baut aus Nummer oder Link eine gültige WhatsApp-URL. */
export function buildWhatsAppHref(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length < 6) return null;
  return `https://wa.me/${digits}`;
}

async function load(): Promise<WhatsAppSupport> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await (supabase.rpc as any)("get_public_whatsapp_support");
      if (error) console.warn("[whatsapp-support] konnte nicht geladen werden:", error.message);
      const row = Array.isArray(data) ? data[0] : data;
      const enabled = !!row?.whatsapp_enabled;
      const href = enabled ? buildWhatsAppHref(row?.whatsapp_number) : null;
      cache = { enabled: enabled && !!href, href };
    } catch (e: any) {
      console.warn("[whatsapp-support] Fehler:", e?.message ?? e);
      cache = EMPTY;
    } finally {
      inflight = null;
    }
    return cache ?? EMPTY;
  })();
  return inflight;
}

export function useWhatsAppSupport(): WhatsAppSupport {
  const [state, setState] = useState<WhatsAppSupport>(cache ?? EMPTY);

  useEffect(() => {
    let active = true;
    load().then((s) => { if (active) setState(s); });
    return () => { active = false; };
  }, []);

  return state;
}

/** Cache leeren, damit Admin-Änderungen sofort greifen. */
export function resetWhatsAppSupportCache() {
  cache = null;
}
