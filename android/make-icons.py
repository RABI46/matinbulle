#!/usr/bin/env python3
"""Icône du lanceur Matinbulle, dessinée en PNG sans dépendance.

Reprend l'icône du favicon : carré arrondi nuit (#14181D) et disque aube
(#F2C078) centré. Rendu par sur-échantillonnage 4x pour des bords lisses.
"""
import os
import struct
import zlib

NUIT = (0x14, 0x18, 0x1D)
AUBE = (0xF2, 0xC0, 0x78)
SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "res")


def inside_round_rect(x, y, size, radius):
    """Vrai si le point normalisé (0..1) est dans le carré arrondi."""
    px, py = x * size, y * size
    r = radius * size
    cx = min(max(px, r), size - r)
    cy = min(max(py, r), size - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def render(size):
    ss = 4  # sous-échantillons par axe
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            cov_alpha = 0
            r_sum = g_sum = b_sum = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size
                    y = (py + (sy + 0.5) / ss) / size
                    if not inside_round_rect(x, y, 1.0, 0.30):
                        continue
                    cov_alpha += 1
                    dx, dy = x - 0.5, y - 0.5
                    if dx * dx + dy * dy <= 0.22 ** 2:
                        r_sum += AUBE[0]
                        g_sum += AUBE[1]
                        b_sum += AUBE[2]
                    else:
                        r_sum += NUIT[0]
                        g_sum += NUIT[1]
                        b_sum += NUIT[2]
            total = ss * ss
            if cov_alpha == 0:
                row += bytes((NUIT[0], NUIT[1], NUIT[2], 0))
            else:
                row += bytes(
                    (
                        r_sum // cov_alpha,
                        g_sum // cov_alpha,
                        b_sum // cov_alpha,
                        round(255 * cov_alpha / total),
                    )
                )
        rows.append(bytes(row))
    return rows


def png(size):
    rows = render(size)
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    for density, size in SIZES.items():
        folder = os.path.join(OUT, f"mipmap-{density}")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "ic_launcher.png")
        with open(path, "wb") as handle:
            handle.write(png(size))
        print(f"{path} ({size}×{size})")


if __name__ == "__main__":
    main()
