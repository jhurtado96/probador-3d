"""Herramientas del worker de avatar en Modal (app `probador-avatar-tools`, sin secretos). Se lanzan desde el workflow
manual «Avatar en Modal» (.github/workflows/avatar-modal.yml):

    modal run modal_avatar_tools.py::fetch_public_assets   # pesos del detector + assets públicos de MHR al volumen
    modal run modal_avatar_tools.py::probe_mhr             # MHR sin SAM 3D Body: pose canónica, medidas y GLB
    modal run modal_avatar_tools.py::smoke_avatar          # pipeline completo con una foto pública (CC0 / dominio público)

La prueba completa no usa Supabase ni datos de usuarios: descarga DENTRO de Modal una foto de cuerpo entero con licencia
CC0 o de dominio público de Wikimedia Commons y escribe en el log solo métricas (tiempos, medidas, nº de vértices,
tamaño del GLB), nunca la imagen.
"""

from __future__ import annotations

import json
import os

import modal

from probador_workers.avatar import deploy as d
from probador_workers.schemas import schemas_dir

REGION = os.environ.get("PROBADOR_MODAL_REGION", "eu")
GPU = d.gpu_spec(os.environ.get("PROBADOR_GPU_AVATAR", "L4,A10G"))
image = (
    d.avatar_base_image(d.BASE_PIP)
    .env({"PROBADOR_SCHEMAS_DIR": "/contracts/schemas"})
    .add_local_dir(str(schemas_dir()), remote_path="/contracts/schemas")
    .add_local_python_source("probador_workers")
)
volume = d.weights_volume()
app = modal.App("probador-avatar-tools", image=image)
VOL = {d.WEIGHTS_MOUNT: volume}
MHR_PUBLIC = f"{d.WEIGHTS_MOUNT}/mhr-v1.0.1"
UA = {"User-Agent": "probador-avatar-smoke/0.1 (prueba automatizada)"}

# Fotos públicas candidatas (Wikimedia Commons). Se comprueba la licencia en tiempo de ejecución con la API de Commons.
COMMONS_QUERIES = (
    "full length portrait standing man",
    "full length portrait standing woman",
    "full-length photograph person standing",
    "standing man full body",
)
PUBLIC_LICENSES = ("cc0", "public domain", "pd")
# Foto por defecto: retrato de cuerpo entero, de frente, de dominio público (Library of Congress, LCCN 99615637),
# elegida porque pasó la validación en la primera prueba. La licencia se vuelve a comprobar con la API en cada ejecución.
DEFAULT_TITLES = ("File:Full-length portrait of Transcaucasian man, standing, facing front LCCN99615637.jpg",)


def _emit(tag: str, payload: dict) -> None:
    print(f"[{tag}] " + json.dumps(payload, ensure_ascii=False, default=str), flush=True)


@app.function(volumes=VOL, region=REGION, timeout=1800)
def fetch_public_assets() -> dict:
    """Pesos COCO de Keypoint R-CNN (torchvision) y `mhr_model.pt` de la release v1.0.1 de MHR, al volumen."""
    import hashlib
    import tempfile
    import time
    import zipfile
    from pathlib import Path

    import httpx

    t0 = time.monotonic()
    os.makedirs(os.environ["TORCH_HOME"], exist_ok=True)
    from torchvision.models.detection import KeypointRCNN_ResNet50_FPN_Weights

    KeypointRCNN_ResNet50_FPN_Weights.COCO_V1.get_state_dict(progress=False)
    out = {"keypointrcnn": "ok"}
    dest = Path(MHR_PUBLIC)
    if not (dest / "mhr_model.pt").is_file():
        dest.mkdir(parents=True, exist_ok=True)
        h = hashlib.sha256()
        with tempfile.NamedTemporaryFile(suffix=".zip") as tmp:
            with httpx.stream("GET", d.MHR_ASSETS_URL, follow_redirects=True, timeout=600, headers=UA) as r:
                r.raise_for_status()
                for chunk in r.iter_bytes(1 << 20):
                    h.update(chunk)
                    tmp.write(chunk)
            tmp.flush()
            if h.hexdigest() != d.MHR_ASSETS_SHA256:
                raise SystemExit("assets.zip de MHR con sha256 inesperado")
            with zipfile.ZipFile(tmp.name) as z:
                for member in ("assets/mhr_model.pt", "assets/LICENSE.txt"):
                    (dest / Path(member).name).write_bytes(z.read(member))
    out["mhr_public"] = sorted(p.name for p in dest.iterdir())
    volume.commit()
    out["seconds"] = round(time.monotonic() - t0, 1)
    _emit("assets", out)
    return out


