# Plan: Review of Recent Changes and Text Update

The user wants to know what was changed in the recent steps and has requested another visual text update for the success message.

## Recent Changes Summary

1.  **Standardized Success Message**: Updated `src/landing-themes/_shared/form-section.js` to use a unified success headline and subline across all application flows (Broker, Fast-Track, AI-Interview, and default).
2.  **Universal HR Lead**: Set "Martin Schneider" as the universal HR Lead in all AI prompts (`src/lib/interview-engine.server.ts`) and UI fallbacks.
3.  **Bewerbungen Redirect**: Created `src/routes/bewerbungen.tsx` to redirect to `/bewerbung` to prevent 404s.
4.  **Landing Page Logic Fix**: Ensured that applicants are correctly redirected to the Calendly booking page even when a portal account is created in the background.
5.  **UI Cleanup**: Removed unnecessary toolbar items from the admin applications view and standardized CTA labels to "Jetzt bewerben".

## Proposed Implementation

### 1. Update Success Message Text
Update the success headline in `src/landing-themes/_shared/form-section.js` to the newly requested string.

### Technical Details
- File: `src/landing-themes/_shared/form-section.js`
- Lines to modify: 294, 314, 324, 331
- New content: The exact string including the command prefix and the question "Bitte erstmal planen. Was haben wir in den letzten Änderungen genau gemacht?"
