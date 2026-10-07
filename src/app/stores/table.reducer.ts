import { createReducer, on } from '@ngrx/store';
import {
  AggregateResult,
  CellValue,
  FilterGroup,
  SavedView,
  TableRow,
  TableState,
} from '../types/table.models';
import * as TableActions from './table.actions';

const EMPTY_AGGREGATE: AggregateResult = { amount: 0, quantity: 0, averageMargin: 0 };

export const EMPTY_FILTER: FilterGroup = {
  kind: 'group',
  id: 'root',
  logic: 'and',
  children: [],
};

export const TABLE_COLUMNS: Array<{ key: keyof TableRow; label: string }> = [
  { key: 'orderNo', label: '订单编号' },
  { key: 'customer', label: '客户名称' },
  { key: 'region', label: '区域' },
  { key: 'category', label: '产品线' },
  { key: 'owner', label: '负责人' },
  { key: 'amount', label: '合同金额' },
  { key: 'quantity', label: '数量' },
  { key: 'margin', label: '毛利率' },
  { key: 'status', label: '状态' },
  { key: 'updatedAt', label: '更新时间' },
];

const initialVisibleColumns = TABLE_COLUMNS.map((column) => column.key);
const initialWidths = Object.fromEntries(
  TABLE_COLUMNS.map((column) => [
    column.key,
    ['orderNo', 'customer'].includes(String(column.key)) ? 190 : 132,
  ]),
);

const initialViews = readViews();

export const initialState: TableState = {
  rows: [],
  total: 0,
  groups: [],
  aggregates: EMPTY_AGGREGATE,
  loading: false,
  error: null,
  page: 0,
  pageSize: 100,
  sort: { field: 'updatedAt', direction: 'desc' },
  filter: EMPTY_FILTER,
  search: '',
  groupBy: null,
  treeMode: true,
  expandedIds: [],
  selectedIds: [],
  visibleColumns: initialVisibleColumns,
  columnWidths: initialWidths,
  pinnedColumns: ['orderNo', 'customer'],
  density: 'standard',
  elapsedMs: 0,
  savedViews: initialViews,
  activeViewId: null,
  dirtyCells: {},
};

