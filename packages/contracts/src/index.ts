/**
 * @probador/contracts
 *
 * Contrato único entre la app (Expo), la API (Supabase Edge Functions) y los
 * workers GPU (Python). Convenciones:
 *
 * - Los campos van en snake_case: es el formato de cable y también el de las
 *   filas de Postgres, así que no hay capa de mapeo en cliente ni en Python.
 * - Longitudes en centímetros (sufijo `_cm`), pesos en kilogramos (`_kg`).
 * - Colores medidos en CIELAB (D65); colores para pintar en hex sRGB.
 * - Fechas en ISO 8601 UTC. Identificadores UUID v4/v7.
 * - Los JSON Schemas de `schemas/` se GENERAN desde este fichero
 *   (`npm run schemas`); no se editan a mano.
 *
 * Ficheros en Storage: `*_url` (contrato) frente a `*_path` (base de datos)
 * ------------------------------------------------------------------------
 * Los campos `*_url` de las entidades que apuntan a Storage privado tienen
 * tres representaciones, según dónde viaje el dato:
 *
 * 1. Worker → API (`JobCallback.output`): una referencia
 *    `storage://<StoragePath>` con la ruta exacta de `output_uploads[].path`
 *    (tipo `StorageRef`). El worker nunca inventa rutas. `jobs.output` no
 *    guarda la salida del worker, solo ids (`JobResult`).
 * 2. Postgres: la RUTA, en una columna `*_path` (ver `STORAGE_URL_COLUMNS`).
 *    Es lo que la app lee con PostgREST.
 * 3. App: una URL https firmada y temporal, que la app obtiene firmando la
 *    ruta (`storage.from(bucket).createSignedUrl(ruta sin bucket, ttl)`).
 *    No se persiste.
 *
 * Los tipos de este fichero describen la forma de cable (1 y 3). Una fila de
 * Postgres es el mismo objeto con cada `X_url` sustituido por `X_path`.
 *
 * Estado: todos los tipos que tienen tabla (`Profile`, `Consent`, `Avatar`,
 * `ColorProfile`, `Garment`, `FitResult`, `UserFitPreferences`, `Outfit`,
 * `StoreProduct`, `DrapeCache`, `Job`) usan los nombres de columna de la tabla.
 */

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------

/**
 * Identificador UUID.
 * @format uuid
 */
export type UUID = string;

/**
 * Fecha y hora ISO 8601 en UTC.
 * @format date-time
 */
export type ISODateTime = string;

/**
 * Color sRGB en hexadecimal, `#RRGGBB`.
 * @pattern ^#[0-9A-Fa-f]{6}$
 */
export type HexColor = string;

/**
 * URL absoluta. Siempre `https://` fuera del desarrollo local (en local se
 * admite `http://localhost`). Para objetos privados de Storage es una URL
 * firmada que caduca: no se persiste en cliente más allá de la sesión.
 *
 * En `JobCallback.output` y en `jobs.output`, los campos `*_url` de artefactos
 * de Storage NO son https: llevan un `StorageRef` (`storage://<ruta>`), que
 * también es una URI válida. Ver la cabecera del fichero.
 * @format uri
 */
export type Url = string;

/** Prefijo de las referencias a Storage en callbacks y en `jobs.output`. */
export const STORAGE_REF_PREFIX = "storage://";

/**
 * Referencia a un objeto de Storage: `storage://<StoragePath>`.
 * @pattern ^storage://[^/]+/.+
 */
export type StorageRef = string;

/**
 * Campo `*_url` del contrato → columna `*_path` de Postgres que guarda su ruta.
 * `StoreProduct.image_urls` y `affiliate_url` son URLs públicas reales y no
 * están aquí.
 */
export const STORAGE_URL_COLUMNS = {
  "Avatar.glb_url": "avatars.glb_path",
  "Garment.image_url": "garments.image_path",
  "Garment.glb_url": "garments.glb_path",
  "Garment.sewing_pattern_url": "garments.sewing_pattern_path",
  "Outfit.preview_url": "outfits.preview_path",
  "DrapeCache.glb_url": "drape_cache.glb_path",
  "DrapeJobOutput.glb_url": "drape_cache.glb_path",
} as const;

/**
 * Ruta de un objeto en Storage, `bucket/carpeta/fichero`.
 * @minLength 3
 */
export type StoragePath = string;

/**
 * Longitud en centímetros.
 * @minimum 0
 */
export type Centimeters = number;

/**
 * Valor normalizado entre 0 y 1.
 * @minimum 0
 * @maximum 1
 */
export type UnitInterval = number;

/** Color CIELAB (iluminante D65, observador 2°). */
export interface LabColor {
  /**
   * @minimum 0
   * @maximum 100
   */
  l: number;
  /**
   * @minimum -128
   * @maximum 127
   */
  a: number;
  /**
   * @minimum -128
   * @maximum 127
   */
  b: number;
}

// ---------------------------------------------------------------------------
// Medidas corporales y avatar
// ---------------------------------------------------------------------------

/**
 * Medidas del cuerpo en cm. Los contornos son perímetros completos.
 * Las obligatorias son las que el fit del MVP necesita; el resto depende del
 * método de medición.
 */
export interface BodyMeasurements {
  /** Altura declarada por el usuario; ancla la escala del avatar. */
  height_cm: Centimeters;
  /** Contorno de pecho en el punto más ancho. */
  chest_cm: Centimeters;
  /** Contorno de cintura natural. */
  waist_cm: Centimeters;
  /** Contorno de cadera en el punto más ancho. */
  hip_cm: Centimeters;
  /** Ancho de hombros, de acromion a acromion por la espalda. */
  shoulder_width_cm: Centimeters;
  /** Largo de brazo, de acromion a muñeca. */
  arm_length_cm: Centimeters;
  /** Entrepierna, de la ingle al suelo. */
  inseam_cm: Centimeters;
  neck_cm?: Centimeters;
  underbust_cm?: Centimeters;
  bicep_cm?: Centimeters;
  wrist_cm?: Centimeters;
  thigh_cm?: Centimeters;
  calf_cm?: Centimeters;
  /** Largo de torso, de la séptima cervical a la cintura. */
  torso_length_cm?: Centimeters;
  /** Contorno de rodilla (zona de fit `knee`). */
  knee_cm?: Centimeters;
  /** Tiro: de la cintura a la entrepierna por delante (zona de fit `rise`); el usuario puede corregirlo. */
  rise_cm?: Centimeters;
  /**
   * Peso declarado, opcional; mejora la estimación de forma.
   * @minimum 0
   */
  weight_kg?: number;
}

/** Clave de una medida corporal de longitud (todas las de `BodyMeasurements` salvo el peso). */
export type BodyMeasurementKey = Exclude<keyof BodyMeasurements, "weight_kg">;

export const BODY_MODELS = ["mhr", "anny", "smplx"] as const;
/**
 * Modelo corporal paramétrico con el que se generó el avatar. El resto del
 * sistema (visor, prenda, drapeado, fit) NO depende de su topología: solo usa
 * el GLB y las medidas. `mhr` (Momentum Human Rig, Apache 2.0) es el de la
 * fase 0; `anny` (Apache 2.0 / CC0) es la alternativa abierta; `smplx` solo es
 * válido si se firma licencia comercial y no se usa en producción sin ella.
 */
export type BodyModel = (typeof BODY_MODELS)[number];

export const BODY_MODEL_GENDERS = ["neutral", "female", "male"] as const;
export type BodyModelGender = (typeof BODY_MODEL_GENDERS)[number];

