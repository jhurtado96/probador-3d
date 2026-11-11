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
 * URL https. Para objetos privados de Storage es una URL firmada que caduca:
 * no se persiste en cliente más allá de la sesión.
 * @format uri
 */
export type Url = string;

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
  /**
   * Peso declarado, opcional; mejora la estimación de forma.
   * @minimum 0
   */
  weight_kg?: number;
}

export const BODY_MODELS = ["smplx", "anny"] as const;
/** Modelo corporal paramétrico. `anny` es la alternativa de licencia abierta. */
export type BodyModel = (typeof BODY_MODELS)[number];

export const BODY_MODEL_GENDERS = ["neutral", "female", "male"] as const;
export type BodyModelGender = (typeof BODY_MODEL_GENDERS)[number];

/**
 * Parámetros del modelo corporal. Con `betas` y `gender` basta para
 * reconstruir la forma; la pose de la foto se descarta y el avatar se entrega
 * en la pose canónica.
 */
export interface SmplxParams {
  gender: BodyModelGender;
  /**
   * Coeficientes de forma.
   * @minItems 10
   * @maxItems 300
   */
  betas: number[];
  /**
   * Pose corporal en eje-ángulo, 21 articulaciones × 3. Opcional.
   * @minItems 63
   * @maxItems 63
   */
  body_pose?: number[];
  /**
   * Coeficientes de expresión facial. Opcional.
   * @maxItems 100
   */
  expression?: number[];
}

export const MEASUREMENT_SOURCES = [
  "photo",
  "photo_reference_object",
  "lidar",
  "manual",
] as const;
/** Cómo se obtuvieron las medidas. */
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

export const AVATAR_POSES = ["a_pose", "t_pose", "relaxed"] as const;
export type AvatarPose = (typeof AVATAR_POSES)[number];

/** Avatar 3D del usuario. No contiene ni referencia la foto de origen. */
export interface Avatar {
  id: UUID;
  user_id: UUID;
  body_model: BodyModel;
  /** Versión del modelo corporal y del pipeline, p. ej. `smplx-1.1/avatar-0.3`. */
  model_version: string;
  /** Parámetros del modelo corporal (se llaman `smplx` aunque el modelo sea compatible). */
  smplx: SmplxParams;
  measurements: BodyMeasurements;
  measurements_source: MeasurementSource;
  /** Medidas corregidas a mano por el usuario; prevalecen sobre `measurements`. */
  measurements_override?: Partial<BodyMeasurements>;
  /** GLB del avatar en `pose`, en metros, Y arriba, pies en el origen. */
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
export type Metal = (typeof METALS)[number];

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

/** Valores continuos de los que salen las categorías; sirven para explicar el resultado. */
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

/** Perfil de color del usuario. Solo valores calculados: el selfie se borra. */
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
  hair_lab?: LabColor;
  eye_lab?: LabColor;
  palettes: ColorPalettes;
  metal: Metal;
  /** Confianza de `season`. */
  confidence: UnitInterval;
  /** Otras estaciones plausibles, de mayor a menor confianza. */
  alternatives?: SeasonCandidate[];
  /** Si hubo referencia de blanco válida; sin ella la confianza baja. */
  white_balanced: boolean;
  /** `true` si el usuario eligió la estación a mano. */
  user_overridden?: boolean;
  pipeline_version: string;
  created_at: ISODateTime;
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
  "body_length",
  "thigh",
  "inseam",
  "rise",
  "hem",
] as const;
/**
 * Zona de medida compartida entre prenda y fit. En contornos (`chest`,
 * `waist`, `hip`, `neck`, `bicep`, `thigh`, `hem`) la medida de la prenda es
 * el perímetro completo, no el ancho en plano.
 */
export type FitZone = (typeof FIT_ZONES)[number];

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

/** Atributos del etiquetado automático; todos corregibles por el usuario. */
export interface GarmentAttributes {
  pattern?: GarmentPattern;
  /** Material principal en texto libre normalizado: `cotton`, `denim`, `wool`. */
  material?: string;
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
/** 1 = plantilla paramétrica + textura; 2 = patrón desde foto; 3 = 3D nativo de marca. */
export type GarmentLevel = (typeof GARMENT_LEVELS)[number];

export const GARMENT_STATUSES = ["processing", "ready", "failed"] as const;
export type GarmentStatus = (typeof GARMENT_STATUSES)[number];

/** Prenda del armario del usuario o normalizada desde un producto de tienda. */
export interface Garment {
  id: UUID;
  /** Dueño. `null` en prendas de catálogo de tienda. */
  user_id: UUID | null;
  /** Producto de tienda del que procede, si lo hay. */
  store_product_id?: UUID | null;
  status: GarmentStatus;
  category: GarmentCategory;
  name?: string;
  brand?: string;
  attributes: GarmentAttributes;
  /**
   * Colores dominantes, de mayor a menor proporción.
   * @minItems 1
   */
  colors: GarmentColor[];
  design_fit: DesignFit;
  /** Talla que tiene el usuario (armario) o `null` si es de catálogo. */
  size_label: string | null;
  /** Medidas por talla; en el armario suele haber una sola. */
  measurements: GarmentSizeMeasurements[];
  level: GarmentLevel;
  /** Plantilla paramétrica usada (nivel 1). */
  template_id?: string;
  /** Recorte de la prenda sin fondo ni persona. La foto original no se conserva. */
  image_url: Url;
  /** GLB de la prenda en reposo; `null` mientras `status` es `processing`. */
  glb_url: Url | null;
  /** Campos que el usuario corrigió a mano; el pipeline no los pisa. */
  user_corrected_fields?: string[];
  pipeline_version: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

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
  /** `garment_cm − body_cm`; negativo si la prenda es más pequeña que el cuerpo. */
  ease_cm: number;
  verdict: ZoneVerdict;
}

export const FIT_VERDICTS = ["too_small", "fits", "too_large"] as const;
/** Veredicto global de la talla sobre este cuerpo. */
export type FitVerdict = (typeof FIT_VERDICTS)[number];

export const FIT_METHODS = ["size_chart", "measured", "simulated"] as const;
export type FitMethod = (typeof FIT_METHODS)[number];

/** Resultado de ajuste de una prenda y talla sobre un avatar. */
export interface FitResult {
  id: UUID;
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
  /** Ajuste respecto a las preferencias del usuario; entra en el ranking con peso 0,3. */
  score: UnitInterval;
  /** Talla recomendada si no es `size_label`. */
  recommended_size_label?: string;
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
  avatar_id: UUID;
  name?: string;
  /** @minItems 1 */
  items: OutfitItem[];
  source: OutfitSource;
  scores?: OutfitScores;
  occasion?: string;
  /** Miniatura renderizada del outfit. */
  preview_url?: Url;
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
  "low_image_quality",
  "consent_missing",
  "timeout",
  "internal",
] as const;
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
  height_cm: Centimeters;
  /** @minimum 0 */
  weight_kg?: number;
  gender?: BodyModelGender;
  /** Consentimiento vigente que ampara este tratamiento. */
  consent_id: UUID;
}

