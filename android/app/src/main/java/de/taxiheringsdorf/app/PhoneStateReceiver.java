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
