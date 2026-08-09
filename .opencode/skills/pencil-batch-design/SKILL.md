---
name: "pencil-batch-design"
description: "Guides correct usage of Pencil MCP batch_design DSL. Invoke whenever creating or editing .pen files via batch_design, batch_get, or any Pencil MCP tool."
---

# Pencil Batch Design Skill

## 1. 核心认知：DSL 不是 JavaScript

`batch_design` 的 `input` 参数是声明式 DSL，不是 JavaScript 运行时。

| 支持 | 不支持 |
|------|--------|
| 同一块内变量赋值与传递 | 跨 `batch_design` 调用引用变量 |
| `document` 关键字 | `document.children[index]` 运行时访问 |
| 严格 Schema 属性 | 超出枚举范围的值 |
| 无注释的纯代码 | `//` 或 `/* */` 注释 |

## 2. 语法规则

### 2.1 使用 `Insert()` 创建节点

```javascript
card = Insert(parent, { type: "frame", id: "card", ... })
```

### 2.2 禁止注释

DSL 中任何 `//` 或 `/* */` 都会导致 SyntaxError。本文档示例中的 `// ❌` / `// ✅` 仅为说明用途，DSL 中严禁出现。

### 2.3 变量作用域：块内有效，跨块无效

```javascript
home = Insert(document, { type: "frame", ... })
header = Insert(home, { type: "frame", ... })
```

跨块调用时，之前返回的 ID 不能作为变量使用（会 ReferenceError）。如需跨块操作，使用 `Update` 配合返回的实际 ID。

### 2.4 父节点引用

| 场景 | 写法 |
|------|------|
| 插入到文档根 | `Insert(document, { ... })` |
| 插入到同块内定义的 frame | `Insert(home, { ... })` |

### 2.5 其他操作

```javascript
Update("nodeId", { fill: "#FF0000", width: 200 })
Delete("nodeId")
FindEmptySpace({ width: 1440, height: 3200 })
```

## 3. Schema 速查

### 3.1 节点类型

| type | 说明 | 子节点 | 典型用途 |
|------|------|--------|---------|
| `frame` | 容器，支持 flex 布局 | 支持 | 页面、卡片、导航栏、按钮容器 |
| `group` | 分组，无布局 | 支持 | 组织管理，不参与布局 |
| `rectangle` | 矩形 | 不支持 | 背景、分隔线、装饰 |
| `ellipse` | 椭圆/圆/弧 | 不支持 | 头像占位、图标背景 |
| `path` | SVG 路径 | 不支持 | 自定义图形 |
| `polygon` | 多边形 | 不支持 | 星形、三角形 |
| `text` | 文本 | 不支持 | 标题、段落、标签 |
| `icon` | 图标库图标 | 不支持 | UI 图标 |
| `note` | 便签 | 不支持 | 设计备注 |
| `ref` | 组件实例 | - | 复用组件 |

### 3.2 Layout 枚举

| 属性 | 可选值 | 说明 |
|------|--------|------|
| `layout` | `"none"` / `"vertical"` / `"horizontal"` | none=绝对定位，vertical=垂直flex，horizontal=水平flex |
| `justifyContent` | `"start"` / `"center"` / `"end"` / `"space_between"` / `"space_around"` | 主轴对齐 |
| `alignItems` | `"start"` / `"center"` / `"end"` | 交叉轴对齐，**不支持** `stretch` |
| `gap` | 数字 | 子元素间距 |
| `padding` | 数字 / `[v, h]` / `[t, r, b, l]` | 内边距，顺序：上、右、下、左 |
| `clip` | `true` / `false` | 裁剪溢出内容 |

### 3.3 尺寸

| 写法 | 说明 |
|------|------|
| 数字（如 `1440`） | 固定尺寸 |
| `"fit_content"` | 适应子元素大小（需节点有 layout） |
| `"fill_container"` | 填满父容器（需父节点有 layout，且自身非 `layoutPosition: "absolute"`） |

**不支持百分比**（如 `"100%"`）。

### 3.4 文本属性

| 属性 | 说明 |
|------|------|
| `content` | 文本内容 |
| `fontFamily` | 字体，如 `"Geist"`、`"Inter"`，所有 Google Fonts 可用 |
| `fontSize` | 字号 |
| `fontWeight` | 字重，如 `"400"`、`"700"` |
| `lineHeight` | 行高倍数 |
| `letterSpacing` | 字间距 |
| `textAlign` | `"left"` / `"center"` / `"right"` / `"justify"` |
| `textAlignVertical` | `"top"` / `"middle"` / `"bottom"` |
| `textGrowth` | `"auto"` / `"fixed-width"` / `"fixed-width-height"`（见下） |

