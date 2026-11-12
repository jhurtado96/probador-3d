"""Pipeline real del job `avatar` (fase 0, prototipo P1a): foto + altura -> SAM 3D Body -> MHR -> medidas + GLB.

Los módulos `measure`, `glb`, `geometry`, `validate` y `output` solo usan numpy (se prueban sin GPU). `pipeline` carga
torch, SAM 3D Body y MHR, y solo se importa dentro de la imagen de Modal del avatar.
"""

PIPELINE_VERSION = "avatar-p0.1"
