"""Descarga ÚNICA de los pesos de SAM 3D Body (Hugging Face, acceso restringido) al volumen de Modal del avatar.

    modal run modal_avatar_weights.py            # o el workflow «Avatar en Modal» con la tarea `weights`

Es una app aparte (`probador-avatar-weights`) porque es lo único que usa el Modal Secret `huggingface` (HF_TOKEN):
si el secreto aún no existe, falla solo esto y el despliegue de `probador-workers` sigue funcionando. El token no se
usa en ningún otro sitio; los workers leen los pesos del volumen con HF_HUB_OFFLINE=1.
"""

from __future__ import annotations

import os

import modal

from probador_workers.avatar import deploy as d

REGION = os.environ.get("PROBADOR_MODAL_REGION", "eu")
image = d.avatar_base_image(d.BASE_PIP).add_local_python_source("probador_workers")
volume = d.weights_volume()
app = modal.App("probador-avatar-weights", image=image)


@app.function(volumes={d.WEIGHTS_MOUNT: volume}, secrets=[modal.Secret.from_name(d.HF_SECRET)], region=REGION, timeout=3600)
def download_sam3db(revision: str = "") -> dict:
    """Descarga `facebook/sam-3d-body-<variante>` (model.ckpt, model_config.yaml, assets/mhr_model.pt) y anota la revisión."""
    import json
    import time
    from pathlib import Path

    os.environ["HF_HUB_OFFLINE"] = "0"
    token = next((os.environ[k].strip() for k in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN") if os.environ.get(k, "").strip()), "")
    if not token:
        # Solo nombres de variables con pinta de token (nunca valores) para ayudar a corregir el secreto
        names = sorted(k for k in os.environ if any(t in k.upper() for t in ("HF", "HUGGING", "TOKEN")))
        raise SystemExit(
            f"El Modal Secret no tiene la clave HF_TOKEN (claves parecidas encontradas: {names or 'ninguna'}). "
            f"Crea el secreto `huggingface` con HF_TOKEN=<token de lectura> de una cuenta que haya aceptado la licencia "
            f"de https://huggingface.co/{d.SAM3DB_HF_REPO}"
        )
    from huggingface_hub import HfApi, snapshot_download
    from huggingface_hub.errors import GatedRepoError, HfHubHTTPError, RepositoryNotFoundError

    dest = Path(d.WEIGHTS_MOUNT) / f"sam-3d-body-{d.SAM3DB_VARIANT}"
    t0 = time.monotonic()
    try:
        info = HfApi(token=token).model_info(d.SAM3DB_HF_REPO, revision=revision or None)
        snapshot_download(d.SAM3DB_HF_REPO, revision=info.sha, local_dir=str(dest), token=token,
                          allow_patterns=["model.ckpt", "model_config.yaml", "assets/*", "LICENSE*", "README.md"])
    except (GatedRepoError, RepositoryNotFoundError):
        raise SystemExit(
            f"Hugging Face deniega el acceso a {d.SAM3DB_HF_REPO}: acepta la licencia en "
            f"https://huggingface.co/{d.SAM3DB_HF_REPO} con la cuenta del token y espera a que Meta la apruebe"
        ) from None
    except HfHubHTTPError as e:
        raise SystemExit(f"Error de Hugging Face al descargar {d.SAM3DB_HF_REPO}: {type(e).__name__}") from None
    files = {str(p.relative_to(dest)): p.stat().st_size for p in dest.rglob("*") if p.is_file() and ".cache" not in p.parts}
    manifest_path = Path(d.WEIGHTS_MOUNT) / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {}
    manifest.update({
        "sam3db_repo": d.SAM3DB_HF_REPO,
        "sam3db_revision": info.sha,
        "sam3db_files": files,
        "sam3db_downloaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    manifest_path.write_text(json.dumps(manifest, indent=2))
    volume.commit()
    summary = {"repo": d.SAM3DB_HF_REPO, "revision": info.sha, "files": files, "seconds": round(time.monotonic() - t0, 1)}
    print(json.dumps(summary, indent=2))
    return summary


@app.local_entrypoint()
def main(revision: str = "") -> None:
    download_sam3db.remote(revision)
