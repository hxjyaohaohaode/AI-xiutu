> 历史记录：146 项初版测试的五轮执行，不计入当前扩展版本的五轮。

# 五轮完整自动化检查原始记录摘要

日期：2026-11-09。五轮对同一份代码和配置执行，未用抽样或跳过代替全量测试。此处的“完整”指仓库现有自动化门；外部供应商、真实手机与网络未因此被认定完成验收。

源码与配置 SHA-256：`54000635bcdffde122a15a6d8fc3c66d956cfebdb39bf36222299e1f181166b5`。

Node.js 24.22.1；每轮使用独立 PostgreSQL 18.6 WASM/PGlite 实际 SQL 数据库（单后端）。原生 PostgreSQL 并发与容器结果另记。

| 轮次     | 起始 UTC                 | 结束 UTC                 | 测试通过/失败/跳过 | 类型检查 | 构建 | 生产审计 |
| -------- | ------------------------ | ------------------------ | ------------------ | -------- | ---- | -------- |
| round-01 | 2026-11-09T13:10:35.411Z | 2026-11-09T13:11:09.408Z | 146 / 0 / 0        | 通过     | 通过 | 0 漏洞   |
| round-02 | 2026-11-09T13:11:26.385Z | 2026-11-09T13:11:55.850Z | 146 / 0 / 0        | 通过     | 通过 | 0 漏洞   |
| round-03 | 2026-11-09T13:12:09.606Z | 2026-11-09T13:12:40.864Z | 146 / 0 / 0        | 通过     | 通过 | 0 漏洞   |
| round-04 | 2026-11-09T13:13:24.233Z | 2026-11-09T13:13:54.245Z | 146 / 0 / 0        | 通过     | 通过 | 0 漏洞   |
| round-05 | 2026-11-09T13:14:26.074Z | 2026-11-09T13:14:56.782Z | 146 / 0 / 0        | 通过     | 通过 | 0 漏洞   |

每轮均执行 `npm run typecheck`、`npm test`（`REQUIRE_DB_TESTS=1`）、前端生产构建和 `npm audit --omit=dev --audit-level=high`。所有命令退出码为 0。五轮并不意味着 730 个不同场景：是同一 146 项完整测试连续重新执行五次。

## 命令耗时与日志校验值

原始日志保留在本地被忽略的 `artifacts/verification/`。下表提供 SHA-256，未将本地运行数据或凭据提交到公开仓库。

| 轮次     | 检查                    | 耗时 ms | 退出码 | 日志 SHA-256                                                       |
| -------- | ----------------------- | ------- | ------ | ------------------------------------------------------------------ |
| round-01 | typecheck               | 15200   | 0      | `db3d65c25e7c4e4ffc154a0d8b0230d0315481d795a3f2adde14a269c0675d5c` |
| round-01 | tests                   | 9425    | 0      | `65544cca6f72531a492ff0ed296ac6df9923f283014b9fd3e3bea373c3a234d3` |
| round-01 | web-build               | 685     | 0      | `6d4e4c1fa61f41a35d3501ec6743b9e951d98390493ef17d7764e86509b6335f` |
| round-01 | production-dependencies | 8681    | 0      | `70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c` |
| round-02 | typecheck               | 15443   | 0      | `db3d65c25e7c4e4ffc154a0d8b0230d0315481d795a3f2adde14a269c0675d5c` |
| round-02 | tests                   | 8576    | 0      | `9f74955ce78d5fae469287128b9ce039ad888a012f84793e4d0706816cef63bc` |
| round-02 | web-build               | 686     | 0      | `28717d046f0155799a53d3e11275a6b98621d3a359557446936799a10dc74735` |
| round-02 | production-dependencies | 4749    | 0      | `70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c` |
| round-03 | typecheck               | 16416   | 0      | `db3d65c25e7c4e4ffc154a0d8b0230d0315481d795a3f2adde14a269c0675d5c` |
| round-03 | tests                   | 8724    | 0      | `565ab70905290994e914c6690822757d35c1a9f710fb33a5aa801a058443f99c` |
| round-03 | web-build               | 836     | 0      | `3a22e2462d1b05bbe21aa398c3bbcaf92710507b4b9a8490d4c082bfb24211a9` |
| round-03 | production-dependencies | 5277    | 0      | `70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c` |
| round-04 | typecheck               | 15746   | 0      | `db3d65c25e7c4e4ffc154a0d8b0230d0315481d795a3f2adde14a269c0675d5c` |
| round-04 | tests                   | 8894    | 0      | `2570d622a5e051a9d6df9b3e25f34c04b41aee371620f9e51bec68c0710c1425` |
| round-04 | web-build               | 697     | 0      | `007f812f0fe78db3d3b7d59aac0fe1895dd44c3c1cde913766481cdda080e599` |
| round-04 | production-dependencies | 4671    | 0      | `70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c` |
| round-05 | typecheck               | 17099   | 0      | `db3d65c25e7c4e4ffc154a0d8b0230d0315481d795a3f2adde14a269c0675d5c` |
| round-05 | tests                   | 8321    | 0      | `a1f3a5c36b69dc4aed594dea8aa62d64bce4d2eaf9f1ca85356ce35ffeb24b53` |
| round-05 | web-build               | 729     | 0      | `dae97d34c275e0a4a1506e2e95a94a6ed1877eb00a5e629348409664e59472a0` |
| round-05 | production-dependencies | 4555    | 0      | `70d17afa06a0dda6a5ee3172326fe7062d7e9a2ad06b5733d035a730e9ddf71c` |

