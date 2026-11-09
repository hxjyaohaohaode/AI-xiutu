# 精修扩展版：五轮完整自动化检查

日期：2026-11-09。五轮均对同一份冻结代码和配置重新执行全部现有自动化门，没有用抽样、跳过数据库测试或旧版本结果补足轮数。这里的“完整”指仓库内现有自动化检查，不等同所有设想、真实手机、真实供应商或网络均已验收。

源码与配置 SHA-256：`7862ad0e7c607648b24d3a4e48036ede4491917f1093220a88d2d96875961902`。

Node.js 24.22.1；每轮独立创建 PostgreSQL 18.6 WASM/PGlite 测试数据库。PGlite 只有一个后端连接语义，原生并发和容器检查单独记录。

| 轮次 | 开始 UTC | 结束 UTC | 通过 / 失败 / 跳过 | 类型检查 | 生产构建 | 生产依赖审计 |
|---|---|---|---|---|---|---|
| refinement-round-01 | 2026-11-09T15:30:10.719Z | 2026-11-09T15:30:56.241Z | 253 / 0 / 0 | 通过 | 通过 | 0 漏洞 |
| refinement-round-02 | 2026-11-09T15:31:23.818Z | 2026-11-09T15:32:04.663Z | 253 / 0 / 0 | 通过 | 通过 | 0 漏洞 |
| refinement-round-03 | 2026-11-09T15:32:06.426Z | 2026-11-09T15:32:48.429Z | 253 / 0 / 0 | 通过 | 通过 | 0 漏洞 |
| refinement-round-04 | 2026-11-09T15:32:50.428Z | 2026-11-09T15:33:33.181Z | 253 / 0 / 0 | 通过 | 通过 | 0 漏洞 |
| refinement-round-05 | 2026-11-09T15:33:35.492Z | 2026-11-09T15:34:17.345Z | 253 / 0 / 0 | 通过 | 通过 | 0 漏洞 |

每轮重新执行 `npm run typecheck`、`npm test`（`REQUIRE_DB_TESTS=1`）、Web 生产构建、`npm audit --omit=dev --audit-level=high`。全部命令退出码 0，运行前后指纹一致。五轮合计 1,265 次测试条目执行，是同一组 253 项反复执行，不是 1,265 个独立场景。此前 146 项初版基线的五轮已归档到 [历史记录](initial-rounds.md)，没有计入本轮。

源码指纹排除 Markdown、Git 内部、密钥、生成目录和本地数据；包含源码、配置和本轮已保存截图。四张本轮截图先保存后执行五轮。其余平台和运行限制见 [总验证记录](../VERIFICATION.md) 与 [真实浏览器记录](browser-refinement.md)。

## 日志摘要校验值

原始日志保存在被忽略的 `artifacts/verification/`。这里保存时间、退出码和 SHA-256，不把本地开发数据或凭据推入仓库。

