import { parquetReadObjects } from 'hyparquet';

import type {
  Column,
  ColumnRow,
  Data,
  Dataset,
  DatasetRow,
  Join,
  JoinRow,
  Manifest,
} from './types';

export const MIN_SCORE = 0.3;

const BASE = `${import.meta.env.BASE_URL}data`;

let manifestRequest: Promise<Manifest> | undefined;

/** The manifest alone, fetched once and shared with `loadData`. */
export function loadManifest() {
  return (manifestRequest ??= readJson<Manifest>(`${BASE}/manifest.json`));
}

export async function loadData(): Promise<Data> {
  const [manifest, datasets, columns, joins] = await Promise.all([
    loadManifest(),
    readParquet<DatasetRow>(`${BASE}/datasets.parquet`),
    readParquet<ColumnRow>(`${BASE}/columns.parquet`),
    readParquet<JoinRow>(`${BASE}/joins.parquet`),
  ]);
  return buildData(manifest, datasets, columns, joins);
}

export function buildData(
  manifest: Manifest,
  datasetRows: DatasetRow[],
  columnRows: ColumnRow[],
  joinRows: JoinRow[],
): Data {
  const datasets = datasetsFrom(manifest, datasetRows);
  const columns = columnRows.map(row => columnFromRow(row, datasets));
  attachJoins(columns, joinRows);
  listColumns(columns);

  return {
    analyzedAt: new Date(manifest.created_at),
    columns,
    byKey: new Map(columns.map(c => [c.key, c])),
    datasets: byTitle([...datasets.values()]),
  };
}

// Fetching

async function fetchOk(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

async function readJson<T>(url: string) {
  return (await (await fetchOk(url)).json()) as T;
}

async function readParquet<T>(url: string) {
  const file = await (await fetchOk(url)).arrayBuffer();
  return (await parquetReadObjects({ file })) as T[];
}

// Building

function newDataset(name: string, title = name, publisher = ''): Dataset {
  return {
    name,
    title,
    publisher,
    excerpt: '',
    description: '',
    topics: [],
    civicIssues: [],
    tags: [],
    columns: [],
    joinable: false,
  };
}

/** The manifest's datasets, described by `datasets.parquet` where it has them. */
function datasetsFrom(manifest: Manifest, rows: DatasetRow[]) {
  const datasets = new Map(
    manifest.packages.map(p => [
      p.name,
      newDataset(p.name, p.title || p.name, p.owner ?? ''),
    ]),
  );
  for (const row of rows)
    Object.assign(datasetNamed(datasets, row.name), {
      title: row.title || row.name,
      publisher: row.publisher,
      excerpt: row.excerpt,
      description: row.description,
      topics: row.topics,
      civicIssues: row.civic_issues,
      tags: row.tags,
    });
  return datasets;
}

/** The dataset with this name, added if the manifest doesn't list it. */
function datasetNamed(datasets: Map<string, Dataset>, name: string) {
  if (!datasets.has(name)) datasets.set(name, newDataset(name));
  return datasets.get(name)!;
}

function columnFromRow(row: ColumnRow, datasets: Map<string, Dataset>): Column {
  return {
    id: row.id,
    key: row.key,
    name: row.column,
    resource: row.resource,
    dataset: datasetNamed(datasets, row.package),
    samples: row.samples,
    joinable: false,
    joins: [],
  };
}

/** Gives each column its joins. They arrive sorted by score, so each list stays best first. */
function attachJoins(columns: Column[], joinRows: JoinRow[]) {
  for (const row of joinRows) {
    if (row.score < MIN_SCORE) break;
    const a = columns[row.id_a];
    const b = columns[row.id_b];
    a.joins.push(joinTo(b, row.containment_a_in_b, row.containment_b_in_a, row));
    b.joins.push(joinTo(a, row.containment_b_in_a, row.containment_a_in_b, row));
  }
}

function joinTo(
  other: Column,
  contained: number,
  contains: number,
  { shared, score }: JoinRow,
): Join {
  return { other, contained, contains, shared, score };
}

function joinsAnotherDataset(column: Column) {
  return column.joins.some(j => j.other.dataset !== column.dataset);
}

/** Lists each dataset's columns, flagging those that join with another dataset. */
function listColumns(columns: Column[]) {
  for (const column of columns) {
    column.joinable = joinsAnotherDataset(column);
    column.dataset.columns.push(column);
    if (column.joinable) column.dataset.joinable = true;
  }
}

function byTitle(datasets: Dataset[]) {
  return datasets.sort((a, b) => a.title.localeCompare(b.title));
}
