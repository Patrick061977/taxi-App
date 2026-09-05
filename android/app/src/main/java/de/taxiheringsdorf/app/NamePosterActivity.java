package de.taxiheringsdorf.app;

import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

/**
 * v6.66.24 (Patrick 05.09.2026 12:20 Bridge): Vollbild-Poster fuer Gast-Abholung am Bahnhof.
 *
 * Patrick: "wenn ich jetzt zum Beispiel am Bahnhof bin und Gaeste abhole, wuerde ich gerne
 * laenger auf den Namen druecken und dann muesste sich ein Fenster oder ein Pop-Up oeffnen
 * koennen, dass der Name dann gross geschrieben wird [...] dass ich das Handy als Pinnwand
 * sozusagen [nehmen kann]"
 *
 * Long-Press auf tv_customer_name in der Ride-Card → diese Activity → Vollbild-Text.
 * Tap = Farb-Toggle schwarz/weiss (fuer Kontrast bei Sonne / Bahnhofshalle).
 * ScreenOn bleibt gesetzt via keepScreenOn im Layout — Patrick haelt das Handy oft
 * mehrere Minuten hoch.
 */
public class NamePosterActivity extends AppCompatActivity {
    private boolean _dark = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_name_poster);

        String name = getIntent() != null ? getIntent().getStringExtra("name") : null;
        if (name == null || name.trim().isEmpty()) name = "?";

        TextView tv = findViewById(R.id.np_name);
        TextView hint = findViewById(R.id.np_hint);
        FrameLayout root = findViewById(R.id.np_root);
        tv.setText(name.trim());

        View.OnClickListener toggle = v -> {
            _dark = !_dark;
            if (_dark) {
                root.setBackgroundColor(Color.BLACK);
                tv.setTextColor(Color.WHITE);
                hint.setTextColor(0x66FFFFFF);
            } else {
                root.setBackgroundColor(Color.WHITE);
                tv.setTextColor(Color.BLACK);
                hint.setTextColor(0x66000000);
            }
        };
        root.setOnClickListener(toggle);
        tv.setOnClickListener(toggle);
    }
}