**textGrowth 详解**：

| 值 | 宽度 | 高度 | 换行 |
|----|------|------|------|
| `"auto"` | 由内容决定 | 由内容决定 | 不换行，始终单行 |
| `"fixed-width"` | 必须设置 `width` | 由内容决定 | 按宽度换行 |
| `"fixed-width-height"` | 必须设置 `width` | 必须设置 `height` | 按宽度换行，可能溢出 |

需要换行时必须用 `fixed-width` 或 `fixed-width-height`。优先用 `fixed-width` + `fill_container` 适配容器。

### 3.5 图标属性

| 属性 | 说明 |
|------|------|
| `library` | `"lucide"` / `"feather"` / `"Material Symbols Outlined"` / `"Material Symbols Rounded"` / `"Material Symbols Sharp"` / `"phosphor"` |
| `icon` | 图标名，如 `"search"` / `"home"` / `"settings"` |
| `weight` | 100-700，仅部分库支持 |

### 3.6 通用属性

| 属性 | 说明 |
|------|------|
| `id` | 唯一标识，不含 `/`，建议语义化如 `"header"`、`"cta-button"` |
| `name` | 显示名称 |
| `fill` | 填充色，如 `"#FFFFFF"`，支持渐变/图片 |
| `stroke` | 描边 |
| `strokeWidth` | 描边宽度，数字或 `{top, right, bottom, left}` |
| `cornerRadius` | 圆角，数字或 `[tl, tr, br, bl]` |
| `opacity` | 透明度 0-1 |
| `rotation` | 旋转角度，逆时针，绕左上角 |
| `layoutPosition` | `"auto"` / `"absolute"`，absolute 脱离布局流 |
| `effect` | 效果：blur / background_blur / shadow |
| `enabled` | 是否可见 |
| `reusable` | 是否可作为组件复用 |

### 3.7 填充类型

```javascript
fill: "#FF0000"
fill: { type: "color", color: "#FF0000" }
fill: { type: "gradient", gradientType: "linear", rotation: 180, colors: [{ color: "#FF0000", position: 0 }, { color: "#0000FF", position: 1 }] }
fill: { type: "image", url: "./image.jpg", mode: "fill" }
```

## 4. 常见错误速查

| 错误信息 | 原因 | 修复 |
|---------|------|------|
| `SyntaxError: expecting ','` | DSL 中有 `//` 注释 | 删除所有注释 |
| `ReferenceError: 'I' is not defined` | 用了 `I()` | 改为 `Insert()` |
| `ReferenceError: 'xxx' is not defined` | 引用跨块返回的 ID | 用 `document` 或同块变量 |
| `Invalid properties: /alignItems expected one of...` | 用了不支持的值如 `stretch` | 用 `start`/`center`/`end` |
| `Node has 'fill_container' sizing but not inside flexbox` | `fill_container` 在无 layout 父容器中 | 确保父容器有 `layout` |
| `FindEmptySpace expects an object with width and height` | `FindEmptySpace()` 无参 | 传 `{ width, height }` |

**关键**：`batch_design` 是原子操作，块内任一错误导致整个块回滚。

## 5. 最佳实践

### 5.1 单块优先

单页设计尽量在同一块内完成，用变量传递构建嵌套。先建容器再填内容：

```javascript
home = Insert(document, { type: "frame", layout: "vertical", ... })
header = Insert(home, { type: "frame", layout: "horizontal", ... })
logo = Insert(header, { type: "text", ... })
```

### 5.2 多页面必须设坐标

`Insert(document, ...)` 创建页面时**必须设置 `x` 和 `y`**，否则所有页面叠加在 `(0, 0)`。

横向平铺公式：`x = n * (page_width + gap)`，gap 建议 ≥ 100。

```javascript
page1 = Insert(document, { type: "frame", x: 0, y: 0, width: 1440, height: 900, ... })
page2 = Insert(document, { type: "frame", x: 1540, y: 0, width: 1440, height: 900, ... })
page3 = Insert(document, { type: "frame", x: 3080, y: 0, width: 1440, height: 900, ... })
```

### 5.3 属性最小化

- 不设置默认值（如 `layout: "none"` 是 frame 默认，可省略）
- 用 `fit_content` / `fill_container` 代替硬编码尺寸
- 子元素需匹配父容器宽高时用 `fill_container`，不要重复硬编码父容器的尺寸值

