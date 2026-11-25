package fr.matinbulle.app;

import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** 4 × 3 : l'heure, les jours, les étoiles et les étapes de la routine. */
public class WidgetLarge extends MatinbulleWidget {

    private static final int[] STEP_IDS = {
            R.id.widget_step_1,
            R.id.widget_step_2,
            R.id.widget_step_3,
            R.id.widget_step_4,
    };

    @Override
    int layoutId() {
        return R.layout.widget_large;
    }

    @Override
    void bind(Context context, RemoteViews views, JSONObject data) {
        views.setTextViewText(R.id.widget_time, data.optString("time", "--:--"));
        views.setTextViewText(R.id.widget_meta, data.optString("meta", "Réveil actif"));
        views.setTextViewText(R.id.widget_stars,
                "★ " + data.optInt("stars", 0) + " aujourd'hui");
        JSONArray steps = data.optJSONArray("steps");
        for (int i = 0; i < STEP_IDS.length; i++) {
            String text = steps != null && i < steps.length() ? steps.optString(i, "") : "";
            views.setTextViewText(STEP_IDS[i], text);
        }
    }
}
