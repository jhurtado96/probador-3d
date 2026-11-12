/**
 * Jobs: creación con `create-job` (ticket de subida → subida única a la URL
 * firmada → aviso `create-job/uploaded`) y seguimiento de la fila de `jobs`
 * por Realtime con sondeo de respaldo.
 */
import type {
  AvatarJobInput,
  CreateJobRequest,
  CreateJobResponse,
  GarmentJobInput,
  Job,
  JobType,
  UploadTicket,
} from '@probador/contracts';
import { useEffect, useRef, useState } from 'react';

import { callFunction } from './api';
import { readBytes } from './bytes';
import { isTerminal } from './jobStatus';
import { supabase } from './supabase';
import { RAW_BUCKET, contentTypeFor, splitStoragePath } from './uploadPaths';

export type UploadStep = 'creating' | 'uploading' | 'dispatching';

/** Sube cada foto con su ticket (PUT único; la URL no admite una segunda subida). */
async function uploadAll(tickets: UploadTicket[], localUriByPath: Record<string, string>): Promise<void> {
  for (const ticket of tickets) {
    const uri = localUriByPath[ticket.path];
    if (!uri) throw new Error('El servidor pidió una foto que la app no tiene.');
    const { bucket, name } = splitStoragePath(ticket.path);
    if (bucket !== RAW_BUCKET) throw new Error('Destino de subida inesperado.');
    const bytes = await readBytes(uri);
    const { error } = await supabase.storage
      .from(RAW_BUCKET)
      .uploadToSignedUrl(name, ticket.token, bytes, { contentType: contentTypeFor(ticket.path), upsert: false });
    if (error) throw new Error('No se pudo subir la foto. Comprueba tu conexión y vuelve a intentarlo.');
  }
}

/**
 * Crea el job, sube las fotos y avisa para que se despache ya. Si el aviso
 * falla no pasa nada: pg_cron despacha los jobs con fotos en menos de un minuto.
 */
export async function createJobWithUploads(
  request: CreateJobRequest,
  localUriByPath: Record<string, string>,
  onStep?: (step: UploadStep) => void,
): Promise<Job> {
  onStep?.('creating');
  const created = await callFunction<CreateJobResponse>('create-job', { method: 'POST', body: request });
  if (created.uploads.length === 0) return created.job;

  onStep?.('uploading');
  await uploadAll(created.uploads, localUriByPath);

  onStep?.('dispatching');
  try {
    const { job } = await callFunction<{ job: Job }>('create-job/uploaded', {
      method: 'POST',
      body: { job_id: created.job.id },
    });
    return job;
  } catch {
    return created.job;
  }
}

export function createAvatarJob(input: AvatarJobInput, photoUri: string, onStep?: (s: UploadStep) => void) {
  return createJobWithUploads({ type: 'avatar', input }, { [input.photo_path]: photoUri }, onStep);
}

export function createGarmentJob(input: GarmentJobInput, photoUris: string[], onStep?: (s: UploadStep) => void) {
  const map: Record<string, string> = {};
  input.image_paths.forEach((p, i) => {
    map[p] = photoUris[i];
  });
  return createJobWithUploads({ type: 'garment', input }, map, onStep);
}

const JOB_COLUMNS =
  'id, user_id, type, status, progress, stage, input, output, error, attempts, worker_version, fake, input_deleted_at, created_at, started_at, finished_at';

export async function fetchJob(id: string): Promise<Job | null> {
  const { data, error } = await supabase.from('jobs').select(JOB_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as Job | null;
}

export async function fetchLatestJob(type: JobType): Promise<Job | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_COLUMNS)
    .eq('type', type)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Job | null;
}

const POLL_MS = 4000;

/**
 * Sigue un job: Realtime (la tabla `jobs` está en la publicación
 * `supabase_realtime` y RLS deja ver solo los propios) y, como respaldo,
 * sondeo cada 4 s hasta que termina.
 */
export function useJob(jobId: string | null, initial?: Job | null) {
  const [job, setJob] = useState<Job | null>(initial ?? null);
  const [error, setError] = useState<unknown>(null);
  const jobRef = useRef<Job | null>(job);
  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let active = true;
    const apply = (next: Job | null) => {
      if (!active || !next || next.id !== jobId) return;
      setJob((prev) => {
        // Realtime y el sondeo pueden llegar desordenados: nunca volver de terminal a no terminal.
        if (prev && prev.id === next.id && isTerminal(prev.status) && !isTerminal(next.status)) return prev;
        return next;
      });
    };
    if (initial && initial.id === jobId) setJob(initial);

    const refresh = () =>
      fetchJob(jobId)
        .then((j) => {
          setError(null);
          apply(j);
        })
        .catch((e) => active && setError(e));
    refresh();

    const channel = supabase
      .channel(`job-${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
        (payload) => apply(payload.new as Job),
      )
      .subscribe();

    const timer = setInterval(() => {
      const current = jobRef.current;
      if (current && current.id === jobId && isTerminal(current.status)) return;
      refresh();
    }, POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
    // `initial` solo se usa al cambiar de job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  return { job, error };
}
