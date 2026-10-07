import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import {
  AggregateResult,
  FilterCondition,
  FilterGroup,
  FilterNode,
  GroupSummary,
  MutationRequest,
  MutationResult,
  QueryRequest,
  QueryResult,
  TableRow,
} from '../types/table.models';

const REGIONS = ['华东', '华南', '华北', '西南', '西北', '东北'];
const CATEGORIES = ['云服务', '智能硬件', '企业软件', '数据服务', '运维支持'];
const OWNERS = ['陈嘉', '林月', '周砺', '许宁', '韩舟', '顾清', '沈河', '陆遥'];
const STATUSES: TableRow['status'][] = ['待审核', '进行中', '已发货', '已完成', '异常'];

// 容量达到 5 万行后，索引构建与汇总一律按 5000 行一批进行，避免单次长任务
const BATCH_RECOMPUTE_THRESHOLD = 50000;
const RECOMPUTE_BATCH_SIZE = 5000;

interface Totals {
  amount: number;
  quantity: number;
  marginSum: number;
  count: number;
}

interface QueryBaseline {
  contextKey: string;
  sorted: TableRow[];
  total: number;
  totals: Totals;
  groupTotals: Map<string, Totals>;
}

@Injectable({ providedIn: 'root' })
export class MockTableApiService {
  private readonly rows: TableRow[] = this.createRows(50000);
  private readonly rowById = new Map<string, TableRow>();
  private readonly childIdsByParent = new Map<string, string[]>();
  private baseline: QueryBaseline | null = null;

  constructor() {
    this.rebuildIndexesAndDerivedAmounts();
  }

  query(request: QueryRequest): Observable<QueryResult> {
    const startedAt = performance.now();
    this.computeBaseline(request);
    const baseline = this.baseline!;

    let pageRows: TableRow[];
    if (request.treeMode) {
      // 分页只数父单
      const roots = baseline.sorted.filter((row) => row.parentId === null);
      const rootPage = roots.slice(
        request.page * request.pageSize,
        (request.page + 1) * request.pageSize,
      );
      // 展开的父单按索引直取其全部子单，子单落在哪一页都取回
      pageRows = rootPage.flatMap((root) => [
        root,
        ...(request.expandedIds.includes(root.id)
          ? this.matchingChildren(root.id, request)
          : []),
      ]);
    } else {
      pageRows = baseline.sorted.slice(
        request.page * request.pageSize,
        (request.page + 1) * request.pageSize,
      );
    }

    const elapsedMs = Math.max(8, Math.round(performance.now() - startedAt + 18));
    return of({
      // 拷贝分页行，避免后续变更直接改到已下发给 store 的对象
      rows: pageRows.map((row) => ({ ...row })),
      total: baseline.total,
      aggregates: this.toAggregate(baseline.totals),
      groups: this.toGroupSummaries(baseline.groupTotals),
      elapsedMs,
    }).pipe(delay(request.page > 8 ? 120 : 55));
  }

