import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';
import { Store } from '@ngrx/store';
import { MockTableApiService } from '../data/mock-table-api.service';
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
        TableActions.setTreeMode,
        TableActions.toggleExpanded,
      ),
      withLatestFrom(this.store.select(selectTableState)),
      switchMap(([, state]) =>
        this.api
          .query({
            page: state.page,
            pageSize: state.pageSize,
            sort: state.sort,
            filter: state.filter,
            groupBy: state.groupBy,
            treeMode: state.treeMode,
            expandedIds: state.expandedIds,
            search: state.search,
          })
          .pipe(
            map((result) => TableActions.loadPageSuccess({ result })),
            catchError((error: unknown) =>
              of(TableActions.loadPageFailure({ error: String(error) })),
            ),
          ),
      ),
    ),
  );

  /**
   * 单元格编辑先落库到模拟服务端（按受影响范围重算父单与分组），
   * 再触发分页查询刷新汇总；不同子单的编辑各自落库，互不覆盖。
   */
  applyEdit$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.updateCell),
      mergeMap(({ id, key, value }) => {
        this.api.applyEdit(id, key, value);
        return of(TableActions.loadPage({ refresh: true }));
      }),
    ),
  );
}
