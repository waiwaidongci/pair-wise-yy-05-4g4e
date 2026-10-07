import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import {
  AggregateResult,
  CellValue,
  FilterCondition,
  FilterGroup,
  FilterNode,
  GroupSummary,
  QueryRequest,
  QueryResult,
  TableRow,
} from '../types/table.models';

const REGIONS = ['华东', '华南', '华北', '西南', '西北', '东北'];
const CATEGORIES = ['云服务', '智能硬件', '企业软件', '数据服务', '运维支持'];
const OWNERS = ['陈嘉', '林月', '周砺', '许宁', '韩舟', '顾清', '沈河', '陆遥'];
const STATUSES: TableRow['status'][] = ['待审核', '进行中', '已发货', '已完成', '异常'];

/** 单批处理的行数：数据量达到 5 万行时按批重算，避免整表扫描。 */
const BATCH_SIZE = 5000;

interface GroupBucket {
  count: number;
  amount: number;
  quantity: number;
  marginSum: number;
}

@Injectable({ providedIn: 'root' })
export class MockTableApiService {
  private readonly rows: TableRow[] = this.createRows(50000);
  private readonly rowById = new Map<string, TableRow>();
  private readonly childrenByParent = new Map<string, TableRow[]>();
  private readonly leafIds = new Set<string>();

  /** 增量维护的汇总与分组，编辑子单时按受影响范围更新，不整表扫描。 */
  private totalAmount = 0;
  private totalQuantity = 0;
  private totalMarginSum = 0;
  private leafCount = 0;
  private currentGroupBy: keyof TableRow | null = null;
  private groupsMap = new Map<string, GroupBucket>();
  private lastFilterKey = '';
  private lastFilter: FilterGroup = { kind: 'group', id: 'root', logic: 'and', children: [] };
  private lastSearch = '';

  constructor() {
    this.buildIndexes();
    this.recomputeAllParentAmounts();
    this.recomputeTotals(this.rows);
  }

  query(request: QueryRequest): Observable<QueryResult> {
    const startedAt = performance.now();
    const filtered = this.filterRows(this.rows, request.filter, request.search);
    const sorted = this.sortRows(filtered, request.sort);

    // 筛选、搜索或分组口径变化时才重建分组与汇总；编辑子单时走增量维护。
    const filterKey = this.filterSignature(request);
    if (filterKey !== this.lastFilterKey || request.groupBy !== this.currentGroupBy) {
      this.recomputeGroups(filtered, request.groupBy);
      this.recomputeTotals(filtered);
      this.lastFilterKey = filterKey;
    }
    this.lastFilter = request.filter;
    this.lastSearch = request.search;
    const groups = this.buildGroupSummaries();

    let pageRows: TableRow[];
    let total: number;

    if (request.treeMode) {
      // 树形模式只按父单分页；展开的父单取回其全部子单（无论落在哪一页）。
      const roots = sorted.filter((row) => row.parentId === null);
      total = roots.length;
      const rootPage = roots.slice(
        request.page * request.pageSize,
        (request.page + 1) * request.pageSize,
      );
      pageRows = rootPage.flatMap((root) => [
        root,
        ...(request.expandedIds.includes(root.id)
          ? sorted.filter((row) => row.parentId === root.id)
          : []),
      ]);
    } else {
      total = sorted.length;
      pageRows = sorted.slice(
        request.page * request.pageSize,
        (request.page + 1) * request.pageSize,
      );
    }

    const elapsedMs = Math.max(8, Math.round(performance.now() - startedAt + 18));
    return of({
      rows: pageRows,
      total,
      aggregates: this.currentAggregates(),
      groups,
      elapsedMs,
    }).pipe(delay(request.page > 8 ? 120 : 55));
  }