  applyCellPatches(request: MutationRequest): Observable<MutationResult> {
    const startedAt = performance.now();
    const baseline = this.ensureBaseline(request.context);
    const context = request.context;
    const updated = new Map<string, TableRow>();
    const removedIds: string[] = [];
    const affectedParentIds = new Set<string>();
    let totalDelta = 0;

    // 树形模式分页只数父单；普通模式所有行都计入总数
    const countsForTotal = (row: TableRow): boolean =>
      context.treeMode ? row.parentId === null : true;

    // 单元格级补丁：两名运营同时改同一父单下不同子单时，各自合入共享数据，互不覆盖
    for (const patch of request.patches) {
      const row = this.rowById.get(patch.id);
      if (!row || patch.key === 'id' || patch.key === 'parentId' || patch.key === 'childCount') {
        continue;
      }
      // 父单合同金额由子单汇总得出，不直接填写
      if (patch.key === 'amount' && row.childCount > 0) {
        continue;
      }
      const before = { ...row };
      const matchedBefore = this.matchesRequest(before, context);
      row[patch.key] = patch.value;
      row.updatedAt = this.now();
      const matchedAfter = this.matchesRequest(row, context);
      updated.set(row.id, { ...row });

      if (row.parentId) {
        affectedParentIds.add(row.parentId);
      }

      // 汇总口径覆盖全部子单（叶子行）：按变化前后差量调整，不整表重扫
      if (row.childCount === 0) {
        if (matchedBefore) {
          this.subtractFromTotals(baseline.totals, before);
        }
        if (matchedAfter) {
          this.addToTotals(baseline.totals, row);
        }
        if (context.groupBy) {
          if (matchedBefore) {
            this.adjustGroupTotals(baseline.groupTotals, before, context.groupBy, -1);
          }
          if (matchedAfter) {
            this.adjustGroupTotals(baseline.groupTotals, row, context.groupBy, 1);
          }
        }
      }
      if (countsForTotal(row)) {
        totalDelta += Number(matchedAfter) - Number(matchedBefore);
      }
      if (matchedBefore && !matchedAfter) {
        removedIds.push(row.id);
      }
    }

    // 只重算受影响的父单：金额 = 其子单金额之和
    for (const parentId of affectedParentIds) {
      const parent = this.rowById.get(parentId);
      const childIds = this.childIdsByParent.get(parentId) ?? [];
      if (!parent || !childIds.length) {
        continue;
      }
      const matchedBefore = this.matchesRequest(parent, context);
      parent.amount = this.round2(
        childIds.reduce((sum, id) => sum + (this.rowById.get(id)?.amount ?? 0), 0),
      );
      parent.updatedAt = this.now();
      const matchedAfter = this.matchesRequest(parent, context);
      updated.set(parent.id, { ...parent });
      if (countsForTotal(parent)) {
        totalDelta += Number(matchedAfter) - Number(matchedBefore);
      }
      if (matchedBefore && !matchedAfter) {
        removedIds.push(parent.id);
      }
    }

    baseline.total = Math.max(0, baseline.total + totalDelta);

    const elapsedMs = Math.max(4, Math.round(performance.now() - startedAt + 6));
    return of({
      updatedRows: [...updated.values()],
      removedIds,
      total: baseline.total,
      aggregates: this.toAggregate(baseline.totals),
      groups: this.toGroupSummaries(baseline.groupTotals),
      elapsedMs,
    }).pipe(delay(30));
  }

  getDatasetSize(): number {
    return this.rows.length;
  }

  private computeBaseline(context: QueryRequest): void {
    const filtered = this.filterRows(this.rows, context.filter, context.search);
    const sorted = this.sortRows(filtered, context.sort);
    const leaves: TableRow[] = [];
    let rootCount = 0;
    this.forEachBatch(sorted, (row) => {
      if (row.childCount === 0) {
        leaves.push(row);
      }
      if (row.parentId === null) {
        rootCount += 1;
      }
    });
    this.baseline = {
      contextKey: JSON.stringify(context),
      sorted,
      total: context.treeMode ? rootCount : sorted.length,
      totals: this.sumInBatches(leaves),
      groupTotals: context.groupBy
        ? this.buildGroupTotals(leaves, context.groupBy)
        : new Map<string, Totals>(),
    };
  }

  private ensureBaseline(context: QueryRequest): QueryBaseline {
    const contextKey = JSON.stringify(context);
    if (!this.baseline || this.baseline.contextKey !== contextKey) {
      this.computeBaseline(context);
    }
    return this.baseline!;
  }

  private rebuildIndexesAndDerivedAmounts(): void {
    this.forEachBatch(this.rows, (row) => {
      this.rowById.set(row.id, row);
      if (row.parentId) {
        const siblings = this.childIdsByParent.get(row.parentId) ?? [];
        siblings.push(row.id);
        this.childIdsByParent.set(row.parentId, siblings);
      }
    });
    // 父单合同金额 = 其子单金额之和，父单自身不直接填写
    this.forEachBatch(this.rows, (row) => {
      const childIds = this.childIdsByParent.get(row.id) ?? [];
      row.childCount = childIds.length;
      if (childIds.length) {
        row.amount = this.round2(
          childIds.reduce((sum, id) => sum + (this.rowById.get(id)?.amount ?? 0), 0),
        );
      }
    });
  }

