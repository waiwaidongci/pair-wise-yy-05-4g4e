import { createFeatureSelector, createSelector } from '@ngrx/store';
import { TABLE_COLUMNS } from './table.reducer';
import { TableState } from '../types/table.models';

export const selectTableState = createFeatureSelector<TableState>('table');

export const selectVisibleColumnDefinitions = createSelector(selectTableState, (state) =>
  TABLE_COLUMNS.filter((column) => state.visibleColumns.includes(column.key)).map((column) => ({
    ...column,
    width: state.columnWidths[column.key] ?? 132,
    pinned: state.pinnedColumns.includes(column.key),
  })),
);

export const selectAllColumnDefinitions = createSelector(
  selectTableState,
  (state) => TABLE_COLUMNS.map((column) => ({
    ...column,
    visible: state.visibleColumns.includes(column.key),
    pinned: state.pinnedColumns.includes(column.key),
  })),
);

export const selectPageCount = createSelector(
  selectTableState,
  (state) => Math.max(1, Math.ceil(state.total / state.pageSize)),
);

export const selectSelectionMode = createSelector(
  selectTableState,
  (state) => ({
    allVisibleSelected:
      state.rows.length > 0 && state.rows.every((row) => state.selectedIds.includes(row.id)),
    count: state.selectedIds.length,
  }),
);