export const tableReducer = createReducer(
  initialState,
  on(TableActions.loadPage, (state) => ({ ...state, loading: true, error: null })),
  on(TableActions.loadPageSuccess, (state, { result }) => ({
    ...state,
    rows: result.rows.map((row) => overlayDirtyCells(row, state.dirtyCells)),
    total: result.total,
    groups: result.groups,
    aggregates: result.aggregates,
    loading: false,
    elapsedMs: result.elapsedMs,
  })),
  on(TableActions.loadPageFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(TableActions.setPage, (state, { page }) => ({ ...state, page })),
  on(TableActions.setPageSize, (state, { pageSize }) => ({ ...state, pageSize, page: 0 })),
  on(TableActions.setSort, (state, { sort }) => ({ ...state, sort, page: 0 })),
  on(TableActions.setFilter, (state, { filter }) => ({ ...state, filter, page: 0 })),
  on(TableActions.setSearch, (state, { search }) => ({ ...state, search, page: 0 })),
  on(TableActions.setGroupBy, (state, { groupBy }) => ({ ...state, groupBy, page: 0 })),
  on(TableActions.toggleTreeMode, (state) => ({ ...state, treeMode: !state.treeMode, page: 0 })),
  on(TableActions.toggleExpanded, (state, { id }) => ({
    ...state,
    expandedIds: state.expandedIds.includes(id)
      ? state.expandedIds.filter((item) => item !== id)
      : [...state.expandedIds, id],
  })),
  on(TableActions.setSelection, (state, { ids }) => ({ ...state, selectedIds: ids })),
  on(TableActions.toggleColumn, (state, { key }) => ({
    ...state,
    visibleColumns: state.visibleColumns.includes(key)
      ? state.visibleColumns.filter((item) => item !== key)
      : [...state.visibleColumns, key],
  })),
  on(TableActions.resizeColumn, (state, { key, width }) => ({
    ...state,
    columnWidths: { ...state.columnWidths, [key]: Math.max(88, width) },
  })),
  on(TableActions.togglePinned, (state, { key }) => ({
    ...state,
    pinnedColumns: state.pinnedColumns.includes(key)
      ? state.pinnedColumns.filter((item) => item !== key)
      : [...state.pinnedColumns, key],
  })),
  on(TableActions.setDensity, (state, { density }) => ({ ...state, density })),
  on(TableActions.updateCell, (state, { id, key, value }) => ({
    ...state,
    rows: state.rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    dirtyCells: { ...state.dirtyCells, [`${id}::${String(key)}`]: value },
  })),
  on(TableActions.updateCellSuccess, (state, { result, committed }) => {
    // 只清除本次已提交的脏单元格，其他运营/其他单元格的未提交变更保留
    const dirtyCells = { ...state.dirtyCells };
    committed.forEach((patch) => {
      const dirtyKey = `${patch.id}::${String(patch.key)}`;
      if (dirtyCells[dirtyKey] === patch.value) {
        delete dirtyCells[dirtyKey];
      }
    });
    const updatedById = new Map(result.updatedRows.map((row) => [row.id, row]));
    const rows = state.rows
      .filter((row) => !result.removedIds.includes(row.id))
      .map((row) => overlayDirtyCells(updatedById.get(row.id) ?? row, dirtyCells));
    return {
      ...state,
      rows,
      dirtyCells,
      total: result.total,
      aggregates: result.aggregates,
      groups: result.groups,
      elapsedMs: result.elapsedMs,
    };
  }),
  on(TableActions.updateCellFailure, (state, { error }) => ({ ...state, error })),
  on(TableActions.saveView, (state, { name }) => {
    const view: SavedView = {
      id: `view-${Date.now()}`,
      name: name.trim(),
      createdAt: new Date().toISOString(),
      version: VIEW_VERSION,
      pageSize: state.pageSize,
      visibleColumns: [...state.visibleColumns],
      columnWidths: { ...state.columnWidths },
      pinnedColumns: [...state.pinnedColumns],
      sort: state.sort,
      filter: state.filter,
      groupBy: state.groupBy,
      treeMode: state.treeMode,
      expandedIds: [...state.expandedIds],
    };
    const savedViews = [...state.savedViews.filter((item) => item.name !== view.name), view];
    persistViews(savedViews);
    return { ...state, savedViews, activeViewId: view.id };
  }),
  on(TableActions.applyView, (state, { view }) => {
    const migrated = migrateView(view);
    return {
      ...state,
      pageSize: migrated.pageSize,
      visibleColumns: [...migrated.visibleColumns],
      columnWidths: { ...migrated.columnWidths },
      pinnedColumns: [...migrated.pinnedColumns],
      sort: migrated.sort,
      filter: migrated.filter,
      groupBy: migrated.groupBy,
      treeMode: migrated.treeMode,
      expandedIds: [...migrated.expandedIds],
      activeViewId: migrated.id,
      page: 0,
    };
  }),
  on(TableActions.deleteView, (state, { id }) => {
    const savedViews = state.savedViews.filter((view) => view.id !== id);
    persistViews(savedViews);
    return {
      ...state,
      savedViews,
      activeViewId: state.activeViewId === id ? null : state.activeViewId,
    };
  }),
);

export const VIEW_VERSION = 2;

// 旧视图缺少树形展开与汇总口径字段，打开时按新默认补齐；列宽与筛选保持原样
function migrateView(view: SavedView): SavedView {
  return {
    ...view,
    version: VIEW_VERSION,
    treeMode: view.treeMode ?? true,
    expandedIds: view.expandedIds ?? [],
  };
}

function overlayDirtyCells(row: TableRow, dirtyCells: Record<string, CellValue>): TableRow {
  let next = row;
  Object.entries(dirtyCells).forEach(([key, value]) => {
    const [id, field] = key.split('::');
    if (id === row.id) {
      next = { ...next, [field]: value };
    }
  });
  return next;
}

function readViews(): SavedView[] {
  try {
    const raw = localStorage.getItem('pair-wise-yy-05:views');
    return raw ? (JSON.parse(raw) as SavedView[]).map(migrateView) : [];
  } catch {
    return [];
  }
}

function persistViews(views: SavedView[]): void {
  localStorage.setItem('pair-wise-yy-05:views', JSON.stringify(views));
}
