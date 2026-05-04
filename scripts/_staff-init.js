#!/usr/bin/env node
// v6.62.234: Stammdaten-Init fuer 4 Mitarbeiter aus ECOVIS-Lohnzettel Juli 2025.
// Quelle: Auswertungen-1.pdf von Patrick (Passwort: 50115).
// Aufruf: node scripts/_staff-init.js
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const data = {
    kargoll: {
        firstName: 'Anja', lastName: 'Kargoll', personalNumber: '00001',
        birthdate: '1976-06-19', address: 'Amselring 10, 17424 Seebad Heringsdorf',
        taxClass: 4, childAllowance: 0.5,
        svNumber: '42190676K513', taxId: '42710963821',
        healthInsurance: 'DAK Gesundheit', healthInsuranceRate: 17.4,
        iban: 'DE20130610080003503852', bank: 'Volksbank Wolgast',
        contractStart: '2020-07-01',
        hourlyRate: 13.9, standbyRate: 2.5, weeklyHoursTarget: 35,
        payType: 'hourly', active: true,
        updatedBy: 'claude-v6.62.234', updatedAt: Date.now()
    },
    kulpa: {
        firstName: 'Dariusz', lastName: 'Kulpa', personalNumber: '00002',
        birthdate: '1976-01-23', address: 'Malopolska 64/1, 72-600 Swinoujscie, POLEN',
        taxClass: 1,
        svNumber: '39230176K000', taxId: '76320985189',
        healthInsurance: 'AOK Nordost', healthInsuranceRate: 18.1,
        iban: 'DE24150505001102151765', bank: 'Sparkasse Vorpommern',
        contractStart: '2024-10-01',
        hourlyRate: 13.9, standbyRate: 2.5, weeklyHoursTarget: 40,
        payType: 'hourly', active: true,
        updatedBy: 'claude-v6.62.234', updatedAt: Date.now()
    },
    dombrowski: {
        firstName: 'Heinz', lastName: 'Dombrowski', personalNumber: '00003',
        birthdate: '1956-05-08', address: 'Neuhoferstrasse 20, 17424 Seebad Heringsdorf',
        taxClass: 6,
        svNumber: '02080556D013', taxId: '82069172530',
        healthInsurance: 'AOK Nordost', healthInsuranceRate: 17.5,
        contractStart: '2024-10-01',
        hourlyRate: 13.9, standbyRate: 2.5, weeklyHoursTarget: 12,
        payType: 'minijob', active: true,
        notes: 'IBAN fehlt im Lohnzettel - bitte nachreichen.',
        updatedBy: 'claude-v6.62.234', updatedAt: Date.now()
    },
    reinke: {
        firstName: 'Danilo', lastName: 'Reinke', personalNumber: '00004',
        birthdate: '1984-06-20', address: 'Am Schloonsee 58c, 17429 Seebad Bansin',
        svNumber: '02200684R025', taxId: '97624307856',
        healthInsurance: 'Knappschaft (Minijob-Zentrale)',
        contractStart: '2026-05-01',
        hourlyRate: 13.9, standbyRate: 2.5, weeklyHoursTarget: 8,
        payType: 'minijob', active: false,
        notes: 'Faengt 1.5.2026 voll an. 2% Pauschalsteuer Par.40a Abs.2 EStG. IBAN fehlt.',
        updatedBy: 'claude-v6.62.234', updatedAt: Date.now()
    }
};

for (const [staffId, payload] of Object.entries(data)) {
    const tmpFile = path.join(os.tmpdir(), `staff-${staffId}-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(payload));
    try {
        execSync(
            `firebase database:update --instance taxi-heringsdorf-default-rtdb -f "/staff/${staffId}" "${tmpFile}"`,
            { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, stdio: 'inherit', shell: true }
        );
        console.log(`OK ${staffId}`);
    } catch (e) {
        console.error(`FAIL ${staffId}: ${e.message}`);
    }
    try { fs.unlinkSync(tmpFile); } catch (_) {}
}
