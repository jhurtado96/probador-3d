import { useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';

import { Banner, Button, Muted } from '@/components/ui';
import { discardLocalFile, pickPhoto, preparePhoto, type LocalPhoto } from '@/lib/photo';
import { useAppTheme } from '@/theme/useAppTheme';

type Props = {
  photo: LocalPhoto | null;
  onChange: (photo: LocalPhoto | null) => void;
  disabled?: boolean;
  /** Relación alto/ancho de la vista previa (cuerpo entero: vertical). */
  previewAspect?: number;
};

/**
 * Elegir o hacer una foto. La foto se prepara al momento (≤ 2048 px, JPEG sin
 * metadatos) y solo vive en la caché de la app hasta que se sube o se quita.
 */
export function PhotoPicker({ photo, onChange, disabled, previewAspect = 4 / 3 }: Props) {
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (source: 'camera' | 'library') => {
    setError(null);
    setBusy(true);
    try {
      const result = await pickPhoto(source);
      if ('denied' in result) {
        setError('Necesitamos permiso para usar la cámara. Puedes darlo en los ajustes del sistema o elegir una foto.');
        return;
      }
      if ('canceled' in result) return;
      const prepared = await preparePhoto(result.photo);
      if (photo) await discardLocalFile(photo.uri);
      onChange(prepared);
    } catch {
      setError('No se pudo preparar la foto. Prueba con otra.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (photo) await discardLocalFile(photo.uri);
    onChange(null);
  };

  return (
    <View style={styles.box}>
      {photo ? (
        <View style={[styles.previewWrap, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
          <Image
            source={{ uri: photo.uri }}
            style={{ width: '100%', aspectRatio: 1 / previewAspect }}
            resizeMode="contain"
            accessibilityLabel="Vista previa de la foto elegida"
          />
        </View>
      ) : null}
      <View style={styles.row}>
        <View style={styles.grow}>
          <Button
            label={Platform.OS === 'web' ? 'Cámara' : 'Hacer foto'}
            icon="camera-outline"
            variant="secondary"
            disabled={disabled || busy}
            onPress={() => choose('camera')}
          />
        </View>
        <View style={styles.grow}>
          <Button
            label={Platform.OS === 'web' ? 'Elegir archivo' : 'Galería'}
            icon="images-outline"
            variant="secondary"
            disabled={disabled || busy}
            loading={busy}
            onPress={() => choose('library')}
          />
        </View>
      </View>
      {photo ? <Button label="Quitar foto" variant="secondary" icon="trash-outline" onPress={remove} disabled={disabled} /> : null}
      {photo ? <Muted>Foto preparada: {photo.width}×{photo.height} px, sin metadatos (ni ubicación ni modelo del móvil).</Muted> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
  previewWrap: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
});
