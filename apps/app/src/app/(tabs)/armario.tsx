import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';

export default function ArmarioScreen() {
  return (
    <Screen
      title="Tu armario"
      subtitle="Aquí aparecerán tus prendas digitalizadas en 3D para combinarlas sobre tu avatar."
    >
      <EmptyState
        icon="shirt-outline"
        title="Tu armario está vacío"
        description="Todavía no has añadido ninguna prenda."
        hint="Próximamente: sube fotos de tu ropa y la convertiremos en prendas 3D (glTF) con su talla y medidas."
      />
    </Screen>
  );
}
