package fr.matinbulle.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Douze derniers événements du réveil (programmé, déclenché, acquitté, manqué),
 * pour diagnostiquer sur un vrai téléphone un réveil qui n'a pas sonné.
 */
final class RingLog {

    private static final String PREFS = "matinbulle.log";
    private static final String KEY = "events";
    private static final int MAX = 12;

    private RingLog() {
    }

    static void add(Context context, String type, String detail) {
        try {
            JSONArray events = read(context);
            JSONObject event = new JSONObject();
            event.put("at", System.currentTimeMillis());
            event.put("type", type == null ? "?" : type);
            event.put("detail", detail == null ? "" : detail);
            events.put(event);
            while (events.length() > MAX) events.remove(0);
            prefs(context).edit().putString(KEY, events.toString()).apply();
        } catch (JSONException ignored) {
            // Un journal incomplet ne doit jamais gêner le réveil.
        }
    }

    static JSONArray read(Context context) {
        try {
            return new JSONArray(prefs(context).getString(KEY, "[]"));
        } catch (JSONException bad) {
            return new JSONArray();
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
