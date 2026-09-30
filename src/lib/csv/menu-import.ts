// ============================================================================
// src/lib/csv/menu-import.ts
//
// CSV parsing + validation for bulk menu upload.
//
// Schema (one row per product):
//   name             required, 1-255 chars
//   category         required, free text — auto-created if doesn't exist
//   price            required, decimal (e.g. "12.50") — converted to cents
//   sku              optional
//   description      optional
//   cost             optional, decimal — converted to cents
//   prep_time_mins   optional, integer minutes
//   image_filename   optional — must match a file in the images folder picker
//   is_active        optional — "true"/"false"/"yes"/"no" — default true
//   sort_order       optional, integer
//
// Returns parsed rows + per-row validation errors + summary stats.
// ============================================================================

import Papa from "papaparse";

export type CsvCell = string | undefined;

export interface RawMenuRow {
  name?: CsvCell;
  category?: CsvCell;
  price?: CsvCell;
  sku?: CsvCell;
  description?: CsvCell;
  cost?: CsvCell;
  prep_time_mins?: CsvCell;
  image_filename?: CsvCell;
  is_active?: CsvCell;
  sort_order?: CsvCell;
  [key: string]: CsvCell;
}

export interface ParsedMenuRow {
  rowNumber: number; // 1-indexed (matches user's spreadsheet)
  name: string;
  category: string;
  priceCents: number;
  sku?: string;
  description?: string;
  costCents?: number;
  prepTimeMinutes?: number;
  imageFilename?: string;
  isActive: boolean;
  sortOrder?: number;
}

export interface RowError {
  rowNumber: number;
  field: string;
  message: string;
  raw: CsvCell;
}

export interface ParseResult {
  valid: ParsedMenuRow[];
  errors: RowError[];
  summary: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    distinctCategories: string[];
    distinctImages: string[];
    missingImages: string[]; // image_filename values
  };
}

// ============================================================================
// Required CSV columns
// ============================================================================
export const REQUIRED_COLUMNS = ["name", "category", "price"] as const;
export const OPTIONAL_COLUMNS = [
  "sku",
  "description",
  "cost",
  "prep_time_mins",
  "image_filename",
  "is_active",
  "sort_order",
] as const;
export const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS] as const;

// ============================================================================
// Cell parsers
// ============================================================================

function isBlank(v: CsvCell): boolean {
  return v == null || String(v).trim() === "";
}

function parseString(v: CsvCell): string | undefined {
  if (isBlank(v)) return undefined;
  return String(v).trim();
}

