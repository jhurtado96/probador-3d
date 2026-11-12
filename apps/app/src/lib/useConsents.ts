import type { Consent, ConsentPurpose, ConsentText, Profile } from '@probador/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchActiveConsents, fetchCurrentConsentTexts, fetchProfile } from './consents';

export type ConsentsState = {
  texts: Partial<Record<ConsentPurpose, ConsentText>>;
  active: Partial<Record<ConsentPurpose, Consent>>;
  profile: Profile | null;
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
};

/** Textos vigentes, consentimientos activos y perfil; se recarga al volver a la pantalla. */
export function useConsents(): ConsentsState {
  const [texts, setTexts] = useState<ConsentsState['texts']>({});
  const [active, setActive] = useState<ConsentsState['active']>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    try {
      const [t, a, p] = await Promise.all([fetchCurrentConsentTexts(), fetchActiveConsents(), fetchProfile()]);
      setTexts(t);
      setActive(a);
      setProfile(p);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { texts, active, profile, loading, error, reload };
}

export const PURPOSE_INFO: Record<ConsentPurpose, { title: string; onWithdraw: string }> = {
  body_scan: {
    title: 'Escaneo corporal',
    onWithdraw: 'Se borrarán tu avatar y las medidas calculadas a partir de tus fotos.',
  },
  color_analysis: {
    title: 'Colorimetría (selfie)',
    onWithdraw: 'Se borrará tu perfil de color completo, también si corregiste la estación a mano.',
  },
  personalization: {
    title: 'Personalización y recomendaciones',
    onWithdraw: 'Se borrarán las recomendaciones calculadas para ti.',
  },
  analytics: { title: 'Analítica de uso', onWithdraw: 'Dejaremos de recoger datos de uso de la app.' },
};

export const PURPOSE_ORDER: ConsentPurpose[] = ['body_scan', 'color_analysis', 'personalization', 'analytics'];

/** Tratamientos que procesan fotos de la persona: exigen declarar la mayoría de edad. */
export const PHOTO_PURPOSES: ConsentPurpose[] = ['body_scan', 'color_analysis'];
