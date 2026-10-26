/**
 * CrossMetric domain types.
 *
 * Two layers live here:
 *  1. The *package* format published by the Python pipeline
 *     (pipeline/publish/package.py). These mirror that JSON exactly.
 *  2. The *analysis* types the engine produces from a package plus the
 *     user's current configuration.
 */

// ---------------------------------------------------------------------------
// Model configuration (packages/engine/model/crossmetric-model.json)
// ---------------------------------------------------------------------------

export type ComponentId = "crash" | "injury" | "pedestrian" | "traffic" | "proximity";
export type ScenarioId = "standard" | "pedestrian" | "injury" | "crash";
export type PriorityBandId = "high" | "elevated" | "moderate" | "lower";
export type StabilityLevel = "high" | "moderate" | "low";
export type MeasureId = "crashes" | "injuryCrashes" | "pedestrianCrashes" | "aadt" | "distanceM";

export interface ScoringComponent {
  id: ComponentId;
  label: string;
  kind: "evidence" | "context";
  measure: MeasureId;
  unit: string;
  direction: "higher-is-priority" | "lower-is-priority";
  missing?: "exclude-and-reweight";
  description: string;
}

export interface SensitivityScenario {
  id: ScenarioId;
  label: string;
  description: string;
  weights: Record<ComponentId, number>;
}

export interface PriorityBand {
  id: PriorityBandId;
  label: string;
  shortLabel: string;
  min: number;
}

export interface ThresholdRule {
  minPositions: number;
  shareOfCandidates: number;
}

export interface ScoringModel {
  version: string;
  name: string;
  released: string;
  normalization: {
    method: string;
    population: string;
    formula: string;
    zeroEvidenceRule: string;
    reference: string;
  };
  components: ScoringComponent[];
  scenarios: SensitivityScenario[];
  scenarioRationale: string;
  combination: { formula: string; rounding: string; tieBreak: string[] };
  bands: PriorityBand[];
  stability: { method: string; definition: string; high: ThresholdRule; moderate: ThresholdRule };
  planner: { coverageRadiusM: number; definition: string };
  periods: { id: PeriodYears; label: string; months: number }[];
  periodRationale: string;
  radii: RadiusMeters[];
  crashFilters: { id: CrashFilterId; label: string }[];
}

/** A model version as recorded with every analysis. */
export interface ModelVersion {
  version: string;
  released: string;
}

// ---------------------------------------------------------------------------
// Published package (one per school)
// ---------------------------------------------------------------------------

export interface School {
  id: string; // 12-digit NCES school ID
  name: string;
  district: string | null;
  city: string | null;
  county: string | null;
  street: string | null;
  zip: string | null;
  level: string | null;
  gradeLow: string | null;
  gradeHigh: string | null;
  schoolType: string | null;
  schoolYear: string | null;
  lon: number;
  lat: number;
  /** "college" for IPEDS institutions (6-digit unit id); absent or "k12" for NCES public schools. */
  institutionType?: "k12" | "college";
  website?: string | null;
}

export type TrafficStatus = "measured" | "partial" | "unavailable";

/** Traffic exposure for a candidate. `aadt === null` means unavailable — never zero. */
export interface TrafficRecord {
  aadt: number | null;
  year: number | null;
  status: TrafficStatus;
  roadsCounted: number;
  roadsTotal: number;
}

export interface PointGeometry {
  type: "Point";
  coordinates: [number, number];
}
export interface LineGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

export type CandidateKind = "intersection" | "segment";

export interface CandidateLocation {
  id: string;
  kind: CandidateKind;
  name: string;
  context: string | null;
  roads: string[];
  distanceM: number;
  functionalClass: number;
  lanes: number | null;
  lengthM: number | null;
  legs: number | null;
  signal: "gdot-permitted" | "no-record";
  traffic: TrafficRecord;
  geometry: PointGeometry | LineGeometry;
}

/** A mid-block analysis unit is a candidate whose geometry is a road segment. */
export type RoadSegment = CandidateLocation & { kind: "segment"; geometry: LineGeometry };

/** Bit flags on each crash record (must match pipeline/publish/package.py). */
export const CRASH_FLAG = {
  injury: 1,
  fatal: 2,
  pedestrian: 4,
  bicyclist: 8,
  lowLight: 16,
} as const;

