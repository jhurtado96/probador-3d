"""Pipeline real del avatar con GPU: foto -> validación -> SAM 3D Body -> MHR en pose canónica -> altura/peso ->
medidas -> GLB. Solo se importa en la imagen de Modal del avatar (torch, torchvision y SAM 3D Body).

Privacidad: la foto solo existe en memoria (bytes -> array) y se suelta en cuanto SAM 3D Body ha estimado la forma;
nada de la foto se escribe en disco ni en los logs. Las salidas son parámetros, medidas y la malla en pose canónica.
"""

from __future__ import annotations

import contextlib
import gc
import io
import json
import logging
import os
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from ..errors import JobFailure
from ..logging_setup import log_event
from . import geometry, glb, measure, validate
from .output import AvatarResult, model_version

log = logging.getLogger("probador.avatar")

WEIGHTS_DIR = Path(os.environ.get("PROBADOR_AVATAR_WEIGHTS_DIR", "/weights"))
SAM3DB_VARIANT = os.environ.get("PROBADOR_SAM3DB_VARIANT", "vith")
SAM3DB_CODE_DIR = Path(os.environ.get("PROBADOR_SAM3DB_CODE_DIR", "/opt/sam-3d-body"))
SAM3DB_COMMIT = os.environ.get("PROBADOR_SAM3DB_COMMIT", "unknown")
MHR_DATA_DIR = Path(os.environ.get("PROBADOR_MHR_DATA_DIR", "/opt/mhr-data"))
EXPORT_LOD = int(os.environ.get("PROBADOR_AVATAR_EXPORT_LOD", "2"))  # LOD 2: 21.318 triángulos (presupuesto 25.000)
WEIGHT_FIT = os.environ.get("PROBADOR_AVATAR_WEIGHT_FIT", "1") == "1"

KP70 = {
    "nose": 0, "left_shoulder": 5, "right_shoulder": 6, "left_elbow": 7, "right_elbow": 8,
    "left_hip": 9, "right_hip": 10, "left_knee": 11, "right_knee": 12, "left_ankle": 13, "right_ankle": 14,
    "right_wrist": 41, "left_wrist": 62, "left_acromion": 67, "right_acromion": 68, "neck": 69,
}


# Aproximación de los puntos de referencia con las articulaciones de MHR (solo si no hay mapeo de keypoints de SAM 3D
# Body, p. ej. en la prueba con el MHR público). Los acromion se aproximan desde la articulación del brazo.
JOINT_LANDMARKS = {
    "neck": "c_neck", "left_shoulder": "l_uparm", "right_shoulder": "r_uparm", "left_elbow": "l_lowarm",
    "right_elbow": "r_lowarm", "left_wrist": "l_wrist", "right_wrist": "r_wrist", "left_hip": "l_upleg",
    "right_hip": "r_upleg", "left_knee": "l_lowleg", "right_knee": "r_lowleg", "left_ankle": "l_foot", "right_ankle": "r_foot",
}


def landmarks_from_joints(names: list[str], joints: np.ndarray) -> dict[str, np.ndarray]:
    """Puntos de referencia aproximados desde las articulaciones de MHR (mismas unidades que `joints`)."""
    j = {n: np.asarray(joints[i], dtype=np.float64) for i, n in enumerate(names)}
    out = {k: j[v] for k, v in JOINT_LANDMARKS.items()}
    out["nose"] = (j["l_eye"] + j["r_eye"]) / 2
    unit = np.linalg.norm(j["l_uparm"] - j["r_uparm"]) / 0.352  # escala relativa (cm o m)
    for s, sign in (("left", 1.0), ("right", -1.0)):
        out[f"{s}_acromion"] = out[f"{s}_shoulder"] + np.array([sign * 0.015, 0.035, 0.0]) * unit
    return out


def sam3db_dir() -> Path:
    return WEIGHTS_DIR / f"sam-3d-body-{SAM3DB_VARIANT}"


def read_manifest() -> dict:
    p = WEIGHTS_DIR / "manifest.json"
    return json.loads(p.read_text()) if p.is_file() else {}


@contextlib.contextmanager
def _quiet():
    """SAM 3D Body escribe con print(); se descarta para que los logs sigan siendo JSON sin datos de la foto."""
    with contextlib.redirect_stdout(io.StringIO()):
        yield


# ---------------------------------------------------------------------------
# MHR en pose canónica (también lo usa la prueba sin SAM 3D Body)
# ---------------------------------------------------------------------------


@dataclass
class RestBody:
    verts_cm: np.ndarray  # (N, 3) LOD 1, sistema nativo de MHR (cm, Y arriba)
    skel_state: np.ndarray  # (J, 8)
    landmarks: dict[str, np.ndarray]  # cm