| 轮次 | 检查 | 耗时 ms | 退出码 | 日志 SHA-256 |
|---|---|---|---|---|
| refinement-round-01 | typecheck | 19873 | 0 | `db3d65c25e7c4e4ffc154a0d8b0230d0315481d795a3f2adde14a269c0675d5c` |
| refinement-round-01 | tests | 16872 | 0 | `e98a4acfec3b6ba80bf1c981d60178ae85fb1b67d60e9e23d557a540a011c882` |
| refinement-round-01 | web-build | 863 | 0 | `28f01c51a3b95a042a35f580b3d38637ebb35ce1680930ff9a39ef7aaf9d5d2d` |
| refinement-round-01 | production-dependencies | 7908 | 0 | `70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c` |
| refinement-round-02 | typecheck | 19118 | 0 | `db3d65c25e7c4e4ffc154a0d8b0230d0315481d795a3f2adde14a269c0675d5c` |
| refinement-round-02 | tests | 15353 | 0 | `df2ffa9cd83f3d498e6989917f0d22afb77d812dee612cd6658587810dfac920` |
| refinement-round-02 | web-build | 901 | 0 | `10df91d1a9ff57a8ae71ecf56481d3a452f5306a1dca9f5399930fabeb0df797` |
| refinement-round-02 | production-dependencies | 5467 | 0 | `70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c` |
| refinement-round-03 | typecheck | 18338 | 0 | `db3d65c25e7c4e4ffc154a0d8b0230d0315481d795a3f2adde14a269c0675d5c` |
| refinement-round-03 | tests | 17311 | 0 | `816c4f39789e397bbeaf3fa50bcde35f57ee36070b2a52e91d448e7e290d3332` |
| refinement-round-03 | web-build | 1009 | 0 | `6e593e5442e0d857e32fa2a98da65919e0625a767e473975d4f5414916553367` |
| refinement-round-03 | production-dependencies | 5338 | 0 | `70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c` |
| refinement-round-04 | typecheck | 19770 | 0 | `db3d65c25e7c4e4ffc154a0d8b0230d0315481d795a3f2adde14a269c0675d5c` |
| refinement-round-04 | tests | 17390 | 0 | `8afdb50042294a25b0c477748f360e333c28235e03dff2dcaea8b100b40f1290` |
| refinement-round-04 | web-build | 829 | 0 | `e4139abb1eaa4434b59ec4af458e83795fd191d99fbdda38db2b17f87c2b4595` |
| refinement-round-04 | production-dependencies | 4755 | 0 | `70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c` |
| refinement-round-05 | typecheck | 19765 | 0 | `db3d65c25e7c4e4ffc154a0d8b0230d0315481d795a3f2adde14a269c0675d5c` |
| refinement-round-05 | tests | 15887 | 0 | `55ccb394369889a2776c49a11ea3c986784f9acf4dab042453e50942a2944393` |
| refinement-round-05 | web-build | 864 | 0 | `368de20fc826d1511e89635b7ceaa5422f4f161855340027b62e8dddf685bd7a` |
| refinement-round-05 | production-dependencies | 5328 | 0 | `70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c` |

## 原始机器报告

```json
{
  "label": "refinement-round-01",
  "startedAt": "2026-11-09T15:30:10.719Z",
  "finishedAt": "2026-11-09T15:30:56.241Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "7862ad0e7c607648b24d3a4e48036ede4491917f1093220a88d2d96875961902",
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 19873,
      "log": "refinement-round-01-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 16872,
      "log": "refinement-round-01-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 863,
      "log": "refinement-round-01-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 7908,
      "log": "refinement-round-01-production-dependencies.log"
    }
  ],
  "passed": true
}
```

```json
{
  "label": "refinement-round-02",
  "startedAt": "2026-11-09T15:31:23.818Z",
  "finishedAt": "2026-11-09T15:32:04.663Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "7862ad0e7c607648b24d3a4e48036ede4491917f1093220a88d2d96875961902",
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 19118,
      "log": "refinement-round-02-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 15353,
      "log": "refinement-round-02-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 901,
      "log": "refinement-round-02-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 5467,
      "log": "refinement-round-02-production-dependencies.log"
    }
  ],
  "passed": true
}
```

```json
{
  "label": "refinement-round-03",
  "startedAt": "2026-11-09T15:32:06.426Z",
  "finishedAt": "2026-11-09T15:32:48.429Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "7862ad0e7c607648b24d3a4e48036ede4491917f1093220a88d2d96875961902",
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 18338,
      "log": "refinement-round-03-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 17311,
      "log": "refinement-round-03-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 1009,
      "log": "refinement-round-03-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 5338,
      "log": "refinement-round-03-production-dependencies.log"
    }
  ],
  "passed": true
}
```

```json
{
  "label": "refinement-round-04",
  "startedAt": "2026-11-09T15:32:50.428Z",
  "finishedAt": "2026-11-09T15:33:33.181Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "7862ad0e7c607648b24d3a4e48036ede4491917f1093220a88d2d96875961902",
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 19770,
      "log": "refinement-round-04-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 17390,
      "log": "refinement-round-04-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 829,
      "log": "refinement-round-04-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 4755,
      "log": "refinement-round-04-production-dependencies.log"
    }
  ],
  "passed": true
}
```

```json
{
  "label": "refinement-round-05",
  "startedAt": "2026-11-09T15:33:35.492Z",
  "finishedAt": "2026-11-09T15:34:17.345Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "7862ad0e7c607648b24d3a4e48036ede4491917f1093220a88d2d96875961902",
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 19765,
      "log": "refinement-round-05-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 15887,
      "log": "refinement-round-05-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 864,
      "log": "refinement-round-05-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 5328,
      "log": "refinement-round-05-production-dependencies.log"
    }
  ],
  "passed": true
}
```
