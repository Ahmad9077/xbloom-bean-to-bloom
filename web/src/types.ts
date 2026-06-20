export type BrewMode = "cold" | "hot";

export interface AuthUser {
  id: string;
  username: string;
  role: "admin" | "user";
}

export interface BeanMetadata {
  coffeeType: string;
  variety: string;
  origin: string;
  processingMethod: string;
  roastLevel: "light" | "medium" | "dark";
  flavors: string[];
  description: string;
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
  brewRatio: string;
  totalVolumeMl: number;
  doseG: number;
  grindSize: number;
  rpm: number;
  pours: Pour[];
  bean: BeanMetadata;
  icedServing?: IcedServingInstruction;
}

export interface RecipeListItem {
  id: string;
  fullName: string;
  beanName: string;
  createdAt: number;
  link: string;
}

export interface BridgeJob {
  id: string;
  recipeId: string;
  status: "pending" | "claimed" | "completed" | "failed";
  safeError?: string | null;
  createdAt: number;
  updatedAt: number;
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