class MhrRest:
    """Evalúa MHR (modelo TorchScript) en pose cero con la forma y las escalas estimadas."""

    def __init__(self, mhr, faces: np.ndarray, device, keypoint_mapping=None, scale_mean=None, scale_comps=None):
        import torch

        self.torch = torch
        self.mhr = mhr
        self.faces = np.asarray(faces, dtype=np.int64)
        self.device = device
        self.keypoint_mapping = keypoint_mapping  # (308, N + J) de la cabeza de SAM 3D Body
        self.scale_mean = scale_mean
        self.scale_comps = scale_comps
        self.faces_t = torch.as_tensor(self.faces, device=device)

    def model_params(self, scale):
        t = self.torch
        n_pose = 136
        if self.scale_mean is None:
            return t.zeros(1, 204, device=self.device)
        scales = self.scale_mean[None] + t.as_tensor(scale, dtype=t.float32, device=self.device)[None] @ self.scale_comps
        return t.cat([t.zeros(1, n_pose, device=self.device), scales], dim=1)

    def forward(self, shape_t, model_params):
        t = self.torch
        verts, skel = self.mhr(shape_t, model_params, t.zeros(1, 72, device=self.device))
        return verts[0], skel[0]

    def landmarks(self, verts_cm, skel):
        t = self.torch
        if self.keypoint_mapping is None:
            return {}
        vj = t.cat([verts_cm, skel[:, :3]], dim=0)
        kp = (self.keypoint_mapping @ vj)[:70]
        kp = kp.detach().cpu().numpy()
        return {name: kp[i] for name, i in KP70.items()}

    def rest(self, shape: np.ndarray, scale: np.ndarray | None) -> RestBody:
        t = self.torch
        with t.no_grad():
            shape_t = t.as_tensor(shape, dtype=t.float32, device=self.device)[None]
            v, s = self.forward(shape_t, self.model_params(scale))
            lm = self.landmarks(v, s)
        return RestBody(v.cpu().numpy().astype(np.float64), s.cpu().numpy().astype(np.float64), lm)

    def fit_weight(self, shape: np.ndarray, scale, height_m: float, weight_kg: float, steps: int = 60):
        """Ajusta los 20 coeficientes de identidad del cuerpo para que masa = densidad × volumen se acerque al peso
        declarado con la altura fija, con un prior gaussiano que penaliza alejarse de la estimación de SAM 3D Body.
        Devuelve (forma, error relativo de masa antes, después)."""
        t = self.torch
        mp = self.model_params(scale)
        base = t.as_tensor(shape, dtype=t.float32, device=self.device)[None]
        delta = t.zeros(1, 20, device=self.device, requires_grad=True)
        opt = t.optim.Adam([delta], lr=0.05)
        f = self.faces_t

        def mass_err():
            sh = base + t.nn.functional.pad(delta, (0, base.shape[1] - 20))
            v, _ = self.forward(sh, mp)
            v = v / 100.0
            h = v[:, 1].max() - v[:, 1].min()
            tri = v[f]
            vol = (tri[:, 0] * t.cross(tri[:, 1], tri[:, 2], dim=1)).sum().abs() / 6.0
            mass = geometry.DENSITY_KG_M3 * vol * (height_m / h) ** 3
            return (mass - weight_kg) / weight_kg

        with t.no_grad():
            before = float(mass_err())
        for _ in range(steps):
            opt.zero_grad()
            e = mass_err()
            loss = (e / 0.03) ** 2 + (delta ** 2).sum()
            loss.backward()
            opt.step()
        with t.no_grad():
            after = float(mass_err())
        out = (base + t.nn.functional.pad(delta, (0, base.shape[1] - 20))).detach().cpu().numpy()[0]
        return out, before, after


