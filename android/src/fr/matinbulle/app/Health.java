package fr.matinbulle.app;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.os.Build;
import android.os.PowerManager;

import org.json.JSONException;
import org.json.JSONObject;

/** Ce que l'écran « Santé du réveil » doit savoir, lu directement au système. */
final class Health {

    private Health() {
    }

    static String json(Context context) {
        JSONObject out = new JSONObject();
        try {
            NotificationManager nm =
                    (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);

            out.put("notifications", nm == null || nm.areNotificationsEnabled());
            out.put("exact", Build.VERSION.SDK_INT < 31 || (am != null && am.canScheduleExactAlarms()));
            out.put("fullScreen",
                    Build.VERSION.SDK_INT < 34 || (nm != null && nm.canUseFullScreenIntent()));
            out.put("battery",
                    pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName()));
            out.put("volume", audio == null ? -1 : audio.getStreamVolume(AudioManager.STREAM_ALARM));
            out.put("volumeMax",
                    audio == null ? -1 : audio.getStreamMaxVolume(AudioManager.STREAM_ALARM));
            out.put("version", version(context));
            out.put("log", RingLog.read(context));
        } catch (JSONException | SecurityException partial) {
            // Les champs manquants seront présentés comme inconnus par la page.
        }
        return out.toString();
    }

    private static String version(Context context) {
        try {
            return context.getPackageManager()
                    .getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException missing) {
            return "?";
        }
    }
}
