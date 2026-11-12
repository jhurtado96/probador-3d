/**
 * Llamadas a las Edge Functions con la región fijada en eu-west-3 (RGPD, M3).
 *
 * No se usa `supabase.functions.invoke(..., { region })` porque, además del
 * parámetro `forceFunctionRegion`, envía la cabecera `x-region`, que las
 * funciones desplegadas no declaran en `Access-Control-Allow-Headers`: en el
 * navegador la petición previa CORS fallaría. El parámetro de la URL basta
 * para fijar la región (comprobado en `supabase/README.md`, M3). Ver
 * `docs/integration-issues.md`.
 */
import { ApiError, functionUrl, parseApiError } from './apiErrors';
import { FUNCTIONS_REGION, SUPABASE_KEY, SUPABASE_URL } from './config';
import { supabase } from './supabase';

type CallOptions = { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown };

/** Llama a la función y devuelve el texto de la respuesta 2xx (o lanza `ApiError`). */
export async function callFunctionText(name: string, { method = 'POST', body }: CallOptions = {}): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, 'unauthorized', 'no session');

  let res: Response;
  try {
    res = await fetch(functionUrl(SUPABASE_URL, name, FUNCTIONS_REGION), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_KEY,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, 'network', err instanceof Error ? err.message : 'network error');
  }
  const text = await res.text();
  if (!res.ok) throw parseApiError(res.status, text);
  return text;
}

export async function callFunction<T>(name: string, options?: CallOptions): Promise<T> {
  const text = await callFunctionText(name, options);
  return JSON.parse(text) as T;
}
