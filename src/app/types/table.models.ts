export type CellValue = string | number | boolean | null;

export interface TableRow {
  id: string;
  orderNo: string;
  customer: string;
  region: string;
  category: string;
  owner: string;
  amount: number;
  quantity: number;
  margin: number;
  status: '待审核' | '进行中' | '已发货' | '已完成' | '异常';
  updatedAt: string;
  parentId: string | null;
  [key: string]: CellValue;
}

export type FilterOperator =
  | 'contains'
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in';

export interface FilterCondition {
  kind: 'condition';
  id: string;
  field: keyof TableRow;
  operator: FilterOperator;
  value: string;
}

export interface FilterGroup {
  kind: 'group';
  id: string;
  logic: 'and' | 'or';
  children: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  field: keyof TableRow;
  direction: SortDirection;
}

export interface ColumnDefinition {
  key: keyof TableRow;
  label: string;
  width: number;
  minWidth: number;
  align?: 'left' | 'right' | 'center';
  editable?: boolean;
  formatter?: 'currency' | 'percent' | 'date' | 'status';
  type: 'text' | 'number' | 'date' | 'enum' | 'boolean';
}

export interface QueryRequest {
  page: number;
  pageSize: number;
  sort: SortState | null;
  filter: FilterGroup;
  groupBy: keyof TableRow | null;
  treeMode: boolean;
  expandedIds: string[];
  search: string;
}

export interface AggregateResult {
  amount: number;
  quantity: number;
  averageMargin: number;
}

export interface GroupSummary {
  key: string;
  count: number;
  aggregate: AggregateResult;
}

export interface QueryResult {
  rows: TableRow[];
  total: number;
  aggregates: AggregateResult;
  groups: GroupSummary[];
  elapsedMs: number;
}

export interface SavedView {
  id: string;
  name: string;
  createdAt: string;
  pageSize: number;
  visibleColumns: Array<keyof TableRow>;
  columnWidths: Record<string, number>;
  pinnedColumns: Array<keyof TableRow>;
  sort: SortState | null;
  filter: FilterGroup;
  groupBy: keyof TableRow | null;
  treeMode: boolean;
}

export interface TableState {
  rows: TableRow[];
  total: number;
  groups: GroupSummary[];
  aggregates: AggregateResult;
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  sort: SortState | null;
  filter: FilterGroup;
  search: string;
  groupBy: keyof TableRow | null;
  treeMode: boolean;
  expandedIds: string[];
  selectedIds: string[];
  visibleColumns: Array<keyof TableRow>;
  columnWidths: Record<string, number>;
  pinnedColumns: Array<keyof TableRow>;
  density: 'compact' | 'standard' | 'comfortable';
  elapsedMs: number;
  savedViews: SavedView[];
  activeViewId: string | null;
  dirtyCells: Record<string, CellValue>;
}
