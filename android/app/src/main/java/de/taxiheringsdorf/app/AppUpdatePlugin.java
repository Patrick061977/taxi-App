package de.taxiheringsdorf.app;

import android.app.DownloadManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.widget.Toast;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * v6.40.1: Liefert APK-Versionsinfo an die Web-App und öffnet Downloads.
 * v6.63.520: DownloadManager für APK-URLs.
 * v6.66.95 (Patrick 18.09.): Session-basierter PackageInstaller mit
 *   BroadcastReceiver-Callback statt ACTION_VIEW-Intent. Zeigt den ECHTEN
 *   Fehlergrund an — "kann nicht abgeschlossen werden" ohne Details war
 *   Blackbox für Play-Protect/Signatur/Speicher-Probleme.
 *
 * Aufruf aus JS:
 *   Capacitor.Plugins.AppUpdate.getAppInfo()     → { versionName, versionCode, packageName }
 *   Capacitor.Plugins.AppUpdate.openExternal({ url })
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    public static final String INSTALL_STATUS_ACTION = "de.taxiheringsdorf.app.INSTALL_STATUS";

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            PackageInfo info = pm.getPackageInfo(pkg, 0);

            JSObject ret = new JSObject();
            ret.put("versionName", info.versionName != null ? info.versionName : "");
            long code;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                code = info.getLongVersionCode();
            } else {
                code = (long) info.versionCode;
            }
            ret.put("versionCode", code);
            ret.put("packageName", pkg);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("App-Info konnte nicht gelesen werden: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        try {
            String url = call.getString("url", null);
            if (url == null || url.isEmpty()) {
                call.reject("url fehlt");
                return;
            }

            if (url.toLowerCase().contains(".apk")) {
                downloadAndInstallApk(url, call);
            } else {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                JSObject ret = new JSObject();
                ret.put("opened", true);
                call.resolve(ret);
            }
        } catch (Exception e) {
            call.reject("Link konnte nicht geöffnet werden: " + e.getMessage(), e);
        }
    }

    private void downloadAndInstallApk(String url, PluginCall call) {
        try {
            Context ctx = getContext();
            DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);

            File destDir = ctx.getExternalFilesDir(null);
            if (destDir == null) destDir = ctx.getFilesDir();
            File destFile = new File(destDir, "taxi-app-update.apk");
            if (destFile.exists()) destFile.delete();

            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setMimeType("application/vnd.android.package-archive");
            req.setTitle("Taxi App Update");
            req.setDescription("Update wird heruntergeladen...");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationUri(Uri.fromFile(destFile));

            final long downloadId = dm.enqueue(req);
            final File finalDest = destFile;

            BroadcastReceiver onComplete = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (id != downloadId) return;
                    try { context.unregisterReceiver(this); } catch (Exception ignored) {}

                    DownloadManager.Query q = new DownloadManager.Query();
                    q.setFilterById(downloadId);
                    Cursor c = dm.query(q);
                    boolean success = false;
                    if (c != null) {
                        if (c.moveToFirst()) {
                            int col = c.getColumnIndex(DownloadManager.COLUMN_STATUS);
                            success = col >= 0 && c.getInt(col) == DownloadManager.STATUS_SUCCESSFUL;
                        }
                        c.close();
                    }
                    if (!success || !finalDest.exists()) {
                        Toast.makeText(context, "❌ Update-Download fehlgeschlagen", Toast.LENGTH_LONG).show();
                        return;
                    }
                    // 🆕 v6.66.95: Session-Installer statt ACTION_VIEW
                    installViaSession(context, finalDest);
                }
            };

            ctx.registerReceiver(onComplete,
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));

            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);

        } catch (Exception e) {
            call.reject("APK-Download fehlgeschlagen: " + e.getMessage(), e);
        }
    }

    /**
     * Installiert die APK via PackageInstaller.Session. Anders als ACTION_VIEW
     * bekommt der Aufrufer Status-Broadcasts mit KONKRETEN Fehlercodes
     * (STATUS_FAILURE_BLOCKED, STATUS_FAILURE_CONFLICT, STATUS_FAILURE_STORAGE, …).
     * Der {@link InstallStatusReceiver} übersetzt sie in Klartext-Toasts.
     */
    private static void installViaSession(Context context, File apkFile) {
        PackageInstaller pi = context.getPackageManager().getPackageInstaller();
        int sessionId;
        try {
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(context.getPackageName());
            sessionId = pi.createSession(params);
        } catch (Exception e) {
            Toast.makeText(context, "❌ Update-Session konnte nicht erstellt werden: " + e.getMessage(),
                Toast.LENGTH_LONG).show();
            return;
        }

        try (PackageInstaller.Session session = pi.openSession(sessionId)) {
            try (OutputStream out = session.openWrite("update.apk", 0, apkFile.length());
                 InputStream in = new FileInputStream(apkFile)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent statusIntent = new Intent(context, InstallStatusReceiver.class);
            statusIntent.setAction(INSTALL_STATUS_ACTION);
            int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                pendingFlags |= PendingIntent.FLAG_MUTABLE;
            }
            PendingIntent statusPending = PendingIntent.getBroadcast(
                context, sessionId, statusIntent, pendingFlags);
            session.commit(statusPending.getIntentSender());
        } catch (Exception e) {
            try { pi.abandonSession(sessionId); } catch (Exception ignored) {}
            Toast.makeText(context, "❌ Update-Datei konnte nicht übertragen werden: " + e.getMessage(),
                Toast.LENGTH_LONG).show();
        }
    }
}
