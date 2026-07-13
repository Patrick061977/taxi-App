const { execSync } = require('child_process');
const admin = require('../functions/node_modules/firebase-admin');

admin.initializeApp({
    databaseURL: 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app'
});

const db = admin.database();

async function main() {
    const rideId = '-OwfatOxFXIK9bCt66QY';
    await db.ref(`rides/${rideId}`).update({
        invoiceAmount: 10,
        updatedAt: Date.now()
    });
    console.log('✅ invoiceAmount auf 10 gesetzt');

    // Verify invoice record
    const inv = await db.ref('invoices/20-26-1292').once('value');
    const invData = inv.val();
    console.log('Invoice totalGross:', invData.totalGross);
    console.log('Invoice positions[0].amount:', invData.positions?.[0]?.amount);
    console.log('Invoice needsPdfRegeneration:', invData.needsPdfRegeneration);
    console.log('Invoice pdfUrl:', invData.pdfUrl?.substring(0, 80) + '...');

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