/**
 * Forma del cuerpo en el espacio de parámetros de `Avatar.body_model`. Solo
 * la interpreta el pipeline de avatar (reajuste tras corregir medidas); nadie
 * más debe leerla. La pose de la foto se descarta: el avatar se entrega en la
 * pose canónica y el esqueleto viaja dentro del GLB.
 */
export interface BodyShape {
  /**
   * Vector de forma: identidad de MHR (45), fenotipos de Anny o betas de SMPL-X.
   * @minItems 1
   * @maxItems 512
   */
  params: number[];
  /** Solo para modelos con variantes por género; MHR no lo usa. */
  gender?: BodyModelGender;
}

export const MEASUREMENT_SOURCES = [
  "photo",
  "photo_reference_object",
  "lidar",
  "manual",
  "unmeasured",
] as const;
/**
 * Cómo se obtuvieron las medidas. `unmeasured`: no hay medidas reales (los
 * valores son marcadores, p. ej. de un worker fake) y no deben usarse para fit.
 */
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

export const AVATAR_POSES = ["a_pose", "t_pose", "relaxed"] as const;
export type AvatarPose = (typeof AVATAR_POSES)[number];

/** Avatar 3D del usuario. No contiene ni referencia la foto de origen. */
export interface Avatar {
  id: UUID;
  user_id: UUID;
  body_model: BodyModel;
  /**
   * Versión del modelo corporal y del pipeline, p. ej. `mhr-1.0/avatar-0.3`.
   * Empieza por `fake/` si lo generó un worker en modo fake.
   */
  model_version: string;
  /** Forma en el espacio de `body_model`. */
  shape: BodyShape;
  /** Medidas ISO 8559-1 tomadas sobre la malla en pose canónica. */
  measurements: BodyMeasurements;
  measurements_source: MeasurementSource;
  /**
   * Incertidumbre (1σ, en cm) de cada medida estimada; el fit la propaga a la
   * holgura. Ausente si no se ha estimado.
   */
  measurements_sigma_cm?: Partial<Record<BodyMeasurementKey, Centimeters>> | null;
  /** Medidas corregidas a mano por el usuario; prevalecen sobre `measurements`. */
  measurements_override?: Partial<BodyMeasurements> | null;
  /**
   * GLB del avatar en `pose` (malla + esqueleto), en metros, Y arriba, pies en
   * el origen. Es la única geometría que consumen visor y drapeado.
   */
  glb_url: Url;
  pose: AvatarPose;
  /** Cambia cuando cambia la forma; forma parte de la clave de caché del drapeado. */
  shape_hash: string;
  /** Confianza global de la estimación. */
  confidence: UnitInterval;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// ---------------------------------------------------------------------------
// Colorimetría
// ---------------------------------------------------------------------------

export const COLOR_SEASONS = [
  "light_spring",
  "warm_spring",
  "bright_spring",
  "light_summer",
  "cool_summer",
  "soft_summer",
  "soft_autumn",
  "warm_autumn",
  "deep_autumn",
  "deep_winter",
  "cool_winter",
  "bright_winter",
] as const;
/** Las 12 estaciones. */
export type ColorSeason = (typeof COLOR_SEASONS)[number];

export const UNDERTONES = ["cool", "neutral", "warm", "olive"] as const;
export type Undertone = (typeof UNDERTONES)[number];

export const COLOR_VALUES = ["light", "medium", "deep"] as const;
/** Valor: claridad global de piel, pelo y ojos. */
export type ColorValue = (typeof COLOR_VALUES)[number];

export const COLOR_INTENSITIES = ["soft", "medium", "bright"] as const;
/** Intensidad (croma). */
export type ColorIntensity = (typeof COLOR_INTENSITIES)[number];

export const CONTRAST_LEVELS = ["low", "medium", "high"] as const;
export type ContrastLevel = (typeof CONTRAST_LEVELS)[number];

export const METALS = ["gold", "silver", "rose_gold", "any"] as const;
/** `any` equivale al «mixto» de `docs/research/color.md`. */
export type Metal = (typeof METALS)[number];

export const COLOR_QUALITY_FLAGS = [
  "no_white_reference",
  "mixed_lighting",
  "underexposed",
  "overexposed",
  "color_cast",
  "low_resolution",
  "face_too_small",
  "hair_not_visible",
  "eyes_not_visible",
  "makeup_or_filter_suspected",
] as const;
/** Avisos de calidad de la captura; bajan la confianza o piden repetir. */
export type ColorQualityFlag = (typeof COLOR_QUALITY_FLAGS)[number];

/** Calidad de la captura del selfie. */
export interface ColorCaptureQuality {
  flags: ColorQualityFlag[];
  /** 0 = inservible, 1 = captura ideal. */
  capture_score: UnitInterval;
}

/** Paletas recomendadas, en hex para pintarlas tal cual. */
export interface ColorPalettes {
  /**
   * Colores que más favorecen.
   * @minItems 1
   */
  best: HexColor[];
  neutrals: HexColor[];
  accents: HexColor[];
  /** Colores a evitar cerca de la cara. */
  avoid: HexColor[];
}

/**
 * Valores continuos de los que salen las categorías, normalizados para
 * explicarlos en la interfaz. El pipeline calcula T, V y S como z-scores y K
 * como ΔL* (`docs/research/color.md`) y los proyecta a estos rangos.
 */
export interface ColorScores {
  /**
   * −1 = frío, +1 = cálido.
   * @minimum -1
   * @maximum 1
   */
  undertone: number;
  /** 0 = profundo, 1 = claro. */
  value: UnitInterval;
  /** 0 = suave, 1 = brillante. */
  intensity: UnitInterval;
  /** 0 = bajo, 1 = alto. */
  contrast: UnitInterval;
}

export interface SeasonCandidate {
  season: ColorSeason;
  confidence: UnitInterval;
}

/**
 * Perfil de color del usuario. Solo valores calculados: el selfie se borra.
 * Es el tipo único del proyecto; la propuesta de `docs/research/color.md` §7
 * se corresponde así: `chroma` → `intensity`, `alternatives[].probability` →
 * `confidence`, `best`/`avoid`/`neutrals` → `palettes`, `measurements.skin` →
 * `skin_lab` (ídem pelo y ojos), `measurements.ita`/`skinHue` → `ita` /
 * `skin_hue_deg`, `algorithmVersion` → `pipeline_version`, metal `mixed` → `any`.
 */
export interface ColorProfile {
  id: UUID;
  user_id: UUID;
  season: ColorSeason;
  undertone: Undertone;
  value: ColorValue;
  intensity: ColorIntensity;
  contrast: ContrastLevel;
  scores: ColorScores;
  /** Colores medidos tras corregir con la referencia de blanco. */
  skin_lab: LabColor;
  hair_lab?: LabColor | null;
  /** `true` si el pelo parece teñido: entonces no cuenta para la estación. */
  hair_dyed?: boolean | null;
  eye_lab?: LabColor | null;
  /** Individual Typology Angle de la piel, en grados. */
  ita?: number | null;
  /**
   * Ángulo de tono de la piel en CIELAB, en grados.
   * @minimum 0
   * @maximum 360
   */
  skin_hue_deg?: number | null;
  palettes: ColorPalettes;
  metal: Metal;
  /** Confianza de `season`. */
  confidence: UnitInterval;
  /**
   * Otras estaciones plausibles, de mayor a menor confianza.
   * @maxItems 3
   */
  alternatives?: SeasonCandidate[] | null;
  /** Si hubo referencia de blanco válida; sin ella la confianza baja. */
  white_balanced: boolean;
  /** Avisos de calidad de la captura. Ausente en perfiles elegidos a mano. */
  quality?: ColorCaptureQuality | null;
  /** `true` si el usuario eligió la estación a mano. */
  user_overridden?: boolean;
  /** Empieza por `fake/` si lo generó un worker en modo fake. */
  pipeline_version: string;
  created_at: ISODateTime;
  /** Cambia cuando el usuario corrige la estación o la paleta. */
  updated_at: ISODateTime;
}

// ---------------------------------------------------------------------------
// Prendas
// ---------------------------------------------------------------------------

export const GARMENT_CATEGORIES = [
  "tshirt",
  "shirt",
  "sweater",
  "hoodie",
  "jacket",
  "coat",
  "dress",
  "skirt",
  "pants",
  "jeans",
  "shorts",
] as const;
export type GarmentCategory = (typeof GARMENT_CATEGORIES)[number];

export const DESIGN_FITS = ["slim", "regular", "relaxed", "oversize"] as const;
/** Fit con el que se diseñó la prenda (no confundir con llevar una talla mayor). */
export type DesignFit = (typeof DESIGN_FITS)[number];

export const FIT_ZONES = [
  "neck",
  "shoulder",
  "chest",
  "waist",
  "hip",
  "sleeve_length",
  "bicep",
  "cuff",
  "body_length",
  "thigh",
  "knee",
  "inseam",
  "rise",
  "hem",
] as const;
/**
 * Zona de medida compartida entre prenda y fit. En contornos (`chest`,
 * `waist`, `hip`, `neck`, `bicep`, `cuff`, `thigh`, `knee`, `hem`) la medida
 * de la prenda es el perímetro completo, no el ancho en plano.
 */
export type FitZone = (typeof FIT_ZONES)[number];

/**
 * Zonas ancla: corresponden a la talla de la persona aunque el diseño sea
 * oversize (`docs/research/fit.md` §3). El resto de zonas son de volumen.
 */
export const ANCHOR_FIT_ZONES = [
  "neck",
  "cuff",
  "waist",
  "sleeve_length",
  "body_length",
] as const satisfies readonly FitZone[];

/**
 * Medida corporal que corresponde a cada zona de fit (`ZoneFit.body_cm`). Es la
 * única tabla de correspondencia: el worker de fit y la app la importan de aquí
 * y no inventan la suya. `null`: la zona no tiene medida corporal equivalente
 * (`hem`, el bajo, es solo de diseño) y no entra en `FitResult.zones`.
 *
 * Si falta la medida corporal de una zona (las opcionales de `BodyMeasurements`
 * no siempre se estiman), el fit OMITE esa zona de `zones` en lugar de
 * inventarla. Si la que falta es una zona ancla (`ANCHOR_FIT_ZONES`),
 * `size_offset` es `null` cuando no queda ninguna ancla medible y
 * `FitResult.confidence` no puede pasar de 0,5.
 */
export const FIT_ZONE_BODY_MEASUREMENT = {
  neck: "neck_cm",
  shoulder: "shoulder_width_cm",
  chest: "chest_cm",
  waist: "waist_cm",
  hip: "hip_cm",
  sleeve_length: "arm_length_cm",
  bicep: "bicep_cm",
  cuff: "wrist_cm",
  body_length: "torso_length_cm",
  thigh: "thigh_cm",
  knee: "knee_cm",
  inseam: "inseam_cm",
  rise: "rise_cm",
  hem: null,
} as const satisfies Record<FitZone, BodyMeasurementKey | null>;

/** Confianza máxima de un `FitResult` al que le falta la medida corporal de alguna zona ancla. */
export const FIT_MAX_CONFIDENCE_WITHOUT_ANCHOR = 0.5;

/** Medidas de una prenda por zona, en cm. */
export type ZoneMeasurements = Partial<Record<FitZone, Centimeters>>;

export const GARMENT_MEASUREMENT_SOURCES = [
  "brand_size_chart",
  "photo_reference_object",
  "lidar",
  "manual",
  "estimated",
] as const;
export type GarmentMeasurementSource =
  (typeof GARMENT_MEASUREMENT_SOURCES)[number];

/** Medidas de una prenda en una talla concreta (fila de `garment_measurements`). */
export interface GarmentSizeMeasurements {
  /** Etiqueta de talla tal como la escribe la marca: `M`, `40`, `32/34`. */
  size_label: string;
  zones: ZoneMeasurements;
  source: GarmentMeasurementSource;
}

/** Un color dominante de la prenda. */
export interface GarmentColor {
  lab: LabColor;
  /** El mismo color en hex, para pintarlo. */
  hex: HexColor;
  /** Fracción de la superficie visible que ocupa. */
  proportion: UnitInterval;
  /** Nombre legible, p. ej. `azul marino`. */
  name?: string;
  /** `true` si queda cerca de la cara (cuello, parte alta); pesa más en colorimetría. */
  near_face?: boolean;
}

export const GARMENT_PATTERNS = [
  "solid",
  "stripes",
  "checks",
  "floral",
  "print",
  "graphic",
  "other",
] as const;
export type GarmentPattern = (typeof GARMENT_PATTERNS)[number];

export const SLEEVE_LENGTHS = ["sleeveless", "short", "three_quarter", "long"] as const;
export type SleeveLength = (typeof SLEEVE_LENGTHS)[number];

export const GARMENT_LENGTHS = ["cropped", "regular", "long", "mini", "midi", "maxi"] as const;
export type GarmentLength = (typeof GARMENT_LENGTHS)[number];

export const FABRIC_PRESETS = [
  "knit_light",
  "knit_heavy",
  "woven_light",
  "woven_stiff",
  "denim",
  "silk",
] as const;
/** Preajuste de tejido del simulador (rigidez a tracción y flexión, densidad). */
export type FabricPreset = (typeof FABRIC_PRESETS)[number];

/** Atributos del etiquetado automático; todos corregibles por el usuario. */
export interface GarmentAttributes {
  /** Estampado (no confundir con el patrón de costura, `sewing_pattern_url`). */
  pattern?: GarmentPattern;
  /** Material principal en texto libre normalizado: `cotton`, `denim`, `wool`. */
  material?: string;
  /** Tejido para la simulación; forma parte de la clave de caché del drapeado. */
  fabric?: FabricPreset;
  /**
   * Elasticidad del tejido: 0 en plano, 0,05–0,15 en punto, hasta 0,3 con
   * elastano. Entra en la holgura de los contornos.
   * @minimum 0
   * @maximum 1
   */
  stretch?: number;
  sleeve_length?: SleeveLength;
  /** `crew`, `v`, `collar`, `hood`… */
  neckline?: string;
  length?: GarmentLength;
  /** Estaciones del año: `summer`, `winter`… */
  seasons?: string[];
  /** `casual`, `smart`, `formal`, `sport`. */
  formality?: string;
  /** Etiquetas libres. */
  tags?: string[];
}

export const GARMENT_LEVELS = [1, 2, 3] as const;
/**
 * 1 = configuración cerrada de GarmentCode por categoría + textura;
 * 2 = parámetros libres de GarmentCode estimados desde la foto;
 * 3 = 3D nativo de marca (sin patrón).
 */
export type GarmentLevel = (typeof GARMENT_LEVELS)[number];

export const GARMENT_STATUSES = ["processing", "ready", "failed"] as const;
export type GarmentStatus = (typeof GARMENT_STATUSES)[number];

export const SEWING_PATTERN_FORMATS = ["garmentcode"] as const;
/** Formato del patrón de costura. Niveles 1 y 2: especificación de GarmentCode (JSON). */
export type SewingPatternFormat = (typeof SEWING_PATTERN_FORMATS)[number];

/** Campos comunes a todos los estados de una prenda. */
interface GarmentCommon {
  id: UUID;
  /** Dueño. `null` en prendas de catálogo de tienda. */
  user_id: UUID | null;
  /** Producto de tienda del que procede, si lo hay. */
  store_product_id?: UUID | null;
  name?: string | null;
  brand?: string | null;
  attributes: GarmentAttributes;
  /** Talla que tiene el usuario (armario) o `null` si es de catálogo. */
  size_label: string | null;
  /** Medidas por talla; en el armario suele haber una sola. */
  measurements: GarmentSizeMeasurements[];
  level: GarmentLevel;
  /** Configuración de GarmentCode usada como plantilla (nivel 1). */
  template_id?: string | null;
  /** Campos que el usuario corrigió a mano; el pipeline no los pisa. */
  user_corrected_fields?: string[];
  /** `pending` hasta que el pipeline la procesa; `fake/…` si la generó un worker fake. */
  pipeline_version: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/**
 * Prenda recién creada (`processing`) o cuyo job falló (`failed`): el pipeline
 * aún no ha rellenado nada, así que todo lo que produce es opcional.
 */
export interface PendingGarment extends GarmentCommon {
  status: "processing" | "failed";
  category?: GarmentCategory | null;
  /** Colores dominantes; vacío hasta que el pipeline los mide. */
  colors: GarmentColor[];
  design_fit?: DesignFit | null;
  design_fit_confidence?: UnitInterval | null;
  image_url?: Url | null;
  glb_url?: Url | null;
  sewing_pattern_url?: Url | null;
  sewing_pattern_format?: SewingPatternFormat | null;
}

/** Prenda procesada. Es lo que devuelve el job `garment`. */
export interface ReadyGarment extends GarmentCommon {
  status: "ready";
  category: GarmentCategory;
  /**
   * Colores dominantes, de mayor a menor proporción.
   * @minItems 1
   */
  colors: GarmentColor[];
  /** Fit con el que se diseñó: atributo de la prenda, no depende de quién la lleve. */
  design_fit: DesignFit;
  /** Confianza del clasificador de `design_fit`. */
  design_fit_confidence?: UnitInterval | null;
  /** Recorte de la prenda sin fondo ni persona. La foto original no se conserva. */
  image_url: Url;
  /** GLB de la prenda en reposo. `null` si no se pudo generar el 3D: no se puede drapear. */
  glb_url: Url | null;
  /**
   * Patrón de costura (paneles, costuras y colocación) del que sale el GLB y
   * que el drapeado simula. `null` en prendas de nivel 3.
   */
  sewing_pattern_url: Url | null;
  sewing_pattern_format?: SewingPatternFormat | null;
}

/**
 * Prenda del armario del usuario o normalizada desde un producto de tienda.
 * Unión discriminada por `status`.
 */
export type Garment = PendingGarment | ReadyGarment;

/** Embedding de imagen de la prenda para recomendaciones (pgvector, coseno). */
export interface GarmentEmbedding {
  /** Modelo que lo generó, p. ej. `fashion-clip-vit-b32`. */
  model: string;
  /**
   * @minItems 512
   * @maxItems 512
   */
  vector: number[];
}

/** Dimensión de `GarmentEmbedding.vector` (columna `garments.embedding vector(512)`). */
export const GARMENT_EMBEDDING_DIMENSIONS = 512;

// ---------------------------------------------------------------------------
// Fit
// ---------------------------------------------------------------------------

export const ZONE_VERDICTS = [
  "too_tight",
  "snug",
  "ideal",
  "loose",
  "too_loose",
  "too_short",
  "too_long",
] as const;
export type ZoneVerdict = (typeof ZONE_VERDICTS)[number];

/** Holgura en una zona: medida de la prenda menos medida del cuerpo. */
export interface ZoneFit {
  zone: FitZone;
  body_cm: Centimeters;
  garment_cm: Centimeters;
  /**
   * `garment_cm · (1 + stretch) − body_cm` en contornos, `garment_cm − body_cm`
   * en largos; negativo si la prenda es más pequeña que el cuerpo.
   */
  ease_cm: number;
  /**
   * Incertidumbre (1σ) de `ease_cm`: √(σ_cuerpo² + σ_prenda²). La app muestra
   * la holgura como banda cuando existe.
   */
  ease_sigma_cm?: Centimeters;
  /** Veredicto más probable. */
  verdict: ZoneVerdict;
  /** Probabilidad de cada veredicto dada la incertidumbre; suman 1. */
  verdict_probabilities?: Partial<Record<ZoneVerdict, UnitInterval>>;
}

export const FIT_VERDICTS = ["too_small", "fits", "too_large"] as const;
/** Veredicto global de la talla sobre este cuerpo. */
export type FitVerdict = (typeof FIT_VERDICTS)[number];

export const FIT_METHODS = ["size_chart", "measured", "simulated"] as const;
export type FitMethod = (typeof FIT_METHODS)[number];

/**
 * Resultado de ajuste de una prenda y talla sobre un avatar: cómo le queda a
 * ESTA persona. El fit de diseño es otra cosa y vive en `Garment.design_fit`.
 */
export interface FitResult {
  id: UUID;
  /** Dueño del avatar. */
  user_id: UUID;
  avatar_id: UUID;
  garment_id: UUID;
  size_label: string;
  /** @minItems 1 */
  zones: ZoneFit[];
  verdict: FitVerdict;
  /** Cómo queda de verdad en este cuerpo, que puede no coincidir con `design_fit`. */
  effective_fit: DesignFit;
  /** `false` cuando, p. ej., un oversize de diseño queda regular o una talla mayor finge oversize. */
  matches_design_fit: boolean;
  /**
   * Tallas de más (positivo) o de menos (negativo) respecto a la suya, medido
   * en las zonas ancla (s_A de `docs/research/fit.md`). Distingue «talla
   * mayor» de «oversize de diseño».
   */
  size_offset?: number | null;
  /** Ajuste respecto a las preferencias del usuario; entra en el ranking con peso 0,3. */
  score: UnitInterval;
  /** Talla recomendada si no es `size_label`. */
  recommended_size_label?: string | null;
  method: FitMethod;
  confidence: UnitInterval;
  created_at: ISODateTime;
}

// ---------------------------------------------------------------------------
// Outfits y tiendas
// ---------------------------------------------------------------------------

export interface OutfitItem {
  garment_id: UUID;
  size_label: string | null;
  /**
   * Orden de capa: 0 es la más pegada al cuerpo.
   * @minimum 0
   * @asType integer
   */
  layer: number;
}

/** Ranking = 0,4 compatibilidad + 0,3 color + 0,3 ajuste. */
export interface OutfitScores {
  compatibility: UnitInterval;
  color: UnitInterval;
  fit: UnitInterval;
  total: UnitInterval;
}

export const OUTFIT_SOURCES = ["user", "recommendation", "stylist"] as const;
export type OutfitSource = (typeof OUTFIT_SOURCES)[number];

export interface Outfit {
  id: UUID;
  user_id: UUID;
  /** `null` si el usuario borró el avatar: el outfit se conserva sin él. */
  avatar_id: UUID | null;
  name?: string | null;
  /** @minItems 1 */
  items: OutfitItem[];
  source: OutfitSource;
  scores?: OutfitScores | null;
  occasion?: string | null;
  /** Miniatura renderizada del outfit. */
  preview_url?: Url | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export const AFFILIATE_NETWORKS = [
  "awin",
  "rakuten",
  "cj",
  "impact",
  "zalando",
  "shopify",
] as const;
export type AffiliateNetwork = (typeof AFFILIATE_NETWORKS)[number];

export interface Money {
  /** @minimum 0 */
  amount: number;
  /**
   * ISO 4217.
   * @pattern ^[A-Z]{3}$
   */
  currency: string;
}

export interface StoreProductSize {
  size_label: string;
  in_stock: boolean;
}

export const TARGET_GENDERS = ["women", "men", "unisex", "kids"] as const;
export type TargetGender = (typeof TARGET_GENDERS)[number];

/** Producto de un feed de afiliación, ya normalizado. */
export interface StoreProduct {
  id: UUID;
  network: AffiliateNetwork;
  merchant: string;
  /** Identificador del producto en el feed. */
  external_id: string;
  title: string;
  brand?: string;
  category: GarmentCategory;
  target_gender?: TargetGender;
  /** Enlace con seguimiento de afiliación; es el que abre la app. */
  affiliate_url: Url;
  /** @minItems 1 */
  image_urls: Url[];
  price: Money;
  /** Precio rebajado, si lo hay. */
  sale_price?: Money;
  sizes: StoreProductSize[];
  /** Prenda normalizada (3D, colores, medidas) creada por el mismo pipeline; `null` si aún no se procesó. */
  garment_id: UUID | null;
  /** Última vez que se vio en el feed. */
  last_seen_at: ISODateTime;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// ---------------------------------------------------------------------------
// Usuario: perfil, consentimientos y preferencias de fit
// ---------------------------------------------------------------------------

/** Perfil mínimo del usuario (tabla `profiles`). Se crea al darse de alta. */
export interface Profile {
  /** Igual al id del usuario de Auth. */
  id: UUID;
  /** @maxLength 80 */
  display_name: string | null;
  /**
   * @pattern ^[a-z]{2}(-[A-Z]{2})?$
   */
  locale: string;
  /** Cuándo declaró cumplir la edad mínima; no se guarda la fecha de nacimiento. */
  age_confirmed_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export const CONSENT_PURPOSES = [
  "body_scan",
  "color_analysis",
  "personalization",
  "analytics",
] as const;
/** Tratamiento que ampara el consentimiento (`docs/architecture.md` §4). */
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/**
 * Texto legal de un consentimiento (tabla `consent_texts`, solo de lectura y
 * sin borrado: cada cambio es una versión nueva). La app muestra `body` y
 * registra el consentimiento con `purpose` y, opcionalmente, `version`; la
 * versión vigente es la última publicada de cada tratamiento.
 */
export interface ConsentText {
  purpose: ConsentPurpose;
  /**
   * @minLength 1
   * @maxLength 64
   */
  version: string;
  /** Texto íntegro, tal como se mostró. */
  body: string;
  /** SHA-256 de `body` en hex: prueba de qué texto exacto se aceptó. */
  sha256: string;
  published_at: ISODateTime;
}

/**
 * Consentimiento explícito por tratamiento (tabla `consents`). Retirar = `withdrawn_at`.
 * La app solo envía `purpose` (y, si quiere, `text_version`): la fecha la pone
 * el servidor y la versión tiene que ser la vigente en `consent_texts`.
 */
export interface Consent {
  id: UUID;
  user_id: UUID;
  purpose: ConsentPurpose;
  /**
   * Versión del texto legal aceptado (`ConsentText.version`), p. ej. `body_scan-2026-11`.
   * @minLength 1
   * @maxLength 64
   */
  text_version: string;
  /** La fija el servidor al insertar; el cliente no puede elegirla. */
  granted_at: ISODateTime;
  withdrawn_at: ISODateTime | null;
  created_at: ISODateTime;
}

/** Holgura preferida en una zona (`docs/research/fit.md` §6). */
export interface EasePreference {
  /** Holgura objetivo μ, en cm. */
  preferred_cm: number;
  /** Tolerancia σ, en cm. */
  tolerance_cm: Centimeters;
  /**
   * Opiniones que la respaldan (la prenda favorita cuenta como 3).
   * @minimum 0
   * @asType integer
   */
  observations: number;
}

/** Preferencias de fit del usuario (tabla `user_fit_preferences`, una fila por usuario). */
export interface UserFitPreferences {
  user_id: UUID;
  /** Fit preferido por defecto. */
  default_fit: DesignFit;
  /** Fit preferido por categoría: `{ "jeans": "slim" }`. */
  fit_by_category: Partial<Record<GarmentCategory, DesignFit>>;
  /** Holgura preferida por categoría y zona; se actualiza con cada opinión. */
  ease_by_category: Partial<Record<GarmentCategory, Partial<Record<FitZone, EasePreference>>>>;
  /** Gusto por siluetas oversize de diseño, aparte de la talla. `null` = sin dato. */
  likes_oversize: boolean | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const JOB_TYPES = ["avatar", "garment", "drape", "color"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Estados en los que el job ya no cambia. */
export const TERMINAL_JOB_STATUSES = [
  "succeeded",
  "failed",
  "canceled",
] as const satisfies readonly JobStatus[];

export const JOB_ERROR_CODES = [
  "invalid_input",
  "no_person_detected",
  "multiple_people",
  "pose_invalid",
  "body_not_fully_visible",
  "no_face_detected",
  "white_reference_missing",
  "garment_not_detected",
  "person_detected",
  "low_image_quality",
  "consent_missing",
  "quota_exceeded",
  "not_implemented",
  "timeout",
  "internal",
] as const;
/**
 * Motivo por el que falla un job. `person_detected`: en una foto de prenda
 * aparece una persona (piel o cara); el worker no sube ningún recorte y la
 * foto se borra igualmente. `not_implemented`: el worker aún no tiene
 * pipeline real para ese tipo (no reintentar). `quota_exceeded`: se agotó una
 * cuota (del usuario o del proveedor de GPU).
 */
export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];

export interface JobError {
  code: JobErrorCode;
  /** Mensaje técnico para logs; la app traduce `code`, no muestra esto. */
  message: string;
  /** Si tiene sentido reintentar sin cambiar la entrada. */
  retryable: boolean;
}

export const WHITE_REFERENCES = ["paper", "gray_card", "none"] as const;
export type WhiteReference = (typeof WHITE_REFERENCES)[number];

/** Entrada del job `avatar`. */
export interface AvatarJobInput {
  /** Foto de cuerpo entero en el bucket efímero. Se borra al terminar el job. */
  photo_path: StoragePath;
  /**
   * @minimum 50
   * @maximum 260
   */
  height_cm: number;
  /**
   * @minimum 20
   * @maximum 350
   */
  weight_kg?: number;
  gender?: BodyModelGender;
  /** Consentimiento vigente que ampara este tratamiento. */
  consent_id: UUID;
}

/** Salida del job `avatar`. El borrado de la foto lo hace y lo anota la API (`Job.input_deleted_at`). */
export interface AvatarJobOutput {
  avatar: Avatar;
}

/** Entrada del job `color`. */
export interface ColorJobInput {
  /** Selfie en el bucket efímero. Se borra al terminar el job. */
  selfie_path: StoragePath;
  white_reference: WhiteReference;
  consent_id: UUID;
}

/** Salida del job `color`. */
export interface ColorJobOutput {
  color_profile: ColorProfile;
}

/** Entrada del job `garment`. */
export interface GarmentJobInput {
  /** Prenda ya creada con `status: processing` que este job rellena. */
  garment_id: UUID;
  /**
   * Fotos de la prenda en el bucket efímero.
   * @minItems 1
   * @maxItems 6
   */
  image_paths: StoragePath[];
  category_hint?: GarmentCategory;
  /** @maxLength 32 */
  size_label?: string;
  /** @maxLength 80 */
  brand?: string;
}

/** Salida del job `garment`. */
export interface GarmentJobOutput {
  garment: ReadyGarment;
  /** Embedding para recomendaciones; la API lo guarda en `garments.embedding` y no lo sirve a la app. */
  embedding?: GarmentEmbedding;
}

export const DRAPE_QUALITIES = ["preview", "final"] as const;
export type DrapeQuality = (typeof DRAPE_QUALITIES)[number];

/**
 * Entrada del job `drape` tal como la envía la app: solo identificadores. La
 * API resuelve lo que el simulador necesita y lo añade al despacho en
 * `DrapeJobDispatch.context`.
 */
export interface DrapeJobInput {
  avatar_id: UUID;
  garment_id: UUID;
  /**
   * @minLength 1
   * @maxLength 32
   */
  size_label: string;
  pose: AvatarPose;
  quality: DrapeQuality;
}

/** Cuerpo sobre el que se drapea. La malla de colisión es el GLB; no hace falta la topología. */
export interface DrapeAvatarContext {
  /** GLB del avatar; su URL de descarga está en `input_urls[glb_path]`. */
  glb_path: StoragePath;
  body_model: BodyModel;
  model_version: string;
  shape_hash: string;
  /** Medidas efectivas: `measurements` con `measurements_override` ya aplicado. */
  measurements: BodyMeasurements;
  measurements_sigma_cm?: Partial<Record<BodyMeasurementKey, Centimeters>> | null;
}

/** Prenda que se drapea. Al menos uno de `sewing_pattern_path` y `glb_path` no es `null`. */
export interface DrapeGarmentContext {
  /** Patrón de costura (GarmentCode); su URL está en `input_urls`. `null` en nivel 3. */
  sewing_pattern_path: StoragePath | null;
  sewing_pattern_format: SewingPatternFormat | null;
  /** GLB en reposo; su URL está en `input_urls`. */
  glb_path: StoragePath | null;
  level: GarmentLevel;
  category: GarmentCategory;
  design_fit: DesignFit;
  /** Incluye `fabric` y `stretch`, que eligen los parámetros de tejido. */
  attributes: GarmentAttributes;
  /** Medidas de la prenda en la talla pedida, si se conocen. */
  measurements: GarmentSizeMeasurements | null;
}

/** Todo lo que el simulador necesita además de `DrapeJobInput`. Lo rellena la API. */
export interface DrapeJobContext {
  /** Clave de caché calculada por la API; el worker la devuelve tal cual en la salida. */
  cache_key: string;
  /** Versión del simulador con la que se calculó `cache_key`. */
  simulator_version: string;
  avatar: DrapeAvatarContext;
  garment: DrapeGarmentContext;
}

/** Indicadores de calidad de la simulación. */
export interface DrapeQualityReport {
  /**
   * Intersecciones tela–cuerpo o tela–tela que quedan.
   * @minimum 0
   * @asType integer
   */
  intersections: number;
  /**
   * Costuras que no llegaron a cerrar.
   * @minimum 0
   * @asType integer
   */
  open_seams: number;
  /** `true` si la relajación alcanzó el umbral de velocidad antes del tope de pasos. */
  converged: boolean;
}

/** Salida del job `drape`. */
export interface DrapeJobOutput {
  /** GLB de la prenda ya drapeada, en el mismo sistema de coordenadas que el avatar. */
  glb_url: Url;
  /** La de `DrapeJobContext.cache_key`: hash(shape_hash, prenda y su versión, talla, pose, calidad, tejido, versión del simulador). */
  cache_key: string;
  /** `true` si salió de `drape_cache` sin simular. El worker envía siempre `false`. */
  cache_hit: boolean;
  fit_result?: FitResult;
  quality_report?: DrapeQualityReport;
}

/** Entrada de la caché de drapeado (tabla `drape_cache`); una por usuario y `cache_key`. */
export interface DrapeCache {
  id: UUID;
  user_id: UUID;
  cache_key: string;
  avatar_id: UUID;
  garment_id: UUID;
  size_label: string;
  pose: AvatarPose;
  quality: DrapeQuality;
  /** `shape_hash` del avatar cuando se simuló. */
  shape_hash: string;
  simulator_version: string;
  /** GLB de la prenda drapeada. */
  glb_url: Url;
  fit_result_id: UUID | null;
  /**
   * @minimum 0
   * @asType integer
   */
  hit_count: number;
  last_used_at: ISODateTime;
  created_at: ISODateTime;
}

/**
 * Lo que `jobs.output` conserva de un job terminado con éxito: solo
 * referencias a lo que se creó (minimización, art. 5.1.c y 5.1.e RGPD). El
 * objeto de dominio completo (avatar con medidas, perfil de color…) vive solo
 * en su tabla y se borra con ella; `jobs` no guarda copias.
 */
export interface AvatarJobResult {
  avatar_id: UUID;
}
export interface ColorJobResult {
  color_profile_id: UUID;
}
export interface GarmentJobResult {
  garment_id: UUID;
}
export interface DrapeJobResult {
  /** Entrada de `drape_cache` creada o reutilizada; `null` si el avatar o la prenda se borraron antes. */
  drape_cache_id: UUID | null;
  fit_result_id: UUID | null;
  /** `true` si salió de `drape_cache` sin simular. */
  cache_hit: boolean;
}
export type JobResult = AvatarJobResult | ColorJobResult | GarmentJobResult | DrapeJobResult;

/**
 * Lo que queda de `jobs.input` cuando el job termina (o se cancela): solo los
 * identificadores. Altura, peso, género y rutas de fotos se purgan al cerrar
 * el job; retirar el consentimiento o borrar el avatar, el perfil de color o la
 * prenda quita también su id. La API purga los jobs terminados a los 30 días.
 */
export interface RetainedJobInput {
  consent_id?: UUID;
  avatar_id?: UUID;
  garment_id?: UUID;
}

/** Días que se conserva una fila de `jobs` terminada antes de purgarla. */
export const JOB_RETENTION_DAYS = 30;

interface JobBase<T extends JobType, I, O> {
  id: UUID;
  /** Dueño. `null` en jobs de ingesta de catálogo. */
  user_id: UUID | null;
  type: T;
  status: JobStatus;
  /** Avance aproximado, para la barra de progreso. */
  progress: UnitInterval;
  /** Etapa actual legible por máquina: `segmenting`, `fitting`, `exporting`… */
  stage?: string;
  /** Entrada completa mientras el job está en cola o en curso; `RetainedJobInput` al terminar. */
  input: I | RetainedJobInput;
  /** Presente solo si `status` es `succeeded`: referencias a lo creado, nunca el objeto completo. */
  output: O | null;
  /** Presente solo si `status` es `failed`. */
  error: JobError | null;
  /**
   * Intentos consumidos.
   * @minimum 0
   * @asType integer
   */
  attempts: number;
  /** Versión del worker que lo procesó. */
  worker_version?: string | null;
  /**
   * `true` si el resultado lo generó un worker en modo fake: los datos
   * derivados son de pega y no deben mostrarse como reales.
   */
  fake: boolean;
  /**
   * Momento en que la API borró las fotos de entrada de `raw-uploads`. Lo
   * escribe solo la API (el worker no puede borrar ni lo declara). `null`
   * mientras no se hayan borrado o si el job no tiene fotos (drapeado).
   */
  input_deleted_at: ISODateTime | null;
  created_at: ISODateTime;
  started_at: ISODateTime | null;
  finished_at: ISODateTime | null;
}

export type AvatarJob = JobBase<"avatar", AvatarJobInput, AvatarJobResult>;
export type GarmentJob = JobBase<"garment", GarmentJobInput, GarmentJobResult>;
export type DrapeJob = JobBase<"drape", DrapeJobInput, DrapeJobResult>;
export type ColorJob = JobBase<"color", ColorJobInput, ColorJobResult>;

/** Fila de `jobs`. Unión discriminada por `type`. */
export type Job = AvatarJob | GarmentJob | DrapeJob | ColorJob;

export interface JobInputByType {
  avatar: AvatarJobInput;
  garment: GarmentJobInput;
  drape: DrapeJobInput;
  color: ColorJobInput;
}

/** Salida que el worker envía en el callback, por tipo de job. */
export interface JobOutputByType {
  avatar: AvatarJobOutput;
  garment: GarmentJobOutput;
  drape: DrapeJobOutput;
  color: ColorJobOutput;
}

/** Lo que conserva `jobs.output`, por tipo de job. */
export interface JobResultByType {
  avatar: AvatarJobResult;
  garment: GarmentJobResult;
  drape: DrapeJobResult;
  color: ColorJobResult;
}

/** Cuerpo de `POST /functions/v1/create-job`: lo que la app envía para crear un job. */
export type CreateJobRequest =
  | { type: "avatar"; input: AvatarJobInput }
  | { type: "garment"; input: GarmentJobInput }
  | { type: "drape"; input: DrapeJobInput }
  | { type: "color"; input: ColorJobInput };

/**
 * Una foto que la app tiene que subir antes de que el job se despache. Se sube
 * con `storage.from("raw-uploads").uploadToSignedUrl(<ruta sin bucket>, token, fichero)`.
 * Caduca a las 2 h (límite fijo de Supabase) y solo admite una subida.
 */
export interface UploadTicket {
  path: StoragePath;
  signed_url: Url;
  token: string;
}

/** Respuesta 201 de `POST /functions/v1/create-job`. */
export interface CreateJobResponse {
  job: Job;
  /** Vacío si no hay nada que subir (drapeado, o fotos ya subidas): el job ya está despachado. */
  uploads: UploadTicket[];
}

export const OUTPUT_ARTIFACT_NAMES = ["glb", "image", "sewing_pattern", "preview"] as const;
/** Nombre lógico de un artefacto de salida. */
export type OutputArtifactName = (typeof OUTPUT_ARTIFACT_NAMES)[number];

/**
 * Una URL firmada de subida que la API entrega al worker para un artefacto de
 * salida. Se sube con un único `PUT` del fichero a `upload_url` con la cabecera
 * `Content-Type: <content_type>`; no admite una segunda subida. La ruta es
 * única por job e intento y caduca a las 2 h (límite fijo de Supabase).
 */
export interface SignedUpload {
  name: OutputArtifactName;
  path: StoragePath;
  upload_url: Url;
  /** Tipo MIME esperado: `model/gltf-binary`, `image/png`, `application/json`. */
  content_type: string;
}

interface JobDispatchBase<T extends JobType, I> {
  job_id: UUID;
  /** Dueño del job; el worker lo copia en las entidades de salida. `null` en jobs de catálogo. */
  user_id: UUID | null;
  type: T;
  input: I;
  /**
   * URLs firmadas de descarga (15 min), indexadas por `StoragePath`: una por
   * cada ruta de `input` y, en el drapeado, por cada ruta de `context`.
   */
  input_urls: Record<string, Url>;
  /** URLs firmadas donde subir los artefactos de salida. */
  output_uploads: SignedUpload[];
  /** Endpoint al que el worker informa del progreso y del resultado. */
  callback_url: Url;
  /**
   * Intento actual, empezando en 1.
   * @minimum 1
   * @asType integer
   */
  attempt: number;
  /** `CONTRACTS_VERSION` de la API que despacha. */
  contracts_version: string;
}

export type AvatarJobDispatch = JobDispatchBase<"avatar", AvatarJobInput>;
export type GarmentJobDispatch = JobDispatchBase<"garment", GarmentJobInput>;
export type ColorJobDispatch = JobDispatchBase<"color", ColorJobInput>;
export interface DrapeJobDispatch extends JobDispatchBase<"drape", DrapeJobInput> {
  /** Cuerpo, prenda y clave de caché que el simulador necesita. */
  context: DrapeJobContext;
}

/**
 * Despacho completo de un job: lo que el worker necesita para procesarlo.
 * Unión discriminada por `type`. El worker no recibe credenciales de la base
 * de datos: solo URLs firmadas.
 *
 * No viaja en el aviso que pasa por la cola del proveedor de GPU (A3): la API
 * envía un `JobDispatchNotice` con solo identificadores, y el contenedor que
 * ejecuta el job pide este objeto a `JobDispatchNotice.dispatch_url` con un
 * `JobDispatchFetch` firmado. La API lo entrega una sola vez por intento.
 */
export type JobDispatch =
  | AvatarJobDispatch
  | GarmentJobDispatch
  | DrapeJobDispatch
  | ColorJobDispatch;

/**
 * Aviso de despacho: lo que la API envía al endpoint del worker (`POST`
 * firmado con `PROBADOR_DISPATCH_SECRET`) y lo único que pasa por la cola del
 * proveedor de GPU. Sin datos personales: ni `user_id`, ni medidas, ni URLs
 * firmadas a fotos.
 */
export interface JobDispatchNotice {
  job_id: UUID;
  type: JobType;
  /**
   * @minimum 1
   * @asType integer
   */
  attempt: number;
  /** Endpoint de la API (`job-dispatch`) donde el contenedor pide el `JobDispatch`. */
  dispatch_url: Url;
  /** `CONTRACTS_VERSION` de la API que despacha. */
  contracts_version: string;
}

/**
 * Cuerpo con el que el contenedor del worker pide el `JobDispatch` a
 * `dispatch_url` (`POST` firmado con `PROBADOR_CALLBACK_SECRET`, el del
 * sentido worker → API). Respuestas: 200 `JobDispatch`; 409 si el intento ya
 * no es el vigente o el despacho ya se entregó.
 */
export interface JobDispatchFetch {
  job_id: UUID;
  /**
   * @minimum 1
   * @asType integer
   */
  attempt: number;
}

/**
 * Lo que el worker envía a `callback_url` (`POST` firmado, igual que el
 * despacho). En `output`, los campos `*_url` de los artefactos que subió el
 * worker van como `storage://<path de output_uploads>` (`StorageRef`); la API
 * los convierte en rutas al persistir. Con `succeeded` es obligatorio
 * `output` (del tipo del job) y con `failed`, `error`.
 */
export interface JobCallback {
  job_id: UUID;
  /** @asType integer */
  attempt: number;
  status: "running" | "succeeded" | "failed";
  progress?: UnitInterval;
  stage?: string;
  output?: AvatarJobOutput | GarmentJobOutput | DrapeJobOutput | ColorJobOutput;
  error?: JobError;
  worker_version: string;
  /**
   * Marca estándar de salida falsa: `true` si el worker corre en modo fake.
   * La API la copia a `Job.fake` y la rechaza salvo que se haya permitido de
   * forma explícita (nunca en producción). Además, por convención, los
   * `model_version` / `pipeline_version` de salidas falsas empiezan por
   * `FAKE_VERSION_PREFIX`.
   */
  fake?: boolean;
}

/** Prefijo de `model_version` / `pipeline_version` en salidas de un worker fake. */
export const FAKE_VERSION_PREFIX = "fake/";

// ---------------------------------------------------------------------------
// Firma de peticiones entre API y workers
// ---------------------------------------------------------------------------
//
// El despacho (API → worker) y el callback (worker → API) se autentican igual:
//
//   x-probador-timestamp: <segundos Unix, entero en decimal>
//   x-probador-signature: sha256=<hex en minúsculas de
//       HMAC-SHA256(secreto, "<timestamp>" + "." + <bytes exactos del cuerpo>)>
//
// - El HMAC se calcula sobre los bytes del cuerpo tal como se envían; quien
//   verifica usa el cuerpo crudo recibido, sin volver a serializar el JSON.
// - Quien verifica rechaza (401) si falta una cabecera, si la firma no
//   coincide (comparación en tiempo constante) o si el timestamp se aleja más
//   de `SIGNATURE_TOLERANCE_SECONDS` de su reloj. Eso acota los reenvíos a esa
//   ventana; dentro de ella, despacho y callback son idempotentes por
//   (`job_id`, `attempt`).
// - Un secreto por sentido, de 32 bytes aleatorios o más, con el mismo nombre
//   de variable en los dos lados: `PROBADOR_DISPATCH_SECRET` (API → worker) y
//   `PROBADOR_CALLBACK_SECRET` (worker → API).
// - Vector de prueba compartido: `fixtures/signature-vector.json`.

export const SIGNATURE_HEADER = "x-probador-signature";
export const SIGNATURE_TIMESTAMP_HEADER = "x-probador-timestamp";
export const SIGNATURE_PREFIX = "sha256=";
/** Desfase máximo admitido entre el timestamp firmado y el reloj de quien verifica. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

// ---------------------------------------------------------------------------
// Errores de la API
// ---------------------------------------------------------------------------

export const API_ERROR_CODES = [
  "invalid_json",
  "invalid_input",
  "unauthorized",
  "invalid_signature",
  "consent_missing",
  "quota_exceeded",
  "not_found",
  "conflict",
  "method_not_allowed",
  "invalid_callback",
  "fake_not_allowed",
  "input_deletion_failed",
  "confirmation_required",
  "storage_not_empty",
  "auth_delete_failed",
  "scans_paused",
  "internal",
] as const;
/**
 * `consent_missing` y `quota_exceeded` coinciden con `JobErrorCode`.
 * `scans_paused` (503): hay una alerta de privacidad abierta (fotos que
 * superan el plazo de borrado) y no se aceptan fotos nuevas hasta resolverla.
 */
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Cuerpo de toda respuesta de error (4xx/5xx) de las Edge Functions. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    /** Mensaje técnico en inglés; la app traduce `code`. */
    message: string;
    /** Detalle estructurado, p. ej. los errores de validación (`{ path, message }[]`). */
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// Derechos del usuario: exportación de datos (arts. 15 y 20 RGPD)
// ---------------------------------------------------------------------------

/** Valor fijo de `DataExport.format`: identifica el fichero exportado. */
export const DATA_EXPORT_FORMAT = "probador.data_export";

/** Validez de las URLs firmadas de una exportación, en segundos. */
export const DATA_EXPORT_SIGNED_URL_TTL_SECONDS = 3600;

/** Cuenta de Auth del usuario (lo que Auth guarda de él y la app conoce). */
export interface DataExportAccount {
  id: UUID;
  email: string | null;
  created_at: ISODateTime;
}

/**
 * Avatar exportado. `glb_url` es una URL firmada temporal; `null` solo si el
 * fichero ya no existe en Storage.
 */
export interface DataExportAvatar extends Omit<Avatar, "glb_url"> {
  glb_url: Url | null;
}

/** Prenda procesada exportada: las URLs firmadas son `null` si el fichero no existe. */
export interface DataExportReadyGarment extends Omit<ReadyGarment, "image_url"> {
  image_url: Url | null;
}

/** Prenda exportada, con sus medidas por talla y URLs firmadas a GLB, patrón y recorte. */
export type DataExportGarment = PendingGarment | DataExportReadyGarment;

/** Entrada de la caché de drapeado exportada; `glb_url` firmada o `null` si no existe. */
export interface DataExportDrapeCache extends Omit<DrapeCache, "glb_url"> {
  glb_url: Url | null;
}

/**
 * Entrada de un job sin rutas internas: las fotos (`photo_path`, `selfie_path`,
 * `image_paths`) ya no existen y su ruta no es un dato del usuario.
 */
export type DataExportJobInput =
  | Omit<AvatarJobInput, "photo_path">
  | Omit<ColorJobInput, "selfie_path">
  | Omit<GarmentJobInput, "image_paths">
  | DrapeJobInput;

/**
 * Job exportado: todo lo que queda de la fila, sin rutas de Storage. `output`
 * son las referencias que conserva `jobs.output` (los datos están en las demás
 * secciones); `input` es la entrada completa sin rutas mientras el job no ha
 * terminado y `RetainedJobInput` cuando ya terminó.
 */
export interface DataExportJob {
  id: UUID;
  type: JobType;
  status: JobStatus;
  progress: UnitInterval;
  stage: string | null;
  input: DataExportJobInput | RetainedJobInput;
  output: JobResult | null;
  error: JobError | null;
  /**
   * @minimum 0
   * @asType integer
   */
  attempts: number;
  worker_version: string | null;
  fake: boolean;
  input_deleted_at: ISODateTime | null;
  created_at: ISODateTime;
  started_at: ISODateTime | null;
  finished_at: ISODateTime | null;
}

/** Embedding de una prenda propia, exportado. */
export interface DataExportGarmentEmbedding extends GarmentEmbedding {
  garment_id: UUID;
}

/**
 * Respuesta 200 de `GET /functions/v1/export-data`: todos los datos del usuario
 * en JSON legible por máquina (derechos de acceso y portabilidad, arts. 15 y
 * 20 RGPD). Las URLs firmadas caducan en `signed_urls_expire_at`.
 */
export interface DataExport {
  format: typeof DATA_EXPORT_FORMAT;
  /** `CONTRACTS_VERSION` de la API que generó la exportación. */
  contracts_version: string;
  exported_at: ISODateTime;
  signed_urls_expire_at: ISODateTime;
  /** Siempre `false`: las fotos de cuerpo, selfies y fotos de prendas se borran al procesarlas. */
  original_photos_retained: false;
  /** Notas legibles para la persona (en español). */
  notes: string[];
  account: DataExportAccount;
  profile: Profile | null;
  consents: Consent[];
  avatars: DataExportAvatar[];
  color_profiles: ColorProfile[];
  garments: DataExportGarment[];
  fit_results: FitResult[];
  user_fit_preferences: UserFitPreferences | null;
  outfits: Outfit[];
  drape_cache: DataExportDrapeCache[];
  /** Embeddings de imagen de las prendas propias (no se sirven a la app, pero son datos del usuario). */
  garment_embeddings: DataExportGarmentEmbedding[];
  jobs: DataExportJob[];
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export function isTerminalJobStatus(status: JobStatus): boolean {
  return (TERMINAL_JOB_STATUSES as readonly JobStatus[]).includes(status);
}

/** Peso de cada señal en el ranking de recomendaciones. */
export const RANKING_WEIGHTS = {
  compatibility: 0.4,
  color: 0.3,
  fit: 0.3,
} as const;

/** Versión del contrato. Sube el mayor cuando un cambio rompe a los workers. */
export const CONTRACTS_VERSION = "0.4.0";
