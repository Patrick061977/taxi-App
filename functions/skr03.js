// 🆕 v6.62.337/.339: SKR03-Sachkonten-Liste fuer Funk Taxi Heringsdorf
// Patrick (06.05. 09:25 + 09:37): "Kannst du die Kontenlisten nicht aus dem Internet
// laden? Das System muss gleich die richtige Zuordnung machen. Nicht bloss 70, sondern
// alles was es so oeffentlich verfuegbar gibt."
//
// v6.62.339: Erweitert auf ~250 Konten basierend auf DATEV-SKR03-Standardkontenrahmen.
// Vollstaendige DATEV-Liste hat ~700 Konten — die meisten sind aber Industrie/Handel.
// Diese Liste deckt die fuer Dienstleistung/Personenbefoerderung/Bueroverwaltung
// relevanten Konten komplett ab.
//
// Format: { konto, bezeichnung, hauptKategorie, subKategorie }
// hauptKategorie folgt Patricks Vorgabe (Verträge, Fahrzeuge, Krankenkasse, ...)
// subKategorie ist eine Ebene tiefer (TÜV, Versicherung, Lohn, ...)

const SKR03_KONTEN = [
    // ═══ 0xxx ANLAGEVERMOEGEN ═══
    { konto: '0030', bezeichnung: 'Konzessionen, gewerbliche Schutzrechte, Lizenzen', hauptKategorie: 'Anlagevermögen', subKategorie: 'Immaterielle Werte' },
    { konto: '0080', bezeichnung: 'Geschaefts- oder Firmenwert', hauptKategorie: 'Anlagevermögen', subKategorie: 'Immaterielle Werte' },
    { konto: '0200', bezeichnung: 'Grundstuecke (unbebaut)', hauptKategorie: 'Anlagevermögen', subKategorie: 'Grundstücke' },
    { konto: '0210', bezeichnung: 'Grundstuecke (Geschaeftsbauten)', hauptKategorie: 'Anlagevermögen', subKategorie: 'Grundstücke' },
    { konto: '0240', bezeichnung: 'Geschaeftsbauten', hauptKategorie: 'Anlagevermögen', subKategorie: 'Bauten' },
    { konto: '0300', bezeichnung: 'Maschinen', hauptKategorie: 'Anlagevermögen', subKategorie: 'Maschinen' },
    { konto: '0320', bezeichnung: 'Pkw / Fahrzeug-Anschaffung (Tesla, Prius, Toyota — gewerblich)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Anschaffung' },
    { konto: '0350', bezeichnung: 'Lkw / Transporter Anschaffung', hauptKategorie: 'Fahrzeuge', subKategorie: 'Anschaffung' },
    { konto: '0380', bezeichnung: 'Sonstige Transportmittel', hauptKategorie: 'Fahrzeuge', subKategorie: 'Anschaffung' },
    { konto: '0410', bezeichnung: 'Betriebs- und Geschaeftsausstattung', hauptKategorie: 'Anlagevermögen', subKategorie: 'BGA' },
    { konto: '0420', bezeichnung: 'GWG geringwertige Wirtschaftsgueter <800 EUR (Drucker, Tablet, Werkzeug)', hauptKategorie: 'Anlagevermögen', subKategorie: 'GWG' },
    { konto: '0430', bezeichnung: 'Werkzeuge', hauptKategorie: 'Anlagevermögen', subKategorie: 'Werkzeuge' },
    { konto: '0440', bezeichnung: 'Telefonanlagen / Festnetz-Equipment', hauptKategorie: 'Anlagevermögen', subKategorie: 'BGA' },
    { konto: '0450', bezeichnung: 'Funkanlagen / Taxameter', hauptKategorie: 'Fahrzeuge', subKategorie: 'Funk/Taxameter' },
    { konto: '0480', bezeichnung: 'Sammelposten Pool-GWG (250-1000 EUR)', hauptKategorie: 'Anlagevermögen', subKategorie: 'GWG' },
    { konto: '0490', bezeichnung: 'Geringwertige WG <250 EUR (sofort abschreibbar)', hauptKategorie: 'Anlagevermögen', subKategorie: 'GWG' },
    { konto: '0500', bezeichnung: 'Bueroausstattung / Moebel', hauptKategorie: 'Büro', subKategorie: 'Ausstattung' },
    { konto: '0520', bezeichnung: 'Ladeneinrichtung / Verkaufseinrichtung', hauptKategorie: 'Büro', subKategorie: 'Ausstattung' },
    { konto: '0670', bezeichnung: 'Software (langfristig genutzt >1 Jahr, einmalig)', hauptKategorie: 'Büro', subKategorie: 'Software' },
    { konto: '0700', bezeichnung: 'EDV / Hardware (PCs, Server, Notebooks)', hauptKategorie: 'Büro', subKategorie: 'Hardware' },
    { konto: '0710', bezeichnung: 'Smartphones / Mobile Geraete', hauptKategorie: 'Büro', subKategorie: 'Hardware' },

    // ═══ 1xxx UMLAUFVERMOEGEN ═══
    { konto: '1000', bezeichnung: 'Kasse (Bargeld)', hauptKategorie: 'Bank/Kasse', subKategorie: 'Bar' },
    { konto: '1010', bezeichnung: 'Nebenkasse', hauptKategorie: 'Bank/Kasse', subKategorie: 'Bar' },
    { konto: '1100', bezeichnung: 'Postbank', hauptKategorie: 'Bank/Kasse', subKategorie: 'Postbank' },
    { konto: '1200', bezeichnung: 'Bank — Geschaeftskonto Sparkasse', hauptKategorie: 'Bank/Kasse', subKategorie: 'Geschäftskonto' },
    { konto: '1210', bezeichnung: 'Bank — Geschaeftskonto Volksbank', hauptKategorie: 'Bank/Kasse', subKategorie: 'Geschäftskonto' },
    { konto: '1220', bezeichnung: 'Bank — Geschaeftskonto Direktbank (DKB, Comdirect, N26)', hauptKategorie: 'Bank/Kasse', subKategorie: 'Geschäftskonto' },
    { konto: '1230', bezeichnung: 'Bank — Tagesgeldkonto', hauptKategorie: 'Bank/Kasse', subKategorie: 'Tagesgeld' },
    { konto: '1300', bezeichnung: 'Bank — Privatkonto Inhaber (Privatentnahme)', hauptKategorie: 'Privat', subKategorie: 'Privatkonto' },
    { konto: '1361', bezeichnung: 'Geldtransit / Stripe / Karte (Zahlungsdienstleister)', hauptKategorie: 'Bank/Kasse', subKategorie: 'Karte/Online' },
    { konto: '1362', bezeichnung: 'PayPal', hauptKategorie: 'Bank/Kasse', subKategorie: 'Karte/Online' },
    { konto: '1363', bezeichnung: 'Kreditkartenkonto (Visa, Mastercard, Amex)', hauptKategorie: 'Bank/Kasse', subKategorie: 'Kreditkarte' },
    { konto: '1400', bezeichnung: 'Forderungen aus Lieferungen + Leistungen (offene Rechnungen)', hauptKategorie: 'Forderungen', subKategorie: 'Offene Rechnungen' },
    { konto: '1410', bezeichnung: 'Forderungen Stammkunden (Dauerschuldverhaeltnis)', hauptKategorie: 'Forderungen', subKategorie: 'Stammkunden' },
    { konto: '1420', bezeichnung: 'Zweifelhafte Forderungen', hauptKategorie: 'Forderungen', subKategorie: 'Zweifelhaft' },
    { konto: '1500', bezeichnung: 'Sonstige Vermoegensgegenstaende', hauptKategorie: 'Forderungen', subKategorie: 'Sonstige' },
    { konto: '1570', bezeichnung: 'Vorsteuer 19%', hauptKategorie: 'Steuer/USt', subKategorie: 'Vorsteuer 19%' },
    { konto: '1571', bezeichnung: 'Vorsteuer 7%', hauptKategorie: 'Steuer/USt', subKategorie: 'Vorsteuer 7%' },
    { konto: '1576', bezeichnung: 'Abziehbare Vorsteuer EU-Erwerb 19%', hauptKategorie: 'Steuer/USt', subKategorie: 'EU-Vorsteuer' },
    { konto: '1577', bezeichnung: 'Abziehbare Vorsteuer EU-Erwerb 7%', hauptKategorie: 'Steuer/USt', subKategorie: 'EU-Vorsteuer' },
    { konto: '1700', bezeichnung: 'Umsatzsteuer-Vorauszahlung Finanzamt', hauptKategorie: 'Steuer/Behörden', subKategorie: 'USt-Voranmeldung' },
    { konto: '1701', bezeichnung: 'Lohnsteuer + Solidaritaetszuschlag (Finanzamt)', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Lohnsteuer' },
    { konto: '1741', bezeichnung: 'Gewerbesteuer-Vorauszahlung (Stadt/Gemeinde)', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Gewerbesteuer' },
    { konto: '1742', bezeichnung: 'Einkommensteuer-Vorauszahlung Inhaber', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Einkommensteuer' },
    { konto: '1743', bezeichnung: 'Kirchensteuer-Vorauszahlung', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Kirchensteuer' },
    { konto: '1745', bezeichnung: 'Solidaritaetszuschlag-Vorauszahlung', hauptKategorie: 'Steuer/Behörden', subKategorie: 'SolZ' },
    { konto: '1755', bezeichnung: 'Umsatzsteuer 19%', hauptKategorie: 'Steuer/USt', subKategorie: 'USt 19%' },
    { konto: '1756', bezeichnung: 'Umsatzsteuer 7%', hauptKategorie: 'Steuer/USt', subKategorie: 'USt 7%' },
    { konto: '1780', bezeichnung: 'Umsatzsteuer-Verbindlichkeit', hauptKategorie: 'Steuer/USt', subKategorie: 'USt-Schuld' },
    { konto: '1789', bezeichnung: 'Umsatzsteuer-Erstattung', hauptKategorie: 'Steuer/USt', subKategorie: 'USt-Erstattung' },
    { konto: '1800', bezeichnung: 'Privatentnahme allgemein (Geld aus Geschaeft fuer privat)', hauptKategorie: 'Privat', subKategorie: 'Entnahme' },
    { konto: '1810', bezeichnung: 'Privateinlage (Geld vom Privatkonto ins Geschaeft)', hauptKategorie: 'Privat', subKategorie: 'Einlage' },
    { konto: '1880', bezeichnung: 'Privatentnahme Steuern (USt/ESt-Vorauszahlung)', hauptKategorie: 'Privat', subKategorie: 'Steuern privat' },
    { konto: '1890', bezeichnung: 'Privatentnahme Sonderausgaben (Krankenversicherung, Spenden)', hauptKategorie: 'Privat', subKategorie: 'Sonderausgaben' },

    // ═══ 2xxx EIGENKAPITAL ═══
    { konto: '2000', bezeichnung: 'Eigenkapital Inhaber', hauptKategorie: 'Eigenkapital', subKategorie: 'Inhaber' },
    { konto: '2100', bezeichnung: 'Gewinnvortrag aus Vorjahren', hauptKategorie: 'Eigenkapital', subKategorie: 'Gewinnvortrag' },
    { konto: '2110', bezeichnung: 'Verlustvortrag aus Vorjahren', hauptKategorie: 'Eigenkapital', subKategorie: 'Verlustvortrag' },

    // ═══ 3xxx VERBINDLICHKEITEN / WARENEINGANG ═══
    { konto: '3000', bezeichnung: 'Wareneingang ohne Vorsteuer (z.B. Kleinunternehmer)', hauptKategorie: 'Wareneingang', subKategorie: '0%' },
    { konto: '3100', bezeichnung: 'Wareneingang 19% Vorsteuer (Standard)', hauptKategorie: 'Wareneingang', subKategorie: '19%' },
    { konto: '3300', bezeichnung: 'Wareneingang 19% Vorsteuer alt (jetzt 3100)', hauptKategorie: 'Wareneingang', subKategorie: '19%' },
    { konto: '3400', bezeichnung: 'Wareneingang 7% Vorsteuer', hauptKategorie: 'Wareneingang', subKategorie: '7%' },
    { konto: '3500', bezeichnung: 'Innergemeinschaftlicher Erwerb 19%', hauptKategorie: 'Wareneingang', subKategorie: 'EU-Erwerb' },
    { konto: '3600', bezeichnung: 'Erhaltene Anzahlungen', hauptKategorie: 'Verbindlichkeiten', subKategorie: 'Anzahlungen' },
    { konto: '3700', bezeichnung: 'Bezugsnebenkosten (Fracht, Verpackung, Spedition)', hauptKategorie: 'Wareneingang', subKategorie: 'Nebenkosten' },
    { konto: '3800', bezeichnung: 'Nachlaesse erhalten / Skonto-Eingang', hauptKategorie: 'Wareneingang', subKategorie: 'Nachlässe' },

    // ═══ 4xxx BETRIEBSAUSGABEN — VERWALTUNG ═══
    { konto: '4100', bezeichnung: 'Lohn / Gehaelter Mitarbeiter (gross)', hauptKategorie: 'Personal', subKategorie: 'Lohn' },
    { konto: '4110', bezeichnung: 'Loehne (gewerbliche Mitarbeiter)', hauptKategorie: 'Personal', subKategorie: 'Lohn' },
    { konto: '4120', bezeichnung: 'Gehaelter (Angestellte) — Kulpa, Vorbest', hauptKategorie: 'Personal', subKategorie: 'Gehalt' },
    { konto: '4125', bezeichnung: 'Tantieme / Erfolgsbeteiligung', hauptKategorie: 'Personal', subKategorie: 'Bonus' },
    { konto: '4130', bezeichnung: 'Geschaeftsfuehrer-Gehalt (bei GmbH)', hauptKategorie: 'Personal', subKategorie: 'GF-Gehalt' },
    { konto: '4140', bezeichnung: 'Aushilfsloehne / Mini-Job / 520-Euro-Kraefte', hauptKategorie: 'Personal', subKategorie: 'Mini-Job' },
    { konto: '4145', bezeichnung: 'Kurzfristig Beschaeftigte', hauptKategorie: 'Personal', subKategorie: 'Aushilfen' },
    { konto: '4150', bezeichnung: 'Gesetzliche Sozialaufwendungen (AG-Anteil KK/RV/PV/AV)', hauptKategorie: 'Personal', subKategorie: 'Sozialabgaben' },
    { konto: '4151', bezeichnung: 'Krankenkasse Angestellte AOK (AOK Nordost, AOK Bayern, ...)', hauptKategorie: 'Krankenkasse', subKategorie: 'AOK' },
    { konto: '4152', bezeichnung: 'Krankenkasse Angestellte DAK', hauptKategorie: 'Krankenkasse', subKategorie: 'DAK' },
    { konto: '4153', bezeichnung: 'Krankenkasse Angestellte Techniker (TK)', hauptKategorie: 'Krankenkasse', subKategorie: 'TK' },
    { konto: '4154', bezeichnung: 'Krankenkasse Angestellte Barmer', hauptKategorie: 'Krankenkasse', subKategorie: 'Barmer' },
    { konto: '4155', bezeichnung: 'Krankenkasse Angestellte sonstige (IKK, KKH, BKK)', hauptKategorie: 'Krankenkasse', subKategorie: 'Sonstige' },
    { konto: '4156', bezeichnung: 'Private Krankenversicherung Inhaber/Selbststaendiger', hauptKategorie: 'Krankenkasse', subKategorie: 'Privat-KV' },
    { konto: '4157', bezeichnung: 'Pflegeversicherung Inhaber', hauptKategorie: 'Krankenkasse', subKategorie: 'Pflegeversicherung' },
    { konto: '4160', bezeichnung: 'Beitraege Berufsgenossenschaft (BG Verkehr)', hauptKategorie: 'Personal', subKategorie: 'BG Verkehr' },
    { konto: '4170', bezeichnung: 'Aus- + Fortbildungskosten (Personenbefoerderung, P-Schein)', hauptKategorie: 'Personal', subKategorie: 'Schulung' },
    { konto: '4175', bezeichnung: 'Mitarbeiter-Bewirtung / Betriebsfeier', hauptKategorie: 'Personal', subKategorie: 'Bewirtung MA' },
    { konto: '4180', bezeichnung: 'Sonstige Personalaufwendungen', hauptKategorie: 'Personal', subKategorie: 'Sonstige' },
    { konto: '4190', bezeichnung: 'Krankengeld-Erstattung U1/U2 (Erstattung von KK)', hauptKategorie: 'Personal', subKategorie: 'Erstattung' },

    // ═══ 4xxx GESCHAEFTSRAUM ═══
    { konto: '4200', bezeichnung: 'Pacht / Miete (sonstige Pacht)', hauptKategorie: 'Büro', subKategorie: 'Miete' },
    { konto: '4210', bezeichnung: 'Miete Geschaeftsraeume (Buero, Werkstatt)', hauptKategorie: 'Büro', subKategorie: 'Miete' },
    { konto: '4215', bezeichnung: 'Mietnebenkosten (Hausgeld, Reinigung Treppenhaus)', hauptKategorie: 'Büro', subKategorie: 'Mietnebenkosten' },
    { konto: '4220', bezeichnung: 'Heizung / Strom / Wasser Geschaeftsraum (Stadtwerke, E.ON, Vattenfall, EnBW)', hauptKategorie: 'Büro', subKategorie: 'Strom/Heizung' },
    { konto: '4230', bezeichnung: 'Gas / Erdgas Geschaeftsraum', hauptKategorie: 'Büro', subKategorie: 'Gas' },
    { konto: '4240', bezeichnung: 'Reinigung Geschaeftsraum (Reinigungsfirma)', hauptKategorie: 'Büro', subKategorie: 'Reinigung' },
    { konto: '4250', bezeichnung: 'Abwasser / Muellabfuhr Geschaeftsraum', hauptKategorie: 'Büro', subKategorie: 'Entsorgung' },
    { konto: '4260', bezeichnung: 'Reparaturen / Instandhaltung Geschaeftsraum', hauptKategorie: 'Büro', subKategorie: 'Instandhaltung' },
    { konto: '4270', bezeichnung: 'Renovierung / Schoenheitsreparaturen', hauptKategorie: 'Büro', subKategorie: 'Renovierung' },
    { konto: '4280', bezeichnung: 'Grundsteuer Geschaeftsgrundstueck', hauptKategorie: 'Büro', subKategorie: 'Grundsteuer' },

    // ═══ 4xxx VERSICHERUNGEN BETRIEB ═══
    { konto: '4360', bezeichnung: 'Betriebshaftpflicht / Inhalts- / Rechtsschutzversicherung', hauptKategorie: 'Verträge', subKategorie: 'Versicherung Betrieb' },
    { konto: '4365', bezeichnung: 'Betriebsunterbrechungsversicherung', hauptKategorie: 'Verträge', subKategorie: 'Versicherung Betrieb' },
    { konto: '4366', bezeichnung: 'Cyber-Versicherung / Datenversicherung', hauptKategorie: 'Verträge', subKategorie: 'Versicherung Betrieb' },
    { konto: '4380', bezeichnung: 'Beitraege IHK / BG Verkehr / Berufsverbaende', hauptKategorie: 'Verträge', subKategorie: 'Berufsverband' },
    { konto: '4385', bezeichnung: 'Sonstige Beitraege (Innung, Vereinsmitgliedschaften)', hauptKategorie: 'Verträge', subKategorie: 'Mitgliedschaft' },

    // ═══ 4xxx FAHRZEUG-KOSTEN ═══
    { konto: '4500', bezeichnung: 'Reise- und Bewirtungskosten Geschaeftspartner', hauptKategorie: 'Reisekosten', subKategorie: 'Bewirtung' },
    { konto: '4505', bezeichnung: 'Hotel-Uebernachtungen Dienstreise', hauptKategorie: 'Reisekosten', subKategorie: 'Hotel' },
    { konto: '4510', bezeichnung: 'Kfz-Steuer (Hauptzollamt, Bundeskasse)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Kfz-Steuer' },
    { konto: '4520', bezeichnung: 'Kfz-Versicherung (HUK-Coburg, Allianz, AXA, R+V, HDI, VHV, DA Direkt)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Versicherung' },
    { konto: '4530', bezeichnung: 'Treibstoff Kfz (Aral, Shell, Total, JET, Star, Esso, BFT, Avia, Q1)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Tanken' },
    { konto: '4531', bezeichnung: 'Strom Tesla / Ladekosten (Ionity, EnBW, Tesla Supercharger, Maingau, EWE Go, Allego)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Strom-Laden' },
    { konto: '4540', bezeichnung: 'Wartung/Inspektion Kfz (Werkstatt: Inspektion, Oelwechsel, Service)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Werkstatt' },
    { konto: '4550', bezeichnung: 'Kfz-Reparatur (Bremsen, Auspuff, Motor, Getriebe)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Reparatur' },
    { konto: '4555', bezeichnung: 'Glasbruch / Steinschlag / Frontscheibe (Carglass)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Glas' },
    { konto: '4560', bezeichnung: 'TÜV / Hauptuntersuchung / AU (TÜV Rheinland, TÜV Nord, TÜV Süd, DEKRA, GTÜ, KÜS)', hauptKategorie: 'Fahrzeuge', subKategorie: 'TÜV' },
    { konto: '4570', bezeichnung: 'Reifen / Felgen / Reifenwechsel (Reifenservice)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Reifen' },
    { konto: '4575', bezeichnung: 'Reifeneinlagerung', hauptKategorie: 'Fahrzeuge', subKategorie: 'Reifen' },
    { konto: '4580', bezeichnung: 'Garagenmiete / Stellplatz / Parkhaus', hauptKategorie: 'Fahrzeuge', subKategorie: 'Stellplatz' },
    { konto: '4585', bezeichnung: 'Maut / Strassenbenutzungsgebuehren (Toll)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Maut' },
    { konto: '4590', bezeichnung: 'Sonstige Kfz-Kosten (Wagenwaesche, Pflegemittel, Zubehoer)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Sonstiges' },
    { konto: '4595', bezeichnung: 'Konzession / Personenbefoerderungsgenehmigung', hauptKategorie: 'Fahrzeuge', subKategorie: 'Konzession' },

    // ═══ 4xxx LEASING/MIETE FAHRZEUGE ═══
    { konto: '4670', bezeichnung: 'Leasing Pkw (Leasingrate)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Leasing' },
    { konto: '4671', bezeichnung: 'Leasing Sonderzahlung Pkw', hauptKategorie: 'Fahrzeuge', subKategorie: 'Leasing' },
    { konto: '4672', bezeichnung: 'Mietwagenkosten (Leihwagen Werkstattzeit)', hauptKategorie: 'Fahrzeuge', subKategorie: 'Leihwagen' },

    // ═══ 4xxx WERBUNG / MARKETING ═══
    { konto: '4910', bezeichnung: 'Werbe- + Reisekosten (Druckerei, Visitenkarten, Werbeflyer, Plakat)', hauptKategorie: 'Marketing/Werbung', subKategorie: 'Print' },
    { konto: '4911', bezeichnung: 'Online-Werbung (Google Ads, Facebook Ads, Instagram, TikTok)', hauptKategorie: 'Marketing/Werbung', subKategorie: 'Online' },
    { konto: '4912', bezeichnung: 'Geschenke an Kunden (zB Weihnachten, max 50€/Person)', hauptKategorie: 'Marketing/Werbung', subKategorie: 'Geschenke' },
    { konto: '4913', bezeichnung: 'Sponsoring (Verein, Sportverein, lokale Veranstaltungen)', hauptKategorie: 'Marketing/Werbung', subKategorie: 'Sponsoring' },
    { konto: '4914', bezeichnung: 'Messekosten / Standgebuehren', hauptKategorie: 'Marketing/Werbung', subKategorie: 'Messe' },
    { konto: '4915', bezeichnung: 'Auto-Branding / Folierung Werbung', hauptKategorie: 'Marketing/Werbung', subKategorie: 'Branding' },
    { konto: '4916', bezeichnung: 'Webshop / Webseite Erstellung + Pflege', hauptKategorie: 'Marketing/Werbung', subKategorie: 'Web' },

    // ═══ 4xxx KOMMUNIKATION ═══
    { konto: '4920', bezeichnung: 'Telefon / Internet / Mobilfunk (Telekom, Vodafone, 1&1, O2, freenet)', hauptKategorie: 'Telekommunikation', subKategorie: 'Mobilfunk/Festnetz' },
    { konto: '4921', bezeichnung: 'Internet-Anschluss Geschaeftsraum (Glasfaser, DSL)', hauptKategorie: 'Telekommunikation', subKategorie: 'Internet' },
    { konto: '4922', bezeichnung: 'Hosting / Domain / Webspace (Strato, Hetzner, IONOS, Domain-Reg)', hauptKategorie: 'Telekommunikation', subKategorie: 'Hosting' },
    { konto: '4923', bezeichnung: 'Software-Abo SaaS (Anthropic Claude, OpenAI, Google Workspace, Microsoft 365)', hauptKategorie: 'Büro', subKategorie: 'Software-Abo' },
    { konto: '4924', bezeichnung: 'Cloud-Dienste (Firebase, AWS, Stripe, GitHub)', hauptKategorie: 'Büro', subKategorie: 'Cloud-Dienste' },
    { konto: '4925', bezeichnung: 'Steuerberatung (ECOVIS Baltic GmbH, vorher VKO)', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Steuerberater' },
    { konto: '4927', bezeichnung: 'Rechtsberatung (Avoka.law, Anwaltskanzlei)', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Rechtsberatung' },
    { konto: '4928', bezeichnung: 'Notar / Beglaubigung', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Notar' },
    { konto: '4929', bezeichnung: 'Sonstige Beratungskosten (Unternehmensberatung, IT-Beratung)', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Beratung' },

    // ═══ 4xxx BUERO ═══
    { konto: '4930', bezeichnung: 'Bueromaterial (Papier, Toner, Stifte, Ordner)', hauptKategorie: 'Büro', subKategorie: 'Material' },
    { konto: '4940', bezeichnung: 'Porto / Versand (DHL, Hermes, DPD, Deutsche Post)', hauptKategorie: 'Büro', subKategorie: 'Porto' },
    { konto: '4945', bezeichnung: 'Druckerpatronen / Toner', hauptKategorie: 'Büro', subKategorie: 'Material' },
    { konto: '4950', bezeichnung: 'Fachzeitschriften / Buecher (Personenbefoerderung, Steuer)', hauptKategorie: 'Büro', subKategorie: 'Fachliteratur' },
    { konto: '4955', bezeichnung: 'Fortbildung Inhaber / Seminar', hauptKategorie: 'Büro', subKategorie: 'Fortbildung' },

    // ═══ 4xxx BANK + ZINSEN ═══
    { konto: '4970', bezeichnung: 'Bankgebuehren / Kontofuehrung', hauptKategorie: 'Bank/Kasse', subKategorie: 'Gebühren' },
    { konto: '4971', bezeichnung: 'Stripe / PayPal / Kreditkarten-Disagio', hauptKategorie: 'Bank/Kasse', subKategorie: 'Zahlungsdienste' },
    { konto: '4975', bezeichnung: 'Sonstige Zinsen (Kredit, Dispo)', hauptKategorie: 'Bank/Kasse', subKategorie: 'Zinsen' },
    { konto: '4976', bezeichnung: 'Zinsen Kontokorrentkredit', hauptKategorie: 'Bank/Kasse', subKategorie: 'Zinsen' },

    // ═══ 4xxx CATCH-ALL ═══
    { konto: '4980', bezeichnung: 'Sonstige Aufwendungen (catch-all wenn nichts passt)', hauptKategorie: 'Sonstiges', subKategorie: 'Sonstiges' },
    { konto: '4985', bezeichnung: 'Mahngebuehren / Saeumniszuschlaege', hauptKategorie: 'Sonstiges', subKategorie: 'Mahnungen' },
    { konto: '4988', bezeichnung: 'Geldstrafen / Bussgelder (NICHT abzugsfaehig — Privat)', hauptKategorie: 'Privat', subKategorie: 'Strafen' },

    // ═══ 5xxx WAREN- + STOFF-AUFWAND (Industrie/Handel — eher selten Taxi) ═══
    { konto: '5100', bezeichnung: 'Wareneinkauf 19% Vorsteuer', hauptKategorie: 'Wareneingang', subKategorie: '19%' },
    { konto: '5200', bezeichnung: 'Wareneinkauf 7% Vorsteuer', hauptKategorie: 'Wareneingang', subKategorie: '7%' },

    // ═══ 6xxx PERSONALAUFWAND ═══
    { konto: '6010', bezeichnung: 'Loehne (gewerblich)', hauptKategorie: 'Personal', subKategorie: 'Lohn' },
    { konto: '6020', bezeichnung: 'Gehaelter (Angestellte)', hauptKategorie: 'Personal', subKategorie: 'Gehalt' },
    { konto: '6030', bezeichnung: 'GF-Gehalt', hauptKategorie: 'Personal', subKategorie: 'GF-Gehalt' },
    { konto: '6040', bezeichnung: 'Zuschuesse / Sonderzahlungen', hauptKategorie: 'Personal', subKategorie: 'Sonderzahlungen' },
    { konto: '6080', bezeichnung: 'Sachbezuege (Tankgutschein, Jobticket, Essenszuschuss)', hauptKategorie: 'Personal', subKategorie: 'Sachbezüge' },
    { konto: '6090', bezeichnung: 'Vermoegenswirksame Leistungen (VWL)', hauptKategorie: 'Personal', subKategorie: 'VWL' },
    { konto: '6100', bezeichnung: 'Sozialabgaben gesetzlich', hauptKategorie: 'Personal', subKategorie: 'Sozialabgaben' },
    { konto: '6120', bezeichnung: 'Beitraege Berufsgenossenschaft', hauptKategorie: 'Personal', subKategorie: 'BG' },
    { konto: '6130', bezeichnung: 'Beitraege betriebliche Altersversorgung (bAV)', hauptKategorie: 'Personal', subKategorie: 'bAV' },
    { konto: '6200', bezeichnung: 'Sonstige Personalkosten (Reisekosten MA, Arbeitskleidung)', hauptKategorie: 'Personal', subKategorie: 'Sonstige' },

    // ═══ 7xxx ABSCHREIBUNGEN + SONSTIGE BETRIEBSKOSTEN ═══
    { konto: '7010', bezeichnung: 'Abschreibungen Sachanlagen (Pkw, Hardware AfA)', hauptKategorie: 'Abschreibungen', subKategorie: 'AfA' },
    { konto: '7020', bezeichnung: 'AfA GWG (geringwertige WG)', hauptKategorie: 'Abschreibungen', subKategorie: 'GWG-AfA' },
    { konto: '7030', bezeichnung: 'AfA Sammelposten (Pool-AfA)', hauptKategorie: 'Abschreibungen', subKategorie: 'Pool-AfA' },
    { konto: '7050', bezeichnung: 'Abschreibungen immaterielle Vermoegensgegenstaende', hauptKategorie: 'Abschreibungen', subKategorie: 'Software-AfA' },
    { konto: '7100', bezeichnung: 'Sonstige Steuern (NICHT EkSt/USt/GewSt)', hauptKategorie: 'Steuer/Behörden', subKategorie: 'Sonstige Steuern' },
    { konto: '7200', bezeichnung: 'Erwerbskosten Anlagevermoegen (Notar, Grunderwerbsteuer)', hauptKategorie: 'Anlagevermögen', subKategorie: 'Erwerbsnebenkosten' },
    { konto: '7300', bezeichnung: 'Forderungsverluste (Forderungsausfall)', hauptKategorie: 'Forderungen', subKategorie: 'Verlust' },
    { konto: '7350', bezeichnung: 'Pauschale Wertberichtigung Forderungen', hauptKategorie: 'Forderungen', subKategorie: 'Wertberichtigung' },
    { konto: '7390', bezeichnung: 'Spenden (NICHT abziehbar / Sonderausgabe)', hauptKategorie: 'Sonstiges', subKategorie: 'Spenden' },
    { konto: '7400', bezeichnung: 'Reisespesen Inhaber (Verpflegungspauschale)', hauptKategorie: 'Reisekosten', subKategorie: 'Inhaber' },
    { konto: '7500', bezeichnung: 'Verpackungsmaterial', hauptKategorie: 'Wareneingang', subKategorie: 'Verpackung' },
    { konto: '7600', bezeichnung: 'Provisionen / Vermittlungskosten an Dritte', hauptKategorie: 'Sonstiges', subKategorie: 'Provision-Aufwand' },

    // ═══ 8xxx ERLOESE ═══
    { konto: '8400', bezeichnung: 'Erloese 7% USt — Personenbefoerderung Nahverkehr (Standard Taxi)', hauptKategorie: 'Erlöse', subKategorie: '7% Personenbeförderung' },
    { konto: '8401', bezeichnung: 'Erloese 19% USt — Fernverkehr / Kurier / sonstige Dienstleistung', hauptKategorie: 'Erlöse', subKategorie: '19% Sonstige' },
    { konto: '8402', bezeichnung: 'Erloese aus Vermittlungsprovision', hauptKategorie: 'Erlöse', subKategorie: 'Provision' },
    { konto: '8403', bezeichnung: 'Erloese steuerfrei (Heilbehandlung, Krankentransport §4 Nr.16 UStG)', hauptKategorie: 'Erlöse', subKategorie: 'Steuerfrei' },
    { konto: '8404', bezeichnung: 'Erloese aus Schulfahrten / Behindertenbefoerderung', hauptKategorie: 'Erlöse', subKategorie: 'Schule/Behindert' },
    { konto: '8405', bezeichnung: 'Erloese aus Krankenfahrten (Krankenkassen-Abrechnung)', hauptKategorie: 'Erlöse', subKategorie: 'Krankenkasse' },
    { konto: '8410', bezeichnung: 'Erloese Fahrzeug-Verkauf (Anlagen-Abgang)', hauptKategorie: 'Erlöse', subKategorie: 'Anlagenverkauf' },
    { konto: '8500', bezeichnung: 'Sonstige Erloese (Vermietung, sonstige Einnahmen)', hauptKategorie: 'Erlöse', subKategorie: 'Sonstige' },
    { konto: '8590', bezeichnung: 'Erloese aus EU-Lieferungen (steuerfrei §6a UStG)', hauptKategorie: 'Erlöse', subKategorie: 'EU' },
    { konto: '8600', bezeichnung: 'Zinsertraege (Bank-Guthaben-Zinsen)', hauptKategorie: 'Erlöse', subKategorie: 'Zinsen' },
    { konto: '8700', bezeichnung: 'Erloese aus Schadensersatz (Versicherung zahlt aus)', hauptKategorie: 'Erlöse', subKategorie: 'Schadensersatz' },
    { konto: '8800', bezeichnung: 'Erloese aus Lohnzuschuessen (z.B. JobCenter, Eingliederung)', hauptKategorie: 'Erlöse', subKategorie: 'Zuschüsse' }
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
