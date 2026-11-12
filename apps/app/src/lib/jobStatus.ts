/**
 * Traduce una fila de `jobs` a lo que muestra la interfaz (fase, textos y si la
 * foto ya se borró). Sin dependencias de React Native: se prueba con
 * `node --test` (tests/jobStatus.test.ts).
 */
import type { Job, JobErrorCode, JobStatus, JobType } from '@probador/contracts';

export type JobPhase = JobStatus;

export type JobView = {
  phase: JobPhase;
  /** El job ya no cambia: se puede dejar de escuchar. */
  terminal: boolean;
  title: string;
  message: string;
  /** Avance 0–1 mientras está en curso; null si no aplica. */
  progress: number | null;
  /** Texto sobre la foto de entrada (borrada o pendiente de borrar); null si el job no tiene fotos. */
  photoNote: string | null;
  /** Tiene sentido volver a intentarlo con la misma foto. */
  retryable: boolean;
};

export type JobLike = Pick<Job, 'type' | 'status' | 'progress' | 'error' | 'input_deleted_at'> & {
  stage?: string | null;
};

const TERMINAL: readonly JobStatus[] = ['succeeded', 'failed', 'canceled'];

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL.includes(status);
}

const SUBJECT: Record<JobType, string> = {
  avatar: 'tu avatar',
  garment: 'tu prenda',
  drape: 'la prueba de la prenda',
  color: 'tu perfil de color',
};

const PHOTO: Record<JobType, string | null> = {
  avatar: 'tu foto',
  garment: 'las fotos de la prenda',
  color: 'tu selfie',
  drape: null,
};

const STAGES: Record<string, string> = {
  validating: 'Comprobando la foto',
  segmenting: 'Separando la silueta del fondo',
  fitting: 'Ajustando el modelo 3D',
  measuring: 'Calculando las medidas',
  exporting: 'Generando el modelo 3D',
  uploading: 'Guardando el resultado',
};

/** Mensaje para el usuario según el código de error del job. */
export function jobErrorMessage(code: JobErrorCode, type: JobType): string {
  switch (code) {
    case 'not_implemented':
      return type === 'avatar'
        ? 'El generador de avatares todavía no está disponible.'
        : type === 'garment'
          ? 'El procesado de prendas todavía no está disponible.'
          : 'Esta función todavía no está disponible.';
    case 'no_person_detected':
      return 'No hemos encontrado a ninguna persona en la foto. Asegúrate de salir de cuerpo entero.';
    case 'multiple_people':
      return 'Aparece más de una persona en la foto. Haz la foto tú solo/a.';
    case 'pose_invalid':
      return 'La pose no es la correcta: ponte de frente con los brazos algo separados del cuerpo (pose A).';
    case 'body_not_fully_visible':
      return 'No se te ve de la cabeza a los pies. Aléjate un poco de la cámara.';
    case 'no_face_detected':
      return 'No hemos encontrado una cara en el selfie.';
    case 'white_reference_missing':
      return 'No vemos la referencia de blanco (folio o tarjeta gris).';
    case 'garment_not_detected':
      return 'No hemos encontrado ninguna prenda en la foto.';
    case 'person_detected':
      return 'En la foto de la prenda aparece una persona. Fotografía la prenda sola, extendida o en una percha.';
    case 'low_image_quality':
      return 'La foto tiene poca calidad (oscura, movida o borrosa). Prueba con más luz.';
    case 'consent_missing':
      return 'Falta tu consentimiento para este tratamiento.';
    case 'quota_exceeded':
      return 'Has alcanzado el límite diario de procesamientos. Inténtalo mañana.';
    case 'timeout':
      return 'El procesamiento tardó demasiado y se canceló.';
    case 'invalid_input':
      return 'Algún dato enviado no es válido.';
    case 'internal':
    default:
      return 'Ha fallado algo en el servidor.';
  }
}

function photoNote(job: JobLike): string | null {
  const photo = PHOTO[job.type];
  if (!photo) return null;
  if (job.input_deleted_at) return `${capitalize(photo)} ya se ha borrado.`;
  if (isTerminal(job.status)) return `${capitalize(photo)} se borrará automáticamente en menos de una hora.`;
  return `${capitalize(photo)} se borrará en cuanto termine el procesamiento.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function describeJob(job: JobLike): JobView {
  const subject = SUBJECT[job.type];
  const note = photoNote(job);
  const base = { phase: job.status, terminal: isTerminal(job.status), photoNote: note };
  switch (job.status) {
    case 'queued':
      return {
        ...base,
        title: 'En cola',
        message: `Hemos recibido la petición; ${subject} empezará a procesarse en breve.`,
        progress: null,
        retryable: false,
      };
    case 'running': {
      const stage = job.stage ? STAGES[job.stage] : undefined;
      return {
        ...base,
        title: 'Procesando',
        message: stage ? `${stage}…` : `Estamos generando ${subject}…`,
        progress: clamp01(Number(job.progress)),
        retryable: false,
      };
    }
    case 'succeeded':
      return {
        ...base,
        title: 'Listo',
        message: `¡${capitalize(subject)} está listo!`,
        progress: 1,
        retryable: false,
      };
    case 'canceled':
      return {
        ...base,
        title: 'Cancelado',
        message: 'El procesamiento se canceló.',
        progress: null,
        retryable: false,
      };
    case 'failed': {
      const code = job.error?.code ?? 'internal';
      return {
        ...base,
        title: code === 'not_implemented' ? 'Todavía no disponible' : 'No se pudo completar',
        message: jobErrorMessage(code, job.type),
        progress: null,
        retryable: code !== 'not_implemented' && (job.error?.retryable ?? false),
      };
    }
  }
}