  private matchingChildren(parentId: string, request: QueryRequest): TableRow[] {
    const childIds = this.childIdsByParent.get(parentId) ?? [];
    const children = childIds
      .map((id) => this.rowById.get(id))
      .filter((row): row is TableRow => !!row && this.matchesRequest(row, request));
    return this.sortRows(children, request.sort);
  }

  private filterRows(rows: TableRow[], filter: FilterGroup, search: string): TableRow[] {
    const normalizedSearch = search.trim().toLowerCase();
    return rows.filter(
      (row) => this.evaluateNode(row, filter) && this.matchesSearch(row, normalizedSearch),
    );
  }

  private matchesRequest(row: TableRow, request: QueryRequest): boolean {
    return (
      this.evaluateNode(row, request.filter) &&
      this.matchesSearch(row, request.search.trim().toLowerCase())
    );
  }

  private matchesSearch(row: TableRow, normalizedSearch: string): boolean {
    if (!normalizedSearch) {
      return true;
    }
    return [row.orderNo, row.customer, row.region, row.category, row.owner, row.status]
      .some((value) => String(value).toLowerCase().includes(normalizedSearch));
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

  private sumInBatches(rows: TableRow[]): Totals {
    const totals: Totals = { amount: 0, quantity: 0, marginSum: 0, count: 0 };
    this.forEachBatch(rows, (row) => this.addToTotals(totals, row));
    return totals;
  }

  private buildGroupTotals(leaves: TableRow[], groupBy: keyof TableRow): Map<string, Totals> {
    const groupTotals = new Map<string, Totals>();
    this.forEachBatch(leaves, (row) => {
      this.adjustGroupTotals(groupTotals, row, groupBy, 1);
    });
    return groupTotals;
  }

  private adjustGroupTotals(
    groupTotals: Map<string, Totals>,
    row: TableRow,
    groupBy: keyof TableRow,
    sign: 1 | -1,
  ): void {
    const key = String(row[groupBy] ?? '未分类');
    const totals = groupTotals.get(key) ?? { amount: 0, quantity: 0, marginSum: 0, count: 0 };
    if (sign === 1) {
      this.addToTotals(totals, row);
    } else {
      this.subtractFromTotals(totals, row);
    }
    if (totals.count > 0) {
      groupTotals.set(key, totals);
    } else {
      groupTotals.delete(key);
    }
  }

  private addToTotals(totals: Totals, row: TableRow): void {
    totals.amount += row.amount;
    totals.quantity += row.quantity;
    totals.marginSum += row.margin;
    totals.count += 1;
  }

  private subtractFromTotals(totals: Totals, row: TableRow): void {
    totals.amount -= row.amount;
    totals.quantity -= row.quantity;
    totals.marginSum -= row.margin;
    totals.count -= 1;
  }

  private toAggregate(totals: Totals): AggregateResult {
    if (!totals.count) {
      return { amount: 0, quantity: 0, averageMargin: 0 };
    }
    return {
      amount: this.round2(totals.amount),
      quantity: totals.quantity,
      averageMargin: this.round1(totals.marginSum / totals.count),
    };
  }

  private toGroupSummaries(groupTotals: Map<string, Totals>): GroupSummary[] {
    return [...groupTotals.entries()]
      .map(([key, totals]) => ({
        key,
        count: totals.count,
        aggregate: this.toAggregate(totals),
      }))
      .sort((left, right) => right.aggregate.amount - left.aggregate.amount);
  }

  // 容量到 5 万行后按批处理，避免单次长循环；变更后的重算只走受影响范围，不整表扫描
  private forEachBatch(rows: TableRow[], visit: (row: TableRow) => void): void {
    if (rows.length < BATCH_RECOMPUTE_THRESHOLD) {
      rows.forEach(visit);
      return;
    }
    for (let start = 0; start < rows.length; start += RECOMPUTE_BATCH_SIZE) {
      const end = Math.min(start + RECOMPUTE_BATCH_SIZE, rows.length);
      for (let index = start; index < end; index += 1) {
        visit(rows[index]);
      }
    }
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private round1(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private now(): string {
    const date = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
        childCount: 0,
      });
    }
    return rows;
  }
}
