export type BrewMode = "cold" | "hot";
export type BrewStrength = "strong" | "soft";
export type RoastLevel = "light" | "medium_light" | "medium" | "medium_dark" | "dark" | "unknown";
export type RecipeRating = 1 | -1 | null;
export type RecipeComplaint = "sour" | "bitter" | "weak" | "harsh";

export interface AuthUser {
  id: string;
  username: string;
  role: "admin" | "user";
}

export interface BeanMetadata {
  storeName?: string;
  beanName?: string;
  coffeeType: string;
  variety: string;
  origin: string;
  processingMethod: string;
  roastLevel: RoastLevel;
  flavors: string[];
  description: string;
}

export interface RecipeProfileOption {
  id: string;
  labelEn: string;
  labelAr?: string;
  emoji?: string;
}

export interface PendingRecipeConfirmation {
  ok: true;
  requestId: string;
  needsConfirmation: true;
  confirmationId: string;
  brewMode: BrewMode;
  strength: BrewStrength;
  bean: BeanMetadata;
  missingFields: string[];
  suggestedProfile: string;
  classifierConfidence: number;
  profileOptions: RecipeProfileOption[];
  analysisFallback: boolean;
  expiresAt: number;
}

export interface CreatedRecipeResponse {
  id: string;
  link: string;
  recipe: Recipe;
  cached?: boolean;
  profile?: string;
  rulesVersion?: string;
}

export type CreateRecipeResponse = PendingRecipeConfirmation | CreatedRecipeResponse;

export interface ConfirmationRecipeDetails {
  finalDrinkMl: number;
  roastLevel: RoastLevel;
  origin?: string;
  processingMethod?: string;
  description?: string;
}

export interface Pour {
  label: string;
  volumeMl: number;
  tempC: number;
  flowRateMlPerSec: number;
  pauseSec: number;
  pattern: "centered" | "spiral" | "circular";
  agitationBefore: boolean;
  agitationAfter: boolean;
}

export interface IcedServingInstruction {
  iceG: number;
  totalBeverageMl: number;
  instruction: string;
}

export interface Recipe {
  name: string;
  machine: string;
  dripper: string;
  brewMode: BrewMode;
  strength: BrewStrength;
  brewRatio: string;
  totalVolumeMl: number;
  doseG: number;
  grindSize: number;
  rpm: number;
  pours: Pour[];
  bean: BeanMetadata;
  icedServing?: IcedServingInstruction;
  profile?: string;
  rulesVersion?: string;
  fingerprint?: string;
  engine?: string;
  engineVersion?: string;
  tasteRationale?: string;
  retuneRevision?: number;
  rating?: RecipeRating;
  ratingComplaint?: RecipeComplaint | null;
}

export interface RecipeRatingResponse {
  rating: RecipeRating;
  complaint: RecipeComplaint | null;
}

export interface RetunedRecipeResponse {
  id: string;
  link: string;
  recipe: Recipe;
  cached?: boolean;
}

export interface RecipeListItem {
  id: string;
  fullName: string;
  storeName?: string;
  beanName: string;
  createdAt: number;
  link: string;
}

export interface AdminUserRecipeListResponse {
  user: {
    id: string;
    username: string;
  };
  recipes: RecipeListItem[];
}

export interface AdminUserRecipeResponse {
  user: {
    id: string;
    username: string;
  };
  recipe: Recipe;
}

export interface BridgeJob {
  id: string;
  recipeId: string;
  status: "pending" | "claimed" | "completed" | "failed";
  safeError?: string | null;
  createdAt: number;
  updatedAt: number;
  shareLink?: string | null;
}

export interface AdminUser {
  id: string;
  username: string;
  role: "admin" | "user";
  enabled: boolean;
  isPrimary: boolean;
  recipeCount: number;
  createdAt: number;
}