def load_lod_data(lod: int) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Caras de un LOD de MHR y su mapeo desde LOD 1 (ficheros del repositorio MHR, Apache 2.0)."""
    if lod == 1:
        return None
    topo = np.load(MHR_DATA_DIR / "lod_topology.npz")
    mapping = np.load(MHR_DATA_DIR / f"lod1_to_lod{lod}_mapping.npz")
    return topo[f"lod{lod}_faces"].astype(np.int64), mapping["triangle_ids"].astype(np.int64), mapping["baryc_coords"]


def rig_source(mhr) -> dict | None:
    """Nombres, padres y pesos de piel del modelo TorchScript de MHR (como hace su visor web); None si no los expone."""
    try:
        names = [str(n) for n in mhr.get_joint_names()]
        parents = np.array([int(p) for p in mhr.character_torch.skeleton.joint_parents], dtype=np.int64)
        idx, w = mhr.get_lbsw()
        return {"names": names, "parents": parents, "idx": idx.detach().cpu().numpy(), "w": w.detach().cpu().numpy()}
    except Exception as e:  # noqa: BLE001
        log_event(log, "avatar_rig_unavailable", level=logging.WARNING, error=type(e).__name__)
        return None


@dataclass
class BodyBuild:
    glb: bytes
    measurements_cm: dict[str, float]
    pose: str
    global_scale: float
    metrics: dict


def build_body(rest: RestBody, faces_lod1: np.ndarray, height_cm: float, rig: dict | None,
               lod: tuple | None) -> BodyBuild:
    """Pose canónica -> orientar a +Z, pies en el origen, escalar a la altura -> medidas (LOD 1) -> GLB (LOD de exportación)."""
    t0 = time.monotonic()
    v_m = rest.verts_cm / 100.0
    kp_m = {n: p / 100.0 for n, p in rest.landmarks.items()}
    R = geometry.facing_rotation(kp_m["nose"], kp_m["neck"])
    v_m, kp_m, R, t = geometry.normalize_placement(v_m, kp_m, R)
    v_m, kp_m, s = geometry.scale_to_height(v_m, kp_m, height_cm / 100.0)
    pose = geometry.canonical_pose_name(kp_m)
    res = measure.measure_body(v_m, faces_lod1, kp_m)
    t_measure = time.monotonic() - t0

    t1 = time.monotonic()
    if lod is not None:
        faces_out, tri_ids, bary = lod
        v_out = geometry.map_lod(v_m, faces_lod1, tri_ids, bary)
    else:
        faces_out, v_out = faces_lod1, v_m
    glb_rig = None
    if rig is not None:
        G = geometry.skeleton_state_to_matrices(rest.skel_state.copy())
        G[:, :3, 3] /= 100.0  # cm -> m
        G = geometry.transform_globals(G, R, t, s)
        if lod is not None:
            j_idx, j_w = geometry.map_skinning(rig["idx"], rig["w"], faces_lod1, tri_ids, bary, len(rig["names"]))
        else:
            j_idx, j_w = geometry.top4(rig["idx"], rig["w"])
        glb_rig = glb.Rig(rig["names"], rig["parents"], G, j_idx, j_w)
    data = glb.export_glb(v_out.astype(np.float32), faces_out, glb_rig, name="avatar")
    metrics = {
        "measure_s": round(t_measure, 3),
        "export_s": round(time.monotonic() - t1, 3),
        "vertices_lod1": int(len(v_m)),
        "vertices_glb": int(len(v_out)),
        "triangles_glb": int(len(faces_out)),
        "glb_bytes": len(data),
        "skinned": glb_rig is not None,
        "joints": len(rig["names"]) if rig else 0,
        "pose": pose,
        "measure_warnings": res.warnings,
        "measure_levels_m": {k: round(v, 3) for k, v in res.levels_m.items()},
    }
    return BodyBuild(data, res.measurements_cm, pose, s, metrics)


# ---------------------------------------------------------------------------
# Modelos (cargados una vez por contenedor)
# ---------------------------------------------------------------------------


class AvatarModels:
    _instance: "AvatarModels | None" = None
    _lock = threading.Lock()

    @classmethod
    def get(cls) -> "AvatarModels":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def __init__(self) -> None:
        t0 = time.monotonic()
        ckpt = sam3db_dir() / "model.ckpt"
        mhr_path = sam3db_dir() / "assets" / "mhr_model.pt"
        if not ckpt.is_file() or not mhr_path.is_file():
            raise JobFailure(
                "internal",
                "faltan los pesos de SAM 3D Body en el volumen de Modal: ejecuta el workflow «Avatar en Modal» "
                "con la tarea `weights` (necesita el Modal Secret `huggingface`)",
                retryable=False,
            )
        import torch
        import torchvision

        os.environ.setdefault("MOMENTUM_ENABLED", "0")  # usa el MHR TorchScript del checkpoint, sin pymomentum
        if str(SAM3DB_CODE_DIR) not in sys.path:
            sys.path.insert(0, str(SAM3DB_CODE_DIR))
        with _quiet():
            from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body

            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            if self.device.type != "cuda":
                raise JobFailure("internal", "el worker de avatar necesita GPU", retryable=True)
            model, cfg = load_sam_3d_body(str(ckpt), device=self.device, mhr_path=str(mhr_path))
            self.estimator = SAM3DBodyEstimator(sam_3d_body_model=model, model_cfg=cfg)
        head = model.head_pose
        self.rest = MhrRest(head.mhr, head.faces.detach().cpu().numpy(), self.device,
                            head.keypoint_mapping.detach(), head.scale_mean.detach(), head.scale_comps.detach())
        self.rig = rig_source(head.mhr)
        self.lod = load_lod_data(EXPORT_LOD)

        from torchvision.models.detection import KeypointRCNN_ResNet50_FPN_Weights, keypointrcnn_resnet50_fpn

        self.detector = keypointrcnn_resnet50_fpn(weights=KeypointRCNN_ResNet50_FPN_Weights.COCO_V1).to(self.device).eval()
        self.torch = torch
        manifest = read_manifest()
        self.model_version = model_version(SAM3DB_VARIANT, manifest.get("sam3db_revision", "unknown"), SAM3DB_COMMIT)
        self.load_s = round(time.monotonic() - t0, 2)
        self.jobs_served = 0
        log_event(log, "avatar_models_loaded", duration_ms=int(self.load_s * 1000), skinned=self.rig is not None,
                  torchvision=torchvision.__version__)

    def detect(self, img: np.ndarray) -> list[validate.Detection]:
        t = self.torch
        with t.no_grad():
            x = t.as_tensor(img, device=self.device).permute(2, 0, 1).float() / 255.0
            out = self.detector([x])[0]
            del x
        dets = []
        for i in range(len(out["scores"])):
            if int(out["labels"][i]) != 1:
                continue
            kps = t.cat([out["keypoints"][i][:, :2], out["keypoints_scores"][i][:, None]], dim=1)
            dets.append(validate.Detection(out["boxes"][i].cpu().numpy(), float(out["scores"][i]), kps.cpu().numpy()))
        return dets

    def estimate(self, img: np.ndarray, box: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        with _quiet():
            outs = self.estimator.process_one_image(img, bboxes=np.asarray(box, dtype=np.float32)[None], inference_type="body")
        if not outs:
            raise JobFailure("no_person_detected", "no se ha podido estimar el cuerpo en la foto")
        o = outs[0]
        return np.asarray(o["shape_params"], dtype=np.float64), np.asarray(o["scale_params"], dtype=np.float64)


def run_pipeline(photo: bytes | bytearray, height_cm: float, weight_kg: float | None, models: AvatarModels | None = None,
                 report: Callable[[str, float], None] | None = None) -> AvatarResult:
    """Ejecuta el pipeline completo. `photo` se consume: el llamador no debe guardar otra referencia."""
    report = report or (lambda stage, p: None)
    timings: dict[str, float] = {}
    t = time.monotonic()
    models = models or AvatarModels.get()
    cold = models.jobs_served == 0
    models.jobs_served += 1

    t = time.monotonic()
    img = validate.decode_image(bytes(photo))
    if isinstance(photo, bytearray):
        photo[:] = b"\0" * len(photo)
    del photo
    h_img, w_img = img.shape[:2]
    timings["decode_s"] = round(time.monotonic() - t, 3)
    report("validating_photo", 0.15)
    try:
        t = time.monotonic()
        det = validate.check_photo(models.detect(img), w_img, h_img)
        quality = validate.detection_quality(det)
        timings["detect_s"] = round(time.monotonic() - t, 3)
        report("estimating_body", 0.35)
        t = time.monotonic()
        shape, scale = models.estimate(img, det.box)
        timings["sam3db_s"] = round(time.monotonic() - t, 3)
    finally:
        img[...] = 0  # la foto deja de existir en memoria en cuanto hay forma estimada (o falla)
        del img
        gc.collect()
        models.torch.cuda.empty_cache()

    report("fitting_shape", 0.6)
    t = time.monotonic()
    weight_fit = "none"
    if weight_kg and WEIGHT_FIT:
        shape, before, after = models.rest.fit_weight(shape, scale, height_cm / 100.0, float(weight_kg))
        weight_fit = "converged" if abs(after) <= 0.05 else "partial"
        timings["weight_mass_err_before"] = round(before, 3)
        timings["weight_mass_err_after"] = round(after, 3)
    rest = models.rest.rest(shape, scale)
    timings["fit_s"] = round(time.monotonic() - t, 3)

    report("measuring", 0.75)
    try:
        body = build_body(rest, models.rest.faces, height_cm, models.rig, models.lod)
    except measure.MeasurementError as e:
        raise JobFailure("internal", f"no se pudieron tomar las medidas: {e}", retryable=False) from None
    metrics = {**timings, **body.metrics, "cold_start": cold, "model_load_s": models.load_s if cold else 0}
    params = [*map(float, shape), *map(float, scale), float(body.global_scale)]
    return AvatarResult(
        glb=body.glb,
        measurements_cm=body.measurements_cm,
        shape_params=params,
        pose=body.pose,
        model_version=models.model_version,
        detection_quality=quality,
        weight_fit=weight_fit,
        metrics=metrics,
    )