/** Salida del job `avatar`. */
export interface AvatarJobOutput {
  avatar: Avatar;
  /** Momento en que se borró la foto de entrada. */
  input_deleted_at: ISODateTime;
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
  input_deleted_at: ISODateTime;
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
  size_label?: string;
  brand?: string;
}

/** Salida del job `garment`. */
export interface GarmentJobOutput {
  garment: Garment;
  /** Momento en que se borraron las fotos originales (queda solo el recorte). */
  input_deleted_at: ISODateTime;
}

export const DRAPE_QUALITIES = ["preview", "final"] as const;
export type DrapeQuality = (typeof DRAPE_QUALITIES)[number];

/** Entrada del job `drape`. */
export interface DrapeJobInput {
  avatar_id: UUID;
  garment_id: UUID;
  size_label: string;
  pose: AvatarPose;
  quality: DrapeQuality;
}

/** Salida del job `drape`. */
export interface DrapeJobOutput {
  /** GLB de la prenda ya drapeada, en el mismo sistema de coordenadas que el avatar. */
  glb_url: Url;
  /** hash(shape_hash, garment_id, versión de prenda, talla, pose, calidad, versión del simulador). */
  cache_key: string;
  /** `true` si salió de `drape_cache` sin simular. */
  cache_hit: boolean;
  fit_result?: FitResult;
}

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
  input: I;
  /** Presente solo si `status` es `succeeded`. */
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
  worker_version?: string;
  created_at: ISODateTime;
  started_at: ISODateTime | null;
  finished_at: ISODateTime | null;
}

export type AvatarJob = JobBase<"avatar", AvatarJobInput, AvatarJobOutput>;
export type GarmentJob = JobBase<"garment", GarmentJobInput, GarmentJobOutput>;
export type DrapeJob = JobBase<"drape", DrapeJobInput, DrapeJobOutput>;
export type ColorJob = JobBase<"color", ColorJobInput, ColorJobOutput>;

/** Fila de `jobs`. Unión discriminada por `type`. */
export type Job = AvatarJob | GarmentJob | DrapeJob | ColorJob;

export interface JobInputByType {
  avatar: AvatarJobInput;
  garment: GarmentJobInput;
  drape: DrapeJobInput;
  color: ColorJobInput;
}

export interface JobOutputByType {
  avatar: AvatarJobOutput;
  garment: GarmentJobOutput;
  drape: DrapeJobOutput;
  color: ColorJobOutput;
}

/** Cuerpo de `POST /functions/v1/jobs`: lo que la app envía para crear un job. */
export type CreateJobRequest =
  | { type: "avatar"; input: AvatarJobInput }
  | { type: "garment"; input: GarmentJobInput }
  | { type: "drape"; input: DrapeJobInput }
  | { type: "color"; input: ColorJobInput };

/** Una URL firmada de subida que la API entrega al worker para un artefacto de salida. */
export interface SignedUpload {
  /** Nombre lógico del artefacto: `glb`, `image`, `preview`. */
  name: string;
  path: StoragePath;
  upload_url: Url;
}

/**
 * Lo que la API envía al worker al despachar un job. El worker no recibe
 * credenciales de la base de datos: solo URLs firmadas de vida corta.
 */
export interface JobDispatch {
  job_id: UUID;
  type: JobType;
  input: AvatarJobInput | GarmentJobInput | DrapeJobInput | ColorJobInput;
  /** URLs firmadas de descarga, una por cada ruta de entrada, indexadas por ruta. */
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
}

/**
 * Lo que el worker envía a `callback_url`, firmado con HMAC-SHA256 en la
 * cabecera `x-probador-signature`. En `output`, los campos `*_url` de los
 * artefactos que subió el worker van como `storage://<path de output_uploads>`;
 * la API los convierte en rutas al persistir y en URLs firmadas al servir.
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
export const CONTRACTS_VERSION = "0.1.0";
