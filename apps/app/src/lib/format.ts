/** Fecha corta en español (p. ej. «12 nov 2026, 13:05»). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 16);
  }
}
