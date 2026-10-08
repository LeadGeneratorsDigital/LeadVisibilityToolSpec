import type { BuyerGroupInput, PhraseInput, RankingInput } from "@lvt/shared";

export type LeadStatus = "active" | "paused" | "converted";

export interface LocationCode {
  code: string;
  label: string;
  data4seo_location_code: number;
}

export interface Lead {
  id: string;
  business_name: string;
  industry: string | null;
  location_code: string | null;
  website_domain: string | null;
  status: LeadStatus;
  brief: string;
  date_added: string;
  next_email_due: string | null;
  last_ranking_pull: string | null;
}

export interface Contact {
  id?: string;
  lead_id?: string;
  name: string;
  job_title: string | null;
  email: string;
  sort_order: number;
}

export type BuyerGroup = BuyerGroupInput & { lead_id: string };
export type Phrase = PhraseInput & { lead_id: string };
export type Ranking = RankingInput;

export interface PullRun {
  id: string;
  lead_id: string;
  status: "running" | "succeeded" | "failed";
  phrases_total: number;
  phrases_done: number;
  phrases_failed: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export const STATUS_LABEL: Record<LeadStatus, string> = { active: "Active", paused: "Paused", converted: "Converted" };