  /**
   * 应用一次单元格编辑。只更新受影响的子单及其父单、分组与汇总，
   * 不整表重算；不同子单的编辑各自落库，互不覆盖。
   */
  applyEdit(id: string, field: keyof TableRow, value: CellValue): void {
    const row = this.rowById.get(id);
    if (!row) {
      return;
    }
    const oldValue = row[field];
    if (oldValue === value) {
      return;
    }

    const wasMatching = this.matchesCurrentFilter(row);
    row[field] = value;
    const isMatching = this.matchesCurrentFilter(row);

    if (field === 'amount' && row.parentId) {
      this.recomputeParentAmount(row.parentId);
    }

    if (wasMatching && isMatching) {
      this.updateTotalsForEdit(row, field, oldValue, value);
      this.updateGroupsForEdit(row, field, oldValue, value);
    } else if (wasMatching && !isMatching) {
      this.removeFromTotals(row);
      this.removeFromGroups(row);
    } else if (!wasMatching && isMatching) {
      this.addToTotals(row);
      this.addToGroups(row);
    }
  }

  getDatasetSize(): number {
    return this.rows.length;
  }

  /** 父单合同金额由其全部子单汇总得到，父单自身不直接填写。 */
  private recomputeParentAmount(parentId: string): void {
    const parent = this.rowById.get(parentId);
    const children = this.childrenByParent.get(parentId);
    if (!parent || !children) {
      return;
    }
    let amount = 0;
    for (let index = 0; index < children.length; index += BATCH_SIZE) {
      const batch = children.slice(index, index + BATCH_SIZE);
      for (const child of batch) {
        amount += child.amount;
      }
    }
    parent.amount = Math.round(amount * 100) / 100;
  }

  private recomputeAllParentAmounts(): void {
    const parentIds = [...this.childrenByParent.keys()];
    for (let index = 0; index < parentIds.length; index += BATCH_SIZE) {
      const batch = parentIds.slice(index, index + BATCH_SIZE);
      for (const parentId of batch) {
        this.recomputeParentAmount(parentId);
      }
    }
  }

  private buildIndexes(): void {
    for (const row of this.rows) {
      this.rowById.set(row.id, row);
      if (row.parentId) {
        const siblings = this.childrenByParent.get(row.parentId) ?? [];
        siblings.push(row);
        this.childrenByParent.set(row.parentId, siblings);
      }
    }
    for (const row of this.rows) {
      if (!this.childrenByParent.has(row.id)) {
        this.leafIds.add(row.id);
      }
    }
  }

  private isLeaf(row: TableRow): boolean {
    return this.leafIds.has(row.id);
  }

  private matchesCurrentFilter(row: TableRow): boolean {
    if (!this.evaluateNode(row, this.lastFilter)) {
      return false;
    }
    const normalizedSearch = this.lastSearch.trim().toLowerCase();
    if (!normalizedSearch) {
      return true;
    }
    return [row.orderNo, row.customer, row.region, row.category, row.owner, row.status]
      .some((value) => String(value).toLowerCase().includes(normalizedSearch));
  }

  private addToTotals(row: TableRow): void {
    if (!this.isLeaf(row)) {
      return;
    }
    this.totalAmount += row.amount;
    this.totalQuantity += row.quantity;
    this.totalMarginSum += row.margin;
    this.leafCount += 1;
  }

  private removeFromTotals(row: TableRow): void {
    if (!this.isLeaf(row)) {
      return;
    }
    this.totalAmount -= row.amount;
    this.totalQuantity -= row.quantity;
    this.totalMarginSum -= row.margin;
    this.leafCount -= 1;
  }

  private addToGroups(row: TableRow): void {
    if (!this.currentGroupBy || !this.isLeaf(row)) {
      return;
    }
    this.addToGroup(String(row[this.currentGroupBy] ?? '未分类'), row);
  }

  private removeFromGroups(row: TableRow): void {
    if (!this.currentGroupBy || !this.isLeaf(row)) {
      return;
    }
    this.removeFromGroup(String(row[this.currentGroupBy] ?? '未分类'), row);
  }

