import { useWhatsAppSupport } from "@/hooks/use-whatsapp-support";

/**
 * Runder WhatsApp-Hilfebutton unten links ("Probleme, Fragen?").
 * Sichtbar nur, wenn in den Admin-Einstellungen aktiviert und eine
 * Nummer/ein Link hinterlegt ist. Unten links, damit das Chat-Widget
 * unten rechts frei bleibt.
 */
export default function WhatsAppSupportButton() {
  const { enabled, href } = useWhatsAppSupport();
  if (!enabled || !href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Probleme oder Fragen? Schreiben Sie uns per WhatsApp"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full bg-[#25D366] py-2 pl-2 pr-2 text-white shadow-lg transition-transform hover:scale-105 sm:pr-4"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
        <WhatsAppIcon className="h-6 w-6" />
      </span>
      <span className="hidden text-sm font-semibold sm:inline">Probleme, Fragen?</span>
    </a>
  );
}

export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="currentColor" aria-hidden="true">
      <path d="M16.02 3.2c-7.06 0-12.8 5.73-12.8 12.79 0 2.25.59 4.45 1.72 6.39L3.2 28.8l6.6-1.72a12.77 12.77 0 0 0 6.22 1.59h.01c7.05 0 12.79-5.74 12.79-12.79 0-3.42-1.33-6.63-3.75-9.04a12.68 12.68 0 0 0-9.05-3.64Zm0 23.31h-.01c-1.86 0-3.68-.5-5.27-1.44l-.38-.22-3.92 1.02 1.05-3.82-.25-.39a10.6 10.6 0 0 1-1.63-5.67c0-5.87 4.78-10.64 10.65-10.64 2.84 0 5.51 1.11 7.52 3.12a10.56 10.56 0 0 1 3.11 7.53c0 5.87-4.78 10.51-10.87 10.51Zm5.84-7.97c-.32-.16-1.89-.93-2.18-1.04-.29-.11-.5-.16-.71.16s-.82 1.04-1 1.25c-.19.21-.37.24-.69.08-.32-.16-1.35-.5-2.57-1.59-.95-.85-1.59-1.89-1.78-2.21-.19-.32-.02-.5.14-.66.15-.15.32-.37.48-.56.16-.19.21-.32.32-.53.11-.21.05-.4-.03-.56-.08-.16-.71-1.72-.98-2.35-.26-.62-.52-.53-.71-.54l-.61-.01c-.21 0-.56.08-.85.4-.29.32-1.11 1.09-1.11 2.65s1.14 3.08 1.3 3.29c.16.21 2.24 3.42 5.43 4.8.76.33 1.35.52 1.81.67.76.24 1.45.21 2 .13.61-.09 1.89-.77 2.15-1.52.27-.75.27-1.38.19-1.52-.08-.13-.29-.21-.61-.37Z" />
    </svg>
  );
}
