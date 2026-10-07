# 企业订单数据中心

基于 Angular 20、Angular Material、NgRx、RxJS 与 Angular CDK 的大型数据表格示例。

## 运行

```bash
export PATH="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH"
corepack pnpm install
corepack pnpm dev
```

生产构建：

```bash
corepack pnpm build
```

## 已实现

- 5 万行本地 mock 数据，通过服务类模拟服务端分页、排序、筛选、分组与聚合
- 父子订单树形展示（默认开启）：分页只数父单，展开父单即按索引取回其全部子单
- 父单合同金额由子单实时汇总得出，父单金额不可直接编辑
- 汇总口径覆盖全部子单（叶子行），父单派生金额不重复计入
- 子单变更后按受影响范围增量重算父单、分组与订单总额，5 万行容量分批计算，不整表扫描
- 单元格级补丁提交，同一父单下不同子单的并发修改串行合入、互不覆盖
- 旧版视图打开时自动升级到新默认（树形展开），列宽与筛选保持原样
- 可嵌套“且 / 或”条件组、全文搜索和字段运算表达式
- CDK 虚拟滚动列表，支持紧凑、标准、宽松三种行高
- 列宽拖拽、列显隐、列排序、列固定
- 行选择、分组统计卡片、树形展开、单元格双击内联编辑
- NgRx 管理查询状态、选择状态、列状态、视图及未提交单元格变更
- 列宽、筛选、排序、分组等保存为视图并写入 localStorage
- 方向键、Enter、Space、Ctrl/Cmd+A、Escape 等键盘操作
- CSV 导出、查询耗时、加载状态与结果统计
