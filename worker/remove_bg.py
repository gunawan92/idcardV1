import argparse
import json
import os
import sys
from pathlib import Path


def normalize_hex_color(value: str):
    text = str(value or "").strip()

    if text.startswith("#"):
        text = text[1:]

    if len(text) == 3:
        text = "".join([char * 2 for char in text])

    if len(text) != 6:
        raise ValueError("Background hex color tidak valid.")

    try:
        return tuple(int(text[index : index + 2], 16) for index in (0, 2, 4))
    except ValueError as exc:
        raise ValueError("Background hex color tidak valid.") from exc


def center_on_4_3_canvas(image, image_module):
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()

    if not bbox:
        width, height = image.size
        target_width, target_height = target_4_3_size(width, height)
        return image_module.new("RGBA", (target_width, target_height), (0, 0, 0, 0))

    width, height = image.size
    target_width, target_height = target_4_3_size(width, height)
    foreground = image.crop(bbox)
    foreground_width, foreground_height = foreground.size
    max_width = int(target_width * 0.92)
    max_height = int(target_height * 0.92)
    scale = min(max_width / foreground_width, max_height / foreground_height, 1)

    if scale < 1:
        foreground = foreground.resize(
            (max(1, int(foreground_width * scale)), max(1, int(foreground_height * scale))),
            image_module.Resampling.LANCZOS,
        )

    canvas = image_module.new("RGBA", (target_width, target_height), (0, 0, 0, 0))
    paste_x = (target_width - foreground.width) // 2
    paste_y = (target_height - foreground.height) // 2
    canvas.alpha_composite(foreground, (paste_x, paste_y))
    return canvas


def target_4_3_size(width, height):
    if width / height >= 4 / 3:
        return int(round(height * 4 / 3)), height

    return width, int(round(width * 3 / 4))


def process_image(source_path: str, destination_path: str) -> dict:
    return process_image_with_background(source_path, destination_path, "#FFFFFF")


def process_image_with_background(source_path: str, destination_path: str, background_color: str) -> dict:
    try:
        from PIL import Image
        from rembg import remove
    except ImportError as exc:
        return {
            "success": False,
            "message": f"Dependency Python belum lengkap: {exc.name}. Jalankan pip install -r worker/requirements.txt",
        }

    source = Path(source_path)
    destination = Path(destination_path)

    if not source.exists():
        return {"success": False, "message": "Source image tidak ditemukan."}

    destination.parent.mkdir(parents=True, exist_ok=True)

    try:
        rgb_background = normalize_hex_color(background_color)

        with Image.open(source) as image:
            output = remove(image.convert("RGBA"))
            output = center_on_4_3_canvas(output, Image)
            background = Image.new("RGBA", output.size, (*rgb_background, 255))
            background.alpha_composite(output)
            output = background.convert("RGB")
            output.save(destination, "JPEG", quality=95, subsampling=0)

        if not destination.exists():
            return {"success": False, "message": "Output tidak berhasil dibuat."}

        return {
            "success": True,
            "source_path": str(source),
            "destination_path": str(destination),
            "file_size": os.path.getsize(destination),
            "width": output.width,
            "height": output.height,
            "ratio": "4:3",
            "mode": output.mode,
            "background_color": f"#{background_color.strip().lstrip('#').upper()}",
        }
    except Exception as exc:
        return {"success": False, "message": str(exc)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--background", default="#FFFFFF")
    args = parser.parse_args()

    result = process_image_with_background(args.source, args.destination, args.background)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
