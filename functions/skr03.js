// 🆕 v6.62.337: SKR03-Sachkonten-Liste fuer Funk Taxi Heringsdorf
// Patrick (06.05. 09:25): "Kannst du die Kontenlisten nicht aus dem Internet laden?
// Das System muss gleich die richtige Zuordnung machen."
//
// Kuratierte SKR03-Liste basierend auf DATEV-Standard, fokussiert auf:
// - Taxi-/Personenbefoerderungs-Betrieb
// - Lohn + Sozialversicherung (Mitarbeiter Kulpa, Vorbest, Aushilfen)
// - Anlagevermoegen (Tesla, Prius, Toyota — Fahrzeug-Flotte)
// - Buero/Verwaltung (Software-Abos, Telekom, Bank)
// - Steuern + Behoerden
// - Werbung/Marketing (Strato, Google Ads, Flyer)
//
// Format: { konto, bezeichnung, hauptKategorie, subKategorie }
// hauptKategorie folgt Patricks Vorgabe (Verträge, Fahrzeuge, Krankenkasse, ...)
// subKategorie ist eine Ebene tiefer (TÜV, Versicherung, Lohn, ...)

const SKR03_KONTEN = [
    // ═══ 0xxx ANLAGEVERMOEGEN ═══
    { konto: '0320', bezeichnung: 'Pkw / Fahrzeug-Anschaffung (Tesla, Prius, Toyota)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Anschaffung' },
    { konto: '0420', bezeichnung: 'GWG geringwertige Wirtschaftsgueter <800 EUR (Drucker, Tablet, Werkzeug)', hauptKategorie: 'Büro', subKategorie: 'Geringwertige Anschaffung' },
    { konto: '0480', bezeichnung: 'Sammelposten Pool-GWG (250-1000 EUR)', hauptKategorie: 'Büro', subKategorie: 'Geringwertige Anschaffung' },
    { konto: '0500', bezeichnung: 'Buerausstattung / Moebel', hauptKategorie: 'Büro', subKategorie: 'Ausstattung' },
    { konto: '0670', bezeichnung: 'Software (langfristig genutzt, >1 Jahr Lizenz)', hauptKategorie: 'Büro', subKategorie: 'Software' },
    { konto: '0700', bezeichnung: 'EDV / Hardware', hauptKategorie: 'Büro', subKategorie: 'Hardware' },

    // ═══ 1xxx UMLAUFVERMOEGEN / FORDERUNGEN ═══
    { konto: '1000', bezeichnung: 'Kasse (Bargeld)', hauptKategorie: 'Bank/Kasse', subKategorie: 'Bar' },
    { konto: '1200', bezeichnung: 'Bank — Geschaeftskonto Sparkasse', hauptKategorie: 'Bank/Kasse', subKategorie: 'Geschaeftskonto' },
    { konto: '1361', bezeichnung: 'Geldtransit / Stripe / Karte (Zahlungsdienstleister)', hauptKategorie: 'Bank/Kasse', subKategorie: 'Karte/Online' },
    { konto: '1400', bezeichnung: 'Forderungen aus Lieferungen + Leistungen (offene Rechnungen)', hauptKategorie: 'Forderungen', subKategorie: 'Offene Rechnungen' },

    // ═══ 3xxx WAREN / VERBINDLICHKEITEN ═══
    { konto: '3300', bezeichnung: 'Wareneingang 19% Vorsteuer', hauptKategorie: 'Wareneingang', subKategorie: '19%' },
    { konto: '3400', bezeichnung: 'Wareneingang 7% Vorsteuer', hauptKategorie: 'Wareneingang', subKategorie: '7%' },

    // ═══ 4xxx BETRIEBSAUSGABEN — FAHRZEUGE ═══
    { konto: '4500', bezeichnung: 'Reise- und Bewirtungskosten (Geschaeftsessen)', hauptKategorie: 'Reisekosten', subKategorie: 'Bewirtung' },
    { konto: '4510', bezeichnung: 'Kfz-Steuer (Hauptzollamt, Bundeskasse)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Kfz-Steuer' },
    { konto: '4520', bezeichnung: 'Kfz-Versicherung (HUK-Coburg, Allianz, AXA, R+V, HDI, VHV)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Versicherung' },
    { konto: '4530', bezeichnung: 'Treibstoff Kfz (Aral, Shell, Total, JET, Star, Esso, BFT, Avia)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Tanken' },
    { konto: '4531', bezeichnung: 'Strom Tesla / Ladekosten (Ionity, EnBW, Tesla Supercharger, Maingau, EWE Go)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Strom-Laden' },
    { konto: '4540', bezeichnung: 'Wartung/Inspektion Kfz (Werkstatt: Inspektion, Oelwechsel, Service)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Werkstatt' },
    { konto: '4550', bezeichnung: 'Kfz-Reparatur (Bremsen, Auspuff, Motor, Getriebe)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Reparatur' },
    { konto: '4560', bezeichnung: 'TÜV / Hauptuntersuchung / AU (TÜV Rheinland, TÜV Nord, TÜV Süd, DEKRA, GTÜ, KÜS)', hauptKategorie: 'Fahrzeuge', subKategorie: 'TÜV' },
    { konto: '4570', bezeichnung: 'Reifen / Felgen / Reifenwechsel', hauptKategorie: 'Fahrzeuge', subKategorie: 'Reifen' },
    { konto: '4580', bezeichnung: 'Garagenmiete / Stellplatz / Parkhaus', hauptKategorie: 'Fahrzeuge', subKategorie: 'Stellplatz' },
    { konto: '4590', bezeichnung: 'Sonstige Kfz-Kosten (Wagenwaesche, Pflegemittel, Zubehoer)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Sonstiges' },

    // ═══ 4xxx BUERO / GESCHAEFTSRAUM ═══
    { konto: '4210', bezeichnung: 'Miete / Pacht Geschaeftsraeume', hauptKategorie: 'Büro', subKategorie: 'Miete' },
    { konto: '4220', bezeichnung: 'Heizung / Strom / Wasser Geschaeftsraum (Stadtwerke, E.ON, Vattenfall, EnBW)', hauptKategorie: 'Büro', subKategorie: 'Strom/Heizung' },
    { konto: '4230', bezeichnung: 'Gas / Erdgas Geschaeftsraum', hauptKategorie: 'Büro', subKategorie: 'Gas' },
    { konto: '4240', bezeichnung: 'Reinigung Geschaeftsraum', hauptKategorie: 'Büro', subKategorie: 'Reinigung' },
    { konto: '4250', bezeichnung: 'Abwasser / Muellabfuhr Geschaeftsraum', hauptKategorie: 'Büro', subKategorie: 'Entsorgung' },
    { konto: '4260', bezeichnung: 'Reparaturen / Instandhaltung Geschaeftsraum', hauptKategorie: 'Büro', subKategorie: 'Instandhaltung' },

    // ═══ 4xxx VERSICHERUNGEN BETRIEB ═══
    { konto: '4360', bezeichnung: 'Betriebshaftpflicht / Inhalts- / Rechtsschutzversicherung', hauptKategorie: 'Verträge', subKategorie: 'Versicherung' },
    { konto: '4380', bezeichnung: 'Beitraege IHK / BG Verkehr / Berufsverbaende', hauptKategorie: 'Verträge', subKategorie: 'Berufsverband' },

    // ═══ 4xxx PERSONAL ═══
    { konto: '4120', bezeichnung: 'Lohn / Gehalt Mitarbeiter', hauptKategorie: 'Personal', subKategorie: 'Lohn' },
    { konto: '4140', bezeichnung: 'Aushilfsloehne / Mini-Job / 520-Euro-Job', hauptKategorie: 'Personal', subKategorie: 'Mini-Job' },
    { konto: '4150', bezeichnung: 'Gesetzliche Sozialaufwendungen (AG-Anteil KK/Rente/Pflege/Arbeitslos)', hauptKategorie: 'Personal', subKategorie: 'Sozialabgaben' },
    { konto: '4160', bezeichnung: 'Beiträge Berufsgenossenschaft (BG Verkehr)', hauptKategorie: 'Personal', subKategorie: 'BG Verkehr' },
    { konto: '4170', bezeichnung: 'Aus- + Fortbildungskosten (Personenbefoerderung, P-Schein)', hauptKategorie: 'Personal', subKategorie: 'Schulung' },

    // ═══ 4xxx KRANKENKASSE / LOHNNEBENKOSTEN (Detaillierte Splittung — Patrick) ═══
    { konto: '4151', bezeichnung: 'Krankenkasse Angestellte AOK (AOK Nordost, AOK Bayern...)', hauptKategorie: 'Krankenkasse', subKategorie: 'AOK' },
    { konto: '4152', bezeichnung: 'Krankenkasse Angestellte DAK', hauptKategorie: 'Krankenkasse', subKategorie: 'DAK' },
    { konto: '4153', bezeichnung: 'Krankenkasse Angestellte Techniker (TK)', hauptKategorie: 'Krankenkasse', subKategorie: 'TK' },
    { konto: '4154', bezeichnung: 'Krankenkasse Angestellte Barmer', hauptKategorie: 'Krankenkasse', subKategorie: 'Barmer' },
    { konto: '4155', bezeichnung: 'Krankenkasse Angestellte sonstige (IKK, KKH, BKK)', hauptKategorie: 'Krankenkasse', subKategorie: 'Sonstige' },
    { konto: '4156', bezeichnung: 'Private Krankenversicherung Inhaber/Selbststaendiger', hauptKategorie: 'Krankenkasse', subKategorie: 'Privat-KV' },

    // ═══ 4xxx KOMMUNIKATION / BUERO ═══
    { konto: '4910', bezeichnung: 'Werbe- + Reisekosten (Druckerei, Visitenkarten, Werbeflyer, Plakat)', hauptKategorie: 'Marketing/Werbung', subKategorie: 'Print' },
    { konto: '4911', bezeichnung: 'Online-Werbung (Google Ads, Facebook Ads, Instagram)', hauptKategorie: 'Marketing/Werbung', subKategorie: 'Online' },
    { konto: '4912', bezeichnung: 'Geschenke an Kunden (zB Weihnachten)', hauptKategorie: 'Marketing/Werbung', subKategorie: 'Geschenke' },
    { konto: '4920', bezeichnung: 'Telefon / Internet / Mobilfunk (Telekom, Vodafone, 1&1, O2, freenet)', hauptKategorie: 'Telekommunikation', subKategorie: 'Mobilfunk/Festnetz' },
    { konto: '4921', bezeichnung: 'Internet-Anschluss Geschaeftsraum (Glasfaser, DSL)', hauptKategorie: 'Telekommunikation', subKategorie: 'Internet' },
    { konto: '4922', bezeichnung: 'Hosting / Domain / Webspace (Strato, Hetzner, IONOS, Domain-Reg)', hauptKategorie: 'Telekommunikation', subKategorie: 'Hosting' },
    { konto: '4923', bezeichnung: 'Software-Abo SaaS (Anthropic Claude, OpenAI, Google Workspace, Microsoft 365)', hauptKategorie: 'Büro', subKategorie: 'Software-Abo' },
    { konto: '4924', bezeichnung: 'Cloud-Dienste (Firebase, AWS, Stripe, GitHub)', hauptKategorie: 'Büro', subKategorie: 'Cloud-Dienste' },
    { konto: '4930', bezeichnung: 'Bueromaterial (Papier, Toner, Stifte, Ordner)', hauptKategorie: 'Büro', subKategorie: 'Material' },
    { konto: '4940', bezeichnung: 'Porto / Versand (DHL, Hermes, DPD, Deutsche Post)', hauptKategorie: 'Büro', subKategorie: 'Porto' },
    { konto: '4950', bezeichnung: 'Fachzeitschriften / Bücher (Personenbefoerderung, Steuer)', hauptKategorie: 'Büro', subKategorie: 'Fachliteratur' },

    // ═══ 4xxx STEUERBERATER + RECHT ═══
    { konto: '4925', bezeichnung: 'Steuerberatung (ECOVIS Baltic GmbH, vorher VKO)', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Steuerberater' },
    { konto: '4927', bezeichnung: 'Rechtsberatung (Avoka.law, Anwaltskanzlei)', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Rechtsberatung' },
    { konto: '4928', bezeichnung: 'Notar / Beglaubigung', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Notar' },
    { konto: '4929', bezeichnung: 'Sonstige Beratungskosten (Unternehmensberatung, IT-Beratung)', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Beratung' },

    // ═══ 4xxx BANK + ZINSEN ═══
    { konto: '4970', bezeichnung: 'Bankgebuehren / Kontofuehrung', hauptKategorie: 'Bank/Kasse', subKategorie: 'Gebühren' },
    { konto: '4971', bezeichnung: 'Stripe / PayPal / Kreditkarten-Disagio', hauptKategorie: 'Bank/Kasse', subKategorie: 'Zahlungsdienste' },
    { konto: '4975', bezeichnung: 'Sonstige Zinsen (Kredit, Dispo)', hauptKategorie: 'Bank/Kasse', subKategorie: 'Zinsen' },

    // ═══ 4xxx CATCH-ALL ═══
    { konto: '4980', bezeichnung: 'Sonstige Aufwendungen (catch-all wenn nichts passt)', hauptKategorie: 'Sonstiges', subKategorie: 'Sonstiges' },

    // ═══ 7xxx ABSCHREIBUNGEN + SONSTIGE BETRIEBSKOSTEN ═══
    { konto: '7010', bezeichnung: 'Abschreibungen Sachanlagen (Pkw, Hardware AfA)', hauptKategorie: 'Abschreibungen', subKategorie: 'AfA' },

    // ═══ 8xxx ERLOESE ═══
    { konto: '8400', bezeichnung: 'Erloese 7% USt — Personenbefoerderung Nahverkehr (Standard Taxi)', hauptKategorie: 'Erlöse', subKategorie: '7% Personenbefoerderung' },
    { konto: '8401', bezeichnung: 'Erloese 19% USt — Fernverkehr / Kurier / sonstige Dienstleistung', hauptKategorie: 'Erlöse', subKategorie: '19% Sonstige' },
    { konto: '8402', bezeichnung: 'Erloese aus Vermittlungsprovision', hauptKategorie: 'Erlöse', subKategorie: 'Provision' },

    // ═══ 9xxx PRIVAT (Patrick als Inhaber) ═══
    { konto: '1800', bezeichnung: 'Privatentnahme allgemein (Geld aus Geschaeft fuer privat)', hauptKategorie: 'Privat', subKategorie: 'Entnahme' },
    { konto: '1810', bezeichnung: 'Privateinlage (Geld vom Privatkonto ins Geschaeft)', hauptKategorie: 'Privat', subKategorie: 'Einlage' },
    { konto: '1880', bezeichnung: 'Privatentnahme Steuern (USt-Vorauszahlung, ESt-Vorauszahlung)', hauptKategorie: 'Privat', subKategorie: 'Steuern' },

    // ═══ STEUER / BEHOERDEN ═══
    { konto: '1700', bezeichnung: 'Umsatzsteuer-Vorauszahlung Finanzamt', hauptKategorie: 'Steuer/Behörden', subKategorie: 'USt-Voranmeldung' },
    { konto: '1701', bezeichnung: 'Lohnsteuer + Solidaritaetszuschlag (Finanzamt)', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Lohnsteuer' },
    { konto: '1741', bezeichnung: 'Gewerbesteuer-Vorauszahlung (Stadt/Gemeinde)', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Gewerbesteuer' },
    { konto: '1742', bezeichnung: 'Einkommensteuer-Vorauszahlung Inhaber', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Einkommensteuer' }
];

// Prompt-Format fuer classifyReceipt-KI
const SKR03_KONTEN_PROMPT = SKR03_KONTEN.map(k => `${k.konto} ${k.bezeichnung}`).join('\n');

// Helper: Konto-Lookup → liefert Hauptkat + Subkat
function getKontoInfo(kontoNr) {
    return SKR03_KONTEN.find(k => k.konto === String(kontoNr)) || null;
}

// Helper: alle Hauptkategorien
function getAllHauptKategorien() {
    return [...new Set(SKR03_KONTEN.map(k => k.hauptKategorie))].sort();
}

// Helper: alle Subkategorien einer Hauptkategorie
function getSubKategorien(hauptKategorie) {
    return [...new Set(SKR03_KONTEN.filter(k => k.hauptKategorie === hauptKategorie).map(k => k.subKategorie))].sort();
}

module.exports = {
    SKR03_KONTEN,
    SKR03_KONTEN_PROMPT,
    getKontoInfo,
    getAllHauptKategorien,
    getSubKategorien
};
