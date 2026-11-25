// Embarque les polices de la maquette dans l'APK (les Google Fonts distantes
// n'ont pas de sens pour un réveil qui doit rester fidèle hors ligne).
// Usage : node android/fetch-fonts.mjs   → android/fonts/
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONTS = join(HERE, "fonts");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const SHEET =
  "https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Nunito+Sans:wght@400;600;700;800&display=swap";
const KEEP = new Set(["latin", "latin-ext"]);

const response = await fetch(SHEET, { headers: { "User-Agent": UA } });
if (!response.ok) throw new Error(`CSS Google Fonts : ${response.status}`);
const css = await response.text();

mkdirSync(FONTS, { recursive: true });

const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)];
if (!blocks.length) throw new Error("aucun @font-face reconnu dans le CSS");

const kept = [];
for (const [, subset, block] of blocks) {
  if (!KEEP.has(subset)) continue;
  const url = block.match(/url\((https:\/\/[^)]+\.woff2)\)/);
  if (!url) continue;
  const family = (block.match(/font-family:\s*'([^']+)'/) || [, "font"])[1];
  const weight = (block.match(/font-weight:\s*(\d+)/) || [, "400"])[1];
  const file = `${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${weight}-${subset}.woff2`;
  const binary = await fetch(url[1], { headers: { "User-Agent": UA } });
  if (!binary.ok) throw new Error(`${url[1]} : ${binary.status}`);
  const bytes = Buffer.from(await binary.arrayBuffer());
  writeFileSync(join(FONTS, file), bytes);
  kept.push({
    css: block.replace(/url\(https:\/\/[^)]+\.woff2\)/, `url(${file})`),
    file,
    size: bytes.length,
  });
}

writeFileSync(join(FONTS, "fonts.css"), `${kept.map((k) => k.css).join("\n")}\n`);
const total = kept.reduce((sum, k) => sum + k.size, 0);
console.log(`fonts.css : ${kept.length} fichiers, ${(total / 1024).toFixed(0)} Kio`);
