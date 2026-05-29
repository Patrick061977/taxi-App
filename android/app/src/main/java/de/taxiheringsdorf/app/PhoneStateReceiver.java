package de.taxiheringsdorf.app;

// 🆕 v6.63.015 (Patrick 29.05.2026 19:13): BroadcastReceiver für TelephonyManager
// PHONE_STATE — triggert CallRecorderService bei OFFHOOK (Anruf läuft), stoppt
// bei IDLE (aufgelegt). Direction wird aus dem vorigen RINGING-State abgeleitet:
//   RINGING → OFFHOOK = eingehend, OFFHOOK ohne vorhergehendes RINGING = ausgehend.

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.TelephonyManager;
import android.util.Log;

public class PhoneStateReceiver extends BroadcastReceiver {
    private static final String TAG = "PhoneStateRcv";

    private static String lastState = TelephonyManager.EXTRA_STATE_IDLE;
    private static String lastIncomingNumber = null;
    private static boolean wasRinging = false;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;
        String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
        String num = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);
        if (state == null) return;
        Log.d(TAG, "state=" + state + " num=" + num + " (lastState=" + lastState + ")");

        if (TelephonyManager.EXTRA_STATE_RINGING.equals(state)) {
            wasRinging = true;
            if (num != null) lastIncomingNumber = num;
            // 🆕 v6.63.020 (Patrick 29.05. 20:29 "Go Split"): Call-Waiting-Erkennung.
            //   RINGING während OFFHOOK = 2. eingehender Anruf während des ersten.
            //   Wir rotieren den Recorder: alten stoppen + neuen mit dem 2. Anruf
            //   starten. Suffix "-CW-" markiert die Call-Waiting-Datei.
            if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(lastState) && num != null) {
                Log.i(TAG, "Call-Waiting erkannt — Recorder rotieren (neuer Anruf: " + num + ")");
                Intent stopSvc = new Intent(ctx, CallRecorderService.class);
                stopSvc.setAction(CallRecorderService.ACTION_STOP);
                try { ctx.startService(stopSvc); } catch (Throwable _t) {}
                Intent startSvc = new Intent(ctx, CallRecorderService.class);
                startSvc.setAction(CallRecorderService.ACTION_START);
                startSvc.putExtra(CallRecorderService.EXTRA_PHONE, num);
                startSvc.putExtra(CallRecorderService.EXTRA_DIRECTION, "0"); // IN
                startSvc.putExtra(CallRecorderService.EXTRA_CALL_WAITING, true);
                try {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                        ctx.startForegroundService(startSvc);
                    } else {
                        ctx.startService(startSvc);
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "CW-Start fehlgeschlagen: " + t.getMessage());
                }
                lastState = TelephonyManager.EXTRA_STATE_OFFHOOK; // bleibt OFFHOOK, nicht RINGING
                return;
            }
        } else if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
            // Anruf angenommen oder ausgehend gestartet
            if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(lastState)) {
                // Schon laufend — kein Doppelstart
                return;
            }
            // ACR-Kompatibilität: 0 = IN, 1 = OUT
            String direction = wasRinging ? "0" : "1";
            String phone = wasRinging ? lastIncomingNumber : "OUT";
            Intent svc = new Intent(ctx, CallRecorderService.class);
            svc.setAction(CallRecorderService.ACTION_START);
            svc.putExtra(CallRecorderService.EXTRA_PHONE, phone != null ? phone : "unbekannt");
            svc.putExtra(CallRecorderService.EXTRA_DIRECTION, direction);
            try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    ctx.startForegroundService(svc);
                } else {
                    ctx.startService(svc);
                }
            } catch (Throwable t) {
                Log.w(TAG, "startForegroundService fehlgeschlagen: " + t.getMessage());
            }
        } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) {
            // Aufgelegt — Service stoppt sich selbst
            if (!TelephonyManager.EXTRA_STATE_IDLE.equals(lastState)) {
                Intent svc = new Intent(ctx, CallRecorderService.class);
                svc.setAction(CallRecorderService.ACTION_STOP);
                try { ctx.startService(svc); }
                catch (Throwable t) { Log.w(TAG, "stop-Intent fehlgeschlagen: " + t.getMessage()); }
            }
            wasRinging = false;
            lastIncomingNumber = null;
        }
        lastState = state;
    }
}
