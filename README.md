# @weibaohui/dsh-thinktank

[![DSH plugin](https://img.shields.io/badge/dsh-plugin-green)](https://github.com/topics/dsh-plugin)
[![npm version](https://img.shields.io/npm/v/@weibaohui/dsh-thinktank)](https://www.npmjs.com/package/@weibaohui/dsh-thinktank)
[![CI](https://github.com/weibaohui/dsh-thinktank/actions/workflows/ci.yml/badge.svg)](https://github.com/weibaohui/dsh-thinktank/actions/workflows/ci.yml)

**智囊团**：把 161 个经典思维模型变成你的智囊团。输入一个问题，多位「思维顾问」从决策、战略、认知、心理、沟通、学习、系统、产品、执行九个视角各自献策，AI 跨模型汇总出**共识 / 分歧 / 盲区 / 行动清单**的综合报告——像请了一个顾问团，而不是只问一个人。

## 效果演示

![demo：输入问题 → 选模型 → AI 推荐 → 确认 → 实时进度 → 综合报告](https://cdn.jsdelivr.net/gh/weibaohui/dsh-thinktank@main/docs/demo.gif)

| 向导三步 | 综合报告 |
|---|---|
| ![向导：输入问题 → 选择模型 → 确认提交](https://cdn.jsdelivr.net/gh/weibaohui/dsh-thinktank@main/docs/shots/step2.png) | ![综合报告：共识/分歧/盲区/行动清单](https://cdn.jsdelivr.net/gh/weibaohui/dsh-thinktank@main/docs/shots/report.png) |
| *第 2 步：关键词匹配推荐 + 绿色绶带选中态* | *真实报告：8 模型交叉分析民宿短租决策* |

| AI 智能推荐 | 实时进度 |
|---|---|
| ![AI 智能推荐：选型思路 + 带理由的推荐清单](https://cdn.jsdelivr.net/gh/weibaohui/dsh-thinktank@main/docs/shots/ai-recommend.png) | ![历史页实时任务卡片](https://cdn.jsdelivr.net/gh/weibaohui/dsh-thinktank@main/docs/shots/running.png) |
| *AI 通读模型库后选型，每个推荐带具体理由* | *提交后自动跳转历史页，批次进度与结论实时填满* |

## 核心功能

- **四步向导**：输入问题（可附背景）→ 🪞 拷问澄清（可选，可跳过）→ 选择模型（搜索 / 分类筛选 / 双推荐）→ 确认提交（胶囊上点 × 可最后移除）；提交后自动跳历史页，向导重置等待下一次输入
- **🪞 拷问澄清**（grill-me 风格）：分析前 AI 先扮演拷问者，针对你的问题出 3-6 个要害追问——隐藏假设、成功标准、真实约束、机会成本、最坏承受力；每个追问说明它能把什么逼到台面上。回答自动并入背景，让多模型分析明显更贴身；不想答可一键跳过，流程与原来完全一致
- **161 个经典思维模型**：第一性原理、逆向思维、二阶思维、SWOT、PESTEL、波特五力、蓝海战略、商业模式画布、护城河、北极星指标、确认偏误、锚定效应、达克效应、人类误判心理学、峰终定律、损失厌恶、鸟笼效应、沉默的螺旋、课题分离、金字塔原理、MECE、SCQA、非暴力沟通、乔哈里视窗、费曼学习法、刻意练习、心流、复利效应、反馈回路、杠杆点、黑天鹅、反脆弱、路径依赖、熵增、第二曲线、HOOK 上瘾、JTBD、福格行为模型、PDCA、5Why、事前验尸……每个模型含定义、要点、适用场景与引导分析问题，「模型库」页可当思维模式手册浏览
- **两种推荐**：
  - 🔍 **关键词匹配**——本地 n-gram 加权匹配（场景关键词 ×8、名称 ×6、定义 ×2），毫秒出结果，不经 AI
  - ✨ **AI 智能推荐**——起一个 AI 会话通读 161 个模型后为你的问题选型（6-12 个、跨分类），弹窗实时显示 AI 输出过程，每个推荐带具体理由，勾选采用
- **双模式分析**：
  - 🧠 **自动分析**——host 把选中模型按每批 6 个分给多个 agent 会话并行执行（3 路并发），完成后跨模型综合；单批失败不影响其余
  - 📋 **提示词往返**——一键生成含全部模型与输出契约的提示词，粘贴到任意 AI 会话执行后把结果粘回导入（无 agents 服务时的完整降级路径）
- **综合报告页**：🧭 综合结论 + 🤝 模型共识 + ⚡ 观点分歧 + 🕳️ 盲区提醒 + ✅ 行动清单（注明依据模型），信号总览（有利/不利/风险/中性），每模型一张卡（结论、洞察、建议、可展开完整分析），按分类过滤，一键导出 Markdown
- **历史与实时进度**：报告持久化保存（最近 50 份）可回看；提交后历史页顶部出现实时任务卡片，批次状态与各模型结论随执行逐渐填满，完成后自动转入历史列表
- **会话可辨**：插件发起的每个 AI 会话都带「🦉 智囊团 · 问题摘要 · 阶段」标题，侧边栏一眼可认
- **明暗主题跟随**：按官方约定监听 `body[data-ds-dark-theme]` / `html[data-ds-theme-source]` 属性，事件驱动即时跟随，无轮询

## 安装

```bash
dsh plugin add @weibaohui/dsh-thinktank
```

入口默认在左侧栏 Global panels（🦉 智囊团）；刷新页面即用。

## 使用

1. **输入问题**：一句话说清要分析什么；补充背景（约束、资源、时间线、相关方）会让分析明显更贴身
2. **拷问澄清（可选）**：让 AI 拷问你的意图并作答，回答并入背景；拿得准可直接跳过
3. **选择模型**：手动勾选，或用两种推荐；建议 6-24 个、跨分类组合
4. **确认提交**：胶囊可点 × 最后调整；提交后自动跳历史页看实时进度
5. **看报告**：综合结论 → 模型共识/分歧/盲区 → 行动清单 → 逐模型卡片；可导出 Markdown

## 技术说明

- **host 半体**（`src/`）：纯 CJS 零运行时依赖。`models.js` 模型库前后端同源（client 经 esbuild 内联）；`prompt.js` 负责提示词构建与 `===MIND-JSON===` 标记协议的提取/校验（容忍代码围栏与尾随散文，id 白名单 + 长度钳制 + signal 枚举兜底）；`index.js` 提供路由（全部挂 `connection.requestRejection` 信任栅栏）、分批任务调度（并发池 + 12 分钟会话超时）与报告持久化（storageDomain 域 `dsh_thinktank`，域打不开退化内存并如实标注）
- **client 半体**（`client/`）：React 函数组件，无 class 组件、渲染路径全 total 化；CSS 变量双主题
- **AI 输出协议**：回复末尾 `===MIND-JSON===` + 单个 JSON 对象，解析失败 fail-safe（批次级降级，不废整份报告）
- **测试**：25 个离线测试覆盖模型库完整性、协议容错、全部路由（含栅栏拦截断言）、分析流水线端到端（mock agents 模拟分批失败/综合失败）与重启读回持久化；`test/render-harness.html` 可在无宿主环境下用真实 Chrome 渲染面板

## 开发

```bash
npm install
npm run build:client   # 改了 client/index.js 必须重跑（宿主加载的是 bundle.js）
npm run check          # 语法检查
npm test               # 离线测试
```

本地联调：

```bash
dsh plugin --profile web add /path/to/dsh-thinktank
```

## 发版

GitHub Release 触发 npm Trusted Publishing（OIDC 直发，无需 NPM_TOKEN）：

```bash
npm version patch
git push --follow-tags
gh release create vX.Y.Z --generate-notes
```

## License

MIT