@app.function(volumes=VOL, gpu=GPU, region=REGION, timeout=900)
def probe_mhr() -> dict:
    """Comprueba la parte MHR del pipeline con el modelo público (sin SAM 3D Body ni fotos)."""
    import time

    import numpy as np
    import torch

    from probador_workers.avatar import geometry, glb
    from probador_workers.avatar.pipeline import MhrRest, RestBody, build_body, landmarks_from_joints, load_lod_data, rig_source

    # Las dependencias de SAM 3D Body están en la imagen (sin pesos no se puede construir el modelo)
    import sys

    sys.path.insert(0, os.environ["PROBADOR_SAM3DB_CODE_DIR"])
    t0 = time.monotonic()
    import sam_3d_body
    from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body  # noqa: F401
    from sam_3d_body.models.meta_arch import SAM3DBody  # noqa: F401

    _emit("probe_sam3db_import", {"version": sam_3d_body.__version__, "seconds": round(time.monotonic() - t0, 2),
                                  "torch": torch.__version__, "cuda": torch.version.cuda,
                                  "gpu": torch.cuda.get_device_name(0)})
    t0 = time.monotonic()
    dev = torch.device("cuda")
    mhr = torch.jit.load(f"{MHR_PUBLIC}/mhr_model.pt", map_location=dev).eval()
    load_s = time.monotonic() - t0
    faces = mhr.character_torch.mesh.faces.detach().cpu().numpy()
    names = [str(n) for n in mhr.get_joint_names()]
    params = [str(n) for n in mhr.get_parameter_names()]
    rest = MhrRest(mhr, faces, dev)
    body = rest.rest(np.zeros(45), None)
    v = body.verts_cm / 100
    joints = body.skel_state[:, :3] / 100
    rig = rig_source(mhr)
    info = {
        "load_s": round(load_s, 2),
        "vertices": len(v), "faces": len(faces), "watertight": geometry.is_watertight(faces),
        "extent_m": np.ptp(v, axis=0).round(3).tolist(), "min_m": v.min(axis=0).round(3).tolist(),
        "volume_m3": round(geometry.mesh_volume(v, faces), 4),
        "joints": len(names), "rig": rig is not None, "n_params": len(params),
    }
    _emit("probe_mhr", info)
    _emit("probe_joint_names", {"names": names})
    _emit("probe_joint_positions_m", {n: joints[i].round(3).tolist() for i, n in enumerate(names)})
    _emit("probe_param_names", {"names": params})
    t1 = time.monotonic()
    shape, before, after = rest.fit_weight(np.zeros(45), None, 1.75, 85.0)
    _emit("probe_weight_fit", {"seconds": round(time.monotonic() - t1, 2), "mass_err_before": round(before, 3),
                               "mass_err_after": round(after, 3), "delta_norm": round(float(np.linalg.norm(shape)), 3)})
    lod = load_lod_data(2)
    # Medición sobre la malla real de MHR con puntos de referencia aproximados desde las articulaciones (sin SAM 3D Body)
    for label, coeff in (("neutral", 0.0), ("body0_plus", 1.5), ("body0_minus", -1.5), ("body1_plus", 1.5)):
        shp = np.zeros(45)
        shp[1 if label.startswith("body1") else 0] = coeff
        rb = rest.rest(shp, None)
        rb = RestBody(rb.verts_cm, rb.skel_state, landmarks_from_joints(names, rb.skel_state[:, :3]))
        for height in (175.0, 160.0):
            t2 = time.monotonic()
            built = build_body(rb, faces, height, rig, lod)
            _emit("probe_measure", {"shape": label, "height_cm": height, "seconds": round(time.monotonic() - t2, 2),
                                    "pose": built.pose, "measurements_cm": built.measurements_cm,
                                    "warnings": built.metrics["measure_warnings"],
                                    "levels_m": built.metrics["measure_levels_m"], "glb_bytes": built.metrics["glb_bytes"]})
    if rig is not None:
        G = geometry.skeleton_state_to_matrices(body.skel_state.copy())
        G[:, :3, 3] /= 100
        j_idx, j_w = geometry.map_skinning(rig["idx"], rig["w"], faces, lod[1], lod[2], len(rig["names"]))
        data = glb.export_glb(geometry.map_lod(v, faces, lod[1], lod[2]).astype(np.float32), lod[0],
                              glb.Rig(rig["names"], rig["parents"], G, j_idx, j_w))
        doc, _ = glb.read_glb(data)
        _emit("probe_glb", {"bytes": len(data), "triangles": len(lod[0]), "nodes": len(doc["nodes"])})
    return info


