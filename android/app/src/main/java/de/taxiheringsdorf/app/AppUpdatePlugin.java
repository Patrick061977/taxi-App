package de.taxiheringsdorf.app;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * v6.40.1: Liefert APK-Versionsinfo an die Web-App und öffnet Downloads
 * im System-Browser (nicht-APK) oder via DownloadManager (APK).
 *
 * v6.63.520: openExternal für .apk-URLs nutzt jetzt DownloadManager statt
 * Intent.ACTION_VIEW — Chrome blockiert APK-Downloads per Security-Policy
 * ("Download failed"). DownloadManager lädt direkt, FileProvider stellt
 * content://-URI bereit, REQUEST_INSTALL_PACKAGES öffnet den System-Installer.
 *
 * Aufruf aus JS:
 *   Capacitor.Plugins.AppUpdate.getAppInfo()     → { versionName, versionCode, packageName }
 *   Capacitor.Plugins.AppUpdate.openExternal({ url })
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            PackageInfo info = pm.getPackageInfo(pkg, 0);

            JSObject ret = new JSObject();
            ret.put("versionName", info.versionName != null ? info.versionName : "");
            long code;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
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

            // Ziel: app-private externer Speicher → FileProvider kann diesen Pfad bereitstellen
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
                    try {
                        context.unregisterReceiver(this);
                    } catch (Exception ignored) {}

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

                    if (!success || !finalDest.exists()) return;

                    try {
                        Uri apkUri;
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
                            apkUri = FileProvider.getUriForFile(context,
                                context.getPackageName() + ".fileprovider", finalDest);
                        } else {
                            apkUri = Uri.fromFile(finalDest);
                        }
                        Intent install = new Intent(Intent.ACTION_VIEW);
                        install.setDataAndType(apkUri, "application/vnd.android.package-archive");
                        install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        context.startActivity(install);
                    } catch (Exception ex) {
                        android.util.Log.e("AppUpdatePlugin", "Install-Intent fehlgeschlagen: " + ex.getMessage());
                    }
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
}
