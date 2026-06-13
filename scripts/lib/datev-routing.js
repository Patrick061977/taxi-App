// scripts/lib/datev-routing.js — v6.63.315 (Patrick 13.06.2026 09:44):
// Routing-Entscheidung pro Beleg → welches der 5 DATEV-Postfaecher.
//
// 5 Postfaecher:
//   📥 EINGANG         — Default fuer alle Vendor-Ueberweisungs-Rechnungen
//   💵 KASSE           — Bar-Belege (REWE eBon, Tankrechnung wenn 'bar' im Body etc.)
//   🏖️  FEWO 2026      — Booking.com / Airbnb Buchungen
//   📤 AUSGANG         — Eigene Rechnungen die taxiwydra an Kunden gesendet hat
//   📁 SONSTIGE        — manuell, niemals automatisch
//
// Aufruf: const target = pickDatevTarget({ fromAddr, fromDomain, subject, body });

const TARGETS = {
    eingang:   { email: 'e41e7435-8c6b-4078-a3d4-fd7a04a0c891@uploadmail.datev.de', label: '📥 EINGANG' },
    kasse:     { email: 'b52d4382-f077-4ed5-8e5f-a685b934fd9c@uploadmail.datev.de', label: '💵 KASSE' },
    fewo:      { email: '7ec1e41e-8258-4679-ae56-113911d95a1b@uploadmail.datev.de', label: '🏖️ FEWO 2026' },
    ausgang:   { email: '8d5776ad-af6b-4ff8-ad13-b0ff2bea30e1@uploadmail.datev.de', label: '📤 AUSGANG' },
    sonstige:  { email: '050b28f6-3f0b-4d87-a531-77af400bfb71@uploadmail.datev.de', label: '📁 SONSTIGE' }
};

// Vendor-Domains die typisch Bar-Belege liefern (REWE eBon etc.)
const KASSE_DOMAINS = [
    'rewe.de', 'mailing.rewe.de',
    'aldi-sued.de', 'aldi-nord.de', 'aldi.de',
    'lidl.de',
    'netto-online.de', 'netto.de',
    'edeka.de',
    'penny.de',
    'kaufland.de',
    'dm.de',
    'rossmann.de'
];

// Vendor-Domains fuer Ferienwohnungs-Buchungen
const FEWO_DOMAINS = [
    'booking.com',
    'mailing.booking.com',
    'airbnb.com', 'airbnb.de',
    'fewo-direkt.de',
    'e-domizil.de',
    'traum-ferienwohnungen.de'
];

const OWN_FROM = /taxiwydra@(gmx\.de|googlemail\.com|gmail\.com)/i;
const OWN_INVOICE_SUBJ = /rechnung|invoice|RE-?\d{3,}/i;
const KASSE_BODY_HINT = /\b(bar(zahlung)?|bar\s*bezahlt|ebon|kassenbon|kaufbeleg)\b/i;
const FEWO_SUBJ_HINT = /ferienwohnung|booking\.com|airbnb|reservierung[s\-]?best|buchungsbest/i;

function pickDatevTarget({ fromAddr = '', fromDomain = '', subject = '', body = '' }) {
    const _from = String(fromAddr).toLowerCase();
    const _dom = String(fromDomain).toLowerCase();
    const _subj = String(subject || '');
    const _body = String(body || '');

    // 1. AUSGANG: Eigene Rechnungen (taxiwydra als Absender + Subject 'Rechnung')
    if (OWN_FROM.test(_from) && OWN_INVOICE_SUBJ.test(_subj)) {
        return { key: 'ausgang', ...TARGETS.ausgang, reason: 'own-invoice' };
    }

    // 2. KASSE: Vendor-Domain ODER Subject/Body sagt "Bar"
    if (KASSE_DOMAINS.includes(_dom) || KASSE_BODY_HINT.test(_subj) || KASSE_BODY_HINT.test(_body)) {
        return { key: 'kasse', ...TARGETS.kasse, reason: KASSE_DOMAINS.includes(_dom) ? 'kasse-domain' : 'kasse-body' };
    }

    // 3. FEWO 2026: Booking.com / Airbnb / FeWo-Direkt
    if (FEWO_DOMAINS.includes(_dom) || FEWO_SUBJ_HINT.test(_subj)) {
        return { key: 'fewo', ...TARGETS.fewo, reason: 'fewo' };
    }

    // 4. DEFAULT: EINGANGSRECHNUNG
    return { key: 'eingang', ...TARGETS.eingang, reason: 'default' };
}

module.exports = { pickDatevTarget, TARGETS };
