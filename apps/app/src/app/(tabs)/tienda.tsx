import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';

export default function TiendaScreen() {
  return (
    <Screen
      title="Tienda"
      subtitle="Recomendaciones de tiendas según tu talla, el fit que prefieres y tu colorimetría."
    >
      <EmptyState
        icon="bag-handle-outline"
        title="Aún no hay recomendaciones"
        description="Para recomendarte tallas y prendas necesitamos tus medidas. Empieza por la pestaña Escanear."
        hint="Las recomendaciones se calcularán a partir de tus medidas reales, no de tu foto."
      />
    </Screen>
  );
}
