package de.taxiheringsdorf.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.util.Log;
import android.widget.Toast;

/**
 * v6.66.95: Empfängt Status-Broadcasts vom PackageInstaller.Session
 * und übersetzt die numerischen STATUS_-Codes in Klartext-Toasts +
 * Log-Zeilen — damit Patrick beim nächsten "Update kann nicht abgeschlossen
 * werden" endlich sieht WOran es liegt.
 *
 * Registriert in AndroidManifest.xml.
 */
public class InstallStatusReceiver extends BroadcastReceiver {
    private static final String TAG = "InstallStatus";

    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999);
        String statusMsg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        String pkg = intent.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME);
        Log.i(TAG, "PackageInstaller status=" + status + " msg=" + statusMsg + " pkg=" + pkg);

        switch (status) {
            case PackageInstaller.STATUS_PENDING_USER_ACTION: {
                // Android fragt den User um Erlaubnis (Install-from-Unknown-Sources-Dialog).
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        context.startActivity(confirm);
                    } catch (Throwable t) {
                        Log.e(TAG, "Confirm-Intent fehlgeschlagen: " + t.getMessage());
                        toast(context, "❌ Update-Bestätigungs-Dialog konnte nicht geöffnet werden");
                    }
                }
                break;
            }
            case PackageInstaller.STATUS_SUCCESS:
                toast(context, "✅ Update erfolgreich installiert");
                break;
            case PackageInstaller.STATUS_FAILURE:
                toast(context, "❌ Update fehlgeschlagen (allgemein): " + statusMsg);
                break;
            case PackageInstaller.STATUS_FAILURE_BLOCKED:
                toast(context, "🛡️ Play Protect hat blockiert.\nPlay Store → Play Protect → Zahnrad → Scan aus, dann nochmal.");
                break;
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                toast(context, "❌ Update abgebrochen (User): " + statusMsg);
                break;
            case PackageInstaller.STATUS_FAILURE_INVALID:
                toast(context, "❌ APK-Datei defekt oder ungültig — bitte neu laden.");
                break;
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
                toast(context, "❌ Signatur-Konflikt.\nDeinstalliere die App einmal, dann Update installieren. Deine Fahrten bleiben in Firebase.");
                break;
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                toast(context, "💾 Zu wenig Speicher — bitte >500 MB freimachen.");
                break;
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                toast(context, "❌ Version inkompatibel mit deinem Android.");
                break;
            default:
                toast(context, "❌ Update-Status " + status + (statusMsg != null ? ": " + statusMsg : ""));
                break;
        }
    }

    private static void toast(Context ctx, String msg) {
        Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show();
    }
}
