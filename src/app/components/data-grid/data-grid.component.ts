import { CommonModule } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CellValue, GroupSummary, SortState, TableRow } from '../../types/table.models';

export interface GridColumn {
  key: keyof TableRow;
  label: string;
  width: number;
  pinned: boolean;
}

@Component({
  selector: 'app-data-grid',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    ScrollingModule,
  ],
  template: `
    <div class="grid-shell">
      <div class="grid-head" [style.min-width.px]="gridWidth + 54">
        <div class="cell cell--select">
          <mat-checkbox
            [checked]="allCurrentSelected"
            [indeterminate]="someCurrentSelected"
            (change)="toggleAll($event.checked)"
            aria-label="选择本页"
          />
        </div>
        @for (column of columns; track column.key) {
          <div
            class="cell cell--head"
            [class.cell--pinned]="column.pinned"
            [style.left.px]="column.pinned ? pinnedLeft(column.key) : null"
            [style.width.px]="column.width"
            [style.min-width.px]="column.width"
          >
            <button mat-button class="sort-button" (click)="sortChange.emit(column.key)">
              <span>{{ column.label }}</span>
              @if (currentSort?.field === column.key) {
                <mat-icon>{{ currentSort?.direction === 'asc' ? 'arrow_upward' : 'arrow_downward' }}</mat-icon>
              }
            </button>
            <span
              class="resizer"
              (mousedown)="startResize($event, column)"
              aria-label="拖动调整列宽"
            ></span>
          </div>
        }
        <div class="cell cell--tail">操作</div>
      </div>

      @if (loading) {
        <div class="grid-state">
          <mat-spinner diameter="30" />
          <span>正在从模拟服务端加载分页数据…</span>
        </div>
      } @else if (!rows.length) {
        <div class="grid-state">
          <mat-icon>search_off</mat-icon>
          <span>没有符合当前表达式的数据</span>
        </div>
      } @else {
        <cdk-virtual-scroll-viewport
          #viewport
          [itemSize]="rowHeight"
          class="grid-viewport"
          (keydown)="handleKeyboard($event)"
          tabindex="0"
        >
          <div
            *cdkVirtualFor="let row of rows; let rowIndex = index; trackBy: trackById"
            class="grid-row"
            [class.grid-row--tree-child]="row.parentId && treeMode"
            [class.grid-row--selected]="selectedIds.includes(row.id)"
            [class.grid-row--active]="activeIndex === rowIndex"
            [class.grid-row--dirty]="dirtyIds.has(row.id)"
            [style.min-width.px]="gridWidth + 54"
            [style.height.px]="rowHeight"
            (click)="activate(rowIndex)"
          >
            <div class="cell cell--select" (click)="$event.stopPropagation()">
              <mat-checkbox
                [checked]="selectedIds.includes(row.id)"
                (change)="toggleRow(row.id, $event.checked)"
                [aria-label]="'选择订单 ' + row.orderNo"
              />
            </div>
            @for (column of columns; track column.key; let columnIndex = $index) {
              <div
                class="cell"
                [class.cell--pinned]="column.pinned"
                [class.cell--number]="isNumeric(column.key)"
                [style.left.px]="column.pinned ? pinnedLeft(column.key) : null"
                [style.width.px]="column.width"
                [style.min-width.px]="column.width"
                (click)="activate(rowIndex, columnIndex); $event.stopPropagation()"
                (dblclick)="startEdit(row, column.key)"
              >
                @if (editingId === row.id && editingKey === column.key) {
                  <input
                    class="cell-editor"
                    [ngModel]="row[column.key]"
                    (ngModelChange)="editValue = $event"
                    (keydown.enter)="commitEdit(row, column.key)"
                    (keydown.escape)="cancelEdit()"
                    (blur)="commitEdit(row, column.key)"
                    autofocus
                  >
                } @else {
                  @if (column.key === 'orderNo') {
                    @if (treeMode && !row.parentId) {
                      <button
                        mat-icon-button
                        class="tree-toggle"
                        type="button"
                        (click)="toggleExpand(row.id, $event)"
                        aria-label="展开子订单"
                      >
                        <mat-icon>{{ expandedIds.includes(row.id) ? 'expand_more' : 'chevron_right' }}</mat-icon>
                      </button>
                    } @else if (treeMode) {
                      <span class="tree-spacer"></span>
                    }
                    <strong>{{ row[column.key] }}</strong>
                  } @else if (column.key === 'amount') {
                    ¥{{ row[column.key] | number:'1.2-2' }}
                  } @else if (column.key === 'margin') {
                    {{ row[column.key] }}%
                  } @else if (column.key === 'status') {
                    <span class="status" [ngClass]="statusClass(row.status)">{{ row.status }}</span>
                  } @else {
                    {{ row[column.key] }}
                  }
                }
              </div>
            }
            <div class="cell cell--tail">
              <button mat-icon-button matTooltip="复制订单号" (click)="copyRow(row, $event)">
                <mat-icon>content_copy</mat-icon>
              </button>
              <button mat-icon-button matTooltip="查看明细" (click)="inspectRow(row, $event)">
                <mat-icon>open_in_new</mat-icon>
              </button>
            </div>
          </div>
        </cdk-virtual-scroll-viewport>
      }
    </div>
  `,
  styles: [`
    .grid-shell {
      min-width: 0;
      height: 100%;
      overflow: hidden;
      background: #fff;
    }
    .grid-head,
    .grid-row {
      display: flex;
      align-items: stretch;
      width: max-content;
    }
    .grid-head {
      position: sticky;
      z-index: 8;
      top: 0;
      height: 42px;
      border-bottom: 1px solid #d5dbe5;
      background: #f7f9fc;
      color: #344054;
      font-size: 12px;
      font-weight: 700;
    }
    .grid-viewport {
      height: calc(100% - 42px);
      overflow: auto;
      outline: none;
    }
    .grid-row {
      position: relative;
      border-bottom: 1px solid #edf0f4;
      background: #fff;
      font-size: 13px;
      cursor: cell;
    }
    .grid-row:hover {
      background: #f8fbff;
    }
    .grid-row--selected {
      background: #eef4ff;
    }
    .grid-row--active {
      outline: 2px solid #2e90fa;
      outline-offset: -2px;
    }
    .grid-row--dirty::after {
      position: absolute;
      top: 0;
      right: 0;
      width: 3px;
      height: 100%;
      background: #f79009;
      content: '';
    }
    .grid-row--tree-child .cell:first-of-type {
      padding-left: 30px;
    }
    .cell {
      display: flex;
      align-items: center;
      min-width: 0;
      padding: 0 10px;
      border-right: 1px solid #edf0f4;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cell--select {
      width: 54px;
      min-width: 54px;
      justify-content: center;
      position: sticky;
      left: 0;
      z-index: 3;
      background: inherit;
    }
    .cell--tail {
      width: 96px;
      min-width: 96px;
      justify-content: center;
      gap: 2px;
      background: inherit;
    }
    .cell--head {
      position: relative;
      padding: 0;
      font-variant-numeric: tabular-nums;
    }
    .cell--pinned {
      position: sticky;
      z-index: 4;
      background: inherit;
      box-shadow: 4px 0 8px -8px rgba(16, 24, 40, .55);
    }
    .grid-head .cell--pinned {
      z-index: 9;
      background: #f7f9fc;
    }
    .cell--number {
      justify-content: flex-end;
      font-variant-numeric: tabular-nums;
    }
    .sort-button {
      width: 100%;
      height: 100%;
      justify-content: space-between;
      padding: 0 12px;
      border-radius: 0;
      color: inherit;
      font-size: 12px;
    }
    .sort-button mat-icon {
      width: 16px;
      height: 16px;
      font-size: 16px;
    }
    .resizer {
      position: absolute;
      z-index: 5;
      top: 0;
      right: -4px;
      width: 8px;
      height: 100%;
      cursor: col-resize;
    }
    .resizer:hover {
      background: #2e90fa;
    }
    .cell-editor {
      width: 100%;
      height: 30px;
      padding: 0 7px;
      border: 2px solid #2e90fa;
      border-radius: 4px;
      outline: none;
    }
    .tree-toggle {
      width: 30px;
      height: 30px;
      margin-right: 4px;
    }
    .tree-toggle mat-icon {
      font-size: 19px;
    }
    .tree-spacer {
      width: 34px;
    }
    .grid-state {
      display: flex;
      height: calc(100% - 42px);
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: #667085;
    }
    .grid-state mat-icon {
      font-size: 30px;
      width: 30px;
      height: 30px;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataGridComponent implements AfterViewInit {
  @Input() rows: TableRow[] = [];
  @Input() columns: GridColumn[] = [];
  @Input() loading = false;
  @Input() density: 'compact' | 'standard' | 'comfortable' = 'standard';
  @Input() sort: SortState | null = null;
  @Input() selectedIds: string[] = [];
  @Input() dirtyCells: Record<string, CellValue> = {};
  @Input() expandedIds: string[] = [];
  @Input() treeMode = false;

  @Output() sortChange = new EventEmitter<keyof TableRow>();
  @Output() resize = new EventEmitter<{ key: keyof TableRow; width: number }>();
  @Output() selectionChange = new EventEmitter<string[]>();
  @Output() edit = new EventEmitter<{ id: string; key: keyof TableRow; value: CellValue }>();
  @Output() expand = new EventEmitter<string>();
  @Output() inspect = new EventEmitter<TableRow>();

  @ViewChild(CdkVirtualScrollViewport) viewport?: CdkVirtualScrollViewport;

  activeIndex = 0;
  activeColumnIndex = 0;
  editingId: string | null = null;
  editingKey: keyof TableRow | null = null;
  editValue: CellValue = '';
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private resizingColumn: keyof TableRow | null = null;

  get currentSort(): SortState | null {
    return this.sort;
  }

  get gridWidth(): number {
    return this.columns.reduce((sum, column) => sum + column.width, 0);
  }

  get rowHeight(): number {
    return this.density === 'compact' ? 36 : this.density === 'comfortable' ? 56 : 44;
  }

  get allCurrentSelected(): boolean {
    return this.rows.length > 0 && this.rows.every((row) => this.selectedIds.includes(row.id));
  }

  get someCurrentSelected(): boolean {
    return this.rows.some((row) => this.selectedIds.includes(row.id)) && !this.allCurrentSelected;
  }

  get dirtyIds(): Set<string> {
    return new Set(Object.keys(this.dirtyCells).map((key) => key.split('::')[0]));
  }

  ngAfterViewInit(): void {
    document.addEventListener('mousemove', this.handleResizeMove);
    document.addEventListener('mouseup', this.handleResizeEnd);
  }

  ngOnDestroy(): void {
    document.removeEventListener('mousemove', this.handleResizeMove);
    document.removeEventListener('mouseup', this.handleResizeEnd);
  }

  trackById = (_: number, row: TableRow): string => row.id;

  isNumeric(key: keyof TableRow): boolean {
    return ['amount', 'quantity', 'margin'].includes(String(key));
  }

  statusClass(status: TableRow['status']): string {
    return {
      待审核: 'status--warning',
      进行中: 'status--info',
      已发货: 'status--info',
      已完成: 'status--success',
      异常: 'status--danger',
    }[status] ?? 'status--info';
  }

  toggleAll(checked: boolean): void {
    const currentIds = this.rows.map((row) => row.id);
    this.selectionChange.emit(
      checked
        ? [...new Set([...this.selectedIds, ...currentIds])]
        : this.selectedIds.filter((id) => !currentIds.includes(id)),
    );
  }

  toggleRow(id: string, checked: boolean): void {
    this.selectionChange.emit(
      checked ? [...new Set([...this.selectedIds, id])] : this.selectedIds.filter((item) => item !== id),
    );
  }

  activate(index: number, columnIndex = 0): void {
    this.activeIndex = index;
    this.activeColumnIndex = Math.min(Math.max(columnIndex, 0), this.columns.length - 1);
  }

  pinnedLeft(key: keyof TableRow): number {
    const pinnedIndex = this.columns.findIndex((column) => column.key === key);
    return 54 + this.columns
      .slice(0, Math.max(0, pinnedIndex))
      .filter((column) => column.pinned)
      .reduce((sum, column) => sum + column.width, 0);
  }

  startResize(event: MouseEvent, column: GridColumn): void {
    event.preventDefault();
    event.stopPropagation();
    this.resizingColumn = column.key;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = column.width;
  }

  private readonly handleResizeMove = (event: MouseEvent): void => {
    if (!this.resizingColumn) {
      return;
    }
    this.resize.emit({
      key: this.resizingColumn,
      width: this.resizeStartWidth + event.clientX - this.resizeStartX,
    });
  };

  private readonly handleResizeEnd = (): void => {
    this.resizingColumn = null;
  };

  startEdit(row: TableRow, key: keyof TableRow): void {
    if (key === 'id') {
      return;
    }
    this.editingId = row.id;
    this.editingKey = key;
    this.editValue = row[key];
  }

  commitEdit(row: TableRow, key: keyof TableRow): void {
    if (this.editingId !== row.id || this.editingKey !== key) {
      return;
    }
    const numerical = this.isNumeric(key);
    const nextValue = numerical ? Number(this.editValue) : String(this.editValue);
    this.edit.emit({ id: row.id, key, value: nextValue });
    this.cancelEdit();
  }

  cancelEdit(): void {
    this.editingId = null;
    this.editingKey = null;
  }

  toggleExpand(id: string, event: Event): void {
    event.stopPropagation();
    this.expand.emit(id);
  }

  copyRow(row: TableRow, event: MouseEvent): void {
    event.stopPropagation();
    void navigator.clipboard.writeText(JSON.stringify(row, null, 2));
  }

  inspectRow(row: TableRow, event: MouseEvent): void {
    event.stopPropagation();
    this.inspect.emit(row);
  }

  handleKeyboard(event: KeyboardEvent): void {
    const current = this.rows[this.activeIndex];
    if (!current) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveActive(-1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.activeColumnIndex = Math.max(0, this.activeColumnIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.activeColumnIndex = Math.min(this.columns.length - 1, this.activeColumnIndex + 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const column = this.columns[this.activeColumnIndex] ?? this.columns[0];
      this.startEdit(current, column.key);
    } else if (event.key === ' ') {
      event.preventDefault();
      this.toggleRow(current.id, !this.selectedIds.includes(current.id));
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.toggleAll(true);
    } else if (event.key === 'Escape') {
      this.cancelEdit();
    }
  }

  private moveActive(delta: number): void {
    this.activeIndex = Math.min(Math.max(this.activeIndex + delta, 0), this.rows.length - 1);
    this.viewport?.scrollToIndex(this.activeIndex, 'smooth');
  }
}
