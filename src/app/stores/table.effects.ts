import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, concatMap, map, of, switchMap, withLatestFrom } from 'rxjs';
import { Store } from '@ngrx/store';
import { MockTableApiService } from '../data/mock-table-api.service';
import { QueryRequest, TableState } from '../types/table.models';
import * as TableActions from './table.actions';
import { selectTableState } from './table.selectors';

@Injectable()
export class TableEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);
  private readonly api = inject(MockTableApiService);

  loadPage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        TableActions.loadPage,
        TableActions.setPage,
        TableActions.setPageSize,
        TableActions.setSort,
        TableActions.setFilter,
        TableActions.setSearch,
        TableActions.setGroupBy,
        TableActions.toggleTreeMode,
        TableActions.toggleExpanded,
      ),
      withLatestFrom(this.store.select(selectTableState)),
      switchMap(([, state]) =>
        this.api.query(toQueryRequest(state)).pipe(
          map((result) => TableActions.loadPageSuccess({ result })),
          catchError((error: unknown) =>
            of(TableActions.loadPageFailure({ error: String(error) })),
          ),
        ),
      ),
    ),
  );

  // 单元格变更串行提交：同一父单下不同子单的并发修改按序合入，互不覆盖
  persistCell$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.updateCell),
      withLatestFrom(this.store.select(selectTableState)),
      concatMap(([{ id, key, value }, state]) =>
        this.api
          .applyCellPatches({
            patches: [{ id, key, value }],
            context: toQueryRequest(state),
          })
          .pipe(
            map((result) =>
              TableActions.updateCellSuccess({ result, committed: [{ id, key, value }] }),
            ),
            catchError((error: unknown) =>
              of(TableActions.updateCellFailure({ error: String(error) })),
            ),
          ),
      ),
    ),
  );
}

function toQueryRequest(state: TableState): QueryRequest {
  return {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    filter: state.filter,
    groupBy: state.groupBy,
    treeMode: state.treeMode,
    expandedIds: state.expandedIds,
    search: state.search,
  };
}
