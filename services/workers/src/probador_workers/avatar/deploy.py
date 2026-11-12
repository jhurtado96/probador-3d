"""Imagen de Modal del worker de avatar, versiones fijadas y volumen de pesos. Solo lo usan los ficheros `modal_*.py`.

Versiones fijadas (revisadas el 2026-11-12):
- SAM 3D Body: código en el commit SAM3DB_COMMIT de facebookresearch/sam-3d-body (SAM License). Pesos en Hugging Face,
  repositorio con acceso restringido SAM3DB_HF_REPO; la revisión exacta descargada se guarda en el manifiesto del volumen
  y entra en `Avatar.model_version`. Se usa la variante ViT-H porque su backbone viene en el propio repositorio (la
  variante DINOv3 descarga en cada arranque código de facebookresearch/dinov3, con otra licencia).
- MHR: modelo TorchScript `assets/mhr_model.pt` incluido en el checkpoint de SAM 3D Body; topología del LOD 2 y mapeo
  LOD 1 -> LOD 2 del repositorio facebookresearch/MHR en MHR_COMMIT (Apache 2.0). Los assets de la release v1.0.1 de MHR
  (sin acceso restringido) se usan solo en la prueba sin SAM 3D Body.
- Detector de personas para validar la foto: Keypoint R-CNN de torchvision (BSD-3), pesos COCO de download.pytorch.org.
"""

from __future__ import annotations

SAM3DB_REPO = "https://github.com/facebookresearch/sam-3d-body"
SAM3DB_COMMIT = "b5c765a0d89d789985e186d396315e7590887b94"  # main, 2026-02-19
SAM3DB_VARIANT = "vith"
SAM3DB_HF_REPO = f"facebook/sam-3d-body-{SAM3DB_VARIANT}"
MHR_REPO = "https://github.com/facebookresearch/MHR"
MHR_COMMIT = "85fc2cbaf77f606e41346cb791d8ad96a75e1a4b"  # main, 2026-11-11
MHR_ASSETS_URL = "https://github.com/facebookresearch/MHR/releases/download/v1.0.1/assets.zip"
MHR_ASSETS_SHA256 = "e4f4f205cd87c0fa106577ba1de4fc763e4eb197c924461d2ef7e6944e9d6b94"

WEIGHTS_VOLUME = "probador-avatar-weights"
WEIGHTS_MOUNT = "/weights"
HF_SECRET = "huggingface"  # Modal Secret con HF_TOKEN; SOLO lo usa modal_avatar_weights.py

BASE_PIP = ("httpx>=0.27", "jsonschema[format-nongpl]>=4.21", "fastapi>=0.110", "numpy>=1.26", "pillow>=10.4")
ML_PIP = (
    "torch==2.7.1",
    "torchvision==0.22.1",
    "numpy==2.2.6",
    "pillow==11.3.0",
    "opencv-python-headless==4.11.0.86",
    "pytorch-lightning==2.5.2",
    "yacs==0.1.8",
    "omegaconf==2.3.0",
    "timm==1.0.15",
    "einops==0.8.1",
    "roma==1.5.3",
    "braceexpand==0.1.7",
    "huggingface_hub==0.33.4",
)

AVATAR_ENV = {
    "PROBADOR_AVATAR_WEIGHTS_DIR": WEIGHTS_MOUNT,
    "PROBADOR_SAM3DB_VARIANT": SAM3DB_VARIANT,
    "PROBADOR_SAM3DB_CODE_DIR": "/opt/sam-3d-body",
    "PROBADOR_SAM3DB_COMMIT": SAM3DB_COMMIT,
    "PROBADOR_MHR_DATA_DIR": "/opt/mhr-data",
    "TORCH_HOME": f"{WEIGHTS_MOUNT}/torch",
    "MOMENTUM_ENABLED": "0",  # la cabeza de SAM 3D Body usa el MHR TorchScript, sin pymomentum
    "HF_HUB_DISABLE_TELEMETRY": "1",
    "HF_HUB_OFFLINE": "1",  # en los workers nunca se habla con Hugging Face; solo la función de descarga lo desactiva
}


def gpu_spec(value: str):
    """`"L4,A10G"` -> `["L4", "A10G"]` (Modal prueba en orden según capacidad); `none`/`cpu` -> None."""
    parts = [p.strip() for p in value.split(",") if p.strip()]
    if not parts or parts[0].lower() in {"none", "cpu"}:
        return None
    return parts[0] if len(parts) == 1 else parts


def avatar_base_image(base_pip: tuple[str, ...]):
    """Imagen con las dependencias de ML (sin código local: el llamador añade env, esquemas y paquete al final)."""
    import modal

    return (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install("git")
        .pip_install(*base_pip)
        .pip_install(*ML_PIP)
        .run_commands(
            f"git init -q /opt/sam-3d-body && cd /opt/sam-3d-body && git fetch -q --depth 1 {SAM3DB_REPO} {SAM3DB_COMMIT}"
            " && git checkout -q FETCH_HEAD && rm -rf .git",
            f"git init -q /tmp/mhr && cd /tmp/mhr && git fetch -q --depth 1 {MHR_REPO} {MHR_COMMIT} && git checkout -q FETCH_HEAD"
            " && mkdir -p /opt/mhr-data && cp web-viewer/data/lod_topology.npz tools/mhr_LOD_conversion/lod1_to_lod2_mapping.npz"
            " LICENSE /opt/mhr-data/ && rm -rf /tmp/mhr",
        )
        .env(AVATAR_ENV)
    )


def weights_volume():
    import modal

    return modal.Volume.from_name(WEIGHTS_VOLUME, create_if_missing=True)
