package fr.matinbulle.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Widgets d'écran d'accueil : la page pousse l'heure, les jours, les étoiles
 * et les étapes ; chaque taille décide de ce qu'elle montre.
 */
public abstract class MatinbulleWidget extends AppWidgetProvider {

    private static final String PREFS = "matinbulle.widget";
    private static final String KEY = "data";

    /** Reçoit le dernier état affiché, envoyé par la page après chaque rendu. */
    static void store(Context context, String json) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY, json == null ? "{}" : json)
                .apply();
    }

    static JSONObject data(Context context) {
        try {
            return new JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getString(KEY, "{}"));
        } catch (JSONException empty) {
            return new JSONObject();
        }
    }

    static void updateAll(Context context) {
        update(context, WidgetSmall.class);
        update(context, WidgetMedium.class);
        update(context, WidgetLarge.class);
    }

    private static void update(Context context, Class<? extends MatinbulleWidget> type) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, type));
        if (ids.length == 0) return;
        Intent refresh = new Intent(context, type)
                .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(refresh);
    }

    static PendingIntent open(Context context) {
        Intent intent = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    abstract int layoutId();

    abstract void bind(Context context, RemoteViews views, JSONObject data);

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        JSONObject data = data(context);
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), layoutId());
            bind(context, views, data);
            views.setOnClickPendingIntent(R.id.widget_root, open(context));
            manager.updateAppWidget(id, views);
        }
    }
}
