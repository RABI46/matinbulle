#!/usr/bin/env bash
# Construit l'APK Matinbulle sans Gradle : aapt2 (ressources), javac, d8 (dex),
# zipalign puis apksigner. Sortie : android/build/Matinbulle-<version>.apk
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AND="$ROOT/android"
SDK="${ANDROID_SDK_ROOT:-$HOME/android-sdk}"
BT="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"
export JAVA_HOME="${JAVA_HOME:-$HOME/tools/jdk17}"
export PATH="$JAVA_HOME/bin:$PATH"

VERSION="${1:-1.0}"
CODE="${2:-1}"
OUT="$AND/build"

[ -x "$BT/aapt2" ] || { echo "build-tools 34.0.0 absents ($BT)" >&2; exit 1; }
[ -f "$PLATFORM" ] || { echo "platform android-34 absent ($PLATFORM)" >&2; exit 1; }
command -v java >/dev/null || { echo "java introuvable (JAVA_HOME=$JAVA_HOME)" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/assets/www" "$OUT/assets/sounds" "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "== pages embarquées =="
cp "$ROOT/index.html" "$ROOT/app.js" "$ROOT/logic.js" "$ROOT/sounds.js" "$ROOT/styles.css" \
  "$OUT/assets/www/"
cp "$AND/bridge.js" "$OUT/assets/www/bridge.js"
cp "$AND/fonts/fonts.css" "$OUT/assets/www/"
cp "$AND"/fonts/*.woff2 "$OUT/assets/www/"

# Les sonneries synthétisées sont rendues en WAV : le service natif peut jouer
# le son choisi dans la page, même application fermée.
echo "== sonneries =="
node "$AND/tools/render-sounds.mjs" "$OUT/assets/sounds"

# Les polices sont embarquées : le réveil doit être fidèle même hors ligne.
node -e '
const fs = require("fs");
const p = process.argv[1];
let h = fs.readFileSync(p, "utf8");
h = h.replace(/[ \t]*<link rel="preconnect"[^>]*>\n?/g, "");
h = h.replace(/<link[\s\S]{0,160}?fonts\.googleapis\.com[\s\S]{0,200}?>/,
  "<link rel=\"stylesheet\" href=\"fonts.css\" />");
if (/fonts\.googleapis\.com/.test(h)) throw new Error("police distante encore liée dans index.html");
fs.writeFileSync(p, h);
' "$OUT/assets/www/index.html"

echo "== ressources =="
"$BT/aapt2" compile --dir "$AND/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$PLATFORM" \
  --manifest "$AND/AndroidManifest.xml" \
  -A "$OUT/assets" \
  --java "$OUT/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code "$CODE" \
  --version-name "$VERSION" \
  "$OUT/res.zip"

echo "== java =="
# shellcheck disable=SC2046
javac -nowarn -Xlint:-options -classpath "$PLATFORM" -d "$OUT/classes" \
  $(find "$AND/src" -name '*.java') "$OUT/gen/fr/matinbulle/app/R.java"

echo "== dex =="
# shellcheck disable=SC2046
"$BT/d8" --lib "$PLATFORM" --min-api 24 --release --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class')

echo "== assemblage =="
cp "$OUT/base.apk" "$OUT/unsigned.apk"
( cd "$OUT" && zip -q -j unsigned.apk dex/classes.dex )
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "== signature =="
# Clé de debug locale (mot de passe public de l'AOSP) : suffisant pour installer
# et tester l'APK, pas pour une publication sur le Play Store.
KS="${MATINBULLE_KEYSTORE:-$HOME/.android/matinbulle-debug.jks}"
if [ ! -f "$KS" ]; then
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -keystore "$KS" -storetype PKCS12 -alias matinbulle \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass android -keypass android \
    -dname "CN=Matinbulle, O=Matinbulle, C=FR"
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --min-sdk-version 24 --out "$OUT/Matinbulle-$VERSION.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --min-sdk-version 24 "$OUT/Matinbulle-$VERSION.apk"

echo "== résultat =="
"$BT/aapt2" dump badging "$OUT/Matinbulle-$VERSION.apk" | sed -n '1,5p'
ls -lh "$OUT/Matinbulle-$VERSION.apk"
