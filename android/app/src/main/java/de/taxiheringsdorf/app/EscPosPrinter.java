package de.taxiheringsdorf.app;

import android.content.Context;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.Charset;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * v6.62.128 — Bluetooth-Drucker-Stub für HALE TPD-02-BT.
 *
 * Aktuell läuft alles im MOCK-Modus: generierte Quittungen werden ins Logcat
 * ausgegeben. Sobald der Servicetechniker-Termin folgendes geklärt hat:
 *   1) Bluetooth-Profil (Classic/SPP RFCOMM oder BLE GATT)
 *   2) Druck-Protokoll (ESC/POS Standard oder HALE-proprietär)
 *   3) Standard-Pairing-PIN
 *   4) Papierbreite (58 mm = 32 Zeichen / 80 mm = 48 Zeichen)
 * werden die {@link #connectSpp(String)} / {@link #connectBle(String)}
 * Methoden mit echtem Code befüllt. Die Quittungs-Generation ({@link
 * #generateReceipt}) ist hardware-unabhängig und schon nutzbar.
 *
 * Aufruf-Beispiel (Mock-Modus):
 *   EscPosPrinter p = new EscPosPrinter(ctx);
 *   p.printReceipt(ride, 31.15, "stripe", "https://checkout.stripe.com/...");
 *   // → Logcat-Tag "EscPosPrinter": kompletter Quittungs-Inhalt
 */
public class EscPosPrinter {
    private static final String TAG = "EscPosPrinter";

    // ESC/POS-Standard-Befehle (gültig sobald wir wissen, dass der TPD-02-BT
    // ESC/POS spricht — fast alle Thermo-Drucker tun das).
    private static final byte ESC = 0x1B;
    private static final byte GS  = 0x1D;
    private static final byte LF  = 0x0A;

    static final byte[] CMD_INIT          = { ESC, '@' };                   // Drucker reset
    static final byte[] CMD_ALIGN_LEFT    = { ESC, 'a', 0 };
    static final byte[] CMD_ALIGN_CENTER  = { ESC, 'a', 1 };
    static final byte[] CMD_ALIGN_RIGHT   = { ESC, 'a', 2 };
    static final byte[] CMD_DOUBLE_HEIGHT = { ESC, '!', 0x10 };             // 2x Höhe (Header)
    static final byte[] CMD_DOUBLE_WIDTH  = { ESC, '!', 0x20 };             // 2x Breite
    static final byte[] CMD_DOUBLE_BOTH   = { ESC, '!', 0x30 };             // 2x Breite + Höhe
    static final byte[] CMD_NORMAL        = { ESC, '!', 0x00 };
    static final byte[] CMD_BOLD_ON       = { ESC, 'E', 1 };
    static final byte[] CMD_BOLD_OFF      = { ESC, 'E', 0 };
    static final byte[] CMD_CUT_FULL      = { GS,  'V', 0 };
    static final byte[] CMD_FEED_3LINES   = { ESC, 'd', 3 };

    // Papierbreite — wird beim Pairing ggf. überschrieben.
    private int charsPerLine = 32; // 58 mm Default; 80 mm = 48

    private final Context ctx;
    private boolean mockMode = true;        // bis Hardware angeschlossen ist
    private String connectedMac = null;
    private String profile = "spp";         // wird auf "ble" gesetzt falls TPD BLE nutzt

    public EscPosPrinter(Context ctx) {
        this.ctx = ctx;
    }

    public void setMockMode(boolean enabled) { this.mockMode = enabled; }
    public boolean isMockMode() { return mockMode; }
    public void setCharsPerLine(int n) { this.charsPerLine = n; }
    public void setProfile(String p) { this.profile = p; }

    /** TODO Servicetechniker-Termin: echten Bluetooth-Socket aufbauen. */
    public boolean connectSpp(String macAddress) {
        if (mockMode) {
            connectedMac = macAddress;
            Log.i(TAG, "[MOCK] connectSpp(" + macAddress + ") → ok");
            return true;
        }
        // TODO: BluetoothAdapter.getDefaultAdapter().getRemoteDevice(mac)
        //       .createRfcommSocketToServiceRecord(SPP_UUID).connect();
        Log.w(TAG, "connectSpp: SPP-Implementierung steht aus (warten auf BT-Profil-Bestätigung)");
        return false;
    }

    /** TODO Servicetechniker-Termin: GATT-Verbindung mit Service-/Char-UUIDs vom Hersteller. */
    public boolean connectBle(String deviceId) {
        if (mockMode) {
            connectedMac = deviceId;
            profile = "ble";
            Log.i(TAG, "[MOCK] connectBle(" + deviceId + ") → ok");
            return true;
        }
        Log.w(TAG, "connectBle: BLE-Implementierung steht aus (Service-UUIDs vom HALE-Support)");
        return false;
    }

    public void disconnect() {
        connectedMac = null;
        Log.i(TAG, "disconnect()");
    }

    /**
     * Generiert die Quittung als ESC/POS-Bytefolge. Hardware-unabhängig — kann
     * im Mock-Mode geloggt oder im Live-Mode auf den Bluetooth-OutputStream
     * geschrieben werden. driverName + vehicleName werden separat reingegeben,
     * weil die {@link DriverDashboardActivity.Ride}-Klasse sie nicht enthält
     * (kommen aus SharedPreferences bzw. der laufenden Schicht).
     */
    public byte[] generateReceipt(DriverDashboardActivity.Ride r, double amount,
                                  String paymentMethod, String stripeUrl,
                                  String driverName, String vehicleName) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            out.write(CMD_INIT);

            // Header
            out.write(CMD_ALIGN_CENTER);
            out.write(CMD_DOUBLE_BOTH);
            writeLine(out, "FUNK TAXI");
            writeLine(out, "HERINGSDORF");
            out.write(CMD_NORMAL);
            writeLine(out, "Kanalstr. 1, 17424 Heringsdorf");
            writeLine(out, "Tel. 038378 / 13313");
            writeLine(out, "USt-IdNr. DE205006336");
            writeLine(out, hr());

            // Beleg-Kopf
            out.write(CMD_ALIGN_LEFT);
            String dateStr = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMANY).format(new Date());
            writeLine(out, padRight("Datum", 12) + dateStr);
            if (r != null && r.id != null) writeLine(out, padRight("Beleg-Nr.", 12) + safe(r.id));
            if (driverName != null)  writeLine(out, padRight("Fahrer", 12) + safe(driverName));
            if (vehicleName != null) writeLine(out, padRight("Fahrzeug", 12) + safe(vehicleName));
            writeLine(out, hr());

            // Strecke
            if (r != null) {
                if (r.pickup != null)      writeLine(out, padRight("Abfahrt", 12) + safe(r.pickup));
                if (r.waypoints != null) {
                    int i = 1;
                    for (String wp : r.waypoints) {
                        writeLine(out, padRight("Stopp " + (i++), 12) + safe(wp));
                    }
                }
                if (r.destination != null) writeLine(out, padRight("Ziel", 12) + safe(r.destination));
                if (r.distance != null) writeLine(out, padRight("Strecke", 12)
                        + String.format(Locale.GERMANY, "%.1f km", r.distance));
                writeLine(out, hr());
            }

            // Preis
            out.write(CMD_BOLD_ON);
            String amountStr = String.format(Locale.GERMANY, "%.2f EUR", amount);
            writeLine(out, padRight("SUMME", charsPerLine - amountStr.length()) + amountStr);
            out.write(CMD_BOLD_OFF);
            // 7 % MwSt. (Personenbeförderung)
            double netto = amount / 1.07;
            double mwst  = amount - netto;
            writeLine(out, padRight("netto", charsPerLine - 12)
                            + String.format(Locale.GERMANY, "%10.2f", netto));
            writeLine(out, padRight("MwSt 7 %", charsPerLine - 12)
                            + String.format(Locale.GERMANY, "%10.2f", mwst));
            writeLine(out, hr());

            // Bezahlart
            String pm = paymentMethod == null ? "?" : paymentMethod;
            writeLine(out, padRight("Bezahlart", 12) + pm);
            if ("stripe".equals(pm) && stripeUrl != null && !stripeUrl.isEmpty()) {
                writeLine(out, "QR fuer Online-Zahlung:");
                appendQr(out, stripeUrl);
            }
            writeLine(out, hr());

            // Footer
            out.write(CMD_ALIGN_CENTER);
            writeLine(out, "Vielen Dank, gute Fahrt!");
            writeLine(out, "funktaxi.de");

            // Vorschub + Schnitt
            out.write(CMD_FEED_3LINES);
            out.write(CMD_CUT_FULL);
        } catch (IOException e) {
            Log.e(TAG, "generateReceipt failed", e);
        }
        return out.toByteArray();
    }

    public void printReceipt(DriverDashboardActivity.Ride r, double amount,
                             String paymentMethod, String stripeUrl,
                             String driverName, String vehicleName) {
        byte[] bytes = generateReceipt(r, amount, paymentMethod, stripeUrl, driverName, vehicleName);
        if (mockMode || connectedMac == null) {
            // Im Mock-Mode geben wir die Quittung als lesbaren Text ins Log aus
            // (ohne ESC-Sequences), damit Patrick beim Anschauen sieht ob Layout
            // und Werte stimmen.
            Log.i(TAG, "[MOCK PRINT] -----\n" + bytesToReadable(bytes) + "\n-----");
            return;
        }
        // TODO: BluetoothSocket.getOutputStream().write(bytes);
        Log.w(TAG, "printReceipt: Live-Druck-Implementierung folgt nach Servicetechniker-Termin");
    }

    // ----- Helpers ------------------------------------------------------------

    private void writeLine(ByteArrayOutputStream out, String s) throws IOException {
        out.write(s.getBytes(Charset.forName("CP437")));
        out.write(LF);
    }

    private String hr() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < charsPerLine; i++) sb.append('-');
        return sb.toString();
    }

    private String padRight(String s, int n) {
        if (s == null) s = "";
        if (s.length() >= n) return s.substring(0, n);
        StringBuilder sb = new StringBuilder(s);
        while (sb.length() < n) sb.append(' ');
        return sb.toString();
    }

    private String safe(String s) { return s == null ? "" : s; }

    /** Stub QR-Code-Block — echte Implementierung nutzt GS k 65 oder ZXing-Bitmap. */
    private void appendQr(ByteArrayOutputStream out, String data) throws IOException {
        // TODO: ESC/POS GS k 65 (model 2 QR code). Bis Hardware bestätigt:
        // Stripe-URL als Klartext drucken — Kunde kann Tippen statt Scannen.
        writeLine(out, data.length() > charsPerLine ? data.substring(0, charsPerLine) : data);
    }

    /** Strippt ESC-Sequenzen für lesbares Mock-Logging. */
    private String bytesToReadable(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        boolean skip = false;
        for (int i = 0; i < bytes.length; i++) {
            byte b = bytes[i];
            if (skip) { skip = false; continue; }
            if (b == ESC || b == GS) {
                // Nächstes Byte = Befehl, danach 0-2 Parameter — vereinfacht: skip 2
                skip = true;
                if (i + 2 < bytes.length) i++;
                continue;
            }
            if (b >= 0x20 || b == LF) sb.append((char) (b & 0xFF));
        }
        return sb.toString();
    }
}
