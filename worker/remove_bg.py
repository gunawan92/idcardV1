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
    max_width = int(target_width * 0.98)
    max_height = int(target_height * 0.98)
    scale = min(max(max_width / foreground_width, max_height / foreground_height), 1.3)

    if scale != 1:
        foreground = foreground.resize(
            (max(1, int(foreground_width * scale)), max(1, int(foreground_height * scale))),
            image_module.Resampling.LANCZOS,
        )

    if foreground.width > target_width:
        crop_left = (foreground.width - target_width) // 2
        foreground = foreground.crop((crop_left, 0, crop_left + target_width, foreground.height))

    if foreground.height > target_height:
        foreground = foreground.crop((0, 0, foreground.width, target_height))

    canvas = image_module.new("RGBA", (target_width, target_height), (0, 0, 0, 0))
    paste_x = (target_width - foreground.width) // 2
    paste_y = max(0, int(target_height * 0.025))

    if paste_y + foreground.height > target_height:
        paste_y = target_height - foreground.height

    canvas.alpha_composite(foreground, (paste_x, paste_y))
    return canvas


def target_4_3_size(width, height):
    if width / height >= 3 / 4:
        return int(round(height * 3 / 4)), height

    return width, int(round(width * 4 / 3))


def reduce_red_spill(image):
    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        return image

    data = np.array(image.convert("RGBA")).astype(np.int16)
    red = data[:, :, 0]
    green = data[:, :, 1]
    blue = data[:, :, 2]
    alpha = data[:, :, 3]

    luma = (red * 299 + green * 587 + blue * 114) / 1000
    red_dominant = (
        (alpha > 0)
        & (red > green + 28)
        & (red > blue + 28)
        & (green < 115)
        & (blue < 115)
    )

    spill_mask = red_dominant & (luma < 90) & (alpha < 180)

    neutral_red = np.maximum(green, blue) + 20
    data[:, :, 0] = np.where(spill_mask, np.minimum(red, neutral_red), red)
    data = np.clip(data, 0, 255).astype("uint8")

    return Image.fromarray(data, "RGBA")


def resize_for_matting(image, image_module, max_side):
    width, height = image.size
    longest_side = max(width, height)

    if longest_side <= max_side:
        return image

    scale = max_side / longest_side
    return image.resize(
        (max(1, int(width * scale)), max(1, int(height * scale))),
        image_module.Resampling.LANCZOS,
    )


def memory_error_message(error):
    message = str(error).lower()
    return "memory" in message or "allocate" in message or "bad allocation" in message


def remove_background(image, remove_function, session):
    try:
        return remove_function(image, session=session, post_process_mask=False)
    except Exception as exc:
        if not memory_error_message(exc):
            raise

        return remove_function(image, session=session, post_process_mask=False)


def process_image(source_path: str, destination_path: str) -> dict:
    return process_image_with_background(source_path, destination_path, "#FFFFFF", 2600)


def process_image_with_background(source_path: str, destination_path: str, background_color: str, max_side: int) -> dict:
    try:
        from PIL import Image
        from rembg import new_session, remove
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
        no_fill = str(background_color or "").strip().lower() in {"none", "no_fill", "nofill", "transparent"}
        rgb_background = None if no_fill else normalize_hex_color(background_color)
        model_name = "u2net"

        try:
            session = new_session(model_name)
        except Exception as exc:
            if not memory_error_message(exc):
                raise

            model_name = "u2netp"
            session = new_session(model_name)

        with Image.open(source) as image:
            working_image = resize_for_matting(image.convert("RGBA"), Image, max_side)
            try:
                output = remove_background(working_image, remove, session)
            except Exception as exc:
                if not memory_error_message(exc) or model_name == "u2netp":
                    raise

                model_name = "u2netp"
                session = new_session(model_name)
                output = remove_background(working_image, remove, session)

            output = reduce_red_spill(output)
            output = center_on_4_3_canvas(output, Image)

            if no_fill:
                output.save(destination, "PNG")
            else:
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
            "ratio": "3:4",
            "mode": output.mode,
            "format": "PNG" if no_fill else "JPEG",
            "background_color": "NO_FILL" if no_fill else f"#{background_color.strip().lstrip('#').upper()}",
            "max_side": max_side,
            "model": model_name,
        }
    except Exception as exc:
        return {"success": False, "message": str(exc)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--background", default="#FFFFFF")
    parser.add_argument("--max-side", type=int, default=2600)
    args = parser.parse_args()

    result = process_image_with_background(args.source, args.destination, args.background, args.max_side)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
