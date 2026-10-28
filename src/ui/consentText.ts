/**
 * Participant consent text (Art. 6(1)(a) / Art. 13 GDPR).
 *
 * This file is duplicated byte-for-byte in `master-prj-pwa/src/ui/
 * consentText.ts`. Both apps are rated against each other in the UX
 * questionnaire, so participants must read exactly the same words before
 * either one starts — and a difference in what they were told is a difference
 * in what they consented to. Change both together or neither; a test in each
 * app asserts they match.
 *
 * ── FILL IN BEFORE THE FIRST SESSION ─────────────────────────────────────────
 * The CONTROLLER block below contains placeholders. The notice is incomplete
 * and must not be shown to a participant until they are replaced with a real
 * name, an institutional e-mail address and the supervisor's details.
 *
 * ── ON THE FACTUAL CLAIMS ────────────────────────────────────────────────────
 * The statements about what does and does not leave the device are verifiable,
 * not aspirational. Both apps were checked for every image egress and
 * persistence path (`toDataURL`, `toBlob`, `FormData`, `getImageData`,
 * `putImageData`, `localStorage`, `IndexedDB`, `writeFile`, `AsyncStorage`,
 * `FileSystem`) with no hits. The only data either app sends is the session
 * record: the measurements, detection summaries, settings and device information
 * listed in the second section, checked field by field against what the backend
 * stores (version 1.1; 1.0 described only part of it). Version 1.2 drops
 * "randomly generated" from the session identifier: the PWA's embeds the
 * device clock. If what is sent ever changes, this text must change with it.
 */

export const CONSENT_VERSION = "1.2";

export const CONSENT_TITLE = "Einwilligung zur Teilnahme";

export const CONSENT_INTRO =
    "Diese App ist Teil einer Masterarbeit, die zwei technische Umsetzungen " +
    "derselben Anwendung vergleicht (Web-App und native App). Bitte lies die " +
    "folgenden Punkte, bevor du die Kamera startest.";

export interface ConsentSection {
    heading: string;
    body: string;
}

export const CONSENT_SECTIONS: ConsentSection[] = [
    {
        heading: "Was passiert mit dem Kamerabild?",
        body:
            "Das Kamerabild wird ausschließlich lokal auf diesem Gerät verarbeitet. " +
            "Es wird nicht aufgezeichnet, nicht gespeichert und nicht an einen Server " +
            "übertragen. Es verlässt das Gerät zu keinem Zeitpunkt.",
    },
    {
        heading: "Welche Daten werden übertragen?",
        body:
            "Übertragen werden ausschließlich Messwerte und technische Angaben: " +
            "Messwerte zur Leistung der App (etwa Bildrate, Inferenz-, " +
            "Verarbeitungs- und Darstellungszeiten, Anzahl verarbeiteter und " +
            "verworfener Bilder, Lade- und Startzeiten, Speicher- und " +
            "Prozessorauslastung, Akkustand und Ladezustand, Thermalzustand); über " +
            "die Sitzung gemittelte Kennzahlen der Gesichts- und Handerkennung " +
            "(etwa wie viele Gesichter und Hände erkannt wurden, wie oft die " +
            "Erkennung abriss, wie ruhig die erkannten Punkte lagen, wie stark " +
            "erkannte Gesichtsausdrücke im Mittel ausgeprägt waren und wie sicher " +
            "Handgesten erkannt wurden); die gewählten Einstellungen und Filter; " +
            "technische Angaben zum Gerät (Gerätemodell, Betriebssystem- und " +
            "App-Version, Anzahl der Prozessorkerne, Arbeitsspeicher, Name des " +
            "Grafikprozessors, Bildschirmgröße und Kameraauflösung, in der Web-App " +
            "außerdem die Kennung des Browsers sowie Art und Geschwindigkeit der " +
            "Netzwerkverbindung); dazu ein Zeitstempel und eine " +
            "Sitzungskennung. Es werden keine Bild-, Video- oder Tondaten, keine " +
            "Namen und keine Kontaktdaten übertragen.",
    },
    {
        heading: "Wozu werden die Daten verwendet?",
        body:
            "Die Messwerte werden ausschließlich für die wissenschaftliche Auswertung " +
            "im Rahmen der Masterarbeit verwendet. Es findet keine Weitergabe an " +
            "Dritte und keine kommerzielle Nutzung statt. Rechtsgrundlage der " +
            "Verarbeitung ist deine Einwilligung gemäß Art. 6 Abs. 1 lit. a DSGVO.",
    },
    {
        heading: "Teilnahme ist freiwillig",
        body:
            "Die Teilnahme ist freiwillig. Du kannst die Nutzung jederzeit und ohne " +
            "Angabe von Gründen abbrechen, ohne dass dir daraus ein Nachteil " +
            "entsteht. Du kannst deine Einwilligung jederzeit mit Wirkung für die " +
            "Zukunft widerrufen; die Rechtmäßigkeit der bis dahin erfolgten " +
            "Verarbeitung bleibt davon unberührt.",
    },
    {
        heading: "Löschung deiner Messwerte",
        body:
            "Die Messwerte enthalten keine Angaben, die dich unmittelbar " +
            "identifizieren. Deine Sitzung lässt sich jedoch über den Zeitpunkt der " +
            "Messung zuordnen. Wenn du die Löschung wünschst, genügt eine formlose " +
            "Nachricht an die unten genannte Kontaktadresse.",
    },
    {
        heading: "Speicherdauer",
        body:
            "Die Messwerte werden bis zum Abschluss und zur Beurteilung der " +
            "Masterarbeit gespeichert und anschließend gelöscht.",
    },
    {
        heading: "Deine Rechte",
        body:
            "Dir stehen die Rechte auf Auskunft, Berichtigung, Löschung, " +
            "Einschränkung der Verarbeitung und Datenübertragbarkeit zu. Außerdem " +
            "hast du das Recht, dich bei der Österreichischen Datenschutzbehörde zu " +
            "beschweren.",
    },
];

/**
 * Placeholders. The consent gate refuses to show the accept button while any of
 * these still contains "TODO", so an unfinished notice cannot reach a
 * participant by accident.
 */
export const CONSENT_CONTROLLER: ConsentSection = {
    heading: "Verantwortlich für die Verarbeitung",
    body:
        "Mazen El-shaarawi\n" +
        "mazen.el-shaarawi@stud.hcw.ac.at\n" +
        "Hochschule Campus Wien, Masterstudiengang Software Design & Engineering\n" +
        "Betreuung: FH-Prof.in Mag.a Dr.in Sigrid Schefer-Wenzl, MSc BSc; FH-Prof. DI Dr. Igor Miladinovic",
};

export const CONSENT_ACCEPT = "Ich stimme zu und starte";
export const CONSENT_DECLINE = "Ablehnen";

export const CONSENT_DECLINED_MESSAGE =
    "Kein Problem — ohne Einwilligung werden keine Daten verarbeitet. " +
    "Du kannst die App jetzt schließen oder die Seite neu laden, falls du es " +
    "dir anders überlegst.";

/** True while the controller block still carries placeholder text. */
export function consentIsIncomplete(): boolean {
    return CONSENT_CONTROLLER.body.includes("TODO");
}