def _commons_pages(params: dict) -> list[dict]:
    import httpx

    base = {"action": "query", "format": "json", "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": 1600}
    r = httpx.get("https://commons.wikimedia.org/w/api.php", params={**base, **params}, headers=UA, timeout=30)
    r.raise_for_status()
    out = []
    for page in (r.json().get("query", {}).get("pages", {}) or {}).values():
        ii = (page.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata", {})
        lic = (meta.get("LicenseShortName", {}).get("value") or meta.get("License", {}).get("value") or "").lower()
        if ii.get("mime") != "image/jpeg":
            continue
        if not any(lic.startswith(p) or p in lic for p in PUBLIC_LICENSES) or "cc-by" in lic or "cc by" in lic:
            continue  # solo CC0 o dominio público, comprobado en los metadatos de Commons
        if ii.get("height", 0) < 1.3 * ii.get("width", 1):
            continue  # retrato vertical: probablemente de cuerpo entero
        out.append({"title": page["title"], "license": lic, "url": ii.get("thumburl") or ii["url"],
                    "page": ii.get("descriptionurl")})
    return out


def _commons_candidates(limit: int = 12) -> list[dict]:
    out = _commons_pages({"titles": "|".join(DEFAULT_TITLES)})
    seen = {c["title"] for c in out}
    for q in COMMONS_QUERIES:
        for c in _commons_pages({"generator": "search", "gsrnamespace": 6, "gsrsearch": f"{q} filetype:bitmap", "gsrlimit": 40}):
            if c["title"] not in seen:
                seen.add(c["title"])
                out.append(c)
            if len(out) >= limit:
                return out
    return out


def _validation_only(image_url: str) -> dict:
    """Sin pesos de SAM 3D Body: prueba al menos descarga, decodificación y validación de la foto con el detector."""
    import time

    import httpx
    import torch

    from probador_workers.avatar import validate
    from probador_workers.avatar.pipeline import PersonDetector
    from probador_workers.errors import JobFailure

    t0 = time.monotonic()
    det = PersonDetector(torch.device("cuda"))
    load_s = round(time.monotonic() - t0, 2)
    candidates = [{"title": "parámetro", "license": "(declarada por quien lanza la prueba)", "url": image_url}] if image_url \
        else _commons_candidates()
    results = []
    for cand in candidates:
        photo = httpx.get(cand["url"], headers=UA, timeout=60, follow_redirects=True).content
        t = time.monotonic()
        try:
            img = validate.decode_image(photo)
            main = validate.check_photo(det.detect(img), img.shape[1], img.shape[0])
            verdict = {"ok": True, "quality": round(validate.detection_quality(main), 3)}
        except JobFailure as e:
            verdict = {"ok": False, "code": e.code}
        finally:
            del photo
        results.append({"title": cand["title"], "license": cand.get("license"), "page": cand.get("page"),
                        "seconds": round(time.monotonic() - t, 3), **verdict})
    report = {"mode": "validation_only", "detector_load_s": load_s, "candidates": results,
              "blocked_by": "faltan los pesos de SAM 3D Body (Modal Secret `huggingface`)"}
    _emit("smoke_validation_only", report)
    return report


@app.function(volumes=VOL, gpu=GPU, region=REGION, timeout=1200)
def smoke_avatar(image_url: str = "", height_cm: float = 175.0, weight_kg: float = 0.0) -> dict:
    """Pipeline completo con una foto pública: dos pasadas (en frío y en caliente) y solo métricas en el log."""
    import time

    import httpx

    from probador_workers.avatar import glb
    from probador_workers.avatar.output import build_output, confidence, sigmas
    from probador_workers.avatar.pipeline import AvatarModels, run_pipeline
    from probador_workers.errors import JobFailure
    from probador_workers.schemas import validate_callback

    t0 = time.monotonic()
    try:
        models = AvatarModels.get()
    except JobFailure as e:
        _emit("smoke_blocked", {"code": e.code, "message": str(e)})
        return _validation_only(image_url)
    cold_load = round(time.monotonic() - t0, 2)
    _emit("smoke_models", {"load_s": cold_load, "model_version": models.model_version, "rig": models.rig is not None})
    candidates = [{"title": "parámetro", "license": "(declarada por quien lanza la prueba)", "url": image_url}] if image_url \
        else _commons_candidates()
    _emit("smoke_candidates", {"n": len(candidates)})
    for cand in candidates:
        photo = httpx.get(cand["url"], headers=UA, timeout=60, follow_redirects=True).content
        try:
            runs = []
            for attempt in ("cold", "warm"):
                t = time.monotonic()
                res = run_pipeline(bytearray(photo), height_cm, weight_kg or None, models=models)
                runs.append({"run": attempt, "total_s": round(time.monotonic() - t, 2), **res.metrics})
        except JobFailure as e:
            _emit("smoke_rejected", {"title": cand["title"], "code": e.code, "message": str(e)})
            continue
        finally:
            del photo
        inp = {"photo_path": "raw-uploads/smoke/p.jpg", "height_cm": height_cm, "consent_id": "00000000-0000-4000-8000-000000000000"}
        if weight_kg:
            inp["weight_kg"] = weight_kg
        out = build_output("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", inp,
                           "storage://assets/smoke/avatars/a.glb", res)
        validate_callback({"job_id": "00000000-0000-4000-8000-000000000003", "attempt": 1, "worker_version": "avatar-smoke",
                           "status": "succeeded", "progress": 1, "output": out}, "avatar")
        doc, _ = glb.read_glb(res.glb)
        acc = doc["accessors"][doc["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
        report = {
            "photo": {k: cand[k] for k in ("title", "license", "page") if k in cand},
            "height_cm_declared": height_cm, "weight_kg_declared": weight_kg or None,
            "measurements_cm": res.measurements_cm, "sigma_cm": sigmas(res), "confidence": confidence(res),
            "pose": res.pose, "weight_fit": res.weight_fit, "model_version": res.model_version,
            "glb": {"bytes": len(res.glb), "bbox_min": acc["min"], "bbox_max": acc["max"], "skins": len(doc.get("skins", []))},
            "runs": runs, "models_load_s": cold_load, "output_schema": "ok",
        }
        _emit("smoke_report", report)
        return report
    raise SystemExit("ninguna foto candidata pasó la validación")


@app.local_entrypoint()
def main(task: str = "probe", image_url: str = "", height_cm: float = 175.0, weight_kg: float = 0.0) -> None:
    if task in ("assets", "all"):
        fetch_public_assets.remote()
    if task in ("probe", "all"):
        probe_mhr.remote()
    if task in ("smoke", "all"):
        smoke_avatar.remote(image_url, height_cm, weight_kg)