## 脚本返回的原始报告

```json
{
  "label": "round-01",
  "startedAt": "2026-11-09T13:10:35.411Z",
  "finishedAt": "2026-11-09T13:11:09.408Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "54000635bcdffde122a15a6d8fc3c66d956cfebdb39bf36222299e1f181166b5",
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 15200,
      "log": "round-01-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 9425,
      "log": "round-01-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 685,
      "log": "round-01-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 8681,
      "log": "round-01-production-dependencies.log"
    }
  ],
  "passed": true
}
```

```json
{
  "label": "round-02",
  "startedAt": "2026-11-09T13:11:26.385Z",
  "finishedAt": "2026-11-09T13:11:55.850Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "54000635bcdffde122a15a6d8fc3c66d956cfebdb39bf36222299e1f181166b5",
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 15443,
      "log": "round-02-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 8576,
      "log": "round-02-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 686,
      "log": "round-02-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 4749,
      "log": "round-02-production-dependencies.log"
    }
  ],
  "passed": true
}
```

```json
{
  "label": "round-03",
  "startedAt": "2026-11-09T13:12:09.606Z",
  "finishedAt": "2026-11-09T13:12:40.864Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "54000635bcdffde122a15a6d8fc3c66d956cfebdb39bf36222299e1f181166b5",
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 16416,
      "log": "round-03-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 8724,
      "log": "round-03-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 836,
      "log": "round-03-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 5277,
      "log": "round-03-production-dependencies.log"
    }
  ],
  "passed": true
}
```

```json
{
  "label": "round-04",
  "startedAt": "2026-11-09T13:13:24.233Z",
  "finishedAt": "2026-11-09T13:13:54.245Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "54000635bcdffde122a15a6d8fc3c66d956cfebdb39bf36222299e1f181166b5",
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 15746,
      "log": "round-04-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 8894,
      "log": "round-04-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 697,
      "log": "round-04-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 4671,
      "log": "round-04-production-dependencies.log"
    }
  ],
  "passed": true
}
```

```json
{
  "label": "round-05",
  "startedAt": "2026-11-09T13:14:26.074Z",
  "finishedAt": "2026-11-09T13:14:56.782Z",
  "runtime": "v24.22.1",
  "database": "PostgreSQL 18.6 WASM/PGlite (single backend)",
  "sourceFingerprint": "54000635bcdffde122a15a6d8fc3c66d956cfebdb39bf36222299e1f181166b5",
  "unchangedDuringChecks": true,
  "checks": [
    {
      "name": "typecheck",
      "status": 0,
      "durationMs": 17099,
      "log": "round-05-typecheck.log"
    },
    {
      "name": "tests",
      "status": 0,
      "durationMs": 8321,
      "log": "round-05-tests.log"
    },
    {
      "name": "web-build",
      "status": 0,
      "durationMs": 729,
      "log": "round-05-web-build.log"
    },
    {
      "name": "production-dependencies",
      "status": 0,
      "durationMs": 4555,
      "log": "round-05-production-dependencies.log"
    }
  ],
  "passed": true
}
```