  private recomputeTotals(rows: TableRow[]): void {
    this.totalAmount = 0;
    this.totalQuantity = 0;
    this.totalMarginSum = 0;
    this.leafCount = 0;
    for (let index = 0; index < rows.length; index += BATCH_SIZE) {
      const batch = rows.slice(index, index + BATCH_SIZE);
      for (const row of batch) {
        if (!this.isLeaf(row)) {
          continue;
        }
        this.totalAmount += row.amount;
        this.totalQuantity += row.quantity;
        this.totalMarginSum += row.margin;
        this.leafCount += 1;
      }
    }
  }

  private updateTotalsForEdit(
    row: TableRow,
    field: keyof TableRow,
    oldValue: CellValue,
    newValue: CellValue,
  ): void {
    if (!this.isLeaf(row)) {
      return;
    }
    if (field === 'amount') {
      this.totalAmount += Number(newValue) - Number(oldValue);
    } else if (field === 'quantity') {
      this.totalQuantity += Number(newValue) - Number(oldValue);
    } else if (field === 'margin') {
      this.totalMarginSum += Number(newValue) - Number(oldValue);
    }
  }

  private recomputeGroups(rows: TableRow[], groupBy: keyof TableRow | null): void {
    this.groupsMap.clear();
    this.currentGroupBy = groupBy;
    if (!groupBy) {
      return;
    }
    for (let index = 0; index < rows.length; index += BATCH_SIZE) {
      const batch = rows.slice(index, index + BATCH_SIZE);
      for (const row of batch) {
        if (!this.isLeaf(row)) {
          continue;
        }
        const key = String(row[groupBy] ?? '未分类');
        const bucket = this.groupsMap.get(key) ?? { count: 0, amount: 0, quantity: 0, marginSum: 0 };
        bucket.count += 1;
        bucket.amount += row.amount;
        bucket.quantity += row.quantity;
        bucket.marginSum += row.margin;
        this.groupsMap.set(key, bucket);
      }
    }
  }

  private updateGroupsForEdit(
    row: TableRow,
    field: keyof TableRow,
    oldValue: CellValue,
    newValue: CellValue,
  ): void {
    if (!this.currentGroupBy || !this.isLeaf(row)) {
      return;
    }
    const groupBy = this.currentGroupBy;
    if (field === groupBy) {
      const oldKey = String(oldValue ?? '未分类');
      const newKey = String(newValue ?? '未分类');
      if (oldKey !== newKey) {
        this.removeFromGroup(oldKey, row);
        this.addToGroup(newKey, row);
        return;
      }
    }
    const key = String(row[groupBy] ?? '未分类');
    const bucket = this.groupsMap.get(key);
    if (!bucket) {
      return;
    }
    if (field === 'amount') {
      bucket.amount += Number(newValue) - Number(oldValue);
    } else if (field === 'quantity') {
      bucket.quantity += Number(newValue) - Number(oldValue);
    } else if (field === 'margin') {
      bucket.marginSum += Number(newValue) - Number(oldValue);
    }
  }

  private addToGroup(key: string, row: TableRow): void {
    const bucket = this.groupsMap.get(key) ?? { count: 0, amount: 0, quantity: 0, marginSum: 0 };
    bucket.count += 1;
    bucket.amount += row.amount;
    bucket.quantity += row.quantity;
    bucket.marginSum += row.margin;
    this.groupsMap.set(key, bucket);
  }

  private removeFromGroup(key: string, row: TableRow): void {
    const bucket = this.groupsMap.get(key);
    if (!bucket) {
      return;
    }
    bucket.count -= 1;
    bucket.amount -= row.amount;
    bucket.quantity -= row.quantity;
    bucket.marginSum -= row.margin;
    if (bucket.count <= 0) {
      this.groupsMap.delete(key);
    }
  }

  private buildGroupSummaries(): GroupSummary[] {
    if (!this.currentGroupBy) {
      return [];
    }
    return [...this.groupsMap.entries()]
      .map(([key, bucket]) => ({
        key,
        count: bucket.count,
        aggregate: {
          amount: Math.round(bucket.amount * 100) / 100,
          quantity: bucket.quantity,
          averageMargin: bucket.count
            ? Math.round((bucket.marginSum / bucket.count) * 10) / 10
            : 0,
        },
      }))
      .sort((left, right) => right.aggregate.amount - left.aggregate.amount);
  }

