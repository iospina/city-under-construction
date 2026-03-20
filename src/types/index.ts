// ---------------------------------------------------------------------------
// Permit — used by the UI
// Matches the Build Data Schema exactly.
// ---------------------------------------------------------------------------
export interface Permit {
  trackingNumber: string;
  jobFilingNumber: string;
  sequenceNumber: number;
  permitStatus: string;
  workPermitText: string;
  filingReason: string;
  workType: string;
  workLocation: string;
  jobDescription: string;
  estimatedJobCost: number;
  approvedDate: string;
  issuedDate: string;
  expiredDate: string;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Parcel — used by the UI
// Matches the Build Data Schema exactly.
// ---------------------------------------------------------------------------
export interface Parcel {
  parcelId: string;
  bbl: string;
  displayAddress: string;
  borough: string;
  nta: string;
  censusTract: string;
  communityBoard: string;
  councilDistrict: string;
  latitude: number;
  longitude: number;
  hasActivePermit: boolean;
  activePermits: Permit[];
  permitHistory: Permit[];
  latestPermitSummary: string | null;
}

// ---------------------------------------------------------------------------
// RawPermitRow — shape of the rows returned by the NYC Open Data API
// (dataset rbx6-tga4).  Field names use the API's snake_case convention.
// ---------------------------------------------------------------------------
export interface RawPermitRow {
  borough: string;
  community_board: string;
  council_district: string;
  census_tract: string;
  nta: string;
  bin: string;
  bbl: string;
  house_number: string;
  street_name: string;
  job_filing_number: string;
  job_doc_number: string;
  tracking_number: string;
  sequence_number: string;
  work_permit_type: string;
  permit_status: string;
  filing_reason: string;
  work_type: string;
  work_on_floor: string;
  job_description: string;
  estimated_job_cost: string;
  approved_date: string;
  issued_date: string;
  expired_date: string;
  latitude: string;
  longitude: string;
  // Additional fields may exist; we only declare the ones we use.
  [key: string]: string | undefined;
}

// ---------------------------------------------------------------------------
// Search suggestion from Mapbox Geocoding API
// ---------------------------------------------------------------------------
export interface SearchSuggestion {
  id: string;
  placeName: string;
  text: string;
  center: [number, number]; // [lng, lat]
}
