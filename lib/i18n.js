"use client";
import { createContext, useContext, useState, useEffect } from "react";

// English dictionary keyed by the German source string. DE is default (returns key as-is).
const EN = {
  // shell / nav / topbar
  "Erfassen": "Capture", "Belege": "Receipts", "Auswertungen": "Analytics",
  "Neuer Beleg": "New receipt", "Arbeiten": "Work", "Auswerten": "Analyze", "Analyse": "Analytics",
  "Admin": "Admin", "Abmelden": "Sign out", "System": "System", "Zur Startseite": "To home",
  "Beleg oder Händler suchen …": "Search receipt or merchant …", "Suchen": "Search",
  "Neoterra · The Vegetable Company": "Neoterra · The Vegetable Company",
  // login
  "Anmelden": "Sign in", "Konto erstellen": "Create account",
  "Melde dich an, um Belege zu erfassen und freizugeben.": "Sign in to capture and submit receipts.",
  "Lege ein Konto für die Belegerfassung an.": "Create an account for receipt capture.",
  "E-Mail": "Email", "Passwort": "Password", "Registrieren": "Register",
  "Noch kein Konto? ": "No account yet? ", "Bereits registriert? ": "Already registered? ",
  "Konto erstellt. Bitte E-Mail bestätigen, dann anmelden.": "Account created. Please confirm your email, then sign in.",
  "Demo-Zugang": "Demo access", "Demo": "Demo",
  "GoBD-konform · Daten in der EU": "GoBD-compliant · data in the EU",
  "Belege & Spesen — erfasst, geprüft, gebucht.": "Receipts & expenses — captured, checked, posted.",
  // capture
  "Beleg erfassen": "Capture receipt",
  "Foto, Scan, Upload oder per E-Mail — die OCR füllt die Felder automatisch.": "Photo, scan, upload or email — OCR fills the fields automatically.",
  "Foto": "Photo", "Scan": "Scan", "Upload": "Upload", "E-Mail-Inbox": "Email inbox",
  "Beleg hierher ziehen oder auswählen": "Drag a receipt here or choose a file",
  "Belege hierher ziehen oder auswählen": "Drag receipts here or choose files",
  "Mehrere Dateien möglich · JPG, PNG oder PDF": "Multiple files supported · JPG, PNG or PDF",
  "JPG, PNG oder PDF · mehrseitige Belege werden zusammengeführt": "JPG, PNG or PDF · multi-page receipts are merged",
  "Datei auswählen": "Choose file", "Dateien auswählen": "Choose files", "Lade hoch & erkenne …": "Uploading & reading …",
  "OCR startet automatisch nach dem Hochladen — du prüfst nur die markierten Felder.": "OCR runs automatically after upload — you only check the flagged fields.",
  "OCR startet automatisch — du prüfst nur die markierten Felder.": "OCR runs automatically — you only check the flagged fields.",
  "Mehr hinzufügen": "Add more", "Lese …": "Reading …", "Entfernen": "Remove",
  "Alle einreichen": "Submit all", "OCR läuft …": "OCR running …",
  // review
  "Prüfen & ergänzen": "Review & complete",
  "Beleg erkannt · Confidence ": "Receipt recognized · confidence ",
  "Händler": "Merchant", "Datum": "Date", "Betrag brutto (€)": "Amount gross (€)", "Betrag brutto": "Amount gross", "Betrag (brutto)": "Amount (gross)", "Währung": "Currency",
  "MwSt-Satz (%)": "VAT rate (%)", "MwSt": "VAT", "Kategorie": "Category",
  "Kostenstelle / Projekt": "Cost center / project", "Kostenstelle": "Cost center", "— wählen —": "— choose —",
  "wählen": "choose", "prüfen": "check",
  "Zahlart": "Payment method", "Firmenkarte": "Company card", "Privat verauslagt": "Paid privately",
  "Einreichen": "Submit", "Als Entwurf speichern": "Save as draft", "Abbrechen": "Cancel",
  // manual + import
  "oder": "or", "Manuell erfassen": "Enter manually", "Excel/CSV importieren": "Import Excel/CSV",
  "Manuell": "Manual", "Import": "Import", "Manueller Beleg": "Manual receipt",
  "Import-Spalten: Datum, Händler, Brutto, Währung, MwSt, Kategorie, Kostenstelle, Zahlart, Anlass, Teilnehmer.": "Import columns: date, merchant, gross, currency, VAT, category, cost center, payment, occasion, attendees.",
  "Zeilen importiert": "rows imported", "Keine Zeilen in der Datei.": "No rows in the file.", "Import fehlgeschlagen": "Import failed",
  "Als Entwürfe speichern": "Save as drafts", "Direkt einreichen": "Submit directly",
  // categories
  "Kraftstoff": "Fuel", "Reise": "Travel", "Bewirtung": "Hospitality", "IT / SaaS": "IT / SaaS",
  "Übernachtung": "Lodging", "Büromaterial": "Office", "Sonstiges": "Other",
  // status
  "Entwurf": "Draft", "In Prüfung": "In review", "Freigabe": "Approval", "Genehmigt": "Approved",
  "Gebucht": "Posted", "Abgelehnt": "Rejected",
  // receipts list
  "Meine Belege": "My receipts", "Alle": "All", "Offen": "Open", "Offenes Volumen": "Open amount",
  "Erstattung offen": "Reimbursement open", "Keine Belege in dieser Ansicht.": "No receipts in this view.",
  // detail
  "Beleg-Status": "Receipt status", "Zurück": "Back", "Verlauf (Audit-Trail)": "History (audit trail)",
  "An ERPNext übergeben": "Send to ERPNext", "Status": "Status",
  "Originalbeleg": "Original receipt", "Öffnen": "Open",
  "Erfasst": "Captured", "OCR & Plausibilität": "OCR & validation", "Eingereicht": "Submitted",
  "Freigabe Vorgesetzter": "Manager approval", "Übergabe ERPNext": "Hand-off ERPNext",
  // analytics
  "CSV-Export": "CSV export", "Monat": "Month", "3 Monate": "3 months", "12 Monate": "12 months",
  "Alle Kostenstellen": "All cost centers", "Alle Kategorien": "All categories",
  "Volumen": "Volume", "Ø Betrag": "Avg amount", "Vorsteuer": "Input VAT", "Offene Erstattung": "Open reimbursement",
  "Ausgaben pro Monat": "Spend per month", "Nach Kategorie": "By category", "Nach Kostenstelle": "By cost center",
  "Nach Mitarbeiter": "By employee", "Top-Lieferanten": "Top vendors",
  "Keine Daten im Filter.": "No data for this filter.", "Keine Daten.": "No data.",
  "Beträge in EUR · EZB-Kurs zum Belegdatum": "Amounts in EUR · ECB rate on receipt date",
  "ohne Kurs": "without rate", "Nach Währung": "By currency",
  "Zeitraum": "Period", "Erstellt": "Generated",
  // admin
  "Nutzerverwaltung": "User management", "Nutzer anlegen": "Create user", "Name": "Name", "Rolle": "Role",
  "Anlegen": "Create", "Nutzer": "Users", "Mitarbeiter": "Employee", "Genehmiger": "Approver",
  "Buchhaltung": "Accounting", "Administrator": "Administrator",
  "Temporäres Passwort": "Temporary password", "Nutzer angelegt": "User created",
  "Passwort (einmalig anzeigen):": "Password (shown once):", "Speichern": "Save", "Gespeichert": "Saved",
  "Nur Administratoren.": "Administrators only.", "Rolle aktualisiert": "Role updated",
  "Nutzer löschen": "Delete user", "Nutzer gelöscht": "User deleted", "Aktionen": "Actions", "Löschen": "Delete",
  "Verstanden": "Got it",
  "Kostenstellen": "Cost centers", "Code": "Code", "Bezeichnung": "Name", "Status": "Status",
  "optional": "optional", "wird sonst generiert": "auto-generated if empty", "Bearbeiten": "Edit",
  "z. B. Vertrieb": "e.g. Sales", "Aktiv": "Active", "Inaktiv": "Inactive", "Status umschalten": "Toggle status",
  "Noch keine Kostenstellen — lege oben die erste an.": "No cost centers yet — add the first one above.",
  "Kostenstelle angelegt": "Cost center created", "Kostenstelle gelöscht": "Cost center deleted",
  "Kostenstelle deaktiviert (in Belegen verwendet)": "Cost center deactivated (used in receipts)",
  "Diese Funktion folgt in Kürze: Du kannst Belege dann einfach an eine persönliche Sammeladresse weiterleiten — sie werden automatisch ausgelesen und hier erfasst. Nutze bis dahin Foto, Scan oder Upload.": "This feature is coming soon: you'll be able to forward receipts to a personal inbox address — they'll be read automatically and captured here. Until then, use Photo, Scan or Upload.",
  "Neues Passwort festlegen": "Set a new password",
  "Bitte vergib zur Sicherheit ein eigenes Passwort, um fortzufahren.": "Please set your own password to continue.",
  "Neues Passwort": "New password", "Passwort bestätigen": "Confirm password", "Passwort speichern": "Save password",
  "Mindestens 8 Zeichen.": "At least 8 characters.", "Passwörter stimmen nicht überein.": "Passwords don't match.",
  "Passwort zurücksetzen": "Reset password", "Zurücksetzen": "Reset", "Fertig": "Done",
  "Für «{name}» ein neues Temp-Passwort erzeugen? Der Nutzer muss es beim nächsten Login ändern.": "Generate a new temporary password for “{name}”? The user must change it on next login.",
  "Temp-Passwort für": "Temporary password for", "nur jetzt sichtbar:": "shown only now:",
  "Du kannst dich nicht selbst löschen.": "You can't delete yourself.",
  "Der letzte Administrator kann nicht gelöscht werden.": "The last administrator can't be deleted.",
  "«{name}» wirklich löschen? Die erfassten Belege bleiben erhalten.": "Really delete “{name}”? The captured receipts are kept.",
  "Nutzer & Rollen verwalten und die Beleg-Ablage konfigurieren.": "Manage users & roles and configure receipt filing.",
  "Beleg-Ablage (Google Drive)": "Receipt filing (Google Drive)",
  "Inbox-Ordner-ID (Shared Drive)": "Inbox folder ID (Shared Drive)",
  "ID aus der Drive-URL …/folders/<ID>. Pro Mitarbeiter wird darunter automatisch ein Unterordner angelegt. Service-Account & Schlüssel bleiben in den Servervariablen.": "ID from the Drive URL …/folders/<ID>. A subfolder per employee is created automatically underneath. Service account & key stay in server variables.",
  "ID aus der Drive-URL …/folders/<ID>. Pro Mitarbeiter wird darunter automatisch ein Unterordner angelegt. Das verbundene Google-Konto muss Zugriff auf den Ordner haben.": "ID from the Drive URL …/folders/<ID>. A subfolder per employee is created automatically underneath. The connected Google account must have access to the folder.",
  "Google-Konto": "Google account", "Mit Google verbinden": "Connect Google", "Trennen": "Disconnect", "verbunden": "connected",
  "Google-Konto verbunden": "Google account connected", "Google-Verbindung fehlgeschlagen": "Google connection failed", "Verbindung getrennt": "Disconnected",
  // approvals / workflow
  "Freigaben": "Approvals", "zur Freigabe": "awaiting approval", "Nichts zur Freigabe.": "Nothing to approve.",
  "Alle freigeben": "Approve all", "Freigeben": "Approve", "Ablehnen": "Reject", "Ablehnungsgrund?": "Reason for rejection?",
  "Hinweise": "flags", "mögliche Dublette": "possible duplicate",
  "Zurückziehen": "Withdraw",
  // bewirtung
  "Anlass der Bewirtung": "Occasion (hospitality)", "Teilnehmer": "Attendees",
  "z. B. Projektbesprechung mit Lieferant": "e.g. project meeting with vendor", "Namen, kommagetrennt": "Names, comma-separated",
  // plausibility flags (canonical DE keys)
  "Mögliche Dublette — dieser Beleg existiert bereits.": "Possible duplicate — this receipt already exists.",
  "Händler fehlt": "Merchant missing", "Betrag fehlt": "Amount missing",
  "Datum in der Zukunft": "Date in the future", "MwSt-Satz unplausibel": "Implausible VAT rate",
  "Betrag über Limit (1.000)": "Amount over limit (1,000)", "Bewirtung: Teilnehmer fehlen": "Hospitality: attendees missing",
  // vendor memory / toasts / theme / sheet
  "Vorbelegt aus Lieferanten-Gedächtnis — bitte prüfen.": "Pre-filled from vendor memory — please review.",
  "Hell": "Light", "Dunkel": "Dark", "Schließen": "Close",
  "als Entwurf gespeichert": "saved as draft", "Beleg(e) eingereicht": "receipt(s) submitted",
  "freigegeben": "approved", "abgelehnt": "rejected", "Freigegeben": "Approved", "Zurückgezogen": "Withdrawn",
  "Alle auswählen": "Select all", "ausgewählt": "selected",
  // analytics redesign
  "Anteil am Volumen": "Share of volume", "ggü. Vorperiode": "vs. previous period",
  "Gesamtzeitraum": "Full period", "des Volumens": "of volume", "abziehbar (EUR)": "deductible (EUR)",
  "Belege zur Freigabe": "receipts to approve", "Belege offen": "receipts open",
  "Ø pro Monat": "Avg per month", "Monate": "months", "pro Beleg": "per receipt", "Beträge in EUR": "Amounts in EUR",
  "Betrag": "Amount",
  // receipts journal
  "Belege durchsuchen …": "Search receipts …", "Aufsteigend": "Ascending", "Absteigend": "Descending",
  "von": "of", "Belegen": "receipts", "Keine Treffer im Filter.": "No matches for this filter.",
  "Noch keine Belege erfasst.": "No receipts captured yet.",
  // drive ablage
  "Drive-Ablage": "Drive filing", "In Drive abgelegt": "Filed to Drive", "In Drive öffnen": "Open in Drive",
  "Jetzt ablegen": "File now", "nach Freigabe": "after approval",
  "Drive-Ablage fehlgeschlagen": "Drive filing failed", "Drive ist noch nicht konfiguriert.": "Drive is not configured yet.",
};

const LangCtx = createContext({ lang: "de", t: (s) => s, setLang: () => {} });

export function LangProvider({ children }) {
  const [lang, setLang] = useState("de");
  useEffect(() => { try { const s = localStorage.getItem("snap_lang"); if (s) setLang(s); } catch {} }, []);
  const set = (l) => { setLang(l); try { localStorage.setItem("snap_lang", l); } catch {} };
  const t = (s) => (lang === "en" ? (EN[s] ?? s) : s);
  return <LangCtx.Provider value={{ lang, t, setLang: set }}>{children}</LangCtx.Provider>;
}
export const useT = () => useContext(LangCtx);
