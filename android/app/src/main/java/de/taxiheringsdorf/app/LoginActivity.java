package de.taxiheringsdorf.app;

import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.tabs.TabLayout;
import com.google.android.material.textfield.TextInputEditText;
import com.google.firebase.FirebaseException;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.PhoneAuthCredential;
import com.google.firebase.auth.PhoneAuthOptions;
import com.google.firebase.auth.PhoneAuthProvider;
import java.util.concurrent.TimeUnit;

// v6.45.0: Native Login — Fahrer kann sich ohne WebView/ADB einloggen.
// Email/Passwort ODER Telefon/SMS via Firebase Auth.
// Nach Login → VehiclePickerActivity.
public class LoginActivity extends AppCompatActivity {
    private static final String TAG = "LoginActivity";

    private LinearLayout emailPanel, phonePanel;
    private TextInputEditText etEmail, etPassword, etPhone, etCode;
    private MaterialButton btnEmailLogin, btnEmailReset, btnPhoneSend, btnPhoneVerify;
    private com.google.android.material.textfield.TextInputLayout codeLayout;
    private ProgressBar progress;
    private TextView errorView;

    private FirebaseAuth auth;
    private String pendingVerificationId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_login);

        auth = FirebaseAuth.getInstance();

        // Wenn schon eingeloggt UND vehicleId schon gewählt → direkt Dashboard
        String existingVid = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);
        if (auth.getCurrentUser() != null && existingVid != null && !existingVid.isEmpty()) {
            startActivity(new Intent(this, DriverDashboardActivity.class));
            finish();
            return;
        }
        // Wenn schon eingeloggt aber noch kein Fahrzeug → direkt zum Picker
        if (auth.getCurrentUser() != null) {
            startActivity(new Intent(this, VehiclePickerActivity.class));
            finish();
            return;
        }

        TabLayout tabs = findViewById(R.id.login_tabs);
        emailPanel = findViewById(R.id.email_panel);
        phonePanel = findViewById(R.id.phone_panel);
        etEmail = findViewById(R.id.et_email);
        etPassword = findViewById(R.id.et_password);
        etPhone = findViewById(R.id.et_phone);
        etCode = findViewById(R.id.et_code);
        btnEmailLogin = findViewById(R.id.btn_email_login);
        btnEmailReset = findViewById(R.id.btn_email_reset);
        btnPhoneSend = findViewById(R.id.btn_phone_send);
        btnPhoneVerify = findViewById(R.id.btn_phone_verify);
        codeLayout = findViewById(R.id.code_layout);
        progress = findViewById(R.id.login_progress);
        errorView = findViewById(R.id.login_error);

        tabs.addOnTabSelectedListener(new TabLayout.OnTabSelectedListener() {
            @Override public void onTabSelected(TabLayout.Tab tab) {
                emailPanel.setVisibility(tab.getPosition() == 0 ? View.VISIBLE : View.GONE);
                phonePanel.setVisibility(tab.getPosition() == 1 ? View.VISIBLE : View.GONE);
                hideError();
            }
            @Override public void onTabUnselected(TabLayout.Tab tab) {}
            @Override public void onTabReselected(TabLayout.Tab tab) {}
        });

        btnEmailLogin.setOnClickListener(v -> doEmailLogin());
        btnEmailReset.setOnClickListener(v -> doPasswordReset());
        btnPhoneSend.setOnClickListener(v -> doPhoneSendCode());
        btnPhoneVerify.setOnClickListener(v -> doPhoneVerifyCode());
    }

    private void doEmailLogin() {
        hideError();
        String email = textOf(etEmail);
        String pass = textOf(etPassword);
        if (TextUtils.isEmpty(email) || TextUtils.isEmpty(pass)) {
            showError("Email und Passwort eingeben.");
            return;
        }
        showProgress(true);
        auth.signInWithEmailAndPassword(email, pass)
            .addOnSuccessListener(r -> { showProgress(false); openVehiclePicker(); })
            .addOnFailureListener(e -> {
                showProgress(false);
                showError("Login fehlgeschlagen: " + e.getMessage());
                Log.w(TAG, "Email-Login fail", e);
            });
    }

    private void doPasswordReset() {
        hideError();
        String email = textOf(etEmail);
        if (TextUtils.isEmpty(email)) {
            showError("Email eingeben für Passwort-Reset.");
            return;
        }
        showProgress(true);
        auth.sendPasswordResetEmail(email)
            .addOnSuccessListener(v -> {
                showProgress(false);
                showError("✅ Reset-Mail an " + email + " gesendet.");
            })
            .addOnFailureListener(e -> {
                showProgress(false);
                showError("Reset fehlgeschlagen: " + e.getMessage());
            });
    }

    private void doPhoneSendCode() {
        hideError();
        String phone = textOf(etPhone);
        if (TextUtils.isEmpty(phone) || !phone.startsWith("+")) {
            showError("Telefonnummer mit Ländervorwahl (+49…) eingeben.");
            return;
        }
        showProgress(true);
        PhoneAuthOptions options = PhoneAuthOptions.newBuilder(auth)
            .setPhoneNumber(phone)
            .setTimeout(60L, TimeUnit.SECONDS)
            .setActivity(this)
            .setCallbacks(new PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
                @Override public void onVerificationCompleted(@NonNull PhoneAuthCredential credential) {
                    // Auto-Verifikation
                    signInWithPhoneCredential(credential);
                }
                @Override public void onVerificationFailed(@NonNull FirebaseException e) {
                    showProgress(false);
                    showError("SMS-Versand fehlgeschlagen: " + e.getMessage());
                }
                @Override public void onCodeSent(@NonNull String verificationId, @NonNull PhoneAuthProvider.ForceResendingToken token) {
                    showProgress(false);
                    pendingVerificationId = verificationId;
                    codeLayout.setVisibility(View.VISIBLE);
                    btnPhoneVerify.setVisibility(View.VISIBLE);
                    showError("📨 SMS gesendet — Code eingeben.");
                }
            })
            .build();
        PhoneAuthProvider.verifyPhoneNumber(options);
    }

    private void doPhoneVerifyCode() {
        hideError();
        String code = textOf(etCode);
        if (TextUtils.isEmpty(code) || pendingVerificationId == null) {
            showError("Code eingeben.");
            return;
        }
        showProgress(true);
        PhoneAuthCredential credential = PhoneAuthProvider.getCredential(pendingVerificationId, code);
        signInWithPhoneCredential(credential);
    }

    private void signInWithPhoneCredential(PhoneAuthCredential credential) {
        auth.signInWithCredential(credential)
            .addOnSuccessListener(r -> { showProgress(false); openVehiclePicker(); })
            .addOnFailureListener(e -> {
                showProgress(false);
                showError("Anmeldung fehlgeschlagen: " + e.getMessage());
            });
    }

    private void openVehiclePicker() {
        startActivity(new Intent(this, VehiclePickerActivity.class));
        finish();
    }

    private void showProgress(boolean s) { progress.setVisibility(s ? View.VISIBLE : View.GONE); }
    private void showError(String s) { errorView.setText(s); errorView.setVisibility(View.VISIBLE); }
    private void hideError() { errorView.setVisibility(View.GONE); }
    private static String textOf(TextInputEditText t) { return t.getText() != null ? t.getText().toString().trim() : ""; }
}
