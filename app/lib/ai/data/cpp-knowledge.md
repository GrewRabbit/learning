# C++ 知识点体系库

> 用途：供 skill 在生成第五章"知识点思维导图"时按本库的层级组织思维导图节点。
> 维护方式：直接编辑本文件即可，无需修改 skill prompt。skill 会通过 orchestrator 自动加载本文件并拼接进 prompt。
>
> 层级约定（思维导图节点必须按此层级组织）：
> - 根节点：题目名称
> - 第二层：本题涉及的知识大类（从下方 9 大类中挑选，仅列出与本题相关的）
> - 第三层：该大类下的子分类（仅列出与本题相关的子分类）
> - 第四层：该子分类下的具体知识点（仅列出本题实际用到的，避免冗余）
>
> **命名安全规范（重要）**：节点文本**禁止**包含以下 Mermaid 特殊字符：
> - 英文括号 `()` `[]` `{}`（Mermaid 形状字符，会触发 Syntax error）
> - 双冒号 `::`（Mermaid `::icon()` 语法，会触发 Syntax error）
> - 斜杠 `/`（可能被解析为分隔符）
> - 加号 `+`、星号 `*`（Mermaid 语法字符）
> - 三元运算符 `?:`（冒号会被误解析）
>
> 命名时用中文文字代替符号，如 `std::optional` 写作 `optional 可选值`，`if / else` 写作 `if 与 else`。

---

## 1. 基础语法与数据类型

### 基本数据类型
- 整型 int
- 浮点型 float 与 double
- 字符型 char
- 布尔型 bool
- void 类型
- 类型修饰符 signed unsigned short long

### 变量与常量
- 变量的声明与初始化
- const 常量
- constexpr 编译期常量
- volatile 易变变量

### 类型推导
- auto 关键字
- decltype 类型推导

### 作用域与命名空间
- 全局作用域
- 局部作用域
- namespace 命名空间
- using 指令

### 控制流 条件判断
- if 与 else
- switch 与 case
- 三元运算符

### 控制流 循环语句
- for 循环
- while 循环
- do-while 循环
- 基于范围的 for 循环

### 控制流 跳转语句
- break
- continue
- return
- goto

### 运算符
- 算术运算符
- 关系运算符
- 逻辑运算符
- 位运算符
- 赋值运算符
- 逗号运算符
- 运算符优先级

---

## 2. 内存管理与指针

### 指针基础
- 内存与地址
- 指针的定义与运算
- 指针与数组的关系

### 引用
- 左值引用
- 常量引用
- 右值引用

### 内存分配
- 栈内存与堆内存的区别
- new 与 delete
- malloc 与 free

### 智能指针 RAII
- unique_ptr 独占指针
- shared_ptr 共享指针
- weak_ptr 弱指针

### 类型转换
- C 风格转换
- static_cast 静态转换
- dynamic_cast 动态转换
- const_cast 常量转换
- reinterpret_cast 重解释转换

---

## 3. 函数

### 函数基础
- 函数的声明与定义
- 参数传递 值传递
- 参数传递 指针传递
- 参数传递 引用传递
- 默认参数

### 高级特性
- 函数重载
- 内联函数 inline
- Lambda 表达式

### 异常处理
- try catch throw 机制
- noexcept 异常规范

---

## 4. 面向对象编程 OOP

### 类与对象
- 类的定义
- 访问控制 public private protected
- this 指针
- 静态成员 static
- 友元 friend

### 构造与析构
- 默认构造函数
- 带参构造函数
- 拷贝构造函数
- 移动构造函数
- 析构函数
- 初始化列表
- Rule of Five 与 Rule of Zero

### 继承
- 单继承
- 多重继承
- 菱形继承与虚继承 virtual
- 派生类的构造与析构顺序

### 多态
- 编译期多态 函数重载
- 运行期多态 虚函数 virtual
- 纯虚函数
- 抽象类
- 虚函数表 vtable 与虚表指针 vptr
- 运行时类型识别 RTTI

### 运算符重载
- 成员函数重载
- 友元函数重载

---

## 5. 模板与泛型编程

### 函数模板
- 模板的定义
- 模板实例化
- 模板重载

### 类模板
- 类模板的定义与实例化
- 类模板的静态成员与友元

### 高级模板
- 模板特化与偏特化
- 可变参数模板
- SFINAE
- C++20 Concepts 概念

---

## 6. STL 标准模板库

### 容器 顺序容器
- vector 动态数组
- list 链表
- deque 双端队列
- array 数组

### 容器 关联容器
- map 映射
- set 集合
- multimap 多重映射
- multiset 多重集合

### 容器 无序容器
- unordered_map 无序映射
- unordered_set 无序集合

### 容器 容器适配器
- stack 栈
- queue 队列
- priority_queue 优先队列

### 迭代器
- 输入迭代器
- 输出迭代器
- 前向迭代器
- 双向迭代器
- 随机访问迭代器

### 算法
- 查找算法 find
- 排序算法 sort
- 遍历算法
- 修改算法

### 字符串处理
- string 字符串
- string_view 字符串视图

---

## 7. 数据结构与算法 应用层

### 线性结构
- 数组
- 链表
- 栈
- 队列

### 树形结构
- 二叉树
- 二叉搜索树 BST
- 平衡二叉树 AVL
- 红黑树
- B 树与 B 加树
- 堆 Heap

### 图与哈希
- 图的遍历 BFS 与 DFS
- 最短路径算法
- 哈希表原理

---

## 8. 现代 C++ 特性与并发编程

### 现代特性
- 移动语义
- 结构化绑定
- optional 可选值
- variant 变体
- any 任意类型
- 协程

### 多线程与并发
- thread 线程
- mutex 互斥锁
- 条件变量
- atomic 原子操作
- async 与 future 异步编程

---

## 9. 文件与流 I/O

### 流的概念
- iostream 体系
- 格式化输入与输出

### 文件操作
- 文件流 fstream 的打开
- 文件流 fstream 的关闭
- 文件读写操作
- 随机文件读写

### 字符串流
- stringstream 字符串流
