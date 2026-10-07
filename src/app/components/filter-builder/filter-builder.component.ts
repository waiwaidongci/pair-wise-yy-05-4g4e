import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FilterCondition, FilterGroup, FilterNode, FilterOperator, TableRow } from '../../types/table.models';
import { TABLE_COLUMNS } from '../../stores/table.reducer';

const OPERATORS: Array<{ value: FilterOperator; label: string }> = [
  { value: 'contains', label: '包含' },
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'in', label: '属于（逗号分隔）' },
];

@Component({
  selector: 'app-filter-builder',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <section class="filter-builder" [class.filter-builder--nested]="depth > 0">
      <div class="filter-builder__head">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>条件关系</mat-label>
          <mat-select
            [ngModel]="group.logic"
            (ngModelChange)="changeLogic($event)"
          >
            <mat-option value="and">满足全部条件</mat-option>
            <mat-option value="or">满足任一条件</mat-option>
          </mat-select>
        </mat-form-field>
        <button mat-stroked-button type="button" (click)="addCondition()">
          <mat-icon>filter_alt</mat-icon>
          条件
        </button>
        <button mat-stroked-button type="button" (click)="addGroup()">
          <mat-icon>account_tree</mat-icon>
          条件组
        </button>
        @if (depth > 0) {
          <button mat-icon-button type="button" aria-label="删除条件组" (click)="remove.emit(group.id)">
            <mat-icon>delete_outline</mat-icon>
          </button>
        }
      </div>

      @if (!group.children.length) {
        <div class="filter-builder__empty">当前为全量数据，可添加条件进行组合筛选。</div>
      }

      @for (node of group.children; track node.id) {
        @if (node.kind === 'condition') {
          <div class="filter-row">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>字段</mat-label>
              <mat-select
                [ngModel]="node.field"
                (ngModelChange)="changeField(node, $event)"
              >
                @for (column of columns; track column.key) {
                  <mat-option [value]="column.key">{{ column.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>运算</mat-label>
              <mat-select
                [ngModel]="node.operator"
                (ngModelChange)="changeOperator(node, $event)"
              >
                @for (operator of operators; track operator.value) {
                  <mat-option [value]="operator.value">{{ operator.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="filter-row__value">
              <mat-label>比较值</mat-label>
              <input
                matInput
                [ngModel]="node.value"
                (ngModelChange)="changeValue(node, $event)"
                placeholder="输入筛选值"
              >
            </mat-form-field>
            <button mat-icon-button type="button" aria-label="删除条件" (click)="remove.emit(node.id)">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        } @else {
          <app-filter-builder
            [group]="node"
            [depth]="depth + 1"
            (change)="change.emit($event)"
            (remove)="remove.emit($event)"
          />
        }
      }
    </section>
  `,
  styles: [`
    .filter-builder {
      padding: 14px;
      border: 1px solid #d9e1ec;
      border-radius: 10px;
      background: #fff;
    }
    .filter-builder--nested {
      margin: 8px 0;
      border-left: 3px solid #84adff;
      background: #f8faff;
    }
    .filter-builder__head {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .filter-builder__head mat-form-field {
      width: 180px;
    }
    .filter-builder__empty {
      padding: 12px 2px 4px;
      color: #667085;
      font-size: 13px;
    }
    .filter-row {
      display: grid;
      grid-template-columns: 190px 190px minmax(180px, 1fr) 40px;
      gap: 10px;
      align-items: center;
      margin-top: 8px;
    }
    @media (max-width: 760px) {
      .filter-row {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class FilterBuilderComponent {
  @Input({ required: true }) group!: FilterGroup;
  @Input() depth = 0;
  @Output() change = new EventEmitter<FilterGroup>();
  @Output() remove = new EventEmitter<string>();

  readonly columns = TABLE_COLUMNS;
  readonly operators = OPERATORS;

  addCondition(): void {
    const next: FilterCondition = {
      kind: 'condition',
      id: `condition-${Date.now()}-${Math.random()}`,
      field: 'customer',
      operator: 'contains',
      value: '',
    };
    this.change.emit({ ...this.group, children: [...this.group.children, next] });
  }

  addGroup(): void {
    const child: FilterGroup = {
      kind: 'group',
      id: `group-${Date.now()}-${Math.random()}`,
      logic: 'or',
      children: [],
    };
    this.change.emit({ ...this.group, children: [...this.group.children, child] });
  }

  changeLogic(logic: 'and' | 'or'): void {
    this.change.emit({ ...this.group, logic });
  }

  changeField(node: FilterCondition, field: keyof TableRow): void {
    this.updateNode({ ...node, field });
  }

  changeOperator(node: FilterCondition, operator: FilterOperator): void {
    this.updateNode({ ...node, operator });
  }

  changeValue(node: FilterCondition, value: string): void {
    this.updateNode({ ...node, value });
  }

  private updateNode(next: FilterCondition): void {
    this.change.emit({
      ...this.group,
      children: this.group.children.map((child) =>
        child.id === next.id ? next : child,
      ) as FilterNode[],
    });
  }
}
