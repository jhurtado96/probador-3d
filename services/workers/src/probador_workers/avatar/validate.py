"""Validación de la foto de cuerpo entero: decodificación en memoria y reglas sobre la detección de personas.

Las reglas trabajan sobre detecciones genéricas (caja, puntuación y 17 puntos COCO con puntuación), así se prueban sin
GPU. En el worker las produce Keypoint R-CNN de torchvision. Los mensajes van a los logs y a `JobError.message`; la app
traduce el código, no muestra el mensaje (contrato `JobError`). Nunca incluyen datos de la foto.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np

from ..errors import JobFailure

# Índices COCO de Keypoint R-CNN.
COCO = {
    "nose": 0, "left_eye": 1, "right_eye": 2, "left_ear": 3, "right_ear": 4,
    "left_shoulder": 5, "right_shoulder": 6, "left_elbow": 7, "right_elbow": 8, "left_wrist": 9, "right_wrist": 10,
    "left_hip": 11, "right_hip": 12, "left_knee": 13, "right_knee": 14, "left_ankle": 15, "right_ankle": 16,
}

MAX_SIDE = 2048
MIN_SIDE = 320
PERSON_SCORE = 0.8
SECOND_PERSON_SCORE = 0.7
SECOND_PERSON_AREA = 0.15  # otra persona con >= 15 % del área de la principal cuenta como segunda persona
KP_VISIBLE = 1.0  # umbral sobre la puntuación (logit) de cada punto de Keypoint R-CNN
MIN_BODY_FRACTION = 0.35  # la persona debe ocupar al menos un 35 % del alto de la imagen


@dataclass
class Detection:
    box: np.ndarray  # (4,) x1, y1, x2, y2 en píxeles
    score: float
    keypoints: np.ndarray  # (17, 3) x, y, puntuación

    @property
    def area(self) -> float:
        return float(max(self.box[2] - self.box[0], 0) * max(self.box[3] - self.box[1], 0))


def decode_image(data: bytes) -> np.ndarray:
    """JPEG/PNG/WebP -> RGB uint8 (H, W, 3) en memoria, con la orientación EXIF aplicada y el lado mayor <= MAX_SIDE."""
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        with Image.open(io.BytesIO(data)) as im:
            if im.format not in {"JPEG", "PNG", "WEBP", "MPO"}:
                raise JobFailure("invalid_input", "formato de imagen no admitido (usa JPEG, PNG o WebP)")
            im = ImageOps.exif_transpose(im).convert("RGB")
            if max(im.size) > MAX_SIDE:
                im.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
            arr = np.asarray(im, dtype=np.uint8).copy()
    except (UnidentifiedImageError, OSError, ValueError):
        raise JobFailure("invalid_input", "la foto no se puede leer como imagen") from None
    if min(arr.shape[:2]) < MIN_SIDE:
        raise JobFailure("low_image_quality", "la foto tiene muy poca resolución para medir el cuerpo")
    return arr


def _vis(det: Detection, name: str) -> bool:
    return bool(det.keypoints[COCO[name], 2] > KP_VISIBLE)


def _pt(det: Detection, name: str) -> np.ndarray:
    return det.keypoints[COCO[name], :2]


def check_photo(detections: list[Detection], width: int, height: int) -> Detection:
    """Exige una sola persona, de cuerpo entero (cabeza y tobillos dentro de la foto) y de pie. Devuelve su detección."""
    people = sorted([d for d in detections if d.score >= SECOND_PERSON_SCORE], key=lambda d: d.area, reverse=True)
    main = next((d for d in people if d.score >= PERSON_SCORE), None)
    if main is None:
        raise JobFailure("no_person_detected", "no se ha encontrado a ninguna persona en la foto")
    others = [d for d in people if d is not main and d.area >= SECOND_PERSON_AREA * main.area]
    if others:
        raise JobFailure("multiple_people", "en la foto aparece más de una persona; haz la foto con una sola")

    head_visible = any(_vis(main, n) for n in ("nose", "left_eye", "right_eye", "left_ear", "right_ear"))
    feet_visible = _vis(main, "left_ankle") and _vis(main, "right_ankle")
    margin = 0.005 * height
    ankles_inside = all(margin < _pt(main, f"{s}_ankle")[1] < height - margin for s in ("left", "right"))
    if not (head_visible and feet_visible and ankles_inside):
        raise JobFailure("body_not_fully_visible", "no se ve el cuerpo entero: tienen que verse la cabeza y los pies")

    body_h = main.box[3] - main.box[1]
    if body_h < MIN_BODY_FRACTION * height:
        raise JobFailure("low_image_quality", "la persona sale demasiado pequeña en la foto; acércate a la cámara")

    core = ("left_shoulder", "right_shoulder", "left_hip", "right_hip", "left_knee", "right_knee")
    if not all(_vis(main, n) for n in core):
        raise JobFailure("body_not_fully_visible", "no se distinguen bien hombros, caderas y rodillas")
    sh = (_pt(main, "left_shoulder") + _pt(main, "right_shoulder")) / 2
    hp = (_pt(main, "left_hip") + _pt(main, "right_hip")) / 2
    kn = (_pt(main, "left_knee") + _pt(main, "right_knee")) / 2
    an = (_pt(main, "left_ankle") + _pt(main, "right_ankle")) / 2
    span = an[1] - sh[1]  # en la imagen y crece hacia abajo
    upright = span > 0 and sh[1] < hp[1] < kn[1] < an[1]
    torso = hp - sh
    tilt = np.degrees(np.arctan2(abs(torso[0]), max(torso[1], 1e-6)))
    legs_extended = (kn[1] - hp[1]) > 0.25 * span and (an[1] - kn[1]) > 0.25 * span
    if not (upright and tilt < 25 and legs_extended):
        raise JobFailure("pose_invalid", "ponte de pie, de frente, con los brazos algo separados del cuerpo")
    return main


def detection_quality(det: Detection) -> float:
    """0..1: puntuación de la persona por la fracción de puntos visibles (entra en `Avatar.confidence`)."""
    visible = float(np.mean(det.keypoints[:, 2] > KP_VISIBLE))
    return float(np.clip(det.score, 0, 1) * visible)