/** Columnar crash storage: index i across every array is one crash. */
export interface CrashColumns {
  id: string[];
  candidate: number[];
  day: number[];
  flags: number[];
  collision: number[];
  light: number[];
  lon: number[];
  lat: number[];
}

export interface AssociationQuality {
  recordedNearby: number;
  assigned: number;
  off_network: number;
  limited_access: number;
  ramp: number;
  no_candidate: number;
  outside_school_areas?: number;
}

export interface SchoolPackage {
  schemaVersion: 1;
  modelVersion: string;
  generatedAt: string;
  school: School;
  window: { start: string; end: string };
  candidates: CandidateLocation[];
  crashes: CrashColumns;
  quality: AssociationQuality;
}

/** One crash, decoded from the columnar package for display. */
export interface CrashRecord {
  id: string;
  candidateId: string;
  date: string; // YYYY-MM-DD
  injury: boolean;
  fatal: boolean;
  pedestrian: boolean;
  bicyclist: boolean;
  lowLight: boolean;
  collision: number;
  light: number;
  lon: number;
  lat: number;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export type RadiusMeters = 400 | 800 | 1200;
export type PeriodYears = 1 | 3;
export type CrashFilterId = "all" | "injury" | "pedestrian" | "lowLight";

export interface AnalysisConfiguration {
  radiusM: RadiusMeters;
  periodYears: PeriodYears;
  crashFilter: CrashFilterId;
  scenario: ScenarioId;
}

export interface CandidateFeatures {
  crashes: number;
  injuryCrashes: number;
  fatalCrashes: number;
  pedestrianCrashes: number;
  bicyclistCrashes: number;
  lowLightCrashes: number;
  aadt: number | null;
  distanceM: number;
}

export interface ScoreComponent {
  id: ComponentId;
  label: string;
  /** 0–100 percentile score, or null when the data is unavailable. */
  score: number | null;
  /** Raw value behind the score (crashes, vehicles/day, meters); null when unavailable. */
  rawValue: number | null;
  unit: string;
  weight: number;
  /** Share of the final priority contributed by this component (0–1). */
  contribution: number;
}

export interface ScoreBreakdown {
  components: ScoreComponent[];
  /** Sum of the weights actually used (components with data). */
  weightUsed: number;
  excluded: ComponentId[];
}

export interface RankingStability {
  level: StabilityLevel;
  bestRank: number;
  worstRank: number;
  spread: number;
  tolerance: { high: number; moderate: number };
}

export interface SensitivityResult {
  ranks: Record<ScenarioId, number>;
  priorities: Record<ScenarioId, number>;
  stability: RankingStability;
}

export interface ScoredCandidate {
  candidate: CandidateLocation;
  index: number; // index in the package's candidate array
  features: CandidateFeatures;
  breakdown: ScoreBreakdown;
  priority: number; // full precision
  displayPriority: number; // rounded integer shown to people
  band: PriorityBand;
  rank: number;
  sensitivity: SensitivityResult;
}

export interface AnalysisResult {
  config: AnalysisConfiguration;
  school: School;
  model: ModelVersion;
  periodWindow: { start: string; end: string };
  population: number;
  /** Sorted by rank (1 = highest priority). */
  candidates: ScoredCandidate[];
  matchedCrashes: number;
  bandCounts: Record<PriorityBandId, number>;
}

export interface PlannerSelection {
  slot: number;
  scored: ScoredCandidate;
  /** True when the candidate stays inside the top-N under every scenario. */
  robust: boolean;
}

export interface PlannerSkip {
  scored: ScoredCandidate;
  coveredBySlot: number;
  distanceM: number;
  sharedRoad: string;
}

export interface PlannerResult {
  capacity: number;
  selections: PlannerSelection[];
  skipped: PlannerSkip[];
  robustCount: number;
  exhausted: boolean;
}

export interface DataSourceMetadata {
  id: string;
  title: string;
  publisher: string;
  url: string;
  role: string;
  records: number | null;
}

export interface ValidationResult {
  id: string;
  title: string;
  reference: string;
  description: string;
  metrics: { label: string; value: number | null; display: string; note?: string }[];
}

export interface Explanation {
  headline: string;
  drivers: string[];
  context: string[];
  caveats: string[];
}