  private currentAggregates(): AggregateResult {
    return {
      amount: Math.round(this.totalAmount * 100) / 100,
      quantity: this.totalQuantity,
      averageMargin: this.leafCount
        ? Math.round((this.totalMarginSum / this.leafCount) * 10) / 10
        : 0,
    };
  }

  private filterSignature(request: QueryRequest): string {
    return JSON.stringify({ filter: request.filter, search: request.search });
  }

  private filterRows(rows: TableRow[], filter: FilterGroup, search: string): TableRow[] {
    const normalizedSearch = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesExpression = this.evaluateNode(row, filter);
      if (!matchesExpression || !normalizedSearch) {
        return matchesExpression;
      }
      return [row.orderNo, row.customer, row.region, row.category, row.owner, row.status]
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }

  private evaluateNode(row: TableRow, node: FilterNode): boolean {
    if (node.kind === 'condition') {
      return this.evaluateCondition(row, node);
    }
    if (!node.children.length) {
      return true;
    }
    return node.logic === 'and'
      ? node.children.every((child) => this.evaluateNode(row, child))
      : node.children.some((child) => this.evaluateNode(row, child));
  }

  private evaluateCondition(row: TableRow, condition: FilterCondition): boolean {
    const rawValue = row[condition.field];
    const filterValue = condition.value.trim();
    if (!filterValue) {
      return true;
    }
    if (condition.operator === 'in') {
      return filterValue.split(',').map((item) => item.trim()).includes(String(rawValue));
    }
    const left = typeof rawValue === 'number' ? rawValue : String(rawValue ?? '').toLowerCase();
    const rightNumber = Number(filterValue);
    const right = typeof rawValue === 'number' ? rightNumber : filterValue.toLowerCase();

    switch (condition.operator) {
      case 'contains':
        return String(left).includes(String(right));
      case 'equals':
        return left === right;
      case 'notEquals':
        return left !== right;
      case 'gt':
        return Number(left) > Number(right);
      case 'gte':
        return Number(left) >= Number(right);
      case 'lt':
        return Number(left) < Number(right);
      case 'lte':
        return Number(left) <= Number(right);
      default:
        return true;
    }
  }

  private sortRows(rows: TableRow[], sort: QueryRequest['sort']): TableRow[] {
    if (!sort) {
      return rows;
    }
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
      const a = left[sort.field];
      const b = right[sort.field];
      if (typeof a === 'number' && typeof b === 'number') {
        return (a - b) * direction;
      }
      return String(a).localeCompare(String(b), 'zh-CN') * direction;
    });
  }

  private createRows(count: number): TableRow[] {
    const rows: TableRow[] = [];
    const parentEvery = 7;
    for (let index = 0; index < count; index += 1) {
      const id = `ORD-${String(index + 1).padStart(6, '0')}`;
      const parentIndex = index % parentEvery === 0 ? null : index - (index % parentEvery);
      const day = (index * 7) % 27 + 1;
      const hour = index % 24;
      const status = STATUSES[(index * 13) % STATUSES.length];
      rows.push({
        id,
        orderNo: `SO-${String(202600000 + index).padStart(9, '0')}`,
        customer: `${['远海', '星图', '柏川', '新域', '启明', '屹辰'][index % 6]}${['科技', '制造', '物流', '能源'][index % 4]}有限公司`,
        region: REGIONS[(index * 5) % REGIONS.length],
        category: CATEGORIES[(index * 3) % CATEGORIES.length],
        owner: OWNERS[(index * 11) % OWNERS.length],
        amount: Math.round((6800 + ((index * 7919) % 940000) / 3) * 100) / 100,
        quantity: 1 + ((index * 17) % 280),
        margin: Math.round((6 + ((index * 29) % 310) / 10) * 10) / 10,
        status,
        updatedAt: `2026-09-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}`,
        parentId: parentIndex === null ? null : `ORD-${String(parentIndex + 1).padStart(6, '0')}`,
      });
    }
    return rows;
  }
}