function parseMoneyToCents(v: CsvCell): { ok: true; cents: number } | { ok: false; reason: string } {
  if (isBlank(v)) return { ok: false, reason: "empty" };

  // Allow values like "12.50", "12.5", "12", "$12.50", "12,50"
  const cleaned = String(v).trim().replace(/[$\s]/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { ok: false, reason: `not a number: "${v}"` };
  if (n < 0) return { ok: false, reason: `cannot be negative: ${n}` };

  return { ok: true, cents: Math.round(n * 100) };
}

function parseInteger(v: CsvCell, opts: { min?: number } = {}):
  | { ok: true; value: number }
  | { ok: false; reason: string } {
  if (isBlank(v)) return { ok: false, reason: "empty" };
  const n = Number(String(v).trim());
  if (!Number.isInteger(n)) return { ok: false, reason: `not an integer: "${v}"` };
  if (opts.min !== undefined && n < opts.min) {
    return { ok: false, reason: `must be >= ${opts.min}` };
  }
  return { ok: true, value: n };
}

function parseBoolean(v: CsvCell, defaultValue: boolean): boolean {
  if (isBlank(v)) return defaultValue;
  const s = String(v).trim().toLowerCase();
  if (["true", "yes", "y", "1", "active"].includes(s)) return true;
  if (["false", "no", "n", "0", "inactive"].includes(s)) return false;
  return defaultValue;
}

// ============================================================================
// Main parse + validate
// ============================================================================

export function parseMenuCsv(csvText: string): ParseResult {
  const result = Papa.parse<RawMenuRow>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
    dynamicTyping: false, // keep everything as string, we parse explicitly
  });

  const errors: RowError[] = [];
  const valid: ParsedMenuRow[] = [];
  const distinctCategories = new Set<string>();
  const distinctImages = new Set<string>();

  // Check required columns are present
  const headers = result.meta.fields ?? [];
  const missingHeaders = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missingHeaders.length > 0) {
    return {
      valid: [],
      errors: [
        {
          rowNumber: 0,
          field: "headers",
          message: `Missing required columns: ${missingHeaders.join(", ")}`,
          raw: headers.join(","),
        },
      ],
      summary: {
        totalRows: 0,
        validRows: 0,
        errorRows: 0,
        distinctCategories: [],
        distinctImages: [],
        missingImages: [],
      },
    };
  }

  // Process each row
  result.data.forEach((row, i) => {
    const rowNumber = i + 2; // CSV row 1 is the header, data starts at 2
    const rowErrors: RowError[] = [];

    const name = parseString(row.name);
    if (!name) {
      rowErrors.push({ rowNumber, field: "name", message: "Required", raw: row.name });
    } else if (name.length > 255) {
      rowErrors.push({
        rowNumber,
        field: "name",
        message: `Too long (${name.length} chars). Max 255.`,
        raw: row.name,
      });
    }

    const category = parseString(row.category);
    if (!category) {
      rowErrors.push({
        rowNumber,
        field: "category",
        message: "Required",
        raw: row.category,
      });
    } else if (category.length > 100) {
      rowErrors.push({
        rowNumber,
        field: "category",
        message: `Too long (${category.length} chars). Max 100.`,
        raw: row.category,
      });
    }

    const priceResult = parseMoneyToCents(row.price);
    let priceCents = 0;
    if (!priceResult.ok) {
      rowErrors.push({
        rowNumber,
        field: "price",
        message: `Invalid price: ${priceResult.reason}`,
        raw: row.price,
      });
    } else {
      priceCents = priceResult.cents;
    }

    // Optional fields
    let costCents: number | undefined;
    if (!isBlank(row.cost)) {
      const r = parseMoneyToCents(row.cost);
      if (!r.ok) {
        rowErrors.push({
          rowNumber,
          field: "cost",
          message: `Invalid cost: ${r.reason}`,
          raw: row.cost,
        });
      } else {
        costCents = r.cents;
      }
    }

    let prepTimeMinutes: number | undefined;
    if (!isBlank(row.prep_time_mins)) {
      const r = parseInteger(row.prep_time_mins, { min: 0 });
      if (!r.ok) {
        rowErrors.push({
          rowNumber,
          field: "prep_time_mins",
          message: `Invalid prep time: ${r.reason}`,
          raw: row.prep_time_mins,
        });
      } else {
        prepTimeMinutes = r.value;
      }
    }

    let sortOrder: number | undefined;
    if (!isBlank(row.sort_order)) {
      const r = parseInteger(row.sort_order, { min: 0 });
      if (!r.ok) {
        rowErrors.push({
          rowNumber,
          field: "sort_order",
          message: `Invalid sort order: ${r.reason}`,
          raw: row.sort_order,
        });
      } else {
        sortOrder = r.value;
      }
    }

    const sku = parseString(row.sku);
    const description = parseString(row.description);
    const imageFilename = parseString(row.image_filename);
    const isActive = parseBoolean(row.is_active, true);

    // If any errors on this row, collect them and skip
    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      return;
    }

    // Row passes — track for summary
    if (category) distinctCategories.add(category);
    if (imageFilename) distinctImages.add(imageFilename);

    valid.push({
      rowNumber,
      name: name!,
      category: category!,
      priceCents,
      sku,
      description,
      costCents,
      prepTimeMinutes,
      imageFilename,
      isActive,
      sortOrder,
    });
  });

  return {
    valid,
    errors,
    summary: {
      totalRows: result.data.length,
      validRows: valid.length,
      errorRows: errors.length,
      distinctCategories: [...distinctCategories].sort(),
      distinctImages: [...distinctImages].sort(),
      missingImages: [], // filled in by client after folder picker
    },
  };
}

// ============================================================================
// CSV TEMPLATE — what the user downloads as starter
// ============================================================================

export function generateMenuCsvTemplate(): string {
  const headers = ALL_COLUMNS.join(",");
  const exampleRow = [
    "Classic Burger",
    "Burgers",
    "12.50",
    "BRG-001",
    "1/3 lb beef patty with cheese, lettuce, tomato",
    "4.20",
    "8",
    "classic-burger.jpg",
    "true",
    "1",
  ]
    .map((v) => (v.includes(",") ? `"${v}"` : v))
    .join(",");

  const secondRow = [
    "Veggie Wrap",
    "Wraps",
    "9.75",
    "WRP-002",
    "Hummus, spinach, peppers, feta",
    "2.80",
    "5",
    "veggie-wrap.jpg",
    "true",
    "2",
  ]
    .map((v) => (v.includes(",") ? `"${v}"` : v))
    .join(",");

  return [
    headers,
    exampleRow,
    secondRow,
  ].join("\n");
}