### 5.4 文本尺寸

不要猜测文本尺寸，始终依赖 `textGrowth` + flex 布局自动计算。需要换行时设 `textGrowth: "fixed-width"` + `width`。

## 6. 完整示例

```javascript
home = Insert(document, {
  type: "frame",
  id: "home",
  name: "Home Page",
  width: 1440,
  height: 3200,
  fill: "#FFFFFF",
  layout: "vertical",
  gap: 0,
  clip: true
})

header = Insert(home, {
  type: "frame",
  id: "header",
  width: 1440,
  height: 72,
  fill: "#FFFFFF",
  layout: "horizontal",
  justifyContent: "space_between",
  alignItems: "center",
  padding: [16, 48, 16, 48]
})

Insert(header, {
  type: "text",
  id: "logo",
  content: "CatNet",
  fontFamily: "Geist",
  fontSize: 28,
  fontWeight: "700",
  fill: "#1EBFBF",
  textGrowth: "auto"
})

nav = Insert(header, {
  type: "frame",
  id: "nav",
  layout: "horizontal",
  gap: 32,
  alignItems: "center",
  width: "fit_content",
  height: "fit_content"
})

Insert(nav, {
  type: "text",
  id: "nav-pricing",
  content: "定价",
  fontSize: 16,
  fill: "#5B6065",
  fontFamily: "Geist",
  textGrowth: "auto"
})

ctaButton = Insert(header, {
  type: "frame",
  id: "cta-button",
  layout: "horizontal",
  justifyContent: "center",
  alignItems: "center",
  width: 120,
  height: 40,
  cornerRadius: 8,
  fill: "#1EBFBF",
  gap: 8
})

Insert(ctaButton, {
  type: "text",
  id: "cta-text",
  content: "开始使用",
  fontFamily: "Geist",
  fontSize: 14,
  fontWeight: "600",
  fill: "#FFFFFF",
  textGrowth: "auto"
})

hero = Insert(home, {
  type: "frame",
  id: "hero",
  width: 1440,
  height: 600,
  fill: "#F8FAFC",
  layout: "vertical",
  justifyContent: "center",
  alignItems: "center",
  gap: 24,
  padding: [80, 48, 80, 48]
})

Insert(hero, {
  type: "text",
  id: "hero-title",
  content: "构建下一代应用",
  fontFamily: "Geist",
  fontSize: 48,
  fontWeight: "700",
  fill: "#1A1A2E",
  textGrowth: "auto"
})

Insert(hero, {
  type: "text",
  id: "hero-subtitle",
  content: "简单、快速、可靠的全栈开发平台",
  fontFamily: "Geist",
  fontSize: 20,
  fill: "#5B6065",
  textGrowth: "auto"
})

featuresGrid = Insert(home, {
  type: "frame",
  id: "features-grid",
  width: 1440,
  layout: "horizontal",
  justifyContent: "center",
  gap: 32,
  padding: [64, 48, 64, 48]
})

featureCard1 = Insert(featuresGrid, {
  type: "frame",
  id: "feature-card-1",
  width: 400,
  layout: "vertical",
  gap: 16,
  padding: 32,
  cornerRadius: 12,
  fill: "#FFFFFF",
  stroke: "#E2E8F0",
  strokeWidth: 1
})

Insert(featureCard1, {
  type: "icon",
  id: "feature-icon-1",
  library: "lucide",
  icon: "zap",
  width: 32,
  height: 32,
  fill: "#1EBFBF"
})

Insert(featureCard1, {
  type: "text",
  id: "feature-title-1",
  content: "极速部署",
  fontFamily: "Geist",
  fontSize: 20,
  fontWeight: "600",
  fill: "#1A1A2E",
  textGrowth: "auto"
})

Insert(featureCard1, {
  type: "text",
  id: "feature-desc-1",
  content: "一键部署到全球边缘节点，毫秒级冷启动",
  fontFamily: "Geist",
  fontSize: 14,
  fill: "#5B6065",
  textGrowth: "fixed-width",
  width: 336
})
```

## 7. 调试技巧

1. **从小块开始**：先测试简单 frame，确认无报错后再添加复杂结构
2. **逐行验证**：每次只添加 2-3 个节点，快速定位问题
3. **使用 `get_editor_state`**：每次 `batch_design` 后检查文档状态
4. **使用 `batch_get`**：查询已创建节点结构，确认层级关系
